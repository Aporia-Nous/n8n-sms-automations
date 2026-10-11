// Review Requests: handle replies. No gating: the review link already went to everyone in the first text,
// and BOTH the happy and the unhappy auto-reply carry that same link. Unhappy replies also alert the owner privately.
//@@COMMON@@
const NEG = /\b(bad|terrible|awful|horrible|worst|poor|unhappy|not happy|disappointed|rude|overcharged|over charged|too expensive|rip ?off|broken|still (makes|making|has|having|doing|broke)|didn'?t fix|not fixed|never again|(?<!no )problems?|(?<!no )issues?|complain|angry|upset|waited too long|late)\b/i;
const POS = /\b(great|awesome|amazing|excellent|perfect|love|loved|happy|thank(s| you)|fantastic|good job|great job|wonderful|best|recommend)\b/i;
const out = [];
for (const item of $input.all()) {
  const ev = item.json;
  const cfg = readJson(path.join(ev.data_dir, 'config.json'), null);
  if (!cfg) throw new Error('config.json not found');
  const [bizId, biz] = findBusiness(cfg, ev.business_id, ev.to);
  const s = Object.assign({}, cfg.defaults || {}, biz || {});
  const ctx = Object.assign({}, ev, { flow: 'review_reply', business_id: bizId || ev.business_id || '', business_name: biz ? biz.name : '', test_mode: s.test_mode !== false, provider: s.provider || 'test', action: 'none', reason: '', sms: null, owner_alert: null });
  delete ctx._token_sha256;
  if (!tokenOk(s, ev._token_sha256)) { ctx.reason = 'bad_webhook_token'; out.push({ json: ctx }); continue; }
  if (!biz || !(biz.reviews || {}).enabled) { ctx.reason = 'unknown_business_or_reviews_off'; out.push({ json: ctx }); continue; }
  const RV = biz.reviews; const T = RV.templates || {};
  const f = path.join(ev.data_dir, 'review-queue.json'); const all = readJson(f, {});
  const r = Object.values(all[bizId] || {}).filter((x) => x.phone === ev.from && x.sent_at).sort((x, y) => new Date(y.sent_at) - new Date(x.sent_at))[0];
  const vars = { business_name: biz.name, first_name: r ? (String(r.customer_name || '').split(' ')[0] || 'there') : 'there', review_link: RV.review_link, business_number: biz.sms_from || '' };
  const mk = (body, kind) => Object.assign({ to: ev.from, from: biz.sms_from, body, kind }, segments(body));
  const oa = biz.owner_alert || {};
  const alert = (subject, body, priority) => ({ to_email: oa.email || '', to_sms: oa.sms || '', subject, body, priority });
  const kw = keywordOf(ev.text);
  ctx.ref = r ? r.job_id : '';
  if (handleComplianceKeyword(ctx, ev, bizId, biz, s, kw, T.help, vars, mk)) { out.push({ json: ctx }); continue; }
  const who = r ? `${r.customer_name || ev.from} (${ev.from}), job ${r.job_id}${r.service ? ' (' + r.service + ')' : ''}` : ev.from;
  const m = ev.text.match(/^\s*([1-5])\s*(stars?|\/\s*5|out of 5)?\s*[.!]*\s*$/i) || ev.text.match(/\b([1-5])\s*(stars?|\/\s*5|out of 5)\b/i) || ev.text.match(/^\s*([1-5])\b/);
  const rating = m ? Number(m[1]) : null;
  const neg = NEG.test(ev.text); const pos = POS.test(ev.text);
  const mood = rating !== null ? (rating <= 3 ? 'unhappy' : (neg ? 'unhappy' : 'happy')) : (neg ? 'unhappy' : (pos ? 'happy' : 'neutral'));
  ctx.detail = { rating, mood };
  if (!r) {
    ctx.action = 'forward'; ctx.reason = 'no_review_request_found';
    ctx.owner_alert = alert(`Text from ${ev.from}`, `${biz.name}: ${ev.from} wrote: "${ev.text}"`, 'normal');
  } else if (r.replied_at) {
    // one auto-reply per request; later messages just go to the owner
    ctx.action = 'forward'; ctx.reason = 'already_replied_once';
    ctx.owner_alert = alert(`Another reply from ${r.customer_name || ev.from}`, `${biz.name}: ${who} wrote: "${ev.text}"`, mood === 'unhappy' ? 'high' : 'normal');
  } else {
    r.replied_at = ev.timestamp; r.reply_mood = mood; r.reply_rating = rating; writeJson(f, all);
    if (mood === 'unhappy') {
      ctx.action = 'unhappy_owner_alerted'; ctx.reason = rating !== null ? 'rating_' + rating : 'negative_words';
      ctx.sms = mk(render(T.unhappy_reply, vars), 'review_unhappy_reply');
      ctx.owner_alert = alert(`PRIVATE: unhappy customer ${r.customer_name || ev.from}`, `${biz.name}: ${who} replied: "${ev.text}". Please reach out personally. (They received the same review link as everyone else.)`, 'high');
    } else if (mood === 'happy') {
      ctx.action = 'happy_link_resent'; ctx.reason = rating !== null ? 'rating_' + rating : 'positive_words';
      ctx.sms = mk(render(T.happy_reply, vars), 'review_happy_reply');
      ctx.owner_alert = alert(`Happy customer: ${r.customer_name || ev.from}`, `${biz.name}: ${who} replied: "${ev.text}"`, 'low');
    } else {
      ctx.action = 'forward'; ctx.reason = 'neutral_reply';
      ctx.owner_alert = alert(`Reply from ${r.customer_name || ev.from}`, `${biz.name}: ${who} replied: "${ev.text}"`, 'normal');
    }
  }
  out.push({ json: ctx });
}
return out;
