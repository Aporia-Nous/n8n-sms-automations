#!/usr/bin/env bash
# Inbound-SMS Router: simulated tests (test mode, nothing is sent). Fictional Kettle Creek Auto Repair (+1 555-555-0100) running all
# three automations on one number. Context is created through the real automation webhooks at simulated times (Nov 2026, CST -06:00),
# then replies go to /webhook/sms-in.
set -u
BASE=${BASE:-http://localhost:5678/webhook}
D=${REPO_DIR:-.}/data; T=${REPO_DIR:-.}/tests/router; OUT=$T/results
mkdir -p $OUT; rm -f $OUT/*.json
for i in $(seq 1 45); do code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/sms-in" -H 'content-type: application/json' -d '{"from":"+10000000000","to":"+19999999999","text":"ping"}'); [ "$code" = "200" ] && break; sleep 2; done
echo '{}' > $D/appointments.json; echo '{}' > $D/review-queue.json; echo '{}' > $D/optouts.json; echo '{"texted":{},"booking_replies":{}}' > $D/state.json; rm -f $D/logs/*.jsonl
B=kettle-creek-auto; N=+15555550100
post () { curl -s -X POST "$BASE/$1" -H 'content-type: application/json' -d "$2"; }
missed () { post missed-call "{\"from\":\"$1\",\"to\":\"$N\",\"business_id\":\"$B\",\"timestamp\":\"$2\",\"call_status\":\"no_answer\"}"; }
appt () { post appointment "{\"business_id\":\"$B\",\"appointment_id\":\"$1\",\"customer_name\":\"$2\",\"phone\":\"$3\",\"service\":\"$4\",\"start\":\"$5\",\"booked_at\":\"2026-11-01T09:00:00-06:00\"}"; }
job () { post job-completed "{\"business_id\":\"$B\",\"job_id\":\"$1\",\"customer_name\":\"$2\",\"phone\":\"$3\",\"service\":\"$4\",\"completed_at\":\"$5\"}"; }
sms () { post sms-in "{\"from\":\"$1\",\"to\":\"$N\",\"text\":\"$2\",\"timestamp\":\"$3\"}"; }
quiet () { "$@" > /dev/null; }
run () { local name=$1; shift; local resp; resp=$("$@"); echo "$resp" | python3 -m json.tool > "$OUT/$name.json" 2>/dev/null || echo "$resp" > "$OUT/$name.json";
  python3 - "$OUT/$name.json" "$name" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print(sys.argv[2],'-> PARSE_ERROR'); sys.exit()
if isinstance(d,list): d=d[0]
if d.get('target'):
    ds=d.get('downstream') or {}
    s=f"ROUTED to {d['target']} [{d.get('rule')}] -> {ds.get('action')}({ds.get('reason')})"+(f" sms={ds['sms']['kind']}" if ds.get('sms') else '')+(f" +alert:{ds['owner_alert']['priority']}" if ds.get('owner_alert') else '')
else:
    s=f"{d.get('flow')}:{d.get('action')}({d.get('reason')})"+(f" sms={d['sms']['kind']}" if d.get('sms') else '')+(f" +alert:{d['owner_alert']['priority']}" if d.get('owner_alert') else '')
print(sys.argv[2],'->',s)
PY
}
echo "--- seeding context through the automations ---"
run S1_missed_Taylor_Nov2          missed +15555550144 2026-11-02T09:00:00-06:00
run S2_missed_Riley_Mon1000        missed +15555550143 2026-11-09T10:00:00-06:00
run S3_missed_Casey_Mon1500        missed +15555550142 2026-11-09T15:00:00-06:00
quiet appt K1 "Jordan Wells" +15555550141 "brake inspection" 2026-11-10T14:00:00-06:00
quiet appt K2 "Avery Stone"  +15555550145 "oil change" 2026-11-11T10:00:00-06:00
run S4_reminders_Mon1405_Jordan24h post reminders-run '{"now":"2026-11-09T14:05:00-06:00"}'
quiet job KJ1 "Jordan Wells" +15555550141 "tire repair" 2026-11-09T13:00:00-06:00
quiet job KJ2 "Casey Hart"   +15555550142 "wipers" 2026-11-09T13:00:00-06:00
quiet job KJ3 "Avery Stone"  +15555550145 "battery test" 2026-11-09T13:00:00-06:00
run S5_reviews_Mon1505_three       post reviews-run '{"now":"2026-11-09T15:05:00-06:00"}'
run S6_reminders_Tue1005_Avery24h  post reminders-run '{"now":"2026-11-10T10:05:00-06:00"}'
echo "--- replies through the router ---"
run 01_overlap_most_recent_review       sms +15555550141 "Thanks, great service!" 2026-11-09T15:30:00-06:00
run 02_overlap_C_goes_to_reminder       sms +15555550141 "C" 2026-11-09T15:40:00-06:00
run 03_tie_missedcall_review_5min       sms +15555550142 "ok" 2026-11-09T15:20:00-06:00
run 04_missed_call_only_booking         sms +15555550143 "Can I bring it in tomorrow?" 2026-11-09T10:05:00-06:00
run 05_telnyx_format_missed_call        post sms-in '{"data":{"event_type":"message.received","occurred_at":"2026-11-09T16:20:00Z","payload":{"id":"m1","from":{"phone_number":"+15555550143"},"to":[{"phone_number":"+15555550100"}],"text":"thanks, see you then"}}}'
run 06_stale_missed_call_7_days         sms +15555550144 "hi, do you still have time this week?" 2026-11-09T10:00:00-06:00
run 07_unknown_number                   sms +15555550148 "Are you open Sunday?" 2026-11-09T11:00:00-06:00
run 08_rating_beats_newer_reminder      sms +15555550145 "5" 2026-11-10T10:30:00-06:00
run 09_newer_reminder_by_recency        sms +15555550145 "Sounds good" 2026-11-10T10:40:00-06:00
run 10_running_late_to_reminder         sms +15555550141 "Running late, be there in 10" 2026-11-10T13:55:00-06:00
run 11_reminder_stale_after_appt        sms +15555550141 "thanks again" 2026-11-10T17:00:00-06:00
run 12_twilio_STOP_central              curl -s -X POST "$BASE/sms-in" --data "AccountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&MessageSid=SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx&From=%2B15555550142&To=%2B15555550100&Body=STOP"
run 13_opted_out_missed_call_skipped    missed +15555550142 2026-11-10T09:00:00-06:00
run 14_START_central                    sms +15555550142 "START" 2026-11-10T09:10:00-06:00
run 15_HELP_central                     sms +15555550141 "help" 2026-11-10T09:15:00-06:00
run 16_bare_CANCEL_with_reminder        sms +15555550145 "Cancel" 2026-11-10T11:00:00-06:00
run 17_stale_review_8_days              sms +15555550141 "thanks" 2026-11-17T16:00:00-06:00
cp $D/logs/*.jsonl $T/; cp $D/optouts.json $T/optouts-after-tests.json
echo '{}' > $D/appointments.json; echo '{}' > $D/review-queue.json; echo '{}' > $D/optouts.json; echo '{"texted":{},"booking_replies":{}}' > $D/state.json
echo "Saved to $T"
