/**
 * Push notifications through Expo's push service: what goes out, and what
 * the answer means.
 *
 * Expo takes up to a hundred messages a request and answers each with a
 * ticket in the same order — "ok", or an error. One push to a person with two
 * phones is two messages; the push counts as sent if any of its phones took
 * it. A phone Expo reports as `DeviceNotRegistered` has uninstalled the app or
 * revoked permission, and is forgotten rather than tried forever.
 *
 * Pure: the dispatcher does the network and the database.
 */

export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
export const EXPO_BATCH = 100;

export type OutboxRow = { id: number; title: string; body: string; data: Record<string, unknown>; channel: string; tokens: string[] };

export type ExpoMessage = {
  to: string;
  title: string;
  body: string;
  data: Record<string, unknown>;
  sound: "default";
  priority: "high";
  channelId: string;
  /** Groups a conversation's pushes on iOS. */
  threadId?: string;
};

export type Ticket = { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } };

/** One message per phone, each remembering which outbox row it came from. */
export function messagesFor(rows: readonly OutboxRow[]): { message: ExpoMessage; row: number }[] {
  const out: { message: ExpoMessage; row: number }[] = [];
  for (const row of rows) {
    for (const token of row.tokens) {
      const conversation = typeof row.data.conversation_id === "string" ? row.data.conversation_id : undefined;
      out.push({
        row: row.id,
        message: {
          to: token,
          title: row.title,
          body: row.body,
          data: row.data,
          sound: "default",
          priority: "high",
          channelId: row.channel === "chat" ? "chat" : "default",
          ...(conversation ? { threadId: conversation } : {}),
        },
      });
    }
  }
  return out;
}

export function chunks<T>(items: readonly T[], size = EXPO_BATCH): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

export type Outcome = { sent: number[]; failed: Record<string, string>; dead: string[] };

/**
 * What a batch's tickets say. A row is sent if any of its phones took it,
 * failed if none did (with the last reason), and rows with no phone at all —
 * the person signed out everywhere since it was queued — are simply done.
 */
export function readOutcome(rows: readonly OutboxRow[], sent: readonly { message: ExpoMessage; row: number }[], tickets: readonly (Ticket | undefined)[]): Outcome {
  const ok = new Set<number>();
  const reasons = new Map<number, string>();
  const dead = new Set<string>();
  sent.forEach((entry, at) => {
    const ticket = tickets[at];
    if (ticket?.status === "ok") { ok.add(entry.row); return; }
    const reason = ticket?.details?.error ?? ticket?.message ?? "no ticket";
    reasons.set(entry.row, reason);
    if (ticket?.details?.error === "DeviceNotRegistered") dead.add(entry.message.to);
  });
  const result: Outcome = { sent: [], failed: {}, dead: [...dead] };
  for (const row of rows) {
    if (row.tokens.length === 0 || ok.has(row.id)) result.sent.push(row.id);
    // A row whose only phones are gone is done too: there is nobody left to retry for.
    else if (row.tokens.every((token) => dead.has(token))) result.sent.push(row.id);
    else result.failed[String(row.id)] = reasons.get(row.id) ?? "unknown";
  }
  return result;
}

/** Constant-time comparison for the dispatcher's shared secret. */
export function sameSecret(given: string, expected: string): boolean {
  if (!expected || given.length !== expected.length) return false;
  let difference = 0;
  for (let at = 0; at < given.length; at += 1) difference |= given.charCodeAt(at) ^ expected.charCodeAt(at);
  return difference === 0;
}
