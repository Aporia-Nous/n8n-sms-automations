// Apply LLM text (only used when llm.enabled = true).
// If the LLM node is disabled, errored, or returned something unusable, keep the template text.
// Guardrails: keep STOP language and booking link, cap length.
//@@COMMON@@
const out = [];
const items = $input.all();
for (let i = 0; i < items.length; i++) {
  const ctx = JSON.parse(JSON.stringify($('LLM personalization on?').all(0)[i].json));
  const r = items[i].json || {};
  let text = '';
  try { text = (r.choices && r.choices[0] && (r.choices[0].message || {}).content) || r.text || ''; } catch (e) { text = ''; }
  text = String(text || '').replace(/\s+/g, ' ').trim();
  const max = Number((ctx.llm || {}).max_chars || 320);
  if (!text || text.length > max) {
    ctx.llm_used = false; ctx.llm_note = text ? 'llm text too long, kept template' : 'no llm response (node disabled or failed), kept template';
  } else {
    if (ctx.sms.footer && !/\bSTOP\b/.test(text)) text += ' ' + ctx.sms.footer;
    ctx.sms = Object.assign({}, ctx.sms, { body: text, template: 'llm' }, segments(text));
    ctx.llm_used = true;
  }
  out.push({ json: ctx });
}
return out;
