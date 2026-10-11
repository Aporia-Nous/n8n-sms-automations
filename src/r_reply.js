// Appointment Reminders: handle replies (C = confirm, R = reschedule, "cancel ..." sentence, "running late", STOP/START/HELP).
// Note: a reply that is only the word CANCEL is a carrier opt-out keyword, so it is treated as STOP.
//@@COMMON@@
const out = [];
for (const item of $input.all()) {
  const ev = item.json;
  const cfg = readJson(path.join(ev.data_dir, 'config.json'), null);
  if (!cfg) throw new Error('config.json not found');
  const [bizId, biz] = findBusiness(cfg, ev.business_id, ev.to);
  const s = Object.assign({}, cfg.defaults || {}, biz || {});
  const ctx = Object.assign({}, ev, { flow: 'reminder_reply', business_id: bizId || ev.business_id || '', business_name: biz ? biz.name : '', test_mode: s.test_mode !== false, provider: s.provider || 'test', action: 'none', reason: '', sms: null, owner_alert: null });
  delete ctx._token_sha256;
  if (!tokenOk(s, ev._token_sha256)) { ctx.reason = 'bad_webhook_token'; out.push({ json: ctx }); continue; }
  if (!biz || !(biz.reminders || {}).enabled) { ctx.reason = 'unknown_business_or_reminders_off'; out.push({ json: ctx }); continue; }
  const R = biz.reminders; const T = R.templates || {}; const tz = biz.timezone || 'America/Chicago';
  const now = new Date(ev.timestamp);
  const f = path.join(ev.data_dir, 'appointments.json'); const all = readJson(f, {});
  // the appointment this reply is about: the soonest upcoming (or just-started) one for this number that got a reminder
  const cands = Object.values(all[bizId] || {}).filter((a) => a.phone === ev.from && ['booked', 'confirmed'].includes(a.status) && new Date(a.start) > new Date(now.getTime() - 2 * 3600000)).sort((x, y) => new Date(x.start) - new Date(y.start));
  const a = cands.find((x) => Object.values(x.reminders || {}).some((r) => r.status === 'sent')) || cands[0];
  const vars = { business_name: biz.name, first_name: a ? (String(a.customer_name || '').split(' ')[0] || 'there') : 'there', when: a ? fmtWhen(new Date(a.start), now, tz) : '', booking_link: biz.booking_link || '', business_number: biz.sms_from || '' };
  const mk = (body, kind) => Object.assign({ to: ev.from, from: biz.sms_from, body, kind }, segments(body));
  const oa = biz.owner_alert || {};
  const alert = (subject, body, priority) => ({ to_email: oa.email || '', to_sms: oa.sms || '', subject, body, priority });
  const kw = keywordOf(ev.text);
  ctx.ref = a ? a.id : '';
  if (handleComplianceKeyword(ctx, ev, bizId, biz, s, kw, T.help, vars, mk)) {
    if (KW_STOP.includes(kw) && a && kw !== 'CANCEL') {
      ctx.owner_alert = alert(`Opt-out: ${a.customer_name || ev.from}`, `${biz.name}: ${a.customer_name || ev.from} (${ev.from}) replied ${kw} and is opted out of texts. They still have ${a.service || 'an appointment'} ${vars.when}; no more reminders will be texted.`, 'normal');
    } else if (kw === 'CANCEL' && a) {
      // e.g. a bare "CANCEL": legally an opt-out, but they probably also meant the appointment
      ctx.owner_alert = alert(`Opt-out + possible cancellation: ${a.customer_name || ev.from}`, `${biz.name}: ${a.customer_name || ev.from} (${ev.from}) replied "${ev.text}" and is now opted out of texts. They have ${a.service || 'an appointment'} ${vars.when}; they may have meant to cancel it. Please call them.`, 'high');
    }
    out.push({ json: ctx }); continue;
  }
  const who = a ? `${a.customer_name || ev.from} (${ev.from}), ${a.service || 'appointment'} ${vars.when}` : ev.from;
  if (!a) {
    ctx.action = 'forward'; ctx.reason = 'no_upcoming_appointment_found';
    ctx.owner_alert = alert(`Text from ${ev.from}`, `${biz.name}: ${ev.from} wrote: "${ev.text}" (no upcoming appointment found for this number)`, 'normal');
  } else if (['C', 'CONFIRM', 'CONFIRMED', 'YES', 'Y', 'OK', 'YES CONFIRM'].includes(kw)) {
    a.status = 'confirmed'; a.confirmed_at = ev.timestamp; writeJson(f, all);
    ctx.action = 'confirmed'; ctx.reason = 'confirm_keyword:' + kw; ctx.sms = mk(render(T.confirm_reply, vars), 'confirm_reply');
  } else if (['R', 'RESCHEDULE', 'CHANGE', 'MOVE'].includes(kw)) {
    a.reschedule_requested_at = ev.timestamp; writeJson(f, all);
    ctx.action = 'reschedule_requested'; ctx.reason = 'reschedule_keyword:' + kw; ctx.sms = mk(render(T.reschedule_reply, vars), 'reschedule_reply');
    ctx.owner_alert = alert(`Reschedule request: ${a.customer_name || ev.from}`, `${biz.name}: ${who} wants to reschedule.`, 'high');
  } else if (/\b(cancel|cancell?ing|can't make it|cannot make it|can not make it|won't make it)\b/i.test(ev.text)) {
    a.status = 'cancel_requested'; a.cancel_requested_at = ev.timestamp; writeJson(f, all);
    ctx.action = 'cancel_requested'; ctx.reason = 'cancel_in_message'; ctx.sms = mk(render(T.cancel_ack, vars), 'cancel_ack');
    ctx.owner_alert = alert(`Cancellation request: ${a.customer_name || ev.from}`, `${biz.name}: ${who} wrote: "${ev.text}". Reminders for it are stopped; please confirm the cancellation.`, 'high');
  } else if (/\b(late|running behind|be there in|few min|stuck in traffic|on my way)\b/i.test(ev.text)) {
    ctx.action = 'running_late'; ctx.reason = 'late_in_message'; ctx.sms = mk(render(T.late_ack, vars), 'late_ack');
    ctx.owner_alert = alert(`Running late: ${a.customer_name || ev.from}`, `${biz.name}: ${who} wrote: "${ev.text}"`, 'high');
  } else {
    ctx.action = 'forward'; ctx.reason = 'other_reply';
    ctx.owner_alert = alert(`Reply from ${a.customer_name || ev.from}`, `${biz.name}: ${who} wrote: "${ev.text}"`, 'normal');
  }
  out.push({ json: ctx });
}
return out;
