// Router response after forwarding: wrap what the target automation answered.
return $input.all().map((it, i) => {
  let c = {}; try { c = $('Route Reply').itemMatching(i).json; } catch (e) {}
  const r = it.json || {};
  return { json: { ok: !r.error, flow: 'sms_router', business_id: c.business_id, from: c.from, action: 'routed', target: c.target, rule: (c.detail || {}).rule, test_mode: c.test_mode,
    downstream: r.error ? { error: String(r.error.message || r.error) } : { flow: r.flow, action: r.action, reason: r.reason, ref: r.ref, sms: r.sms ? { kind: r.sms.kind, body: r.sms.body } : null, owner_alert: r.owner_alert || null, delivery: r.delivery || null } } };
});
