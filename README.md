# n8n SMS Automations: missed-call text-back, reminders, reviews, inbound router

Four production-style n8n workflows for small businesses: text back missed callers within seconds, send appointment reminders, request reviews (with an unhappy-customer feedback path), and route inbound SMS replies to the right workflow. Handles STOP/HELP opt-outs, quiet hours, dedupe, and works with Twilio, Telnyx, or Votel webhooks. Test mode is on by default (nothing is sent). 90+ scripted webhook tests with recorded results in tests/.

**Tech stack:** n8n Community Edition (self-hosted), JavaScript Code nodes, Python build scripts, JSON file state, bash/curl test harness

> **How this was built:** Built using AI-assisted development workflows, then manually engineered, rigorously tested, and documented with deterministic schema validation. Demo data only: all names, numbers, and businesses are fictional.

Built by DeAli Dillard ([Aporia Nous](https://github.com/Aporia-Nous)). Contact: demo@aporianous.com. MIT licensed.

---

# SMS automations on self-hosted n8n: Missed-Call Text-Back, Appointment Reminders, Review Requests

Three product templates and one inbound-SMS router share one n8n instance, one config file, one STOP list and one test-mode log. Sections 1–5 cover Missed-Call Text-Back, which also explains the shared setup. Sections 6–8 cover Appointment Reminders and Review Requests, and section 9 covers the router.


When a call to a client's business line is missed, this texts the caller back within seconds. It uses the client's own number, their wording, their hours, and their booking link. It also alerts the owner and handles replies (STOP, HELP, booking requests, and normal replies forwarded to the owner).

It's built on **n8n Community Edition** (free, self-hosted). There's no n8n Cloud account and no paid API. **Test mode is on by default:** nothing is sent, and every would-be text and owner alert is written to a log file instead.

```
n8n-flows/
  missed-call-text-back.json   <- workflow 1 (import this)
  appointment-reminders.json   <- workflow 2
  review-requests.json         <- workflow 3
  sms-router.json              <- inbound-SMS router (one inbound URL per number)
  src/                         <- Code-node sources + build_*.py / wflib.py (edit here, then rebuild)
  data/config.json             <- per-business settings (name, hours, numbers, templates, test_mode, provider)
  data/optouts.json            <- STOP list (per business)
  data/state.json              <- missed-call dedupe + booking-reply memory
  data/appointments.json       <- reminders: appointments + which reminder slots were sent/skipped
  data/review-queue.json       <- reviews: one entry per job (queued/sent/followed_up/replied...)
  data/logs/*.jsonl            <- outbox (would-be texts), owner-alerts, events
  payload-examples/            <- what Twilio, Telnyx and Votel send, and the generic shape
  tests/                       <- missed-call run-tests.sh + results/, reminders/, reviews/, router/, RESULTS.md
```

## 1. Running it on the box

n8n 2.42.5 is installed in `/workspace/n8n-app`. It runs on its own Node 24 in `/workspace/n8n-app/node`, because the system Node 20 is too old for n8n 2.x. Data lives in `/workspace/n8n-data` (`N8N_USER_FOLDER`).

| What | Command |
|---|---|
| Start (background, low priority) | `/workspace/n8n-data/start-n8n.sh` |
| Stop | `/workspace/n8n-data/stop-n8n.sh` |
| Logs | `tail -f /workspace/n8n-data/n8n.log` |
| Health | `curl http://localhost:5678/healthz` |
| Editor | http://localhost:5678 (first visit asks you to create the local owner login) |
| Rebuild + re-import + publish all four workflows after editing `src/` | `/workspace/n8n-data/redeploy-workflow.sh` |
| Run the tests | `tests/run-tests.sh`, `tests/reminders/run-tests.sh`, `tests/reviews/run-tests.sh`, `tests/router/run-tests.sh` (each resets its own state, the shared opt-out list and the logs first, so run one at a time) |

Settings are in `/workspace/n8n-data/n8n-env.sh`. Telemetry, version checks, templates and personalization are all off. It listens on 127.0.0.1 only, prunes executions after 7 days, caps the heap at 640 MB, and allows Code nodes to use `fs`, `path` and `crypto` only, for the JSON files in `data/`. When idle it uses about 0.5 GB RAM for n8n plus about 0.13 GB for its task runner, at under 1% CPU (about 0.75 GB right after startup). The install itself is 3.1 GB on disk.

Webhook URLs (production, active as long as n8n runs):

- `POST http://localhost:5678/webhook/missed-call`: call-ended events
- `POST http://localhost:5678/webhook/sms-reply`: inbound texts (missed-call)
- `POST .../webhook/appointment`, `.../reminder-reply`, `.../reminders-run` (test-only scan at a simulated time)
- `POST .../webhook/job-completed`, `.../review-reply`, `.../reviews-run` (test-only scan at a simulated time)
- `POST .../webhook/sms-in`: **the inbound-SMS router. In production, this is the one URL to set on every client number.**

Reminders and Reviews also each have a **Schedule Trigger every 15 minutes** that scans with the real clock. The tests empty `appointments.json` and `review-queue.json` when they finish, so the real scans find nothing to do on the box.

## 2. How the workflow works

```
Missed Call Webhook -> Normalize Call Event -> Rules (config, hours, opt-out, dedupe) -> LLM on? --no--> Test mode?
                                                                                       \--yes-> LLM Personalize [disabled] -> Apply LLM Text (guardrails) -> Test mode?
SMS Reply Webhook  -> Normalize Inbound SMS -> Handle Reply (STOP/START/HELP/booking/owner) -----------------------------> Test mode?
Test mode? --true--> TEST: log would-be SMS + owner alert --------------------------------------------> Build Webhook Response
           --false-> Route by Provider -> Twilio: Send SMS [disabled] | Telnyx: Send SMS [disabled] | (no SMS)
                     -> Live: Log Result -> Owner alert? -> Owner Alert Email (SMTP) [disabled] -> Build Webhook Response
```

- **Normalize.** It accepts a generic shape `{from, to, business_id, timestamp, call_status}`, a Twilio `<Dial>` action or status callback (form-encoded), a Telnyx `call.hangup` webhook, or a Votel webhook step. Numbers become E.164.
  - Missed: `no_answer`/`no-answer`, `busy`/`user_busy`, `voicemail`, `canceled`/`originator_cancel`, `failed`, `call_rejected`, `timeout`.
  - Answered (ignored): `answered`, `completed`, `normal_clearing`.
  - See `payload-examples/` for each provider's fields.
- **Per-business config** (`data/config.json`). Each business has a name, numbers, `sms_from`, a timezone, weekly hours, `closed_dates`, a booking link, an owner alert contact (email and SMS), `ignore_numbers` (e.g. the owner's cell), and templates. The business is found by `business_id` or by the dialed number. Edits apply on the next call, with no restart.
- **Business hours.** Calls in hours use the `in_hours` template. After hours, the `after_hours` template says when the business opens again ("We open tomorrow at 8 AM"). Set `after_hours_mode: "skip"` to only alert the owner instead.
- **Dedupe.** The same number gets at most one text-back per `dedupe_window_hours` (default 24) per business. The slot is reserved before sending, so two quick calls can't double-text.
- **Opt-out.** Replies of STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, OPTOUT or REVOKE add the number to `optouts.json`, and it's never auto-texted again (the owner is still alerted about missed calls). START or UNSTOP removes it. HELP or INFO sends the help text. Keywords only count when they are the whole message.
- **Compose.** The template is rendered (`{{business_name}}`, `{{booking_link}}`, `{{next_open}}`, `{{business_number}}`, `{{caller_name}}`), and "Reply STOP to opt out." is added if it's missing. The segment count and encoding are worked out so cost is visible. The demo templates fit in one 160-character segment.
- **Optional LLM.** If `llm.enabled=true`, the item goes to an OpenAI-compatible HTTP node, which is **disabled by default**. The guardrail step falls back to the template if there's no response or it's too long, and re-adds the STOP line if it's missing. The default makes no paid calls.
- **Replies.** Normal replies go to the owner as high-priority alerts. If a reply sounds like a booking request (book, appointment, schedule, come in, tomorrow, quote...) and the business has a booking link, it auto-replies with the link, at most once per `booking_reply_window_hours`.
- **Delivery.** In `test_mode` (default), texts and alerts are only logged. In live mode, the item goes to the Twilio node or the Telnyx HTTP node, both disabled until you add credentials. Then a result is logged, and an owner email goes out through an SMTP node (also disabled).
- **Optional webhook token.** Set `defaults.webhook_token` in the config and add `?token=...` to the provider's webhook URL, or send an `x-webhook-token` header. Only a hash of it is compared, and it's never logged.

## 3. Deploying later on a cheap VPS

1. **Server.** Any 1–2 vCPU / 2–4 GB VPS works. For example, Hetzner CX23 (2 vCPU, 4 GB) is €5.49/mo plus €0.50 IPv4 for new orders since 15 June 2026, ex-VAT (third-party trackers of Hetzner's rate card: [trackvps](https://trackvps.com/hetzner-cloud-pricing), [cloudtally](https://cloudtally.eu/blog/hetzner-june-2026-price-increase); Hetzner's own page didn't render prices when checked today). One instance can serve many clients.
2. **Install n8n.** Docker is recommended, and n8n says future versions will require its Docker image: `docker run -d --restart unless-stopped -p 127.0.0.1:5678:5678 -v n8n_data:/home/node/.n8n -v /opt/mctb:/data/n8n-flows -e N8N_DIAGNOSTICS_ENABLED=false -e NODE_FUNCTION_ALLOW_BUILTIN=fs,path,crypto -e N8N_WEBHOOK_URL=https://automations.yourdomain.com/ -e GENERIC_TIMEZONE=America/Chicago docker.n8n.io/n8nio/n8n`. Copy `data/` to `/opt/mctb/data`. If you mount it somewhere else, update `DATA_DIR` at the top of the two Normalize nodes.
3. **HTTPS.** Put Caddy in front: `automations.yourdomain.com { reverse_proxy 127.0.0.1:5678 }`. That gets a free Let's Encrypt certificate. Twilio and Telnyx need a public HTTPS URL.
4. **Import and publish.** Import `missed-call-text-back.json` in the editor (or `n8n import:workflow` + `n8n publish:workflow --id=MissedCallTxtBk1`), then publish it.
5. **Lock down and back up.** Set `defaults.webhook_token`, keep the editor behind the n8n login, back up `data/` and the n8n volume, and keep execution pruning on.
6. **Scale-up note.** The JSON-file state is fine for a handful of clients at small-business volume. For more traffic, move the state and opt-outs to n8n Data Tables, SQLite/Postgres or Redis, because concurrent writes to one JSON file can race.

**License.** n8n Community Edition uses the Sustainable Use License. Building and running workflows for clients on your own instance and charging for that work is allowed, as long as clients only get the outputs and can't open or edit workflows. Hosting n8n as a service, white-labelling it, or letting clients build workflows needs a commercial license. ([n8n license help](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case), [license FAQ](https://docs.n8n.io/n8n-community-license/community-license/license-faq))

## 4. Running costs to expect (public prices, checked Oct 8 2026)

**SMS per message segment (US, 10DLC local number)**

| | Twilio | Telnyx |
|---|---|---|
| Outbound SMS | $0.0083 + carrier fee | $0.004 + carrier fee |
| Inbound SMS | $0.0083 + carrier fee | $0.004 + carrier fee |
| Carrier fee, outbound | AT&T $0.0035, T-Mobile $0.0045, Verizon $0.005, US Cellular $0.005, others $0.0042 | AT&T $0.0035, T-Mobile $0.0045, Verizon $0.0045 on the rate card ($0.005 from Oct 1 2026 per Telnyx's 10DLC guide) |
| Carrier fee, inbound | AT&T $0.0035, T-Mobile $0.0025, US Cellular $0.0025, Verizon none | AT&T $0.0035, T-Mobile $0.0025, Verizon none |
| Local number | $1.15/mo | $1.00/mo on the pricing page ($1.10/mo "local number with SMS" in Telnyx's 10DLC guide) |
| Failed message fee | $0.001 per failed message | n/a |

Sources: [Twilio US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), [Telnyx messaging pricing](https://telnyx.com/pricing/messaging), [Telnyx "What is 10DLC"](https://telnyx.com/resources/what-is-10dlc).

**A2P 10DLC registration** is required for any app-sent text from a 10-digit number. Unregistered traffic has been blocked since Feb 2025. The fees are TCR and carrier pass-throughs and are the same on both providers:

| Fee | Amount |
|---|---|
| Brand registration (EIN business), one time | $4.50 (sole proprietor $4) |
| Campaign vetting/review, one time per submission | $15 (charged again on resubmission) |
| Campaign monthly fee | $1.50 Low-Volume Mixed · $10 standard use cases (e.g. Customer Care) · $2 sole proprietor |
| Optional Standard Brand vetting (higher throughput) | $41.50 |

Telnyx bills the first 3 months of the campaign fee up front. Sources: [Twilio 10DLC brand fees](https://www.twilio.com/docs/trust-hub/registrations/a2p-10dlc-brand), [Twilio 10DLC page](https://www.twilio.com/en-us/phone-numbers/a2p-10dlc), [Telnyx 10DLC fees and charges](https://support.telnyx.com/en/articles/5634625-10dlc-fees-and-charges), [Telnyx register for 10DLC](https://support.telnyx.com/en/articles/6325731-register-for-10dlc-messaging).

**Worked example: one client, 100 missed calls per month.** That's about 120 outbound texts (100 text-backs plus about 20 booking or STOP replies) and about 40 inbound replies, all one segment, priced at the higher carrier fees.

| | Twilio | Telnyx |
|---|---|---|
| Number | $1.15 | ~$1.10 |
| 10DLC campaign (Low-Volume Mixed) | $1.50 | $1.50 |
| 120 outbound × (rate + ~$0.0045) | ~$1.54 | ~$1.02 |
| 40 inbound × (rate + ~$0.0035) | ~$0.47 | ~$0.30 |
| **Monthly per client** | **≈ $4.70** | **≈ $3.90** |
| One time per client | $19.50 ($4.50 brand + $15 vetting) | $19.50 |

If the campaign has to be a $10 standard one, add $8.50/mo. The VPS (≈ €6/mo) is shared across all clients. Against the catalog's $149/mo care fee, running costs stay under about $15/mo per client in almost any case. Put the one-time 10DLC fees into the setup price.

## 5. Plugging in a client's number

1. **Number.** Either buy or port a number in the client's own Twilio or Telnyx account (preferred: they own it and the bill), or keep their existing carrier line and set up conditional call forwarding (busy or no answer) to the new number.
2. **10DLC.** Register under the client's legal name and EIN. Use "Customer Care" or Low-Volume Mixed. The campaign description should say callers get one text after a missed call. Sample messages are the templates. Opt-in is "the consumer called the business". Include the STOP/HELP language. Approval usually takes a few days, so don't promise go-live before it's approved.
3. **Calls → n8n.**
   - **Twilio:** have the number's Voice URL run TwiML that `<Dial>`s the owner's phone with `timeout="20"` and `action="https://YOUR-N8N/webhook/missed-call?business_id=CLIENT_ID&token=..."`. Twilio posts `DialCallStatus` there.
   - **Telnyx:** use a Call Control app that transfers or dials the owner and sends `call.hangup` webhooks to the same URL.
   - **Votel:** add a `call_ended` trigger (missed/no_answer/voicemail, filtered to the client's number) and a webhook step with the JSON in `payload-examples/votel-call-ended-webhook-step.json`. Only do this on a client's own Votel number, never Ali's.
4. **Texts → n8n.** Set the number's inbound-message webhook to `https://YOUR-N8N/webhook/sms-reply?business_id=CLIENT_ID&token=...`.
   - **Twilio:** Advanced Opt-Out replies to STOP by default. Set `send_stop_confirmation: false` for that client to avoid a double reply.
   - **Either provider:** an empty or TwiML response is ideal. The JSON response is harmless, but Twilio may log a content-type warning.
5. **Config.** Copy the `kettle-creek-auto` block in `data/config.json` to a new id and fill in name, numbers, `sms_from`, timezone, hours, closed dates, booking link, owner email/SMS, `ignore_numbers` and templates.
6. **Credentials (in the n8n editor, never in config).**
   - **Twilio:** a "Twilio API" credential (Account SID + Auth Token, or an API Key), attached to **Twilio: Send SMS**.
   - **Telnyx:** a "Header Auth" credential with `Authorization: Bearer <API key>`, attached to **Telnyx: Send SMS**.
   - **Owner email:** an SMTP credential on **Owner Alert Email**, with a real from address.
7. **Go live (only after 10DLC approval and the client's OK).** Enable the matching send node (and the owner email node), set `"test_mode": false` and `"provider": "twilio"` or `"telnyx"` for that business, and place one real test call from your own phone. Check `data/logs/events.jsonl` for `accepted_by_provider`.

If one client's provider differs from another's, put `provider` and `test_mode` inside that business's block, since business settings override `defaults`.


---

## 6. Appointment Reminders

**Flow.**
```
Appointment Webhook -> Store / Update Appointment (appointments.json) -> Respond
Every 15 Minutes  ─┐
Run Scan Now (test)┴-> Find Due Reminders (24h / 2h) ─┐
Reminder Reply Webhook -> Normalize Inbound SMS -> Handle Reminder Reply ─┴-> Test mode? -> (same delivery tail as missed-call)
```

- **Input.** POST to `/webhook/appointment` with `{ business_id, appointment_id, customer_name, phone, start (ISO with offset), service, status: booked|rescheduled|cancelled, booked_at? }`. Map any calendar to this shape. Examples are a Votel `appointment` trigger with a webhook step, a Cal.com or Calendly webhook through a small mapping node, or a form.
  - A reschedule (a new `start` for the same id) resets the reminders.
  - A cancel stops them.
- **Scan** (every 15 min). For each booked or confirmed appointment, each offset in `reminders.offsets_hours` (default 24h and 2h) is decided **once** and marked in `appointments.json` as sent, superseded, skipped_booked_after_due, skipped_too_late, skipped_opted_out or skipped_quiet_hours. Rules, in order:
  1. Booked after the reminder's due time (e.g. booked 7h ahead): no 24h reminder.
  2. A later reminder is also due (e.g. n8n was down): only the later one is sent.
  3. Less than `min_lead_minutes` (30) before the start: no text.
  4. On the shared STOP list: no text, and one low-priority owner alert per appointment ("call if you need to confirm").
  5. Quiet hours (`defaults.quiet_hours`, 20:00–08:00 local): the reminder waits until quiet hours end, unless that would be too close to the start, in which case it's skipped.
- **Replies** (`/webhook/reminder-reply`):
  - **C** / confirm / yes / ok: marked confirmed, with a confirmation text.
  - **R** / reschedule: booking link sent, high-priority owner alert.
  - A sentence containing "cancel" ("I need to cancel tomorrow"): status set to `cancel_requested`, remaining reminders stopped, acknowledgement text, high-priority owner alert. The appointment is not auto-cancelled; the owner confirms it.
  - "Running late" / "on my way": acknowledgement text and a high-priority alert.
  - Anything else goes to the owner.
  - STOP, START and HELP use the shared list. A reply that is only the word **CANCEL** is a carrier opt-out keyword, so it's treated as STOP. The owner gets a high-priority "opted out and may have meant to cancel, please call" alert.
- **Config** (`businesses.<id>.reminders`): `enabled`, `offsets_hours`, `min_lead_minutes`, and `templates` (`reminder_24h`, `reminder_2h`, `confirm_reply`, `reschedule_reply`, `cancel_ack`, `late_ack`, `help`). Template variables: `{{first_name}}`, `{{pet_or_service}}` (the `service` field), `{{when}}` ("tomorrow at 2 PM"), `{{booking_link}}`, `{{business_name}}`, `{{business_number}}`. The demo business is Bright Paws Grooming (+1 555-555-0110).

## 7. Review Requests

**Flow.**
```
Job Completed Webhook -> Queue Review Request (review-queue.json) ─┐
Every 15 Minutes / Run Scan Now (test) -> Find Due Requests + Follow-ups ─┤
Review Reply Webhook -> Normalize Inbound SMS -> Handle Review Reply ─────┴-> Test mode? -> (same delivery tail)
```

- **Input.** POST to `/webhook/job-completed` with `{ business_id, job_id, customer_name, phone, completed_at, service }`.
- **Queueing.** One request per `job_id` (a second post is a duplicate). It's skipped if the number is opted out or was asked in the last `min_days_between_requests` (90) days. It's scheduled `delay_hours` (2) after the job, moved forward into business hours and outside quiet hours. For example, a job finished at 4:45 PM goes out at 8 AM the next business day, and a Saturday 12:30 job goes out Monday 8 AM.
- **Scan.** Sends due requests once. Sends **one** follow-up after `followup_after_days` (3) if there's been no reply. Sends only inside business hours and outside quiet hours; otherwise it waits. It cancels if the person opted out in the meantime, and expires anything more than `max_send_delay_days` (7) late.
- **Google review policy is built in:**
  - **No incentives.** If any review template mentions a discount, free item, gift card, raffle, reward and so on, every request for that business is refused and the owner gets a high-priority alert.
  - **No gating.** Every customer gets the same `review_link` in the first text, before any feedback is asked for. Both auto-replies (happy and unhappy) carry that same link.
- **Replies** (`/webhook/review-reply`). A rating is read from "5", "4 stars", "3/5" or a leading "2 - ...". Sentiment comes from simple word lists.
  - Ratings of 1–3 or unhappy words: a private, high-priority owner alert ("please reach out personally") and an apology text that still carries the review link.
  - Ratings of 4–5 or happy words: a thank-you with the link again, and a low-priority owner note.
  - Neutral: goes to the owner only.
  - There's only one auto-reply per request, and any reply stops the follow-up. STOP, START and HELP are shared as above.
- **Config** (`businesses.<id>.reviews`): `enabled`, `review_link` (use the client's Google "Ask for reviews" short link), `delay_hours`, `followup_enabled`, `followup_after_days`, `min_days_between_requests`, `max_send_delay_days`, and `templates` (`request`, `followup`, `happy_reply`, `unhappy_reply`, `help`).

## 8. Costs for reminders and reviews, compared with missed-call

The per-text prices are the same as in section 4. There are no new fixed costs **if** the client uses the same number and a 10DLC campaign that covers these message types. Volume is the main difference:

| Per client per month (all 1-segment texts, higher carrier fees) | Texts out | Texts in | Twilio | Telnyx |
|---|---|---|---|---|
| Missed-call, 100 missed calls (section 4) | ~120 | ~40 | ~$2.00 + fixed | ~$1.30 + fixed |
| Reminders, 200 appointments (2 reminders each, ~60 auto-replies) | ~460 | ~100 | ~$5.90 + ~$1.20 = **~$7.10** | ~$3.90 + ~$0.75 = **~$4.65** |
| Reviews, 100 jobs (100 requests, ~40 follow-ups, ~30 auto-replies) | ~170 | ~40 | ~$2.20 + ~$0.47 = **~$2.65** | ~$1.45 + ~$0.30 = **~$1.75** |

The fixed cost is the same in every case and is paid once per number, not once per product: the number ($1.10–1.15/mo) plus the campaign ($1.50 Low-Volume Mixed or $10 standard). Reminders cost the most to run because they're two texts per appointment. Drop to one reminder (`offsets_hours: [24]`) to halve that.

**Possible extra 10DLC cost.** Review requests are often classed as marketing. A Low-Volume Mixed or Mixed campaign can list several use cases (customer care, account notifications, marketing), so one campaign can cover all three products if they're declared at registration. Adding a use case later can mean a new campaign or a resubmission ($15 vetting each time). Marketing texts also need clear consent from the customer to receive texts, so collect it at booking or checkout.

## 9. Inbound-SMS Router (one number, several products)

A provider number can send incoming texts to only **one** URL. Set every client number's inbound-message webhook to `https://YOUR-N8N/webhook/sms-in?business_id=CLIENT_ID&token=...`. It accepts Twilio form posts, Telnyx `message.received` and generic JSON. The router then decides where each reply belongs. The per-product reply webhooks (`sms-reply`, `reminder-reply`, `review-reply`) still work on their own. The router calls them over `127.0.0.1`, so the traffic never leaves the box or server.

```
Inbound SMS Webhook -> Normalize Inbound SMS -> Route Reply -> Central or Forward?
   central (STOP/START/HELP, unclear, unknown, stale) -> Test mode? -> (same delivery tail: log only in test mode)
   forward -> Forward to Automation (POST 127.0.0.1:5678/webhook/<reply path>) -> Router: Build Response
```

**Routing rules, in order:**
1. **STOP, START and HELP are handled once, centrally**, using the shared opt-out list, before anything is routed. The HELP text is `defaults.router.help_template`. A reply that is only **CANCEL** is an opt-out. If the number has a live reminder, the owner also gets a high-priority "may have meant to cancel the appointment, please call" alert.
2. **Find live conversations** this business has with the number, using the automations' own records:
   - **Missed-call:** a text-back (or booking-link reply) in the last `missed_call_window_hours` (72).
   - **Reminders:** a reminder was sent, the appointment is booked, confirmed or cancel-requested, it's no more than `reminder_after_start_hours` (2) past the start, and the reminder is under 72h old.
   - **Reviews:** a request or follow-up was sent in the last `review_window_days` (7).
   - Only texts sent before the reply count.
3. **Intent overrides recency:**
   - a. C, CONFIRM, R or RESCHEDULE, or a sentence about cancelling, rescheduling or running late, goes to **reminders** if there's a live reminder.
   - b. A rating-shaped reply ("5", "4 stars", "3/5", "2 - …") goes to **reviews** if there's a live review request.
4. **Otherwise the most recent automated text wins.** If only one automation is live, it gets the reply.
5. **Tie-break:** if the two most recent texts from different automations are less than `tie_window_minutes` (15) apart, the router doesn't guess. The reply goes to the **owner**, with an alert listing the recent automated texts, and nothing is auto-texted.
6. **No live conversation** (an unknown number, or only stale context): the owner is alerted and nothing is auto-texted.

Every decision is written to `data/logs/router.jsonl` with the rule used and every context it found, live or stale. All settings are in `defaults.router`, and a business can override them with its own `router` block.

**Security note:** if `webhook_token` is set, the router passes it to the internal webhooks in a header. It's never logged or returned, but like any workflow data it is stored in n8n's own execution records. Keep execution pruning on.
