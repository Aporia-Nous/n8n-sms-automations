// TEST MODE: nothing is sent. The would-be text goes to logs/outbox.jsonl and the owner alert to
// logs/owner-alerts.jsonl. Every decision is appended to logs/events.jsonl.
//@@COMMON@@
const out = [];
for (const item of $input.all()) {
  const ctx = item.json;
  const dir = path.join(ctx.data_dir, 'logs');
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date().toISOString();
  const append = (f, o) => fs.appendFileSync(path.join(dir, f), JSON.stringify(o) + '\n');
  const ex = $execution.id;
  if (ctx.sms) append('outbox.jsonl', { logged_at: now, execution_id: ex, mode: 'TEST_NOT_SENT', business_id: ctx.business_id, provider_would_be: ctx.provider, ...ctx.sms });
  if (ctx.owner_alert) append('owner-alerts.jsonl', { logged_at: now, execution_id: ex, mode: 'TEST_NOT_SENT', business_id: ctx.business_id, ...ctx.owner_alert });
  append('events.jsonl', { logged_at: now, execution_id: ex, mode: 'test', flow: ctx.flow, source: ctx.source, business_id: ctx.business_id, from: ctx.from, to: ctx.to, action: ctx.action, reason: ctx.reason, text_in: ctx.text, would_send_sms: !!ctx.sms, would_alert_owner: !!ctx.owner_alert });
  out.push({ json: Object.assign({}, ctx, { delivery: { mode: 'test', sms: ctx.sms ? 'logged_not_sent' : 'none', owner_alert: ctx.owner_alert ? 'logged_not_sent' : 'none' } }) });
}
return out;
