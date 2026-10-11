// Inbound-SMS Router: one inbound webhook per business number.
// 1) STOP/START/HELP handled here, once, for every automation (shared data/optouts.json).
// 2) Otherwise find the live "conversations" this business has with the number and pick one:
//    a. clear reminder intent (C / CONFIRM / R / RESCHEDULE, or a sentence about cancelling / running late) + a live reminder  -> reminders
//    b. a rating-shaped reply ("5", "4 stars", "3/5", "2 - ...") + a live review request                                  -> reviews
//    c. otherwise the most recent outbound text wins; if the top two are within tie_window_minutes                        -> owner (unclear)
//    d. no live context (unknown or stale number)                                                                            -> owner
//@@COMMON@@
const out = [];
for (const item of $input.all()) {
  const ev = item.json;
  const cfg = readJson(path.join(ev.data_dir, 'config.json'), null);
  if (!cfg) throw new Error('config.json not found');
  const [bizId, biz] = findBusiness(cfg, ev.business_id, ev.to);
  const s = Object.assign({}, cfg.defaults || {}, biz || {});
  const RT = Object.assign({ missed_call_window_hours: 72, reminder_window_hours: 72, reminder_after_start_hours: 2, review_window_days: 7, tie_window_minutes: 15, internal_base_url: 'http://127.0.0.1:5678/webhook/' }, s.router || {});
  const ctx = Object.assign({}, ev, { flow: 'sms_router', business_id: bizId || ev.business_id || '', business_name: biz ? biz.name : '', test_mode: s.test_mode !== false, provider: s.provider || 'test', action: 'none', reason: '', route: 'central', sms: null, owner_alert: null });
  const tokenSha = ev._token_sha256; delete ctx._token_sha256;
  const now = new Date(ev.timestamp);
  const logRoute = (extra) => { const dir = path.join(ev.data_dir, 'logs'); fs.mkdirSync(dir, { recursive: true }); fs.appendFileSync(path.join(dir, 'router.jsonl'), JSON.stringify(Object.assign({ logged_at: new Date().toISOString(), execution_id: $execution.id, business_id: ctx.business_id, from: ev.from, text: ev.text, at: ev.timestamp }, extra)) + '\n'); };
  if (!tokenOk(s, tokenSha)) { ctx.action = 'rejected'; ctx.reason = 'bad_webhook_token'; logRoute({ route: 'rejected', reason: ctx.reason }); out.push({ json: ctx }); continue; }
  if (!biz) { ctx.action = 'rejected'; ctx.reason = 'unknown_business'; logRoute({ route: 'rejected', reason: ctx.reason }); out.push({ json: ctx }); continue; }
  const vars = { business_name: biz.name, business_number: biz.sms_from || (biz.numbers || [])[0] || '' };
  const mk = (body, kind) => Object.assign({ to: ev.from, from: biz.sms_from || (biz.numbers || [])[0], body, kind }, segments(body));
  const kw = keywordOf(ev.text);

  // ---- live contexts ----
  const H = 3600000; const ctxs = [];
  const state = readJson(path.join(ev.data_dir, 'state.json'), {});
  const mcTimes = [((state.texted || {})[bizId] || {})[ev.from], ((state.booking_replies || {})[bizId] || {})[ev.from]].filter(Boolean).map((t) => new Date(t)).filter((t) => t <= now);
  if (mcTimes.length) { const last = new Date(Math.max(...mcTimes)); const live = now - last <= RT.missed_call_window_hours * H; ctxs.push({ automation: 'missed_call', last_out: last.toISOString(), live, why: live ? 'text-back sent' : 'older than ' + RT.missed_call_window_hours + 'h' }); }
  const appts = Object.values((readJson(path.join(ev.data_dir, 'appointments.json'), {})[bizId]) || {}).filter((a) => a.phone === ev.from);
  for (const a of appts) {
    const sent = Object.values(a.reminders || {}).filter((r) => r.status === 'sent').map((r) => new Date(r.at)).filter((t) => t <= now);
    if (!sent.length) continue;
    const last = new Date(Math.max(...sent));
    const live = ['booked', 'confirmed', 'cancel_requested'].includes(a.status) && now <= new Date(new Date(a.start).getTime() + RT.reminder_after_start_hours * H) && now - last <= RT.reminder_window_hours * H;
    ctxs.push({ automation: 'reminders', ref: a.id, last_out: last.toISOString(), live, why: live ? 'reminder for upcoming appointment' : 'appointment over/cancelled or reminder too old' });
  }
  const jobs = Object.values((readJson(path.join(ev.data_dir, 'review-queue.json'), {})[bizId]) || {}).filter((r) => r.phone === ev.from);
  for (const r of jobs) {
    const sent = [r.sent_at, r.followup_sent_at].filter(Boolean).map((t) => new Date(t)).filter((t) => t <= now);
    if (!sent.length) continue;
    const last = new Date(Math.max(...sent));
    const live = now - last <= RT.review_window_days * 24 * H;
    ctxs.push({ automation: 'reviews', ref: r.job_id, last_out: last.toISOString(), live, why: live ? 'review request sent' : 'older than ' + RT.review_window_days + ' days' });
  }
  const live = ctxs.filter((c) => c.live).sort((x, y) => new Date(y.last_out) - new Date(x.last_out));
  // one context per automation (latest)
  const byAuto = []; for (const c of live) if (!byAuto.find((b) => b.automation === c.automation)) byAuto.push(c);
  // ---- STOP / START / HELP: once, centrally ----
  if (handleComplianceKeyword(ctx, ev, bizId, biz, s, kw, RT.help_template, vars, mk)) {
    const rem = byAuto.find((c) => c.automation === 'reminders');
    if (kw === 'CANCEL' && rem) { const oa = biz.owner_alert || {}; ctx.owner_alert = { to_email: oa.email || '', to_sms: oa.sms || '', subject: `Opt-out + possible cancellation: ${ev.from}`, body: `${biz.name}: ${ev.from} replied "${ev.text}" and is now opted out of texts. They have appointment ${rem.ref} coming up; they may have meant to cancel it. Please call them.`, priority: 'high' }; }
    logRoute({ route: 'central', action: ctx.action, reason: ctx.reason }); out.push({ json: ctx }); continue;
  }
  const t = String(ev.text || '');
  const reminderIntent = ['C', 'CONFIRM', 'CONFIRMED', 'R', 'RESCHEDULE'].includes(kw) || /\b(cancel|cancell?ing|can'?t make it|cannot make it|won'?t make it|reschedule|running late|running behind|on my way|be there in)\b/i.test(t);
  const ratingShape = /^\s*[1-5]\s*(stars?|\/\s*5|out of 5)?\s*[.!]*\s*$/i.test(t) || /\b[1-5]\s*(stars?|\/\s*5|out of 5)\b/i.test(t) || /^\s*[1-5]\s*[-–:,]/.test(t);
  let pick = null, rule = '';
  const has = (a) => byAuto.find((c) => c.automation === a);
  if (reminderIntent && has('reminders')) { pick = has('reminders'); rule = 'a:reminder_intent'; }
  else if (ratingShape && has('reviews')) { pick = has('reviews'); rule = 'b:rating_reply'; }
  else if (byAuto.length === 1) { pick = byAuto[0]; rule = 'c:only_live_context'; }
  else if (byAuto.length > 1) {
    const gap = (new Date(byAuto[0].last_out) - new Date(byAuto[1].last_out)) / 60000;
    if (gap >= RT.tie_window_minutes) { pick = byAuto[0]; rule = 'c:most_recent (' + Math.round(gap) + ' min newer than ' + byAuto[1].automation + ')'; }
    else rule = 'tie:' + byAuto[0].automation + '+' + byAuto[1].automation + ' within ' + Math.round(gap) + ' min';
  }
  ctx.detail = { rule, contexts: ctxs };
  if (pick) {
    const path_ = { missed_call: 'sms-reply', reminders: 'reminder-reply', reviews: 'review-reply' }[pick.automation];
    ctx.route = 'forward'; ctx.action = 'routed'; ctx.reason = 'to_' + pick.automation; ctx.target = pick.automation;
    ctx.forward = { url: RT.internal_base_url + path_, body: { from: ev.from, to: ev.to, text: ev.text, business_id: bizId, timestamp: ev.timestamp, source: 'router' } };
    ctx._fwd_token = s.webhook_token || ''; // passed as a header to the internal webhook; never logged or returned
  } else {
    const oa = biz.owner_alert || {};
    ctx.action = 'forward_to_owner'; ctx.reason = byAuto.length ? 'unclear_' + rule : (ctxs.length ? 'stale_context_only' : 'no_context_unknown_number');
    const known = ctxs.map((c) => `${c.automation}${c.ref ? ' ' + c.ref : ''} (last text ${fmtWhen(new Date(c.last_out), now, biz.timezone || 'America/Chicago')}, ${c.live ? 'live' : 'stale'})`).join('; ');
    ctx.owner_alert = { to_email: oa.email || '', to_sms: oa.sms || '', subject: `Text from ${ev.from}${byAuto.length ? ' (unclear which conversation)' : ''}`, body: `${biz.name}: ${ev.from} wrote: "${ev.text}". ${known ? 'Recent automated texts: ' + known + '.' : 'No recent automated texts to this number.'} No auto-reply was sent.`, priority: 'normal' };
  }
  logRoute({ route: ctx.route, action: ctx.action, reason: ctx.reason, target: ctx.target || null, rule, contexts: ctxs.map((c) => ({ a: c.automation, ref: c.ref, last_out: c.last_out, live: c.live })) });
  out.push({ json: ctx });
}
return out;
