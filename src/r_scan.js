// Appointment Reminders: find reminders that are due (runs every 15 min, or via the test "run" webhook with a simulated now).
// Once-only: each reminder slot (24h, 2h) is marked in appointments.json the moment it is decided (sent or skipped).
const DATA_DIR = '/data/n8n-flows/data'; // change this if you move the data folder
//@@COMMON@@
const cfg = readJson(path.join(DATA_DIR, 'config.json'), null);
if (!cfg) throw new Error('config.json not found in ' + DATA_DIR);
const trig = $input.first().json || {};
const viaWebhook = !!trig.body;
let now = new Date();
if (viaWebhook && trig.body.now && (cfg.defaults || {}).test_mode !== false) now = new Date(trig.body.now); // simulated time only allowed in test mode
const f = path.join(DATA_DIR, 'appointments.json');
const all = readJson(f, {});
const out = [];
let changed = false;
for (const [bizId, appts] of Object.entries(all)) {
  const biz = (cfg.businesses || {})[bizId];
  if (!biz || !(biz.reminders || {}).enabled) continue;
  const s = Object.assign({}, cfg.defaults || {}, biz);
  const R = biz.reminders;
  const offsets = (R.offsets_hours || [24, 2]).map(Number).sort((a, b) => b - a);
  const minLead = Number(R.min_lead_minutes || 30) * 60000;
  const tz = biz.timezone || 'America/Chicago';
  for (const a of Object.values(appts)) {
    if (!['booked', 'confirmed'].includes(a.status)) continue;
    const start = new Date(a.start);
    if (now >= start) continue;
    for (let k = 0; k < offsets.length; k++) {
      const o = offsets[k]; const key = o + 'h';
      if (a.reminders[key]) continue;
      const due = new Date(start.getTime() - o * 3600000);
      if (now < due) continue;
      const base = { flow: 'reminder', data_dir: DATA_DIR, source: viaWebhook ? 'run_webhook' : 'schedule', business_id: bizId, business_name: biz.name, from: a.phone, to: biz.sms_from, test_mode: s.test_mode !== false, provider: s.provider || 'test', ref: a.id, sms: null, owner_alert: null, sim_now: now.toISOString() };
      const mark = (status, extra) => { a.reminders[key] = Object.assign({ status, at: now.toISOString() }, extra || {}); changed = true; };
      const later = offsets.slice(k + 1).find((o2) => now >= new Date(start.getTime() - o2 * 3600000));
      if (a.booked_at && new Date(a.booked_at) > due) { mark('skipped_booked_after_due'); out.push({ json: { ...base, action: 'skip', reason: key + ':booked_after_due_time' } }); continue; }
      if (later !== undefined) { mark('superseded'); out.push({ json: { ...base, action: 'skip', reason: key + ':superseded_by_' + later + 'h' } }); continue; }
      if (now.getTime() >= start.getTime() - minLead) { mark('skipped_too_late'); out.push({ json: { ...base, action: 'skip', reason: key + ':too_close_to_start' } }); continue; }
      if (isOptedOut(DATA_DIR, bizId, a.phone)) {
        const alreadyAlerted = Object.values(a.reminders).some((r) => r.status === 'skipped_opted_out');
        mark('skipped_opted_out');
        const oa = biz.owner_alert || {};
        out.push({ json: { ...base, action: 'skip', reason: key + ':opted_out', owner_alert: alreadyAlerted ? null : { to_email: oa.email || '', to_sms: oa.sms || '', subject: `No reminder sent: ${a.customer_name || a.phone} opted out`, body: `${biz.name}: ${a.customer_name || a.phone} (${a.phone}) has ${fmtWhen(start, now, tz)} booked but opted out of texts. Call if you need to confirm.`, priority: 'low' } } });
        continue;
      }
      if (!okToText(now, biz, s, false)) {
        const next = nextOkTime(now, biz, s, false);
        if (!next || next.getTime() >= start.getTime() - minLead) { mark('skipped_quiet_hours'); out.push({ json: { ...base, action: 'skip', reason: key + ':quiet_hours_until_too_late' } }); }
        else if (viaWebhook) out.push({ json: { ...base, action: 'deferred', reason: key + ':quiet_hours', detail: { next_try_after: next.toISOString() } } });
        continue;
      }
      const vars = { business_name: biz.name, first_name: String(a.customer_name || '').split(' ')[0] || 'there', pet_or_service: a.service || 'your appointment', when: fmtWhen(start, now, tz), booking_link: biz.booking_link || '', business_number: biz.sms_from || '' };
      const tpl = (R.templates || {})['reminder_' + key] || (R.templates || {}).reminder_24h;
      let body = render(tpl, vars);
      const footer = (biz.templates || {}).opt_out_footer || 'Reply STOP to opt out.';
      if (s.append_opt_out_footer !== false && !/\bSTOP\b/.test(body)) body += ' ' + footer;
      mark('sent');
      out.push({ json: { ...base, action: 'send_reminder', reason: key + '_reminder', sms: Object.assign({ to: a.phone, from: biz.sms_from, body, kind: 'reminder_' + key }, segments(body)), detail: { appointment_start: a.start, when: vars.when } } });
    }
  }
}
if (changed) writeJson(f, all);
if (!out.length && viaWebhook) out.push({ json: { flow: 'reminder', data_dir: DATA_DIR, source: 'run_webhook', action: 'none', reason: 'nothing_due', test_mode: (cfg.defaults || {}).test_mode !== false, sms: null, owner_alert: null, sim_now: now.toISOString() } });
return out;
