/**
 * Asking again when the network dropped the question.
 *
 * A phone on LTE loses a connection mid-request routinely: the radio hands
 * over, the app comes back from the background, a packet is lost. iOS reports
 * it as "The network connection was lost", the request never reached the
 * server, and the person is shown a Swift stack trace and told to start again —
 * which for somebody scanning a QR code in a classroom means scanning it again
 * while everybody waits.
 *
 * These calls are safe to repeat: joining a game twice with the same token
 * lands on the same player row, and asking the server to plan a quiz twice
 * costs one reservation because the spend engine is keyed. So a request that
 * never arrived is simply asked again.
 *
 * What is deliberately not retried is a server that answered. A refusal, a
 * validation error, an empty balance — those are answers, and asking again
 * produces the same one more slowly.
 */

/** iOS, Android and the browser each say it differently. */
const TRANSPORT = [
  "network connection was lost",
  "network request failed",
  "failed to send a request",
  "the internet connection appears to be offline",
  "fetch failed",
  "load failed",
  "timeout",
  "timed out",
  "socket",
  "econnreset",
];

export function isTransport(error: unknown): boolean {
  const said = String((error as { message?: unknown })?.message ?? error ?? "").toLowerCase();
  if (!said) return false;
  return TRANSPORT.some((phrase) => said.includes(phrase));
}

/** What to say instead of the platform's own sentence. */
export const TRANSPORT_MESSAGE =
  "Internet aloqasi uzildi. Aloqa tiklanganda qayta urinib ko‘ring.";

export async function withNetworkRetry<T>(
  run: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delay = options.delayMs ?? 700;

  let last: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await run();
    } catch (failure) {
      last = failure;
      // A server that answered is an answer. Only a question that never
      // arrived is worth asking twice.
      if (!isTransport(failure) || attempt === attempts - 1) throw failure;
      // Backing off a little: a handover takes about a second, and three
      // requests inside one are three failures.
      await new Promise((resolve) => setTimeout(resolve, delay * (attempt + 1)));
    }
  }
  throw last;
}
