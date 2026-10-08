#!/usr/bin/env bash
# VA P3 check: fresh mailbox of 8 samples -> one inbox-run -> assert the sort, the invoices, the drafts, and idempotency.
set -e
cd "$(dirname "$0")"
q() { docker exec va-pg psql -U va -d va -t -A -c "$1"; }
run() { curl -sf -m 400 -X POST localhost:5678/webhook/inbox-run; }
docker exec -i -e PGOPTIONS=-cclient_min_messages=warning va-pg psql -U va -d va -q < schema.sql
# Empty the mailbox BEFORE truncating, so the every-minute schedule run can never re-insert old mail after the truncate.
curl -sf -X DELETE localhost:8025/api/v1/messages >/dev/null
# A schedule run already past "Get message" can still save one old email; wait for the bridge's in-flight Claude calls (max 150 s).
bridge=$(lsof -tiTCP:8788 -sTCP:LISTEN | head -1)
for _ in $(seq 75); do pgrep -P "$bridge" >/dev/null || break; sleep 2; done
q "truncate p3_drafts, p3_invoices, p3_emails restart identity" >/dev/null
node send-samples.mjs
r1=$(run); echo "run 1: $r1"
fail() { echo "FAIL: $1"; exit 1; }
[ "$(q "select count(*) from p3_emails")" = "8" ] && echo "p3 ok: 8 emails" || fail "expected 8 rows in p3_emails, got $(q "select count(*) from p3_emails")"
inv=$(q "select string_agg(amount::text, ',' order by amount) from p3_invoices")
[ "$inv" = "3500.00,6200.00,18450.00" ] && echo "p3 ok: invoices $inv" || fail "invoices: $inv"
d=$(q "select count(*) from p3_drafts")
[ "$d" -ge 2 ] && echo "p3 ok: $d drafts" || fail "drafts: $d"
[ "$(q "select category from p3_emails where from_addr like '%lucky-prize%'")" = "spam" ] && echo "p3 ok: spam" || fail "spam not caught"
[ "$(q "select urgency from p3_emails where from_addr like '%cleanpro%'")" = "high" ] && echo "p3 ok: overdue CleanPro is high" || fail "CleanPro urgency"
r2=$(run); echo "run 2: $r2"
echo "$r2" | grep -q '"processed":0' && echo "p3 ok: idempotent" || fail "second run reprocessed"
[ "$(q "select count(*) from p3_emails")" = "8" ] || fail "rows changed on second run"
