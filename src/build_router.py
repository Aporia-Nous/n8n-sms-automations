#!/usr/bin/env python3
"""Builds ../sms-router.json"""
from wflib import WF
w = WF('router')
w.webhook("Inbound SMS Webhook (one per number)", "sms-in", [0, 200], "Point each client number's inbound-SMS webhook here (Twilio form, Telnyx message.received, or generic JSON).")
w.code("Normalize Inbound SMS", "normalize_sms.js", [240, 200])
w.code("Route Reply", "router.js", [480, 200], "STOP/START/HELP centrally, then pick the automation. Logs data/logs/router.jsonl")
w.node("Central or Forward?", "n8n-nodes-base.switch", 3.2, [720, 200],
       {"mode": "expression", "numberOutputs": 2, "output": "={{ $json.route === 'forward' ? 1 : 0 }}", "options": {}},
       notes="0 handled here (keywords / owner fallback), 1 forward to automation", notesInFlow=True)
w.node("Forward to Automation (internal webhook)", "n8n-nodes-base.httpRequest", 4.2, [960, 460], {
    "method": "POST", "url": "={{ $json.forward.url }}", "sendHeaders": True,
    "headerParameters": {"parameters": [{"name": "x-webhook-token", "value": "={{ $json._fwd_token }}"}]},
    "sendBody": True, "specifyBody": "json", "jsonBody": "={{ JSON.stringify($json.forward.body) }}",
    "options": {"timeout": 15000}}, onError="continueRegularOutput",
    notes="Local call to the same n8n (no external traffic). The target automation does its own test-mode logging.", notesInFlow=True)
w.code("Router: Build Response", "router_response.js", [1200, 460])
w.link("Inbound SMS Webhook (one per number)", "Normalize Inbound SMS"); w.link("Normalize Inbound SMS", "Route Reply"); w.link("Route Reply", "Central or Forward?")
w.link("Central or Forward?", "Test mode?", 0); w.link("Central or Forward?", "Forward to Automation (internal webhook)", 1)
w.link("Forward to Automation (internal webhook)", "Router: Build Response")
w.delivery_tail(960, -60)
w.sticky("## Inbound-SMS Router\nOne inbound URL per client number: /webhook/sms-in?business_id=...\nSTOP/START/HELP handled here once (shared opt-out list). Other replies go to the automation that most recently texted this number (reminders / reviews / missed-call), with intent overrides (C/R/cancel/late -> reminders, ratings -> reviews). Unknown, stale, or tied -> owner alert, no auto-reply.\nTest mode ON: nothing is sent.", [-40, -260], h=260)
w.save("SmsReplyRouter01", "Inbound SMS Router", "sms-router.json")
