// node bridge.mjs -> :8788. POST /reply {prompt} -> `claude -p` (local Claude Code CLI). GET / or /p3 front-desk dashboard, GET /p3/state rows.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
const dir = new URL(".", import.meta.url).pathname;
const run = (cmd, args, input) => new Promise((ok, no) => {
  const p = execFile(cmd, args, { maxBuffer: 1e7, timeout: 120e3 }, (e, out) => (e ? no(e) : ok(out)));
  if (input) p.stdin.end(input);
});
createServer(async (req, res) => {
  const send = (code, type, body) => { res.writeHead(code, { "content-type": type }); res.end(body); };
  try {
    if (req.method === "POST" && req.url === "/reply") {
      let b = ""; for await (const c of req) b += c;
      const { prompt } = JSON.parse(b);
      const text = (await run("claude", ["-p", "--model", "opus"], prompt)).trim();
      return send(200, "application/json", JSON.stringify({ text }));
    }
    if (req.url === "/p3/state") {
      const json = await run("docker", ["exec", "va-pg", "psql", "-U", "va", "-d", "va", "-t", "-A", "-c", `select json_build_object(
        'emails', (select coalesce(json_agg(e order by received_at desc), '[]') from p3_emails e),
        'invoices', (select coalesce(json_agg(i order by due_date), '[]') from p3_invoices i),
        'drafts', (select coalesce(json_agg(d order by id), '[]') from p3_drafts d))`]);
      return send(200, "application/json", json.trim());
    }
    if (req.url === "/" || req.url === "/p3") return send(200, "text/html", readFileSync(dir + "dashboard.html"));
    send(404, "text/plain", "not found");
  } catch (e) { send(500, "text/plain", String(e)); }
}).listen(8788, () => console.log("bridge :8788"));
