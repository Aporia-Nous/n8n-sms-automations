// Review Requests: send due requests and the single follow-up (every 15 min, or test "run" webhook with simulated now).
// Sends only inside business hours and outside quiet hours. Each request and follow-up is sent at most once.
const DATA_DIR = '/data/n8n-flows/data'; // change this if you move the data folder
//@@COMMON@@
const cfg = readJson(path.join(DATA_DIR, 'config.json'), null);
if (!cfg) throw new Error('config.json not found in ' + DATA_DIR);
const trig = $input.first().json || {};
const viaWebhook = !!trig.body;
let now = new Date();
if (viaWebhook && trig.body.now && (cfg.defaults || {}).test_mode !== false) now = new Date(trig.body.now);
const f = path.join(DATA_DIR, 'review-queue.json');
const all = readJson(f, {});
const out = []; let changed = false;
for (const [bizId, jobs] of Object.entries(all)) {
  const biz = (cfg.businesses || {})[bizId];
  if (!biz || !(biz.reviews || {}).enabled) continue;
  const s = Object.assign({}, cfg.defaults || {}, biz);
  const RV = biz.reviews; const T = RV.templates || {};
  const maxDelay = Number(RV.max_send_delay_days || 7) * 86400000;
  for (const r of Object.values(jobs)) {
    const base = { flow: 'review_request', data_dir: DATA_DIR, source: viaWebhook ? 'run_webhook' : 'schedule', business_id: bizId, business_name: biz.name, from: r.phone, to: biz.sms_from, test_mode: s.test_mode !== false, provider: s.provider || 'test', ref: r.job_id, sms: null, owner_alert: null, sim_now: now.toISOString() };
    let kind = null, due = null;
    if (r.status === 'queued') { kind = 'request'; due = new Date(r.send_after); }
    else if (r.status === 'sent' && RV.followup_enabled && !r.replied_at && !r.followup_sent_at) { kind = 'followup'; due = new Date(new Date(r.sent_at).getTime() + Number(RV.followup_after_days || 3) * 86400000); }
    if (!kind || now < due) continue;
    if (isOptedOut(DATA_DIR, bizId, r.phone)) { r.status = kind === 'request' ? 'cancelled_opted_out' : 'done_opted_out'; changed = true; out.push({ json: { ...base, action: 'skip', reason: kind + ':opted_out' } }); continue; }
    if (now - due > maxDelay) { r.status = kind === 'request' ? 'expired' : 'done_followup_expired'; changed = true; out.push({ json: { ...base, action: 'skip', reason: kind + ':too_old' } }); continue; }
    if (!okToText(now, biz, s, true)) {
      if (viaWebhook) out.push({ json: { ...base, action: 'deferred', reason: kind + ':outside_business_or_quiet_hours', detail: { next_try_after: (nextOkTime(now, biz, s, true) || now).toISOString() } } });
      continue;
    }
    const vars = { business_name: biz.name, first_name: String(r.customer_name || '').split(' ')[0] || 'there', review_link: RV.review_link, business_number: biz.sms_from || '' };
    let body = render(T[kind], vars);
    const footer = (biz.templates || {}).opt_out_footer || 'Reply STOP to opt out.';
    if (s.append_opt_out_footer !== false && !/\bSTOP\b/.test(body)) body += ' ' + footer;
    if (kind === 'request') { r.status = 'sent'; r.sent_at = now.toISOString(); } else { r.status = 'followed_up'; r.followup_sent_at = now.toISOString(); }
    changed = true;
    out.push({ json: { ...base, action: 'send_' + kind, reason: kind === 'request' ? 'review_request_due' : 'no_reply_after_' + (RV.followup_after_days || 3) + 'd', sms: Object.assign({ to: r.phone, from: biz.sms_from, body, kind: 'review_' + kind }, segments(body)) } });
  }
}
if (changed) writeJson(f, all);
if (!out.length && viaWebhook) out.push({ json: { flow: 'review_request', data_dir: DATA_DIR, source: 'run_webhook', action: 'none', reason: 'nothing_due', test_mode: (cfg.defaults || {}).test_mode !== false, sms: null, owner_alert: null, sim_now: now.toISOString() } });
return out;
