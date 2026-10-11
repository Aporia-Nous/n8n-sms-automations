// Rules: business lookup, missed-call filter, opt-out list, business hours, dedupe window.
// Output action: 'text' (send the text-back) or 'skip' (with a reason). Owner alert is prepared here too.
//@@COMMON@@
const out = [];
for (const item of $input.all()) {
  const ev = item.json;
  const cfg = readJson(path.join(ev.data_dir, 'config.json'), null);
  if (!cfg) throw new Error('config.json not found or invalid in ' + ev.data_dir);
  const [bizId, biz] = findBusiness(cfg, ev.business_id, ev.to);
  const s = Object.assign({}, cfg.defaults || {}, biz || {});
  const ctx = Object.assign({}, ev, {
    business_id: bizId || ev.business_id || '',
    business_name: biz ? biz.name : '',
    test_mode: s.test_mode !== false,
    provider: s.provider || 'test',
    llm: Object.assign({ enabled: false }, s.llm || {}),
    action: 'skip', reason: '', template_key: '', sms: null, owner_alert: null, hours: null,
  });
  delete ctx._token_sha256;
  const skip = (reason, alert) => { ctx.action = 'skip'; ctx.reason = reason; ctx.alert_owner = !!alert; };

  if (!tokenOk(s, ev._token_sha256)) skip('bad_webhook_token');
  else if (!biz) skip('unknown_business');
  else if (!ev.is_missed) skip('not_missed:' + (ev.call_status_raw || 'unknown'));
  else if (!ev.from || ev.from.length < 8) skip('no_caller_number');
  else if ((biz.ignore_numbers || []).includes(ev.from) || (biz.numbers || []).includes(ev.from)) skip('internal_number');
  else {
    const when = new Date(ev.timestamp);
    ctx.hours = hoursStatus(when, biz);
    const optouts = readJson(path.join(ev.data_dir, 'optouts.json'), {});
    const state = readJson(path.join(ev.data_dir, 'state.json'), { texted: {}, booking_replies: {} });
    state.texted = state.texted || {};
    const last = ((state.texted[bizId] || {})[ev.from]) || null;
    const windowMs = Number(s.dedupe_window_hours || 24) * 3600 * 1000;
    if (optouts[bizId] && optouts[bizId][ev.from]) {
      skip('opted_out', s.owner_alert_on_opted_out !== false);
    } else if (last && Math.abs(when - new Date(last)) < windowMs) {
      skip('duplicate_within_' + (s.dedupe_window_hours || 24) + 'h', s.owner_alert_on_duplicate === true);
      ctx.last_texted_at = last;
    } else if (!ctx.hours.open && s.after_hours_mode === 'skip') {
      skip('after_hours_no_text', true);
    } else {
      ctx.action = 'text';
      ctx.reason = ctx.hours.open ? 'missed_in_hours' : 'missed_after_hours';
      ctx.template_key = ctx.hours.open ? 'in_hours' : 'after_hours';
      ctx.alert_owner = true;
      // reserve the dedupe slot now so a quick second call can't double-text
      state.texted[bizId] = state.texted[bizId] || {};
      state.texted[bizId][ev.from] = ev.timestamp;
      writeJson(path.join(ev.data_dir, 'state.json'), state);
    }
  }

  if (ctx.action === 'text') {
    const vars = { business_name: biz.name, booking_link: biz.booking_link || '', next_open: ctx.hours.next_open, business_number: biz.sms_from || (biz.numbers || [])[0] || '', caller_name: ev.caller_name || '' };
    let body = render((biz.templates || {})[ctx.template_key], vars);
    const footer = (biz.templates || {}).opt_out_footer || 'Reply STOP to opt out.';
    if (s.append_opt_out_footer !== false && !/\bSTOP\b/.test(body)) body = body + ' ' + footer;
    ctx.sms = { to: ev.from, from: biz.sms_from || (biz.numbers || [])[0], body, kind: 'missed_call_text_back', template: ctx.template_key, footer, ...segments(body) };
  }
  if (biz && ctx.alert_owner) {
    const oa = biz.owner_alert || {};
    const local = ctx.hours ? `${DAYNAMES[ctx.hours.local_day]} ${fmt12(ctx.hours.local_time)} (${ctx.hours.timezone})` : ev.timestamp;
    const what = ctx.action === 'text' ? 'We texted them back automatically.' : `No text sent (${ctx.reason}). Consider calling back.`;
    ctx.owner_alert = {
      to_email: oa.email || '', to_sms: oa.sms || '',
      subject: `Missed call from ${ev.from}${ev.caller_name ? ' (' + ev.caller_name + ')' : ''}`,
      body: `${biz.name}: missed call from ${ev.from} at ${local}. ${what}`,
      priority: ctx.hours && ctx.hours.open ? 'normal' : 'low',
    };
  }
  out.push({ json: ctx });
}
return out;
