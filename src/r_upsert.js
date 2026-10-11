// Appointment Reminders: store / update / cancel an appointment.
// Generic payload: { business_id, appointment_id, customer_name, phone, start (ISO with offset), service, status: booked|rescheduled|cancelled, booked_at? }
const DATA_DIR = '/data/n8n-flows/data'; // change this if you move the data folder
//@@COMMON@@
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
  const ctx = { flow: 'appointment_upsert', data_dir: DATA_DIR, source: b.source || 'generic', business_id: bizId || b.business_id || '', from: phone, to: biz ? biz.sms_from : '', test_mode: s.test_mode !== false, provider: s.provider || 'test', action: 'rejected', reason: '', sms: null, owner_alert: null, ref: String(b.appointment_id || '') };
  const start = new Date(b.start || b.start_time);
  const status = String(b.status || 'booked').toLowerCase();
  if (!tokenOk(s, sha)) ctx.reason = 'bad_webhook_token';
  else if (!biz) ctx.reason = 'unknown_business';
  else if (!(biz.reminders || {}).enabled) ctx.reason = 'reminders_not_enabled_for_business';
  else if (!b.appointment_id) ctx.reason = 'missing_appointment_id';
  else if (status !== 'cancelled' && (!phone || phone.length < 8)) ctx.reason = 'missing_phone';
  else if (status !== 'cancelled' && isNaN(start.getTime())) ctx.reason = 'bad_start_time';
  else {
    const f = path.join(DATA_DIR, 'appointments.json');
    const all = readJson(f, {}); all[bizId] = all[bizId] || {};
    const id = String(b.appointment_id); const prev = all[bizId][id];
    const nowIso = (b.booked_at && !isNaN(new Date(b.booked_at))) ? new Date(b.booked_at).toISOString() : new Date().toISOString();
    if (status === 'cancelled') {
      if (prev) { prev.status = 'cancelled'; prev.updated_at = nowIso; ctx.action = 'cancelled'; ctx.reason = 'no further reminders'; }
      else { ctx.action = 'ignored'; ctx.reason = 'cancel_for_unknown_appointment'; }
    } else if (prev && prev.start !== start.toISOString()) {
      Object.assign(prev, { start: start.toISOString(), status: 'booked', reminders: {}, rescheduled_at: nowIso, updated_at: nowIso, phone, customer_name: b.customer_name || prev.customer_name, service: b.service || prev.service });
      ctx.action = 'rescheduled'; ctx.reason = 'reminders reset for new time';
    } else if (prev) {
      Object.assign(prev, { phone, customer_name: b.customer_name || prev.customer_name, service: b.service || prev.service, updated_at: nowIso });
      if (prev.status === 'cancelled') { prev.status = 'booked'; prev.reminders = {}; }
      ctx.action = 'updated'; ctx.reason = 'same time, details updated';
    } else {
      all[bizId][id] = { id, phone, customer_name: b.customer_name || '', service: b.service || '', start: start.toISOString(), status: 'booked', booked_at: nowIso, reminders: {} };
      ctx.action = 'stored'; ctx.reason = 'reminders scheduled';
    }
    writeJson(f, all);
    const a = all[bizId][id];
    if (a) ctx.detail = { start: a.start, status: a.status, local: fmtWhen(new Date(a.start), new Date(a.start), biz.timezone), reminders_planned: ((biz.reminders || {}).offsets_hours || [24, 2]).map((o) => o + 'h before') };
  }
  const dir = path.join(DATA_DIR, 'logs'); fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(path.join(dir, 'events.jsonl'), JSON.stringify({ logged_at: new Date().toISOString(), execution_id: $execution.id, mode: ctx.test_mode ? 'test' : 'live', flow: ctx.flow, business_id: ctx.business_id, from: ctx.from, ref: ctx.ref, action: ctx.action, reason: ctx.reason }) + '\n');
  out.push({ json: ctx });
}
return out;
