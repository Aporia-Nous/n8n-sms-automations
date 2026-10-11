#!/usr/bin/env python3
"""Builds ../missed-call-text-back.json from the Code-node sources in this folder."""
import json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
common = open(os.path.join(HERE, 'common.js')).read()
def code(name):
    s = open(os.path.join(HERE, name)).read()
    return s.replace('//@@COMMON@@', common)
def nid(n): return str(uuid.uuid5(uuid.NAMESPACE_URL, 'mctb/' + n))

nodes, conns = [], {}
def node(name, type_, ver, pos, params, **extra):
    n = {"parameters": params, "id": nid(name), "name": name, "type": type_, "typeVersion": ver, "position": pos}
    n.update(extra); nodes.append(n); return name
def link(a, b, out=0, inp=0):
    conns.setdefault(a, {"main": []})
    m = conns[a]["main"]
    while len(m) <= out: m.append([])
    m[out].append({"node": b, "type": "main", "index": inp})
def codenode(name, file, pos, note=None):
    kw = {}
    if note: kw.update(notes=note, notesInFlow=True)
    return node(name, "n8n-nodes-base.code", 2, pos, {"jsCode": code(file)}, **kw)
def ifbool(name, expr, pos, note=None):
    kw = {}
    if note: kw.update(notes=note, notesInFlow=True)
    return node(name, "n8n-nodes-base.if", 2.2, pos, {
        "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                       "conditions": [{"id": nid(name+'c'), "leftValue": expr, "rightValue": "",
                                       "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                       "combinator": "and"},
        "looseTypeValidation": True, "options": {}}, **kw)

# ---------- missed-call entry ----------
node("Missed Call Webhook", "n8n-nodes-base.webhook", 2.1, [0, 0],
     {"httpMethod": "POST", "path": "missed-call", "responseMode": "lastNode", "responseData": "firstEntryJson", "options": {}},
     webhookId=nid('wh-missed'), notes="POST a call-ended event here (generic JSON, Twilio form post, Telnyx call.hangup, or Votel webhook step).", notesInFlow=True)
codenode("Normalize Call Event", "normalize_call.js", [220, 0])
codenode("Rules: Config, Hours, Opt-out, Dedupe", "rules_call.js", [440, 0], "Reads data/config.json, optouts.json, state.json")
ifbool("LLM personalization on?", "={{ $json.action === 'text' && $json.llm && $json.llm.enabled === true }}", [660, 0])
node("LLM Personalize (OpenAI-compatible)", "n8n-nodes-base.httpRequest", 4.2, [880, -120], {
    "method": "POST", "url": "https://api.openai.com/v1/chat/completions",
    "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
    "sendBody": True, "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ model: 'gpt-4o-mini', max_tokens: 120, temperature: 0.4, messages: [ { role: 'system', content: 'Rewrite this missed-call text for a small business so it sounds warm and human. Keep it under 300 characters, keep the booking link exactly, no emojis, no promises about prices or times.' }, { role: 'user', content: 'Business: ' + $json.business_name + '\\nCaller name (may be blank): ' + ($json.caller_name || '') + '\\nDraft: ' + $json.sms.body } ] }) }}",
    "options": {"timeout": 8000}}, disabled=True, onError="continueRegularOutput",
    notes="DISABLED by default (no paid API calls). Point at any OpenAI-compatible endpoint, add a Header Auth credential, then enable and set llm.enabled=true in config.", notesInFlow=True)
codenode("Apply LLM Text (with guardrails)", "apply_llm.js", [1100, -120])

# ---------- sms reply entry ----------
node("SMS Reply Webhook", "n8n-nodes-base.webhook", 2.1, [0, 360],
     {"httpMethod": "POST", "path": "sms-reply", "responseMode": "lastNode", "responseData": "firstEntryJson", "options": {}},
     webhookId=nid('wh-reply'), notes="Point the client number's inbound-SMS webhook here.", notesInFlow=True)
codenode("Normalize Inbound SMS", "normalize_sms.js", [220, 360])
codenode("Handle Reply: STOP / HELP / Booking / Owner", "handle_reply.js", [440, 360], "Updates data/optouts.json")

# ---------- shared delivery ----------
ifbool("Test mode?", "={{ $json.test_mode !== false }}", [1320, 120], "true = log only, nothing is sent")
codenode("TEST: Log Would-Be SMS + Owner Alert", "test_log.js", [1560, 0], "Writes data/logs/*.jsonl")
node("Live: Route by Provider", "n8n-nodes-base.switch", 3.2, [1560, 320],
     {"mode": "expression", "numberOutputs": 3,
      "output": "={{ !$json.sms ? 2 : ($json.provider === 'twilio' ? 0 : ($json.provider === 'telnyx' ? 1 : 2)) }}",
      "options": {}}, notes="0 Twilio, 1 Telnyx, 2 no SMS / unknown provider", notesInFlow=True)
