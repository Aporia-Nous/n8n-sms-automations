// ---- shared helpers (copied into each Code node that needs them) ----
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return d; } };
const writeJson = (f, o) => { fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(f + '.tmp', f); };
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAYNAMES = { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' };
function localParts(date, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? '00' : p.hour;
  return { day: p.weekday.toLowerCase().slice(0, 3), hhmm: hour + ':' + p.minute, ymd: `${p.year}-${p.month}-${p.day}` };
}
function fmt12(hhmm) { let [h, m] = hhmm.split(':').map(Number); const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12; return m ? `${h}:${String(m).padStart(2, '0')} ${ap}` : `${h} ${ap}`; }
function addDaysYmd(ymd, n) { const d = new Date(ymd + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function hoursStatus(date, biz) {
  const tz = biz.timezone || 'America/Chicago';
  const lp = localParts(date, tz);
  const hours = biz.hours || {};
  const closed = new Set(biz.closed_dates || []);
  const today = hours[lp.day];
  const open = !closed.has(lp.ymd) && Array.isArray(today) && lp.hhmm >= today[0] && lp.hhmm < today[1];
  let next_open = 'soon';
  const di = DAYS.indexOf(lp.day);
  for (let i = 0; i < 8; i++) {
    const d = DAYS[(di + i) % 7];
    const w = hours[d];
    if (closed.has(addDaysYmd(lp.ymd, i))) continue;
    if (!Array.isArray(w)) continue;
    if (i === 0 && lp.hhmm >= w[0]) continue;
    next_open = (i === 0 ? 'today' : i === 1 ? 'tomorrow' : DAYNAMES[d]) + ' at ' + fmt12(w[0]);
    break;
  }
  return { open, local_day: lp.day, local_time: lp.hhmm, local_date: lp.ymd, timezone: tz, next_open };
}
function render(tpl, vars) { return String(tpl || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] !== undefined && vars[k] !== null ? String(vars[k]) : '')).replace(/\s+/g, ' ').trim(); }
const GSM = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\x1bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
function segments(text) { const s = String(text || ''); const gsm = [...s].every((c) => GSM.includes(c)); const len = gsm ? [...s].reduce((n, c) => n + ('^{}\\[~]|€'.includes(c) ? 2 : 1), 0) : [...s].length; const single = gsm ? 160 : 70; const multi = gsm ? 153 : 67; return { encoding: gsm ? 'GSM-7' : 'UCS-2', chars: len, segments: len <= single ? 1 : Math.ceil(len / multi) }; }
function findBusiness(cfg, business_id, number) {
  const bs = cfg.businesses || {};
  if (business_id && bs[business_id]) return [business_id, bs[business_id]];
  for (const [id, b] of Object.entries(bs)) if ((b.numbers || []).includes(number)) return [id, b];
  return [null, null];
}
function tokenOk(settings, sha) { const t = settings.webhook_token; if (!t) return true; return sha === crypto.createHash('sha256').update(String(t)).digest('hex'); }
// ---- end helpers ----
// ---- scheduling + keyword helpers (reminders / reviews) ----
function inQuiet(hhmm, q) { if (!Array.isArray(q) || q.length !== 2) return false; const [a, b] = q; return a < b ? (hhmm >= a && hhmm < b) : (hhmm >= a || hhmm < b); }
function isOpenAt(date, biz) { return hoursStatus(date, biz).open; }
function okToText(date, biz, s, needOpen) { const lp = localParts(date, biz.timezone || 'America/Chicago'); if (inQuiet(lp.hhmm, s.quiet_hours)) return false; return needOpen ? isOpenAt(date, biz) : true; }
function nextOkTime(date, biz, s, needOpen) { let t = new Date(Math.ceil(date.getTime() / 300000) * 300000); for (let i = 0; i < 8 * 24 * 12; i++) { if (okToText(t, biz, s, needOpen)) return t; t = new Date(t.getTime() + 300000); } return null; }
function fmtWhen(date, now, tz) { const lp = localParts(date, tz); const ln = localParts(now, tz); const time = fmt12(lp.hhmm); if (lp.ymd === ln.ymd) return 'today at ' + time; if (lp.ymd === addDaysYmd(ln.ymd, 1)) return 'tomorrow at ' + time; const d = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric' }).format(date); return d + ' at ' + time; }
const KW_STOP = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT', 'REVOKE'];
const KW_START = ['START', 'UNSTOP', 'SUBSCRIBE'];
const KW_HELP = ['HELP', 'INFO'];
function keywordOf(text) { return String(text || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').replace(/\s+/g, ' ').trim(); }
function isOptedOut(dataDir, bizId, phone) { const o = readJson(path.join(dataDir, 'optouts.json'), {}); return !!(o[bizId] && o[bizId][phone]); }
// Shared STOP/START/HELP handling. Returns true when the keyword was handled (ctx filled in).
function handleComplianceKeyword(ctx, ev, bizId, biz, s, kw, helpTpl, vars, mk) {
  const optFile = path.join(ev.data_dir, 'optouts.json');
  const optouts = readJson(optFile, {});
  const T = biz.templates || {};
  const oa = biz.owner_alert || {};
  if (KW_STOP.includes(kw)) {
    optouts[bizId] = optouts[bizId] || {}; optouts[bizId][ev.from] = { at: ev.timestamp, keyword: kw, via: ctx.flow }; writeJson(optFile, optouts);
    ctx.action = 'opt_out'; ctx.reason = 'stop_keyword:' + kw;
    if (s.send_stop_confirmation !== false) ctx.sms = mk(render(T.stop_confirm, vars), 'stop_confirmation');
    ctx.owner_alert = { to_email: oa.email || '', to_sms: oa.sms || '', subject: `Opt-out: ${ev.from}`, body: `${biz.name}: ${ev.from} replied ${kw} and was added to the do-not-text list (all automations).`, priority: 'low' };
    return true;
  }
  if (KW_START.includes(kw)) {
    if (optouts[bizId]) { delete optouts[bizId][ev.from]; writeJson(optFile, optouts); }
    ctx.action = 'opt_in'; ctx.reason = 'start_keyword:' + kw; ctx.sms = mk(render(T.start_confirm, vars), 'start_confirmation');
    return true;
  }
  if (KW_HELP.includes(kw)) { ctx.action = 'help'; ctx.reason = 'help_keyword:' + kw; ctx.sms = mk(render(helpTpl || T.help, vars), 'help_reply'); return true; }
  return false;
}
// ---- end scheduling helpers ----

