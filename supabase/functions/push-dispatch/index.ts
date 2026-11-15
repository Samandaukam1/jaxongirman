/**
 * Sends what is waiting in the push outbox.
 *
 * Woken by the database — a trigger as rows are queued and a cron job every
 * minute, both through pg_net — never by a client: the request must carry the
 * shared secret both sides hold (`PUSH_DISPATCH_SECRET` here, the Vault secret
 * `push_dispatch_secret` there). It claims a batch, sends it through Expo's
 * push service a hundred messages at a time, reports what went, and repeats
 * until the outbox is empty or its time is up; whatever is left waits for the
 * next nudge.
 */
import { createClient } from "npm:@supabase/supabase-js";

import { json } from "../_shared/http.ts";
import { EXPO_PUSH_URL, chunks, messagesFor, readOutcome, sameSecret, type OutboxRow, type Ticket } from "../_shared/push.ts";

const BUDGET_MS = 20_000;

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed", code: "method_not_allowed" }, 405);
  const secret = Deno.env.get("PUSH_DISPATCH_SECRET") ?? "";
  if (!sameSecret(request.headers.get("x-push-secret") ?? "", secret)) {
    return json({ error: "Forbidden", code: "forbidden" }, 403);
  }

  const service = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Optional: with "enhanced push security" on in Expo, sends need the project's access token.
  const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";
  const started = Date.now();
  let total = 0;

  while (Date.now() - started < BUDGET_MS) {
    const claimed = await service.rpc("push_outbox_claim", { p_limit: 200 });
    if (claimed.error) return json({ error: claimed.error.message, code: "claim_failed" }, 500);
    const rows = (claimed.data ?? []) as OutboxRow[];
    if (rows.length === 0) break;

    const messages = messagesFor(rows);
    const tickets: (Ticket | undefined)[] = [];
    for (const batch of chunks(messages)) {
      try {
        const response = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(batch.map((entry) => entry.message)),
        });
        const answer = await response.json().catch(() => null) as { data?: Ticket[] } | null;
        const data = Array.isArray(answer?.data) ? answer!.data : [];
        batch.forEach((_, at) => tickets.push(data[at] ?? { status: "error", message: `HTTP ${response.status}` }));
      } catch (failure) {
        batch.forEach(() => tickets.push({ status: "error", message: String((failure as Error)?.message ?? failure).slice(0, 200) }));
      }
    }

    const outcome = readOutcome(rows, messages, tickets);
    const finished = await service.rpc("push_outbox_finish", {
      p_sent: outcome.sent, p_failed: outcome.failed, p_dead_tokens: outcome.dead,
    });
    if (finished.error) return json({ error: finished.error.message, code: "finish_failed" }, 500);
    total += rows.length;
    console.log(JSON.stringify({ event: "push_batch", rows: rows.length, messages: messages.length, sent: outcome.sent.length, failed: Object.keys(outcome.failed).length, dead: outcome.dead.length }));
  }

  return json({ ok: true, processed: total });
});
