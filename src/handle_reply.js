// Handle Reply: STOP / START / HELP keywords, booking-intent auto-reply, owner alert for real replies.
//@@COMMON@@
const STOP = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REVOKE'];
const START = ['START', 'UNSTOP', 'SUBSCRIBE'];
const HELP = ['HELP', 'INFO'];
const BOOKING = /\b(book|booking|appointment|appt|schedule|reschedule|come in|bring (it|my|the)|drop (it )?off|available|availability|openings?|today|tomorrow|quote|estimate)\b/i;
const out = [];
for (const item of $input.all()) {
  const ev = item.json;
  const cfg = readJson(path.join(ev.data_dir, 'config.json'), null);
  if (!cfg) throw new Error('config.json not found or invalid in ' + ev.data_dir);
  const [bizId, biz] = findBusiness(cfg, ev.business_id, ev.to);
  const s = Object.assign({}, cfg.defaults || {}, biz || {});
  const ctx = Object.assign({}, ev, {
    business_id: bizId || ev.business_id || '', business_name: biz ? biz.name : '',
    test_mode: s.test_mode !== false, provider: s.provider || 'test',
    action: 'none', reason: '', sms: null, owner_alert: null,
  });
  delete ctx._token_sha256;
  const kw = ev.text.toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
  if (!tokenOk(s, ev._token_sha256)) { ctx.reason = 'bad_webhook_token'; out.push({ json: ctx }); continue; }
  if (!biz) { ctx.reason = 'unknown_business'; out.push({ json: ctx }); continue; }
  const T = biz.templates || {};
  const vars = { business_name: biz.name, booking_link: biz.booking_link || '', business_number: biz.sms_from || (biz.numbers || [])[0] || '' };
  const from = biz.sms_from || (biz.numbers || [])[0];
  const mk = (body, kind) => Object.assign({ to: ev.from, from, body, kind }, segments(body));
  const optFile = path.join(ev.data_dir, 'optouts.json');
  const optouts = readJson(optFile, {});
  const isOptedOut = !!(optouts[bizId] && optouts[bizId][ev.from]);
  const oa = biz.owner_alert || {};
  const alert = (subject, body, priority) => ({ to_email: oa.email || '', to_sms: oa.sms || '', subject, body, priority: priority || 'normal' });

  if (STOP.includes(kw)) {
    optouts[bizId] = optouts[bizId] || {};
    optouts[bizId][ev.from] = { at: ev.timestamp, keyword: kw };
    writeJson(optFile, optouts);
    ctx.action = 'opt_out'; ctx.reason = 'stop_keyword:' + kw;
    if (s.send_stop_confirmation !== false) ctx.sms = mk(render(T.stop_confirm, vars), 'stop_confirmation');
    ctx.owner_alert = alert(`Opt-out: ${ev.from}`, `${biz.name}: ${ev.from} replied ${kw} and was added to the do-not-text list.`, 'low');
  } else if (START.includes(kw)) {
    if (optouts[bizId]) { delete optouts[bizId][ev.from]; writeJson(optFile, optouts); }
    ctx.action = 'opt_in'; ctx.reason = 'start_keyword:' + kw;
    ctx.sms = mk(render(T.start_confirm, vars), 'start_confirmation');
  } else if (HELP.includes(kw)) {
    ctx.action = 'help'; ctx.reason = 'help_keyword:' + kw;
    ctx.sms = mk(render(T.help, vars), 'help_reply');
  } else if (isOptedOut) {
    // they opted out earlier and sent something else: no auto-text, but the owner should see it
    ctx.action = 'forward_only'; ctx.reason = 'sender_opted_out';
    ctx.owner_alert = alert(`Text from opted-out number ${ev.from}`, `${biz.name}: ${ev.from} (opted out, do not auto-text) wrote: "${ev.text}"`);
  } else {
    ctx.action = 'forward'; ctx.reason = 'normal_reply';
    ctx.owner_alert = alert(`New text reply from ${ev.from}`, `${biz.name}: ${ev.from} replied: "${ev.text}"`, 'high');
    const state = readJson(path.join(ev.data_dir, 'state.json'), { texted: {}, booking_replies: {} });
    state.booking_replies = state.booking_replies || {};
    const last = (state.booking_replies[bizId] || {})[ev.from];
    const win = Number(s.booking_reply_window_hours || 12) * 3600 * 1000;
    if (s.auto_reply_booking_link !== false && biz.booking_link && BOOKING.test(ev.text)) {
      if (last && Math.abs(new Date(ev.timestamp) - new Date(last)) < win) {
        ctx.booking_reply = 'skipped_recently_sent';
      } else {
        ctx.action = 'forward_and_booking_link'; ctx.reason = 'booking_intent';
        ctx.sms = mk(render(T.booking_reply, vars), 'booking_link_reply');
        state.booking_replies[bizId] = state.booking_replies[bizId] || {};
        state.booking_replies[bizId][ev.from] = ev.timestamp;
        writeJson(path.join(ev.data_dir, 'state.json'), state);
      }
    }
  }
  out.push({ json: ctx });
}
return out;
