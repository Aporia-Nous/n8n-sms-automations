// Normalize Inbound SMS (reply from a caller)
// Accepts Twilio (form-encoded From/To/Body), Telnyx (message.received) or generic {from,to,text,business_id}.
const DATA_DIR = '/data/n8n-flows/data'; // change this if you move the data folder
const toE164 = (p) => {
  if (p === undefined || p === null) return '';
  const s = String(p).trim(); const plus = s.startsWith('+'); const d = s.replace(/\D/g, '');
  if (!d) return ''; if (plus) return '+' + d; if (d.length === 10) return '+1' + d; if (d.length === 11 && d.startsWith('1')) return '+' + d; return '+' + d;
};
const out = [];
for (const item of $input.all()) {
  const req = item.json || {}; const b = req.body || {}; const q = req.query || {}; const h = req.headers || {};
  let m;
  if (b.MessageSid || b.SmsSid) m = { source: 'twilio', from: b.From, to: b.To, text: b.Body, id: b.MessageSid || b.SmsSid, business_id: q.business_id };
  else if (b.data && b.data.event_type) {
    const p = b.data.payload || {};
    m = { source: 'telnyx', event_type: b.data.event_type, from: (p.from || {}).phone_number, to: ((p.to || [])[0] || {}).phone_number, text: p.text, id: p.id, timestamp: b.data.occurred_at, business_id: q.business_id };
  } else m = { source: b.source || 'generic', from: b.from, to: b.to, text: b.text || b.body, id: b.message_id, timestamp: b.timestamp, business_id: b.business_id || q.business_id };
  const t = m.timestamp ? new Date(m.timestamp) : new Date();
  const presented = String(h['x-webhook-token'] || q.token || '');
  out.push({ json: {
    flow: 'sms_reply', data_dir: DATA_DIR, source: m.source,
    event_type: m.event_type || 'sms_received',
    from: toE164(m.from), to: toE164(m.to), text: String(m.text || '').trim(), message_id: m.id || '',
    business_id: m.business_id ? String(m.business_id) : '',
    timestamp: (isNaN(t.getTime()) ? new Date() : t).toISOString(),
    _token_sha256: presented ? require('crypto').createHash('sha256').update(presented).digest('hex') : '',
  } });
}
return out;
