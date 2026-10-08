// node send-samples.mjs [--clear]  -> sends samples.json to the Mailpit test mailbox over plain SMTP (localhost:1025).
// {{date+N}} / {{date-N}} in a body becomes today +/- N days (Asia/Manila), so due dates stay relative to send time.
import { connect } from "node:net";
import { readFileSync } from "node:fs";

const TO = "frontdesk@bayviewdental.example";
const day = (n) => new Date(Date.now() + n * 864e5).toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
const samples = JSON.parse(readFileSync(new URL("samples.json", import.meta.url), "utf8"));

function send({ from, subject, body }) {
  return new Promise((ok, no) => {
    const text = body.replace(/\{\{date([+-]\d+)\}\}/g, (_, n) => day(Number(n)));
    const addr = from.match(/<(.+)>/)?.[1] ?? from;
    const msg = [
      `From: ${from}`, `To: ${TO}`, `Subject: ${subject}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@send-samples.local>`,
      "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "Content-Transfer-Encoding: 8bit", "",
      ...text.split("\n").map((l) => (l.startsWith(".") ? "." + l : l)), // dot-stuffing
    ].join("\r\n");
    const steps = ["HELO send-samples.local", `MAIL FROM:<${addr}>`, `RCPT TO:<${TO}>`, "DATA", msg + "\r\n.", "QUIT"];
    const s = connect(1025, "localhost");
    let buf = "";
    s.on("data", (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (line[3] === "-") continue; // multi-line reply, wait for the last line
        if (!/^[23]/.test(line)) { s.destroy(); return no(new Error(`SMTP: ${line}`)); }
        const next = steps.shift();
        if (next) s.write(next + "\r\n"); else s.end();
      }
    });
    s.on("end", ok).on("error", no);
  });
}

if (process.argv.includes("--clear")) {
  const r = await fetch("http://localhost:8025/api/v1/messages", { method: "DELETE" });
  if (!r.ok) throw new Error(`clear failed: ${r.status}`);
}
for (const m of samples) await send(m);
console.log(`sent ${samples.length} emails to ${TO}`);
