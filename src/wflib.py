"""Small helper for building n8n workflow JSON from the Code-node sources in this folder."""
import json, os, uuid
HERE = os.path.dirname(os.path.abspath(__file__))
COMMON = open(os.path.join(HERE, 'common.js')).read()

def code_src(name):
    return open(os.path.join(HERE, name)).read().replace('//@@COMMON@@', COMMON)

class WF:
    def __init__(self, key):
        self.key, self.nodes, self.conns = key, [], {}
    def nid(self, n): return str(uuid.uuid5(uuid.NAMESPACE_URL, self.key + '/' + n))
    def node(self, name, type_, ver, pos, params, **extra):
        n = {"parameters": params, "id": self.nid(name), "name": name, "type": type_, "typeVersion": ver, "position": pos}
        n.update(extra); self.nodes.append(n); return name
    def link(self, a, b, out=0, inp=0):
        m = self.conns.setdefault(a, {"main": []})["main"]
        while len(m) <= out: m.append([])
        m[out].append({"node": b, "type": "main", "index": inp})
    def note(self, kw, note):
        if note: kw.update(notes=note, notesInFlow=True)
        return kw
    def code(self, name, file, pos, note=None):
        return self.node(name, "n8n-nodes-base.code", 2, pos, {"jsCode": code_src(file)}, **self.note({}, note))
    def ifbool(self, name, expr, pos, note=None):
        return self.node(name, "n8n-nodes-base.if", 2.2, pos, {
            "conditions": {"options": {"caseSensitive": True, "leftValue": "", "typeValidation": "loose", "version": 2},
                           "conditions": [{"id": self.nid(name + 'c'), "leftValue": expr, "rightValue": "",
                                           "operator": {"type": "boolean", "operation": "true", "singleValue": True}}],
                           "combinator": "and"},
            "looseTypeValidation": True, "options": {}}, **self.note({}, note))
    def webhook(self, name, path, pos, note=None, all_entries=False):
        return self.node(name, "n8n-nodes-base.webhook", 2.1, pos,
                         {"httpMethod": "POST", "path": path, "responseMode": "lastNode",
                          "responseData": "allEntries" if all_entries else "firstEntryJson", "options": {}},
                         webhookId=self.nid('wh-' + path), **self.note({}, note))
    def schedule(self, name, minutes, pos, note=None):
        return self.node(name, "n8n-nodes-base.scheduleTrigger", 1.2, pos,
                         {"rule": {"interval": [{"field": "minutes", "minutesInterval": minutes}]}}, **self.note({}, note))
    def sticky(self, text, pos, w=560, h=280):
        self.nodes.append({"parameters": {"content": text, "height": h, "width": w}, "id": self.nid('sticky'), "name": "Sticky Note",
                           "type": "n8n-nodes-base.stickyNote", "typeVersion": 1, "position": pos})
    def delivery_tail(self, x, y):
        """Test mode? -> TEST log | live: provider switch -> Twilio/Telnyx (disabled) -> live log -> owner email (disabled) -> response."""
        self.ifbool("Test mode?", "={{ $json.test_mode !== false }}", [x, y], "true = log only, nothing is sent")
        self.code("TEST: Log Would-Be SMS + Owner Alert", "test_log.js", [x + 240, y - 120], "Writes data/logs/*.jsonl")
        self.node("Live: Route by Provider", "n8n-nodes-base.switch", 3.2, [x + 240, y + 200],
                  {"mode": "expression", "numberOutputs": 3,
                   "output": "={{ !$json.sms ? 2 : ($json.provider === 'twilio' ? 0 : ($json.provider === 'telnyx' ? 1 : 2)) }}", "options": {}},
                  notes="0 Twilio, 1 Telnyx, 2 no SMS / unknown provider", notesInFlow=True)
        self.node("Twilio: Send SMS", "n8n-nodes-base.twilio", 1, [x + 480, y + 80],
                  {"resource": "sms", "operation": "send", "from": "={{ $json.sms.from }}", "to": "={{ $json.sms.to }}", "message": "={{ $json.sms.body }}", "options": {}},
                  disabled=True, notes="DISABLED. Add a Twilio credential and enable for live sends.", notesInFlow=True)
        self.node("Telnyx: Send SMS", "n8n-nodes-base.httpRequest", 4.2, [x + 480, y + 240], {
            "method": "POST", "url": "https://api.telnyx.com/v2/messages",
            "authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth",
            "sendBody": True, "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify({ from: $json.sms.from, to: $json.sms.to, text: $json.sms.body }) }}",
            "options": {"timeout": 10000}}, disabled=True,
            notes="DISABLED. Header Auth credential (Authorization: Bearer <key>). Enable for live sends.", notesInFlow=True)
        self.code("Live: Log Result", "live_log.js", [x + 720, y + 200])
        self.ifbool("Owner alert?", "={{ !!$json.owner_alert }}", [x + 940, y + 200])
        self.node("Owner Alert Email (SMTP)", "n8n-nodes-base.emailSend", 2.1, [x + 1160, y + 120], {
            "fromEmail": "alerts@example.com", "toEmail": "={{ $json.owner_alert.to_email }}",
            "subject": "={{ $json.owner_alert.subject }}", "emailFormat": "text", "text": "={{ $json.owner_alert.body }}", "options": {}},
            disabled=True, notes="DISABLED. Add an SMTP credential to email owners.", notesInFlow=True)
        self.code("Build Webhook Response", "respond.js", [x + 1400, y])
        L = self.link
        L("Test mode?", "TEST: Log Would-Be SMS + Owner Alert", 0); L("Test mode?", "Live: Route by Provider", 1)
        L("TEST: Log Would-Be SMS + Owner Alert", "Build Webhook Response")
        L("Live: Route by Provider", "Twilio: Send SMS", 0); L("Live: Route by Provider", "Telnyx: Send SMS", 1); L("Live: Route by Provider", "Live: Log Result", 2)
        L("Twilio: Send SMS", "Live: Log Result"); L("Telnyx: Send SMS", "Live: Log Result")
        L("Live: Log Result", "Owner alert?"); L("Owner alert?", "Owner Alert Email (SMTP)", 0); L("Owner alert?", "Build Webhook Response", 1)
        L("Owner Alert Email (SMTP)", "Build Webhook Response")
    def save(self, wid, name, filename):
        wf = {"id": wid, "name": name, "active": False, "nodes": self.nodes, "connections": self.conns,
              "settings": {"executionOrder": "v1", "saveDataSuccessExecution": "all", "saveManualExecutions": True, "timezone": "America/Chicago"},
              "pinData": {}, "tags": [], "meta": {"templateCredsSetupCompleted": False}}
        open(os.path.join(HERE, '..', filename), 'w').write(json.dumps(wf, indent=2))
        print(filename, 'nodes:', len(self.nodes))
