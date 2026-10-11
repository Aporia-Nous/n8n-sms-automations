// Review Requests: queue one review request when a job is completed.
// Generic payload: { business_id, job_id, customer_name, phone, completed_at (ISO), service }
// Google policy: no incentives, no gating. Every customer gets the same link; templates with incentive words are refused.
const DATA_DIR = '/data/n8n-flows/data'; // change this if you move the data folder
//@@COMMON@@
const INCENTIVE = /(discount|coupon|% ?off|\boff your\b|free\b|gift ?card|giveaway|raffle|prize|entry|entries|reward|cash ?back|voucher|promo|in exchange)/i;
const toE164 = (p) => { const s = String(p || '').trim(); const plus = s.startsWith('+'); const d = s.replace(/\D/g, ''); if (!d) return ''; if (plus) return '+' + d; if (d.length === 10) return '+1' + d; if (d.length === 11 && d.startsWith('1')) return '+' + d; return '+' + d; };
const out = [];
for (const item of $input.all()) {
  const req = item.json || {}; const b = req.body || {}; const q = req.query || {}; const h = req.headers || {};
  const presented = String(h['x-webhook-token'] || q.token || '');
  const sha = presented ? crypto.createHash('sha256').update(presented).digest('hex') : '';
  const cfg = readJson(path.join(DATA_DIR, 'config.json'), null);
  if (!cfg) throw new Error('config.json not found in ' + DATA_DIR);
  const phone = toE164(b.phone || b.customer_phone);
  const [bizId, biz] = findBusiness(cfg, b.business_id || q.business_id, toE164(b.to));
  const s = Object.assign({}, cfg.defaults || {}, biz || {});
  const RV = (biz || {}).reviews || {};
  const ctx = { flow: 'review_queue', data_dir: DATA_DIR, source: b.source || 'generic', business_id: bizId || b.business_id || '', from: phone, to: biz ? biz.sms_from : '', test_mode: s.test_mode !== false, provider: s.provider || 'test', action: 'skip', reason: '', sms: null, owner_alert: null, ref: String(b.job_id || '') };
  const done = new Date(b.completed_at || Date.now());
  const badTpl = Object.entries(RV.templates || {}).find(([, t]) => INCENTIVE.test(String(t)));
  const f = path.join(DATA_DIR, 'review-queue.json');
  const all = readJson(f, {});
  if (!tokenOk(s, sha)) ctx.reason = 'bad_webhook_token';
  else if (!biz) ctx.reason = 'unknown_business';
  else if (!RV.enabled) ctx.reason = 'reviews_not_enabled_for_business';
  else if (!RV.review_link) ctx.reason = 'missing_review_link';
  else if (badTpl) {
    ctx.reason = 'template_contains_incentive:' + badTpl[0];
    const oa = biz.owner_alert || {};
    ctx.owner_alert = { to_email: oa.email || '', to_sms: oa.sms || '', subject: 'Review texts paused: template offers an incentive', body: `${biz.name}: the "${badTpl[0]}" review template mentions an incentive, which Google's review policy forbids. No review requests are sent until it is fixed.`, priority: 'high' };
  }
  else if (!b.job_id) ctx.reason = 'missing_job_id';
  else if (!phone || phone.length < 8) ctx.reason = 'missing_phone';
  else if (isNaN(done.getTime())) ctx.reason = 'bad_completed_at';
  else if ((all[bizId] || {})[String(b.job_id)]) ctx.reason = 'duplicate_job';
  else if (isOptedOut(DATA_DIR, bizId, phone)) ctx.reason = 'opted_out';
  else {
    const minGap = Number(RV.min_days_between_requests || 90) * 86400000;
    const prev = Object.values(all[bizId] || {}).filter((r) => r.phone === phone && !String(r.status).startsWith('skipped')).sort((x, y) => new Date(y.completed_at) - new Date(x.completed_at))[0];
    if (prev && Math.abs(done - new Date(prev.sent_at || prev.completed_at)) < minGap) {
      ctx.reason = 'recently_asked'; ctx.detail = { previous_job: prev.job_id, previous_at: prev.sent_at || prev.completed_at };
    } else {
      const target = new Date(done.getTime() + Number(RV.delay_hours || 2) * 3600000);
      const sendAfter = nextOkTime(target, biz, s, true) || target;
      all[bizId] = all[bizId] || {};
      all[bizId][String(b.job_id)] = { job_id: String(b.job_id), phone, customer_name: b.customer_name || '', service: b.service || '', completed_at: done.toISOString(), send_after: sendAfter.toISOString(), status: 'queued' };
      writeJson(f, all);
      ctx.action = 'queued'; ctx.reason = sendAfter.getTime() === target.getTime() ? 'send_in_' + (RV.delay_hours || 2) + 'h' : 'moved_into_business_hours';
      ctx.detail = { send_after: sendAfter.toISOString(), local: fmtWhen(sendAfter, done, biz.timezone || 'America/Chicago') };
    }
  }
  out.push({ json: ctx });
}
return out;
