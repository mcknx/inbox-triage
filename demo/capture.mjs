// Films the real P3 flow headless: title → Mailpit with 8 unread → one inbox run, dashboard filling live (every Claude call real, uncut here)
// → overdue CleanPro + total due → whitening reply draft → flow → end card.
// node capture.mjs   (needs Mailpit :8025/:1025, n8n :5678, bridge :8788, va-pg; empties the mailbox + p3 tables first)
// Writes $OUT/raw.webm + $OUT/run.json (event marks in seconds since the page opened ≈ video t=0).
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { execFileSync, execSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)(process.env.PW || "playwright");

const OUT = process.env.OUT || "/tmp/va-p3-demo";
const BASE = "http://localhost:8788";
const SCHED = Number(process.env.SCHED_SEC ?? 9); // UTC second the every-minute schedule fires (n8n execution_entity.startedAt)
const SIZE = { width: 1280, height: 720 };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const here = new URL(".", import.meta.url).pathname;
const q = (sql) => execFileSync("docker", ["exec", "va-pg", "psql", "-U", "va", "-d", "va", "-t", "-A", "-c", sql]).toString().trim();
const psql = (sql) => execFileSync("docker", ["exec", "-i", "va-pg", "psql", "-U", "va", "-d", "va", "-v", "ON_ERROR_STOP=1", "-q"], { input: sql });

