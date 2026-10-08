// Turns Claude's reply into a safe row. Embedded verbatim in workflow.json's "Parse" node; tested by parse.check.mjs.
// text: bridge reply (or undefined if the bridge failed), today: YYYY-MM-DD, email: subject + body the model read.
function parseTriage(text, today, email) {
  const fallback = { category: 'other', urgency: 'normal', summary: 'Needs a human look', invoice: null, reply_draft: '' };
  let r;
  try {
    if (typeof text !== 'string') throw new Error('bridge failed');
    const t = text.replace(/```(?:json)?/g, '');
    r = JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
    if (!r || typeof r !== 'object') throw new Error('not an object');
  } catch (e) { return fallback; }
  const pick = (v, ok, d) => (ok.includes(v) ? v : d);
  let category = pick(r.category, ['invoice', 'enquiry', 'supplier', 'spam', 'other'], 'other');
  let urgency = pick(r.urgency, ['low', 'normal', 'high'], 'normal');
  const summary = (typeof r.summary === 'string' && r.summary.trim()) ? r.summary.trim().slice(0, 200) : fallback.summary;
  const str = v => (typeof v === 'string' && v.trim()) ? v.trim().slice(0, 100) : '';
  const realDate = d => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z'))
    && new Date(d + 'T00:00:00Z').toISOString().slice(0, 10) === d; // rejects 2026-02-30
  const body = String(email || '').toLowerCase();
  // Keep an invoice only when every field is well-formed and the vendor + invoice number are really in the email
  // ("copied, never guessed"); a half-read invoice goes to a human as supplier/high.
  const i = r.invoice;
  let invoice = null;
  if (category === 'invoice') {
    const ok = i && str(i.vendor) && str(i.invoice_no) && Number.isFinite(i.amount) && i.amount > 0 && str(i.currency)
      && realDate(i.due_date) && body.includes(str(i.invoice_no).toLowerCase()) && body.includes(str(i.vendor).toLowerCase());
    if (ok) invoice = { vendor: str(i.vendor), invoice_no: str(i.invoice_no), amount: Math.round(i.amount * 100) / 100, currency: str(i.currency), due_date: i.due_date };
    else { category = 'supplier'; urgency = 'high'; }
  }
  // Belt and braces for the money rule: due within 3 days or overdue is always high.
  if (invoice && (Date.parse(invoice.due_date) - Date.parse(today)) <= 3 * 864e5) urgency = 'high';
  const reply_draft = (category === 'enquiry' && typeof r.reply_draft === 'string' && r.reply_draft.trim()) ? r.reply_draft.trim().slice(0, 1500) : '';
  return { category, urgency, summary, invoice, reply_draft };
}
