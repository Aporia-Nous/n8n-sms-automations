#!/usr/bin/env bash
# Appointment Reminders: simulated tests (test mode, nothing is sent). Fictional Bright Paws Grooming, 555-01xx numbers.
# The scan is driven by POST /webhook/reminders-run {"now": ...} so we can walk through a simulated week (Nov 9-12 2026, CST = -06:00).
set -u
BASE=${BASE:-http://localhost:5678/webhook}
D=${REPO_DIR:-.}/data; T=${REPO_DIR:-.}/tests/reminders; OUT=$T/results
mkdir -p $OUT; rm -f $OUT/*.json
for i in $(seq 1 45); do code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/reminders-run" -H 'content-type: application/json' -d '{"now":"2020-01-01T00:00:00Z"}'); [ "$code" = "200" ] && break; sleep 2; done
echo '{}' > $D/appointments.json; echo '{}' > $D/optouts.json; rm -f $D/logs/*.jsonl
B=bright-paws-grooming
appt () { curl -s -X POST "$BASE/appointment" -H 'content-type: application/json' -d "$1"; }
scan () { curl -s -X POST "$BASE/reminders-run" -H 'content-type: application/json' -d "{\"now\":\"$1\"}"; }
reply () { curl -s -X POST "$BASE/reminder-reply" -H 'content-type: application/json' -d "{\"from\":\"$1\",\"to\":\"+15555550110\",\"text\":\"$2\",\"timestamp\":\"$3\"}"; }
run () { local name=$1; shift; local resp; resp=$("$@"); echo "$resp" | python3 -m json.tool > "$OUT/$name.json" 2>/dev/null || echo "$resp" > "$OUT/$name.json";
  python3 - "$OUT/$name.json" "$name" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print(sys.argv[2],'-> PARSE_ERROR'); sys.exit()
items = d if isinstance(d,list) else [d]
s='; '.join(f"{i.get('ref') or '-'}:{i.get('action')}({i.get('reason')}){' sms='+i['sms']['kind'] if i.get('sms') else ''}{' +alert' if i.get('owner_alert') else ''}" for i in items)
print(sys.argv[2],'->',s)
PY
}
# --- bookings (made Nov 1) ---
run 01_store_A1            appt '{"business_id":"'$B'","appointment_id":"A1","customer_name":"Jamie Rivera","phone":"+15555550111","service":"Bella'"'"'s full groom","start":"2026-11-10T14:00:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
run 02_store_A2            appt '{"business_id":"'$B'","appointment_id":"A2","customer_name":"Sam Lee","phone":"+15555550112","service":"Rocky'"'"'s bath","start":"2026-11-11T08:30:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
run 03_store_A3            appt '{"business_id":"'$B'","appointment_id":"A3","customer_name":"Priya Shah","phone":"+15555550113","service":"Milo'"'"'s nail trim","start":"2026-11-11T09:30:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
run 04_store_A4_optedout   appt '{"business_id":"'$B'","appointment_id":"A4","customer_name":"Alex Kim","phone":"+15555550114","service":"Luna'"'"'s groom","start":"2026-11-10T16:00:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
run 05_A4_texts_STOP       reply +15555550114 "STOP" "2026-11-01T11:00:00-06:00"
run 06_store_A5            appt '{"business_id":"'$B'","appointment_id":"A5","customer_name":"Chris Doe","phone":"+15555550115","service":"Max'"'"'s bath","start":"2026-11-10T15:00:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
run 07_cancel_A5           appt '{"business_id":"'$B'","appointment_id":"A5","status":"cancelled","booked_at":"2026-11-02T09:00:00-06:00"}'
run 08_store_A6            appt '{"business_id":"'$B'","appointment_id":"A6","customer_name":"Dana Cruz","phone":"+15555550116","service":"Pepper'"'"'s groom","start":"2026-11-10T11:00:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
run 09_reschedule_A6       appt '{"business_id":"'$B'","appointment_id":"A6","customer_name":"Dana Cruz","phone":"+15555550116","service":"Pepper'"'"'s groom","start":"2026-11-12T11:00:00-06:00","status":"rescheduled","booked_at":"2026-11-03T09:00:00-06:00"}'
run 10_store_A8            appt '{"business_id":"'$B'","appointment_id":"A8","customer_name":"Tom Ng","phone":"+15555550118","service":"Daisy'"'"'s puppy trim","start":"2026-11-11T09:45:00-06:00","booked_at":"2026-11-01T10:00:00-06:00"}'
# --- the week ---
run 11_scan_Mon_1300_nothing_due      scan 2026-11-09T13:00:00-06:00
run 12_scan_Mon_1405_24h_A1           scan 2026-11-09T14:05:00-06:00
run 13_scan_Mon_1420_once_only        scan 2026-11-09T14:20:00-06:00
run 14_reply_C_confirm                reply +15555550111 "C" "2026-11-09T14:30:00-06:00"
run 15_scan_Mon_1605_optout_cancelled scan 2026-11-09T16:05:00-06:00
run 16_scan_Tue_0935_24h_A2_A3        scan 2026-11-10T09:35:00-06:00
run 17_reply_R_reschedule             reply +15555550112 "R" "2026-11-10T10:00:00-06:00"
run 18_reply_cancel_sentence          reply +15555550113 "So sorry, I need to cancel tomorrow" "2026-11-10T10:05:00-06:00"
run 19_store_A7_booked_late           appt '{"business_id":"'$B'","appointment_id":"A7","customer_name":"Eli Park","phone":"+15555550117","service":"Coco'"'"'s bath","start":"2026-11-10T17:00:00-06:00","booked_at":"2026-11-10T10:00:00-06:00"}'
run 20_scan_Tue_1205_2h_A1_skip_A7_24h scan 2026-11-10T12:05:00-06:00
run 21_scan_Tue_1505_2h_A7            scan 2026-11-10T15:05:00-06:00
run 22_reply_running_late             reply +15555550117 "Running late, be there in 10 min" "2026-11-10T16:55:00-06:00"
run 23_scan_Wed_0635_quiet_too_late   scan 2026-11-11T06:35:00-06:00
run 24_scan_Wed_0750_quiet_deferred   scan 2026-11-11T07:50:00-06:00
run 25_scan_Wed_0800_deferred_sends   scan 2026-11-11T08:00:00-06:00
run 26_scan_Wed_1105_rescheduled_A6   scan 2026-11-11T11:05:00-06:00
run 27_reply_bare_CANCEL_is_optout    reply +15555550116 "Cancel" "2026-11-11T11:10:00-06:00"
run 28_scan_Thu_0905_A6_optedout      scan 2026-11-12T09:05:00-06:00
run 29_reply_HELP                     reply +15555550111 "HELP" "2026-11-10T12:10:00-06:00"
run 30_reply_unknown_number           reply +15555550119 "Do you have openings Saturday?" "2026-11-10T12:15:00-06:00"
cp $D/logs/*.jsonl $T/; cp $D/appointments.json $T/appointments-after-tests.json; cp $D/optouts.json $T/optouts-after-tests.json
echo '{}' > $D/appointments.json   # leave nothing for the real 15-minute scheduler to pick up
echo "Saved to $T"
