// Normalize Call Event
// Accepts a generic, Twilio, Telnyx or Votel "call ended" payload and turns it into one shape:
// { flow, source, from, to, business_id, timestamp, call_status, call_status_raw, is_missed, call_id, caller_name }
const DATA_DIR = '/data/n8n-flows/data'; // change this if you move the data folder

const toE164 = (p) => {
  if (p === undefined || p === null) return '';
  let s = String(p).trim();
  if (s.startsWith('sip:')) s = s.slice(4).split('@')[0];
  const plus = s.startsWith('+');
  const digits = s.replace(/\D/g, '');
  if (!digits) return '';
  if (plus) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '+' + digits;
};

const MISSED = new Set(['missed', 'no_answer', 'no-answer', 'noanswer', 'unanswered', 'busy', 'user_busy',
  'voicemail', 'canceled', 'cancelled', 'originator_cancel', 'failed', 'declined', 'call_rejected', 'timeout']);
const ANSWERED = new Set(['answered', 'completed', 'normal_clearing', 'in-progress', 'in_progress']);

const out = [];
for (const item of $input.all()) {
  const req = item.json || {};
  const b = req.body || {};
  const q = req.query || {};
  const h = req.headers || {};
  let ev = { source: 'generic' };

  if (b.CallSid || b.AccountSid) {
    // Twilio: <Dial action="..."> callback (DialCallStatus) or a call status callback (CallStatus). Form-encoded.
    ev = {
      source: 'twilio',
      from: b.From || b.Caller,
      to: b.To || b.Called,
      call_status_raw: b.DialCallStatus || b.CallStatus,
      timestamp: b.Timestamp,
      call_id: b.CallSid,
      direction: b.Direction,
      caller_name: b.CallerName,
      business_id: q.business_id,
    };
  } else if (b.data && b.data.event_type) {
    // Telnyx Call Control webhook. Only call.hangup is meaningful here.
    const p = b.data.payload || {};
    ev = {
      source: 'telnyx',
      event_type: b.data.event_type,
      from: p.from,
      to: p.to,
      call_status_raw: b.data.event_type === 'call.hangup' ? p.hangup_cause : 'ignored:' + b.data.event_type,
      timestamp: b.data.occurred_at,
      call_id: p.call_session_id || p.call_control_id,
      direction: p.direction,
      business_id: q.business_id,
    };
  } else if (b.source === 'votel' || b.call) {
    // Votel: call_ended trigger (statuses missed/no_answer/voicemail) -> webhook step POSTing this JSON.
    const c = b.call || {};
    ev = {
      source: 'votel',
      from: c.caller_id_number || b.from,
      to: c.to_number || b.to,
      call_status_raw: c.status || b.call_status || 'missed',
      timestamp: b.timestamp,
      call_id: c.id || b.call_id,
      caller_name: c.caller_id_name,
      business_id: b.business_id || q.business_id,
    };
  } else {
    ev = {
      source: 'generic',
      from: b.from,
      to: b.to,
      call_status_raw: b.call_status,
      timestamp: b.timestamp,
      call_id: b.call_id,
      direction: b.direction,
      caller_name: b.caller_name,
      business_id: b.business_id || q.business_id,
    };
  }

  const raw = String(ev.call_status_raw || '').toLowerCase().trim();
  let call_status = 'unknown';
  if (MISSED.has(raw)) call_status = raw === 'voicemail' ? 'voicemail' : 'missed';
  else if (ANSWERED.has(raw)) call_status = 'answered';

  const t = ev.timestamp ? new Date(ev.timestamp) : new Date();
  const ts = isNaN(t.getTime()) ? new Date() : t;

  const presented = String(h['x-webhook-token'] || q.token || '');
  out.push({
    json: {
      flow: 'missed_call',
      data_dir: DATA_DIR,
      source: ev.source,
      event_type: ev.event_type || 'call_ended',
      from: toE164(ev.from),
      to: toE164(ev.to),
      business_id: ev.business_id ? String(ev.business_id) : '',
      timestamp: ts.toISOString(),
      call_status,
      call_status_raw: raw,
      is_missed: call_status === 'missed' || call_status === 'voicemail',
      call_id: ev.call_id || '',
      caller_name: ev.caller_name || '',
      // the token itself is never stored or logged, only its hash for comparison
      _token_sha256: presented ? require('crypto').createHash('sha256').update(presented).digest('hex') : '',
    },
  });
}
return out;
