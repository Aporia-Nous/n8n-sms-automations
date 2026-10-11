// LIVE MODE bookkeeping: runs after the provider node (or directly when there is no SMS).
// Note: if the Twilio/Telnyx node is still disabled, the item just passes through and nothing was sent.
//@@COMMON@@
const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  let src; try { src = $('Test mode?').itemMatching(i).json; } catch (e) { src = items[i].json; }
  const ctx = JSON.parse(JSON.stringify(src));
  const r = items[i].json || {};
  const providerId = r.sid || (r.data && r.data.id) || null;
  const dir = path.join(ctx.data_dir, 'logs'); fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ logged_at: new Date().toISOString(), execution_id: $execution.id, mode: 'live', flow: ctx.flow, business_id: ctx.business_id, from: ctx.from, action: ctx.action, reason: ctx.reason, provider: ctx.provider, provider_message_id: providerId, sms_status: providerId ? 'accepted_by_provider' : (ctx.sms ? 'NOT_SENT_no_provider_response (send node disabled or failed)' : 'none') }) + '\n');
  out.push({ json: Object.assign(ctx, { delivery: { mode: 'live', provider: ctx.provider, provider_message_id: providerId, sms: providerId ? 'accepted_by_provider' : (ctx.sms ? 'not_sent_no_provider_response' : 'none'), owner_alert: ctx.owner_alert ? 'email node (disabled by default)' : 'none' } }) });
}
return out;