node("Twilio: Send SMS", "n8n-nodes-base.twilio", 1, [1800, 200],
     {"resource": "sms", "operation": "send", "from": "={{ $json.sms.from }}", "to": "={{ $json.sms.to }}", "message": "={{ $json.sms.body }}", "options": {}},
     disabled=True, notes="DISABLED. Add a Twilio credential (Account SID + Auth Token) and enable for live sends.", notesInFlow=True)
node("Telnyx: Send SMS", "n8n-nodes-base.httpRequest", 4.2, [1800, 360], {
    "method": "POST", "url": "https://api.telnyx.com/v2/messages",
    "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
    "sendBody": True, "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ from: $json.sms.from, to: $json.sms.to, text: $json.sms.body }) }}",
    "options": {"timeout": 10000}}, disabled=True,
    notes="DISABLED. Header Auth credential: Authorization = Bearer <Telnyx API key>. Enable for live sends.", notesInFlow=True)
codenode("Live: Log Result", "live_log.js", [2040, 320])
ifbool("Owner alert?", "={{ !!$json.owner_alert }}", [2260, 320])
node("Owner Alert Email (SMTP)", "n8n-nodes-base.emailSend", 2.1, [2480, 240], {
    "fromEmail": "alerts@example.com", "toEmail": "={{ $json.owner_alert.to_email }}",
    "subject": "={{ $json.owner_alert.subject }}", "emailFormat": "text", "text": "={{ $json.owner_alert.body }}", "options": {}},
    disabled=True, notes="DISABLED. Add SMTP credential and a real from address to email owners. (Or swap for a Twilio/Telnyx SMS to owner_alert.to_sms.)", notesInFlow=True)
codenode("Build Webhook Response", "respond.js", [2720, 120])

link("Missed Call Webhook", "Normalize Call Event")
link("Normalize Call Event", "Rules: Config, Hours, Opt-out, Dedupe")
link("Rules: Config, Hours, Opt-out, Dedupe", "LLM personalization on?")
link("LLM personalization on?", "LLM Personalize (OpenAI-compatible)", 0)
link("LLM personalization on?", "Test mode?", 1)
link("LLM Personalize (OpenAI-compatible)", "Apply LLM Text (with guardrails)")
link("Apply LLM Text (with guardrails)", "Test mode?")
link("SMS Reply Webhook", "Normalize Inbound SMS")
link("Normalize Inbound SMS", "Handle Reply: STOP / HELP / Booking / Owner")
link("Handle Reply: STOP / HELP / Booking / Owner", "Test mode?")
link("Test mode?", "TEST: Log Would-Be SMS + Owner Alert", 0)
link("Test mode?", "Live: Route by Provider", 1)
link("TEST: Log Would-Be SMS + Owner Alert", "Build Webhook Response")
link("Live: Route by Provider", "Twilio: Send SMS", 0)
link("Live: Route by Provider", "Telnyx: Send SMS", 1)
link("Live: Route by Provider", "Live: Log Result", 2)
link("Twilio: Send SMS", "Live: Log Result")
link("Telnyx: Send SMS", "Live: Log Result")
link("Live: Log Result", "Owner alert?")
link("Owner alert?", "Owner Alert Email (SMTP)", 0)
link("Owner alert?", "Build Webhook Response", 1)
link("Owner Alert Email (SMTP)", "Build Webhook Response")

sticky = {"parameters": {"content": "## Missed-Call Text-Back (template)\nTest mode is ON by default (data/config.json -> defaults.test_mode). In test mode nothing is sent: would-be texts go to data/logs/outbox.jsonl, owner alerts to data/logs/owner-alerts.jsonl.\n\nLive sends need: a client number with A2P 10DLC registration, a provider credential, test_mode=false, provider=twilio|telnyx, and the matching send node enabled.\n\nSee README.md.", "height": 260, "width": 520},
          "id": nid('sticky'), "name": "Sticky Note", "type": "n8n-nodes-base.stickyNote", "typeVersion": 1, "position": [-40, -380]}
nodes.append(sticky)
wf = {"id": "MissedCallTxtBk1", "name": "Missed-Call Text-Back (template)", "active": False, "nodes": nodes, "connections": conns,
      "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "all", "saveManualExecutions": True, "timezone": "America/Chicago"},
      "pinData": {}, "tags": [], "meta": {"templateCredsSetupCompleted": False}}
open(os.path.join(HERE, '..', 'missed-call-text-back.json'), 'w').write(json.dumps(wf, indent=2))
print('nodes:', len(nodes))
