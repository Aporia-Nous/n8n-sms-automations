#!/usr/bin/env bash
# Simulated webhook calls against the local n8n (test mode). Nothing is sent anywhere.
# Resets data/state.json, data/optouts.json and data/logs/ first (previous copies kept in tests/backup-<time>/).
set -u
BASE=${BASE:-http://localhost:5678/webhook}
D=${REPO_DIR:-.}/data
T=${REPO_DIR:-.}/tests
OUT=$T/results; mkdir -p $OUT; rm -f $OUT/*.json
# wait until n8n has registered the production webhooks (a few seconds after /healthz turns ok)
for i in $(seq 1 45); do code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/missed-call" -H 'content-type: application/json' -d '{"call_status":"ping"}'); [ "$code" = "200" ] && break; sleep 2; done
BK=$T/backup-$(date +%Y%m%d-%H%M%S); mkdir -p $BK; cp -r $D/state.json $D/optouts.json $D/logs $BK/ 2>/dev/null
echo '{"texted":{},"booking_replies":{}}' > $D/state.json; echo '{}' > $D/optouts.json; rm -f $D/logs/*.jsonl

post_json () { curl -s -X POST "$BASE/$1" -H 'content-type: application/json' -d "$2"; }
post_form () { curl -s -X POST "$BASE/$1" "${@:2}"; }
run () { local name=$1; shift; local resp; resp=$("$@"); echo "$resp" | python3 -m json.tool > "$OUT/$name.json" 2>/dev/null || echo "$resp" > "$OUT/$name.json";
  echo "$name -> $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("action"), "|", d.get("reason"), "| sms:", (d.get("sms") or {}).get("kind"), "| owner_alert:", bool(d.get("owner_alert")))' "$OUT/$name.json" 2>/dev/null || echo PARSE_ERROR)"; }

# Caller numbers are fictional 555-01xx numbers. Business line +1 555-555-0100 (Kettle Creek Auto Repair, demo).
run 01_normal_missed_call      post_json missed-call '{"from":"+15555550123","to":"+15555550100","business_id":"kettle-creek-auto","timestamp":"2026-10-08T15:10:00-05:00","call_status":"no_answer"}'
run 02_duplicate_within_window post_json missed-call '{"from":"(555) 555-0123","to":"+15555550100","business_id":"kettle-creek-auto","timestamp":"2026-10-08T15:40:00-05:00","call_status":"missed"}'
run 03_after_hours             post_json missed-call '{"from":"+15555550134","to":"+15555550100","business_id":"kettle-creek-auto","timestamp":"2026-10-08T21:15:00-05:00","call_status":"missed"}'
run 04_stop_reply              post_json sms-reply   '{"from":"+15555550145","to":"+15555550100","text":"Stop","timestamp":"2026-10-08T16:00:00-05:00"}'
run 05_opted_out_caller        post_json missed-call '{"from":"+15555550145","to":"+15555550100","timestamp":"2026-10-08T16:05:00-05:00","call_status":"no_answer"}'
run 06_normal_reply_booking    post_json sms-reply   '{"from":"+15555550123","to":"+15555550100","text":"Hi, my brakes are grinding. Can I bring it in tomorrow morning?","timestamp":"2026-10-08T15:12:00-05:00"}'
# extras: HELP, a plain reply, provider payload shapes, an answered call
run 07_help_reply              post_json sms-reply   '{"from":"+15555550134","to":"+15555550100","text":"HELP","timestamp":"2026-10-08T21:20:00-05:00"}'
run 08_plain_reply_no_booking  post_json sms-reply   '{"from":"+15555550134","to":"+15555550100","text":"It was about my truck, I will call back","timestamp":"2026-10-08T21:25:00-05:00"}'
run 09_twilio_dial_no_answer   post_form missed-call --data-urlencode "AccountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" --data-urlencode "CallSid=CAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" --data-urlencode "From=+15555550156" --data-urlencode "To=+15555550100" --data-urlencode "Direction=inbound" --data-urlencode "CallStatus=in-progress" --data-urlencode "DialCallStatus=no-answer" --data-urlencode "Timestamp=Sat, 10 Oct 2026 16:00:00 +0000"
run 10_telnyx_hangup_timeout   post_json missed-call '{"data":{"record_type":"event","event_type":"call.hangup","id":"0ccc7b54-0000-0000-0000-000000000000","occurred_at":"2026-10-11T19:00:00Z","payload":{"call_control_id":"v3:demo","call_session_id":"demo-session","from":"+15555550167","to":"+15555550100","direction":"incoming","state":"hangup","hangup_cause":"timeout","hangup_source":"callee"}}}'
run 11_votel_call_ended        post_json missed-call '{"source":"votel","event":"call_ended","business_id":"kettle-creek-auto","timestamp":"2026-10-09T09:30:00-05:00","call":{"caller_id_number":"+15555550178","caller_id_name":"Dana Demo","status":"missed"}}'
run 12_answered_call_ignored   post_json missed-call '{"from":"+15555550189","to":"+15555550100","business_id":"kettle-creek-auto","timestamp":"2026-10-09T10:00:00-05:00","call_status":"answered"}'
run 13_twilio_inbound_sms_stop post_form sms-reply --data-urlencode "AccountSid=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" --data-urlencode "MessageSid=SMxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" --data-urlencode "From=+15555550156" --data-urlencode "To=+15555550100" --data-urlencode "Body=unsubscribe"

# 14: flip config to LIVE mode (provider telnyx, LLM on) to prove the live path is safe while the send/LLM nodes are disabled.
cp $D/config.json /tmp/mctb-config.bak; trap 'cp /tmp/mctb-config.bak $D/config.json' EXIT
python3 -c "import json;p='$D/config.json';c=json.load(open(p));c['defaults'].update(test_mode=False,provider='telnyx');c['defaults']['llm']['enabled']=True;json.dump(c,open(p,'w'),indent=2)"
run 14_live_mode_send_nodes_disabled post_json missed-call '{"from":"+15555550190","to":"+15555550100","timestamp":"2026-10-09T10:00:00-05:00","call_status":"busy"}'
cp /tmp/mctb-config.bak $D/config.json

cp $D/logs/*.jsonl $T/ 2>/dev/null; cp $D/optouts.json $T/optouts-after-tests.json; cp $D/state.json $T/state-after-tests.json
echo "Saved responses to $OUT and logs to $T"
