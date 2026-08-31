/**
 * What a candidate's link says, and what a stored one still means.
 *
 * Every decision here is one that only goes wrong on somebody else's phone: a
 * link built against the wrong host, a scanned URL that parses to the wrong
 * person, an invitation from last month that hijacks an unrelated sign-in. So
 * they live apart from the storage that holds them and import nothing native,
 * which is what lets `tests/marathon-link.test.mjs` run them.
 */

export type MarathonInvite = { campaignId: string; candidateId: string };

/** The production domain, and the right answer everywhere but a staging build. */
export const DEFAULT_HOST = "https://jaxongirman.uz";

export function linkHost(configured: string | undefined): string {
  const trimmed = (configured ?? "").trim().replace(/\/+$/, "");
  return trimmed || DEFAULT_HOST;
}

/**
 * Where a share sheet and a QR both point.
 *
 * An `https://` URL rather than `jaxongirman://` because a phone camera reads a
 * string and hands it to the browser — it has never heard of the app's private
 * scheme. A phone with the app installed still never renders the web page: the
 * Universal Link / App Link association gets there first.
 *
 * The campaign is in the path, not just the candidate. A link printed on a
 * poster outlives the marathon it was printed for, and one that carried only a
 * person would silently point at whatever campaign is running a year later.
 */
export function candidateLink(campaignId: string, candidateId: string, host: string): string {
  return `${host}/marathon/${campaignId}/${candidateId}`;
}

/** What is written above the link when it is shared. */
export function shareMessage(campaignTitle: string, username: string | null): string {
  const who = username ? `@${username}` : "men";
  return `${campaignTitle} — ${who} uchun ovoz bering.`;
}

/**
 * Reads an invitation out of a URL, in either form it can arrive in.
 *
 * `https://jaxongirman.uz/marathon/<campaign>/<candidate>` from a camera, and
 * `jaxongirman://marathon/<campaign>/<candidate>` from anything that already
 * knows the app. Anything else answers null rather than guessing.
 */
export function parseInviteUrl(url: string): MarathonInvite | null {
  const match = /marathon\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(url);
  return match ? { campaignId: match[1]!.toLowerCase(), candidateId: match[2]!.toLowerCase() } : null;
}

export const PENDING_KEY = "marathon.pending-invite";

/**
 * How long an unfinished invitation is worth honouring.
 *
 * Somebody who scans a code, installs the app and signs up is done inside an
 * hour. A day is generous for that and short enough that a link scanned last
 * month cannot reroute an unrelated sign-in — which is what an invitation with
 * no expiry eventually does.
 */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** What was stored, if it is still an invitation and still recent. */
export function readStoredInvite(raw: string | null, now = Date.now()): MarathonInvite | null {
  if (!raw) return null;
  let stored: unknown;
  try {
    stored = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof stored !== "object" || stored === null) return null;
  const { campaignId, candidateId, at } = stored as Record<string, unknown>;
  if (typeof campaignId !== "string" || typeof candidateId !== "string") return null;
  if (typeof at !== "number" || now - at > PENDING_TTL_MS || at > now + 60_000) return null;
  return { campaignId, candidateId };
}
