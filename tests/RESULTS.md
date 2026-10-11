# Test results (test mode, nothing sent)

The suites ran one at a time against n8n 2.42.5. The first three (72 tests) were last re-run on Thu Oct 8 2026 at about 6:00–6:05 PM CT, after the router was added, with identical results. The router suite ran just before them. Each suite resets the shared opt-out list and the logs, so every folder keeps its own copy of `outbox.jsonl`, `owner-alerts.jsonl` and `events.jsonl`.

## 1. Missed-Call Text-Back (`tests/`)

Run: `/data/n8n-flows/tests/run-tests.sh` against local n8n 2.42.5 (http://localhost:5678), Thu Oct 8 2026, about 5:38 PM CT.
All numbers are fictional 555-01xx numbers. Nothing was sent. Would-be texts are in `outbox.jsonl`, owner alerts in `owner-alerts.jsonl`, and every decision in `events.jsonl`. Raw webhook responses are in `results/`.

| # | Scenario | Payload shape | Expected | Got | Pass |
|---|---|---|---|---|---|
| 01 | Normal missed call, Thu 3:10 PM (open) | generic JSON | text (in-hours template) + owner alert | `text / missed_in_hours`, 1 segment, alert | ✅ |
| 02 | Same caller again 30 min later, written `(555) 555-0123` | generic JSON | skip as duplicate, no text | `skip / duplicate_within_24h`, no alert | ✅ |
| 03 | Missed call Thu 9:15 PM (closed) | generic JSON | after-hours template with next opening | `text / missed_after_hours`, "We open tomorrow at 8 AM", low-priority alert | ✅ |
| 04 | Caller texts "Stop" | generic SMS JSON | added to opt-out list + one confirmation | `opt_out / stop_keyword:STOP`, confirmation logged | ✅ |
| 05 | That opted-out number calls and is missed | generic JSON | no text, owner still alerted | `skip / opted_out`, alert "Consider calling back" | ✅ |
| 06 | Normal reply: "...Can I bring it in tomorrow morning?" | generic SMS JSON | owner alert + booking-link reply | `forward_and_booking_link / booking_intent`, high-priority alert | ✅ |
| 07 | "HELP" | generic SMS JSON | help text | `help / help_keyword:HELP` | ✅ |
| 08 | Plain reply without booking intent | generic SMS JSON | owner alert only | `forward / normal_reply`, no auto-text | ✅ |
| 09 | Twilio `<Dial>` action callback, `DialCallStatus=no-answer`, Sat 11 AM | Twilio form post | text | `text / missed_in_hours` | ✅ |
| 10 | Telnyx `call.hangup`, `hangup_cause=timeout`, Sun 2 PM (closed) | Telnyx JSON | after-hours text, opens Mon | `text / missed_after_hours`, "We open tomorrow at 8 AM" (Mon) | ✅ |
| 11 | Votel call_ended webhook step | Votel JSON | text, business found by `business_id` | `text / missed_in_hours` | ✅ |
| 12 | Answered call | generic JSON | ignored | `skip / not_missed:answered` | ✅ |
| 13 | Twilio inbound SMS "unsubscribe" | Twilio form post | opt-out | `opt_out / stop_keyword:UNSUBSCRIBE` | ✅ |
| 14 | Config flipped to LIVE (provider telnyx, LLM on), send/LLM nodes still disabled | generic JSON | flows through the live branch, nothing sent, template kept | `delivery.sms = not_sent_no_provider_response`, `llm_used=false`, config restored to test mode afterwards | ✅ |

`optouts-after-tests.json` and `state-after-tests.json` show the opt-out list and the dedupe and booking-reply state after the run.

## 2. Appointment Reminders (`tests/reminders/`, 30 calls, all pass)

Demo business: Bright Paws Grooming (Tue–Sat). The scans use simulated times from Mon Nov 9 to Thu Nov 12 2026 (CST). Quiet hours are 8 PM–8 AM.

| # | Scenario | Expected | Got | Pass |
|---|---|---|---|---|
| 01–04, 06, 08, 10 | Store appointments A1–A6, A8 | stored | `stored` | ✅ |
| 05 | A4's customer texts STOP | shared opt-out + confirmation; owner told they still have an appointment | `opt_out`, normal-priority alert | ✅ |
| 07 | A5 cancelled | no reminders | `cancelled` | ✅ |
| 09 | A6 moved from Tue 11 AM to Thu 11 AM | reminders reset | `rescheduled` | ✅ |
| 11 | Scan Mon 1:00 PM | nothing due | `none` | ✅ |
| 12 | Scan Mon 2:05 PM | A1 24h reminder ("tomorrow at 2 PM") | `send_reminder 24h` | ✅ |
| 13 | Scan Mon 2:20 PM | **once-only**: nothing | `none` | ✅ |
| 14 | A1 replies "C" | confirmed + thank-you | `confirmed` | ✅ |
| 15 | Scan Mon 4:05 PM | A4 opted out: no text, one owner alert. A5 cancelled: nothing | `skip 24h:opted_out` + alert | ✅ |
| 16 | Scan Tue 9:35 AM | 24h reminders for A2 and A3 | both sent | ✅ |
| 17 | A2 replies "R" | booking link + high-priority alert | `reschedule_requested` | ✅ |
| 18 | A3: "So sorry, I need to cancel tomorrow" | stop reminders, acknowledge, high-priority alert | `cancel_requested` | ✅ |
| 19 | A7 booked Tue 10 AM for Tue 5 PM | stored | `stored` | ✅ |
| 20 | Scan Tue 12:05 PM | A1 2h ("today at 2 PM"), A8 24h, **A7 24h skipped (booked after due)** | as expected | ✅ |
| 21 | Scan Tue 3:05 PM | A7 2h sent; A4 2h skipped **without a second alert** | as expected | ✅ |
| 22 | A7: "Running late, be there in 10 min" | acknowledgement + high-priority alert | `running_late` | ✅ |
| 23 | Scan Wed 6:35 AM (**quiet hours**) | A2 2h due 6:30, but quiet hours end at 8:00, too close to the 8:30 start: skip | `skip 2h:quiet_hours_until_too_late` | ✅ |
| 24 | Scan Wed 7:50 AM (**quiet hours**) | A8 2h held until 8:00 | `deferred`, next try 8:00 AM | ✅ |
| 25 | Scan Wed 8:00 AM | held A8 2h reminder goes out | `send_reminder 2h` | ✅ |
| 26 | Scan Wed 11:05 AM | rescheduled A6 gets its 24h reminder for the **new** time | sent ("tomorrow at 11 AM") | ✅ |
| 27 | A6 replies just "Cancel" | carrier opt-out keyword → STOP; high-priority "may have meant to cancel, call them" | `opt_out` + high-priority alert | ✅ |
| 28 | Scan Thu 9:05 AM | A6 2h not sent (opted out), one alert | `skip 2h:opted_out` + alert | ✅ |
| 29 | "HELP" | help text | `help` | ✅ |
| 30 | Unknown number texts | goes to the owner | `forward (no_upcoming_appointment_found)` | ✅ |

All reminder texts are one segment. `appointments-after-tests.json` shows each slot's final mark.

## 3. Review Requests (`tests/reviews/`, 28 calls, all pass)

Demo business: Kettle Creek Auto Repair (Mon–Fri 8–5:30, Sat 9–1, Sun closed), with simulated times Nov 9–20 2026. Review link: `https://example.com/review/kettle-creek`.

| # | Scenario | Expected | Got | Pass |
|---|---|---|---|---|
| 01 | Job J1 done Tue 10:00 | queued for 12:00 | `queued (send_in_2h)` | ✅ |
| 02 | Same job posted again | **once-only** per job | `skip duplicate_job` | ✅ |
| 03 | J2 done Tue 4:45 PM (+2h = after closing) | moved to next morning | `queued`, Wed 8 AM | ✅ |
| 04 | J3 done Sat 12:30 (+2h = closed, Sun closed) | moved to Monday | `queued`, Mon Nov 16 8 AM | ✅ |
| 05–06 | Robin texted STOP, then a job | not queued | `skip opted_out` | ✅ |
| 07 | J6 queued | queued | `queued` | ✅ |
| 08 | Scan Tue 11:00 | nothing due | `none` | ✅ |
| 09 | Scan Tue 12:05 | J1 request | `send_request` | ✅ |
| 10 | Scan Tue 12:20 | **once-only** | `none` | ✅ |
| 11–12 | Kelly texts "unsubscribe" before her 12:30 send, then a scan | request cancelled | `skip request:opted_out` | ✅ |
| 13 | J1: "5 stars, great job!" | thanks + **same link**, low-priority owner note | `happy_link_resent (rating_5)` | ✅ |
| 14 | J1 replies again | no second auto-reply, goes to the owner | `forward (already_replied_once)` | ✅ |
| 15 | Scan Tue 6:50 PM | nothing (J2 was already moved to the morning) | `none` | ✅ |
| 16 | Scan Wed 8:05 AM | J2 request | `send_request` | ✅ |
| 17 | J2: "2 - the car still makes the noise" | **private** high-priority owner alert + apology that carries the **same link** | `unhappy_owner_alerted (rating_2)` | ✅ |
| 18 | Chris (J1) has another job 10 days later | 90-day limit | `skip recently_asked` | ✅ |
| 19 | Scan Mon Nov 16 8:05 AM | J3 request; **no follow-up** for J1/J2 (they replied) | only J3 sent | ✅ |
| 20 | J8 done Wed Nov 18 3 PM | queued for 5 PM | `queued` | ✅ |
| 21 | Scan Wed 9:00 PM (**quiet hours** / closed) | held | `deferred` | ✅ |
| 22 | Scan Thu 8:10 AM | J8 request + **J3 follow-up** (no reply after 3 days) | both sent | ✅ |
| 23 | Scan Thu 8:30 AM | **once-only** follow-up | `none` | ✅ |
| 24 | J8 replies just "3" | unhappy → private alert + same link | `unhappy_owner_alerted (rating_3)` | ✅ |
| 25 | J3: "who is this?" | neutral → owner only, no auto-text | `forward (neutral_reply)` | ✅ |
| 26 | "HELP" | help text | `help` | ✅ |
| 27 | Unknown number: "no problem, all good" | goes to the owner ("no problem" not read as a complaint) | `forward` | ✅ |
| 28 | A template is temporarily changed to add "Get 10% off your next visit!" | **refused** + high-priority owner alert; config restored | `skip template_contains_incentive:request` | ✅ |

All review texts are one segment. The missed-call suite was re-run after the shared code changes and all 14 still pass.

## 4. Inbound-SMS Router (`tests/router/`, 6 seeding calls + 17 router tests, all pass)

Kettle Creek Auto Repair runs all three automations on one number (+1 555-555-0100). Context is created through the real automation webhooks at simulated times (Nov 2026, CST):

| Seed | What |
|---|---|
| S1 | Missed-call text-back to Taylor, Mon **Nov 2** 9:00 (stale by Nov 9) |
| S2 | Missed-call text-back to Riley, Mon Nov 9 10:00 |
| S3 | Missed-call text-back to Casey, Mon 15:00 |
| S4 | 24h reminder to Jordan (brake inspection Tue 14:00), sent Mon 14:05 |
| S5 | Review requests to Jordan, Casey and Avery, sent Mon 15:05 |
| S6 | 24h reminder to Avery (oil change Wed 10:00), sent Tue 10:05 |

| # | Reply (sender, time) | Live contexts | Expected | Got | Pass |
|---|---|---|---|---|---|
| 01 | "Thanks, great service!" (Jordan, Mon 15:30) | reminder 14:05, review 15:05 | **overlap** → most recent = reviews | reviews `happy_link_resent` | ✅ |
| 02 | "C" (Jordan, Mon 15:40) | same | **overlap**, reminder intent beats a newer review | reminders `confirmed` | ✅ |
| 03 | "ok" (Casey, Mon 15:20) | missed-call 15:00, review 15:05 | **tie** (5 min < 15) → owner, no auto-text | `forward_to_owner (unclear_tie)` | ✅ |
| 04 | "Can I bring it in tomorrow?" (Riley, Mon 10:05) | missed-call only | missed-call | `forward_and_booking_link` | ✅ |
| 05 | Telnyx-format "thanks, see you then" (Riley) | missed-call only | missed-call (Telnyx shape parsed) | `forward (normal_reply)` | ✅ |
| 06 | "hi, do you still have time this week?" (Taylor, Nov 9) | missed-call from Nov 2 (**stale**) | owner | `forward_to_owner (stale_context_only)` | ✅ |
| 07 | "Are you open Sunday?" (**unknown number**) | none | owner | `forward_to_owner (no_context_unknown_number)` | ✅ |
| 08 | "5" (Avery, Tue 10:30) | review Mon 15:05, reminder Tue 10:05 (newer) | rating beats a newer reminder → reviews | reviews `happy_link_resent (rating_5)` | ✅ |
| 09 | "Sounds good" (Avery, Tue 10:40) | same | recency → reminders | reminders `forward (other_reply)` | ✅ |
| 10 | "Running late, be there in 10" (Jordan, Tue 13:55) | reminder, review | reminder intent → reminders | reminders `running_late` | ✅ |
| 11 | "thanks again" (Jordan, Tue 17:00) | reminder **stale** (appointment over), review live | reviews | reviews `forward (already_replied_once)` | ✅ |
| 12 | Twilio-form "STOP" (Casey) | — | **central opt-out**, one confirmation | `opt_out` | ✅ |
| 13 | Casey calls again (missed-call webhook) | — | no text-back (**shared opt-out**) | missed-call `skip opted_out` | ✅ |
| 14 | "START" (Casey) | — | central opt-in | `opt_in` | ✅ |
| 15 | "help" (Jordan) | — | central HELP | `help` | ✅ |
| 16 | "Cancel" (Avery) | live reminder | opt-out + high-priority "may have meant to cancel" alert | `opt_out` + high-priority alert | ✅ |
| 17 | "thanks" (Jordan, Nov 17) | review from Nov 9 (**stale**, 8 days) | owner | `forward_to_owner (stale_context_only)` | ✅ |

`router.jsonl` in the folder has each decision with every context considered.
