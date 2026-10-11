#!/usr/bin/env bash
# Review Requests: simulated tests (test mode, nothing is sent). Fictional Kettle Creek Auto Repair, 555-01xx numbers.
# Shop hours Mon-Fri 8:00-17:30, Sat 9:00-13:00, Sun closed; quiet hours 20:00-08:00. Dates: Nov 10-19 2026 (CST, -06:00).
set -u
BASE=${BASE:-http://localhost:5678/webhook}
D=${REPO_DIR:-.}/data; T=${REPO_DIR:-.}/tests/reviews; OUT=$T/results
mkdir -p $OUT; rm -f $OUT/*.json
for i in $(seq 1 45); do code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/reviews-run" -H 'content-type: application/json' -d '{"now":"2020-01-01T00:00:00Z"}'); [ "$code" = "200" ] && break; sleep 2; done
echo '{}' > $D/review-queue.json; echo '{}' > $D/optouts.json; rm -f $D/logs/*.jsonl
B=kettle-creek-auto
job () { curl -s -X POST "$BASE/job-completed" -H 'content-type: application/json' -d "{\"business_id\":\"$B\",\"job_id\":\"$1\",\"customer_name\":\"$2\",\"phone\":\"$3\",\"service\":\"$4\",\"completed_at\":\"$5\"}"; }
scan () { curl -s -X POST "$BASE/reviews-run" -H 'content-type: application/json' -d "{\"now\":\"$1\"}"; }
reply () { curl -s -X POST "$BASE/review-reply" -H 'content-type: application/json' -d "{\"from\":\"$1\",\"to\":\"+15555550100\",\"text\":\"$2\",\"timestamp\":\"$3\"}"; }
run () { local name=$1; shift; local resp; resp=$("$@"); echo "$resp" | python3 -m json.tool > "$OUT/$name.json" 2>/dev/null || echo "$resp" > "$OUT/$name.json";
  python3 - "$OUT/$name.json" "$name" <<'PY'
import json,sys
try: d=json.load(open(sys.argv[1]))
except Exception: print(sys.argv[2],'-> PARSE_ERROR'); sys.exit()
items = d if isinstance(d,list) else [d]
def f(i):
    x=f"{i.get('ref') or '-'}:{i.get('action')}({i.get('reason')})"
    if i.get('sms'): x+=' sms='+i['sms']['kind']
    if i.get('owner_alert'): x+=' +alert:'+i['owner_alert']['priority']
    det=i.get('detail') or {}
    if 'local' in det: x+=' send '+det['local']
    return x
print(sys.argv[2],'->','; '.join(f(i) for i in items))
PY
}
run 01_job_J1_queued_2h_later        job J1 "Chris Allen"  +15555550131 "brake pads" 2026-11-10T10:00:00-06:00
run 02_job_J1_again_duplicate        job J1 "Chris Allen"  +15555550131 "brake pads" 2026-11-10T10:00:00-06:00
run 03_job_J2_after_close_moves_am   job J2 "Morgan Bell"  +15555550132 "check engine light" 2026-11-10T16:45:00-06:00
run 04_job_J3_sat_moves_to_monday    job J3 "Pat Quinn"    +15555550133 "oil change" 2026-11-14T12:30:00-06:00
run 05_robin_texts_STOP              reply +15555550135 "STOP" 2026-11-09T09:00:00-06:00
run 06_job_J5_opted_out              job J5 "Robin Ford"   +15555550135 "tire rotation" 2026-11-10T10:15:00-06:00
run 07_job_J6_queued                 job J6 "Kelly Moss"   +15555550136 "alignment" 2026-11-10T10:30:00-06:00
run 08_scan_Tue_1100_nothing_due     scan 2026-11-10T11:00:00-06:00
run 09_scan_Tue_1205_J1_request      scan 2026-11-10T12:05:00-06:00
run 10_scan_Tue_1220_once_only       scan 2026-11-10T12:20:00-06:00
run 11_kelly_STOP_before_send        reply +15555550136 "unsubscribe" 2026-11-10T12:25:00-06:00
run 12_scan_Tue_1235_J6_cancelled    scan 2026-11-10T12:35:00-06:00
run 13_reply_J1_happy_5_stars        reply +15555550131 "5 stars, great job!" 2026-11-10T12:40:00-06:00
run 14_reply_J1_second_reply         reply +15555550131 "thanks again" 2026-11-10T12:45:00-06:00
run 15_scan_Tue_1850_after_hours     scan 2026-11-10T18:50:00-06:00
run 16_scan_Wed_0805_J2_request      scan 2026-11-11T08:05:00-06:00
run 17_reply_J2_unhappy_rating_2     reply +15555550132 "2 - the car still makes the noise" 2026-11-11T09:00:00-06:00
run 18_job_J4_same_customer_90d      job J4 "Chris Allen"  +15555550131 "oil change" 2026-11-20T10:00:00-06:00
run 19_scan_Mon_0805_J3_no_followups scan 2026-11-16T08:05:00-06:00
run 20_job_J8_queued                 job J8 "Sam Ortiz"    +15555550138 "battery" 2026-11-18T15:00:00-06:00
run 21_scan_Wed_2100_quiet_deferred  scan 2026-11-18T21:00:00-06:00
run 22_scan_Thu_0810_J8_and_J3_followup scan 2026-11-19T08:10:00-06:00
run 23_scan_Thu_0830_once_only       scan 2026-11-19T08:30:00-06:00
run 24_reply_J8_rating_3_unhappy     reply +15555550138 "3" 2026-11-19T09:00:00-06:00
run 25_reply_J3_neutral              reply +15555550133 "who is this?" 2026-11-19T09:05:00-06:00
run 26_reply_HELP                    reply +15555550133 "HELP" 2026-11-19T09:06:00-06:00
run 27_reply_unknown_number          reply +15555550139 "no problem, all good" 2026-11-19T09:10:00-06:00
# 28: incentive in a template is refused (temporarily edit the config, then restore it)
cp $D/config.json /tmp/rv-config.bak; trap 'cp /tmp/rv-config.bak $D/config.json' EXIT
python3 -c "import json;p='$D/config.json';c=json.load(open(p));c['businesses']['$B']['reviews']['templates']['request']+=' Get 10% off your next visit!';json.dump(c,open(p,'w'),indent=2)"
run 28_incentive_template_refused     job J9 "Lee Grant"   +15555550140 "detail" 2026-11-19T10:00:00-06:00
cp /tmp/rv-config.bak $D/config.json
cp $D/logs/*.jsonl $T/; cp $D/review-queue.json $T/review-queue-after-tests.json; cp $D/optouts.json $T/optouts-after-tests.json
echo '{}' > $D/review-queue.json   # leave nothing for the real 15-minute scheduler
echo "Saved to $T"