// Flow diagram from workflow.json: the main path grouped into 5 boxes (every node name is checked against the file).
function flowHtml() {
  const wf = JSON.parse(readFileSync(here + "../workflow.json", "utf8"));
  const names = new Set(wf.nodes.map((n) => n.name));
  const groups = [
    ["Check the mailbox", ["Every minute", "Run now", "List messages"]],
    ["Skip what's sorted", ["Known ids", "Filter new", "Any new?"]],
    ["Read each email", ["Each email", "Get message", "Load kb"]],
    ["Claude sorts + extracts", ["Build prompt", "Ask Claude", "Parse"]],
    ["Save for the dashboard", ["Save", "Summary", "Respond"]],
  ];
  for (const n of groups.flatMap((g) => g[1])) if (!names.has(n)) throw new Error("workflow.json has no node " + n);
  const boxes = groups.map(([title, ns], i) => `${i ? '<div class="arr" style="animation-delay:' + (1.6 + i * 1.6) + 's">→</div>' : ""}
    <div class="box" style="animation-delay:${1.6 + i * 1.6}s"><div class="k">${i + 1}</div><b>${title}</b><span>${ns.join(" · ")}</span></div>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#f3f7fa;color:#0f2a3d;font:16px -apple-system,Segoe UI,Roboto,sans-serif}
  h2{margin:0 0 6px;font-size:30px;text-align:center} p{margin:0 0 40px;text-align:center;color:#5b7083}
  .row{display:flex;align-items:center;gap:10px}
  .box{width:196px;min-height:150px;padding:20px 14px;background:#fff;border:2px solid #dde5ec;border-radius:14px;text-align:center;opacity:.35;animation:on .5s forwards}
  .box b{display:block;font-size:18px;margin:8px 0 6px;line-height:1.25} .box span{color:#5b7083;font-size:13px}
  .k{width:30px;height:30px;margin:0 auto;border-radius:50%;background:#0e7c86;color:#fff;display:grid;place-items:center;font-weight:700}
  .arr{font-size:28px;color:#0e7c86;opacity:.2;animation:on2 .5s forwards}
  @keyframes on{to{opacity:1;border-color:#0e7c86;box-shadow:0 8px 24px rgba(14,124,134,.18)}} @keyframes on2{to{opacity:1}}
  </style><div><h2>${wf.name.replace(/^VA P3 — /, "")}: the n8n workflow</h2><p>Rendered from workflow.json · ${wf.nodes.length} nodes in 5 steps</p><div class="row">${boxes}</div></div>`;
}
const card = (eyebrow, title, sub) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;height:100vh;display:grid;place-items:center;background:#0f2a3d;color:#fff;font:18px -apple-system,Segoe UI,Roboto,sans-serif;text-align:center}
  .e{letter-spacing:.18em;text-transform:uppercase;color:#7fd3da;font-size:15px;font-weight:600} h1{font-size:50px;margin:14px 0 12px;line-height:1.15} p{color:#b9c8d4;margin:0}
  </style><div><div class="e">${eyebrow}</div><h1>${title}</h1><p>${sub}</p></div>`;

// Visible cursor + ring (Playwright's mouse is invisible on video). Both pointer-events:none.
const cursorJs = () => {
  if (document.getElementById("__cur")) return;
  const mk = (id, css) => Object.assign(document.body.appendChild(Object.assign(document.createElement("div"), { id })).style, { position: "fixed", pointerEvents: "none", zIndex: 2147483646, ...css });
  mk("__cur", { width: "20px", height: "20px", borderRadius: "50%", background: "rgba(20,20,20,.9)", boxShadow: "0 0 0 5px rgba(255,255,255,.85),0 3px 10px rgba(0,0,0,.4)", left: "60%", top: "60%", transition: "left .6s cubic-bezier(.4,0,.2,1),top .6s cubic-bezier(.4,0,.2,1)" });
  mk("__ring", { border: "3px solid #EF621C", borderRadius: "14px", boxShadow: "0 0 0 6px rgba(239,98,28,.18)", opacity: 0, transition: "all .5s cubic-bezier(.4,0,.2,1)" });
};
async function point(page, loc, hold = 800, ring = false) {
  let b; // the dashboard re-renders on change, so a box can come back null mid-swap
  for (let i = 0; i < 10 && !(b = await loc.boundingBox()); i++) await wait(100);
  await page.evaluate(([b, ring]) => {
    Object.assign(document.getElementById("__cur").style, ring ? { left: b.x + b.width - 4 + "px", top: b.y + b.height - 4 + "px" } : { left: b.x + b.width / 2 - 10 + "px", top: b.y + b.height / 2 - 10 + "px" });
    Object.assign(document.getElementById("__ring").style, ring ? { left: b.x - 8 + "px", top: b.y - 8 + "px", width: b.width + 10 + "px", height: b.height + 10 + "px", opacity: 1 } : { opacity: 0 });
  }, [b, ring]);
  await wait(hold);
}

let browser, ctx;
const run = { marks: {}, arrivals: [] };
try {
  // Same safe reset order as check.sh: empty the mailbox, let in-flight bridge calls finish, then truncate.
  await fetch("http://localhost:8025/api/v1/messages", { method: "DELETE" });
  const bridge = execSync("lsof -tiTCP:8788 -sTCP:LISTEN | head -1").toString().trim();
  for (let i = 0; i < 75; i++) { try { execFileSync("pgrep", ["-P", bridge]); } catch { break; } await wait(2000); }
  psql("truncate p3_drafts, p3_invoices, p3_emails restart identity;");

  mkdirSync(OUT + "/raw", { recursive: true });
  browser = await chromium.launch({ headless: true });
  // Start the 8 s title so the samples land 1 s after a schedule tick: the webhook run (~50 s) then finishes before the next tick.
  const lead = ((SCHED + 1 - 9 - new Date().getUTCSeconds()) % 60 + 60) % 60;
  console.error(`aligning to the schedule: ${lead} s`); await wait(lead * 1000);
  ctx = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, recordVideo: { dir: OUT + "/raw", size: SIZE } });
  const page = await ctx.newPage();
  const t0 = Date.now();
  const mark = (k) => (run.marks[k] = +((Date.now() - t0) / 1000).toFixed(2));

  await page.setContent(card("Bayview Dental · a fictional clinic", "Every email sorted.<br>No invoice missed.", "AI inbox triage + invoice extractor · n8n + Claude + Postgres"));
  mark("title"); await wait(8000);

  mark("send"); execFileSync(process.execPath, [here + "../send-samples.mjs"]); run.sentAt = new Date().toISOString();
  await page.goto("http://localhost:8025/", { waitUntil: "domcontentloaded" });
  await page.locator("a.message").nth(7).waitFor(); await page.evaluate(cursorJs);
  mark("mailpit"); await wait(1200);
  run.unread = (await (await fetch("http://localhost:8025/api/v1/messages")).json()).unread;
  if (run.unread !== 8) throw new Error("expected 8 unread, got " + run.unread);
  await point(page, page.locator("button:visible", { hasText: "Inbox" }).first(), 2000, true);
  await point(page, page.locator("a.message", { hasText: "CleanPro" }), 2200, true);
  await point(page, page.locator("a.message", { hasText: "Liza Reyes" }), 1400, true);

  await page.goto(BASE + "/p3", { waitUntil: "domcontentloaded" });
  await page.locator("#emails .empty").waitFor(); await page.evaluate(cursorJs); mark("dash"); await wait(800);
  // Receipt for the wait: elapsed since the run started, frozen with ✓ when the webhook answers.
  await page.evaluate(() => {
    const t = performance.now(), el = document.body.appendChild(Object.assign(document.createElement("div"), { id: "__timer" }));
    Object.assign(el.style, { position: "fixed", top: "48px", right: "16px", padding: "7px 14px", borderRadius: "10px", background: "rgba(14,17,22,.9)", color: "#E6EDF3", font: "600 15px ui-monospace,Menlo,monospace", pointerEvents: "none", zIndex: 2147483647 });
    window.__tick = setInterval(() => { el.textContent = `live run · 1 Claude call per email · ${((performance.now() - t) / 1000).toFixed(1)} s`; }, 100);
  });
  const res = fetch("http://localhost:5678/webhook/inbox-run", { method: "POST", signal: AbortSignal.timeout(400_000) }).then((r) => r.json());
  mark("run");
  let done = false; res.then(() => (done = true), () => (done = true));
  for (let seen = 0, last = false; !last; await wait(250)) {
    last = done; // one more poll after the webhook answers, so the last email is marked too
    const n = Number(q("select count(*) from p3_emails"));
    while (seen < n) { seen++; mark("e" + seen); run.arrivals.push(run.marks["e" + seen]); }
  }
  run.summary = await res; mark("done");
  await page.evaluate(() => { clearInterval(window.__tick); document.getElementById("__timer").textContent += " ✓"; });
  await page.locator("#s-emails", { hasText: "8" }).waitFor({ timeout: 10_000 }); // the page polls every 3 s
  run.runSeconds = +(run.marks.done - run.marks.run).toFixed(1);
  mark("invoices"); await wait(600);
  await point(page, page.locator("#invoices tr.overdue"), 3400, true);
  await point(page, page.locator("#invoices tfoot"), 2600, true);
  await point(page, page.locator(".stat", { hasText: "Total due" }), 2000, true);
  run.dashboard = await page.locator("main").innerText();
  const draft = page.locator("#drafts .card", { hasText: "liza.reyes" });
  run.draft = await draft.innerText();
  mark("draft");
  await page.evaluate(() => document.getElementById("__ring").style.opacity = 0);
  await draft.evaluate((el) => el.scrollIntoView({ behavior: "smooth", block: "center" })); await wait(1200);
  await point(page, draft, 6000, true);

  // what the film claims must be what the run produced (a miss = failed take, exit 1, re-run)
  const total = Number(q("select sum(amount) from p3_invoices"));
  if (run.summary.processed !== 8 || total !== 28150) throw new Error(`off-script: ${JSON.stringify(run.summary)} total ${total}`);
  if (!/CleanPro/.test(await page.locator("#invoices tr.overdue").innerText())) throw new Error("CleanPro not shown overdue");
  if (!/8,?000/.test(run.draft)) throw new Error("whitening draft has no price: " + run.draft);

  await page.setContent(flowHtml()); mark("flow"); await wait(12000);
  await page.setContent(card("Built by", "McKeen Asma", "AI Automation VA · n8n + Claude")); mark("end"); await wait(6000);
  mark("stop");
} catch (e) { run.error = String(e); console.error(e); process.exitCode = 1; }
finally {
  const v = ctx && ctx.pages()[0]?.video();
  await ctx?.close(); await browser?.close(); // close is what writes the webm
  if (v) renameSync(await v.path(), OUT + "/raw.webm");
  writeFileSync(OUT + "/run.json", JSON.stringify(run, null, 2));
  console.log(JSON.stringify(run, null, 2));
}
