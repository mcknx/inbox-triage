// node parse.check.mjs -> asserts the Parse rules, on the exact code embedded in workflow.json.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("parse.js", import.meta.url), "utf8");
const wf = JSON.parse(readFileSync(new URL("workflow.json", import.meta.url), "utf8"));
assert.ok(wf.nodes.find((n) => n.name === "Parse").parameters.jsCode.startsWith(src), "workflow.json Parse node is out of sync with parse.js");
const parse = new Function(src + "\nreturn parseTriage;")();

const email = "Invoice INV-778\nVendor: Davao Lab Works\nInvoice no: INV-778\nAmount: PHP 6,200.00\nDue date: 2026-10-12";
const inv = (o) => "```json\n" + JSON.stringify({ category: "invoice", urgency: "normal", summary: "s", reply_draft: null,
  invoice: { vendor: "Davao Lab Works", invoice_no: "INV-778", amount: 6200, currency: "PHP", due_date: "2026-10-30", ...o } }) + "\n```";
const today = "2026-10-09";

const good = parse(inv(), today, email);
assert.deepEqual(good.invoice, { vendor: "Davao Lab Works", invoice_no: "INV-778", amount: 6200, currency: "PHP", due_date: "2026-10-30" });
assert.equal(good.category, "invoice"); assert.equal(good.urgency, "normal");
assert.equal(parse(inv({ due_date: "2026-10-12" }), today, email).urgency, "high"); // due in 3 days
for (const [why, o] of [["missing field", { amount: undefined }], ["bad date", { due_date: "2026-02-30" }],
  ["invoice_no not in text", { invoice_no: "INV-999" }], ["vendor not in text", { vendor: "Acme Dental" }]]) {
  const r = parse(inv(o), today, email);
  assert.equal(r.invoice, null, why); assert.equal(r.category, "supplier", why); assert.equal(r.urgency, "high", why);
}
assert.equal(parse(undefined, today, email).summary, "Needs a human look");
assert.equal(parse("not json", today, email).category, "other");
console.log("parse ok: 8 cases");
