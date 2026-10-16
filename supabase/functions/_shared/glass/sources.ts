/**
 * A bibliography that does not send anybody to a page that is not there.
 *
 * Sources read out of the research notes come from the model's memory when it
 * did not search, and a remembered address is often almost right —
 * `uz.wikipedia.org/wiki/AmirTemur` for `Amir_Temur`. A student cannot hand in
 * a list like that. So every address is opened: one that answers stays as it
 * is, one that does not is cut back to its site, which is real even when the
 * page is not. Lines without an address are left alone.
 */

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const ADDRESS = /^(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/i;
/** Google's grounding links: a way to a page, never a source in themselves. */
const REDIRECTOR = /vertexaisearch\.cloud\.google\.com|grounding-api-redirect/i;
/** Where a redirect lands when Google stops a server: a check page, not a source. */
const DEAD_END = /(^|\/\/)(www\.)?google\.[a-z.]+\/(sorry|search)|consent\.google|accounts\.google/i;
/**
 * Not sources a student can cite: social networks, video and file-sharing
 * sites. A grounded search finds them; a bibliography leaves them out.
 */
const NOT_CITABLE = /^(?:[a-z0-9-]+\.)*(ok\.ru|vk\.com|facebook\.com|instagram\.com|tiktok\.com|t\.me|telegram\.(?:me|org)|twitter\.com|x\.com|pinterest\.[a-z.]+|youtube\.com|youtu\.be|scribd\.com|slideshare\.net|studfile\.net|docplayer\.[a-z.]+)(\/|$)/i;

/** Whether a bibliography line names a page somebody may cite. */
export function citable(line: string): boolean {
  const bare = line.trim().replace(/^https?:\/\/(www\.)?/i, "");
  return Boolean(bare) && !REDIRECTOR.test(bare) && !DEAD_END.test(`//${bare}`) && !NOT_CITABLE.test(bare);
}

/**
 * "unesco.org/en/digital-education", the way a bibliography line reads.
 *
 * Long addresses are cut at a "/" with "…": the site and the first steps of
 * the path say where to look, and a 140-character report link printed whole
 * is three lines of noise on a slide.
 */
export function address(url: string, max = 56): string {
  let host = "";
  let path = "";
  try {
    const parsed = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
    host = parsed.hostname.replace(/^www\./, "");
    path = decodeURI(parsed.pathname).replace(/\/$/, "");
  } catch {
    const bare = url.replace(/^https?:\/\/(www\.)?/i, "");
    host = bare.split("/")[0] ?? bare;
    path = bare.slice(host.length).replace(/\/$/, "");
  }
  if (host.length + path.length <= max) return `${host}${path}`;
  let kept = "";
  for (const segment of path.split("/").filter(Boolean)) {
    // An opaque id says nothing to a reader; the address stops before it.
    if (/\d{8,}|^[0-9a-f-]{16,}$/i.test(segment)) break;
    if (host.length + kept.length + segment.length + 3 > max) break;
    kept += `/${segment}`;
  }
  return `${host}${kept}/…`;
}

/**
 * The pages a grounded search cited, as addresses a reader can type.
 *
 * Gemini hands back each citation as a redirect through Google with the site's
 * name as its title. Following the redirect gives the page itself; when that
 * fails the site's name is still true, so it is what the line says.
 */
export async function resolveCitations(
  citations: readonly { title: string; url: string }[],
  fetchImpl: Fetch = fetch,
  timeoutMs = 5_000,
): Promise<{ title: string; url: string }[]> {
  return await Promise.all(citations.map(async (citation) => {
    if (!REDIRECTOR.test(citation.url)) return citation;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await Promise.race([
        fetchImpl(citation.url, { method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0 (compatible; link-check)" } }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
      ]);
      await response.body?.cancel().catch(() => undefined);
      if (!response.url || REDIRECTOR.test(response.url) || DEAD_END.test(response.url)) return citation;
      return { title: address(response.url), url: response.url };
    } catch {
      return citation;
    } finally {
      clearTimeout(timer);
    }
  }));
}

export async function checkSources(lines: readonly string[], fetchImpl: Fetch = fetch, timeoutMs = 5_000): Promise<string[]> {
  const checked = await Promise.all(lines.map(async (line) => {
    const match = line.trim().match(ADDRESS);
    if (!match) return line;
    const host = match[1]!.toLowerCase().replace(/^www\./, "");
    const path = match[2] ?? "";
    if (!path || path === "/") return host;
    const clock = new AbortController();
    const alarm = setTimeout(() => clock.abort(), timeoutMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Raced as well as aborted: a server that ignores the abort still costs
      // no more than the timeout.
      const response = await Promise.race([
        fetchImpl(`https://${match[1]}${path}`, {
          method: "GET",
          redirect: "follow",
          signal: clock.signal,
          headers: { "user-agent": "Mozilla/5.0 (compatible; link-check)" },
        }),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), timeoutMs); }),
      ]);
      // The body is not wanted, only whether the page exists.
      await response.body?.cancel().catch(() => undefined);
      if (!response.ok) return REDIRECTOR.test(host) ? "" : host;
      if (response.url && DEAD_END.test(response.url)) return REDIRECTOR.test(host) ? "" : host;
      // Where the link really leads — a search redirect becomes its page.
      return address(response.url || line);
    } catch {
      // A redirector that did not answer names no source at all.
      return REDIRECTOR.test(host) ? "" : host;
    } finally {
      clearTimeout(alarm);
      clearTimeout(timer);
    }
  }));
  const seen = new Set<string>();
  return checked.filter(citable).filter((line) => {
    const key = line.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
