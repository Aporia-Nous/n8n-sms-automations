// Build the webhook response (what the caller of the webhook sees). No secrets in here.
return $input.all().map((it, i) => {
  let c = it.json;
  if (!c.flow) { try { c = $('Live: Log Result').itemMatching(i).json; } catch (e) { /* keep */ } }
  return { json: {
    ok: true, flow: c.flow, source: c.source, business_id: c.business_id, from: c.from,
    action: c.action, reason: c.reason, test_mode: c.test_mode,
    hours: c.hours ? { open: c.hours.open, local: `${c.hours.local_day} ${c.hours.local_time}`, next_open: c.hours.next_open } : undefined,
    sms: c.sms ? { to: c.sms.to, from: c.sms.from, kind: c.sms.kind, body: c.sms.body, segments: c.sms.segments, encoding: c.sms.encoding } : null,
    owner_alert: c.owner_alert ? { subject: c.owner_alert.subject, priority: c.owner_alert.priority } : null,
    llm_used: c.llm_used || false,
    ref: c.ref, detail: c.detail,
    delivery: c.delivery || null,
  } };
});
