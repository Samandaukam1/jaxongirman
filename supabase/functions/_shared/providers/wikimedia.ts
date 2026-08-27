import { bestWikimedia, type Orientation, type WikimediaPage } from "../wikimedia-results.ts";
import type { PhotoHit } from "../unsplash-results.ts";

/**
 * Wikimedia Commons, for the pictures a stock library does not have.
 *
 * Unsplash has beautiful photographs of nobody in particular. Commons has Amir
 * Temur, the Registan, the Apollo 11 launch and a labelled diagram of the
 * heart — the subjects a real deck is actually about. It needs no key and no
 * account: the MediaWiki API is open, which is why there is no secret here to
 * configure and none to leak.
 *
 * Everything it returns is openly licensed, and every result carries the
 * photographer and a link to the file page. A result missing either is refused
 * rather than used with an empty credit line, the same rule the other two
 * providers apply.
 *
 * Nothing in this path is reachable from a browser: the app asks the server,
 * the server asks Commons.
 */

const ENDPOINT = "https://commons.wikimedia.org/w/api.php";

/**
 * Wikimedia asks to be told who is calling and how to get in touch.
 *
 * Their etiquette expects a real contact, and inventing one would be worse than
 * omitting it. The project's own address is used, which is a place a Wikimedia
 * administrator could actually reach somebody.
 */
const AGENT = "Jaxongirman/1.0 presentation-generator (https://jaxongirman.uz)";

/**
 * How long to wait before giving up and letting the next provider answer.
 *
 * An external index that stops responding must not become a deck that never
 * finishes. Ten seconds is far more than a search normally takes and far less
 * than a stage can afford.
 */
const TIMEOUT_MS = 10_000;

/**
 * How wide a rendered variant to ask for.
 *
 * A Commons original is routinely eight thousand pixels across — twenty
 * megabytes for a slide 1920 wide. 1600 is sharp on a 16:9 page and small
 * enough to download, store and embed without thinking about it.
 */
const RENDER_WIDTH = 1600;

/** How many candidates to score. Enough to rank, few enough to stay quick. */
const CANDIDATES = 10;

export async function searchWikimedia(
  query: string,
  orientation: Orientation,
  skip = 0,
): Promise<PhotoHit | null> {
  const wanted = query.trim();
  if (!wanted) return null;

  const parameters = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    generator: "search",
    gsrsearch: wanted,
    // Namespace 6 is `File:`. Without it the search returns articles, which
    // have no picture in them at all.
    gsrnamespace: "6",
    gsrlimit: String(CANDIDATES),
    prop: "imageinfo",
    iiprop: "url|size|mime|extmetadata",
    iiurlwidth: String(RENDER_WIDTH),
  });

  const clock = new AbortController();
  const alarm = setTimeout(() => clock.abort(), TIMEOUT_MS);
  let timedOut = false;
  clock.signal.addEventListener("abort", () => { timedOut = true; }, { once: true });

  try {
    const response = await fetch(`${ENDPOINT}?${parameters}`, {
      headers: { "User-Agent": AGENT, Accept: "application/json" },
      signal: clock.signal,
    });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: "photo_provider", provider: "wikimedia", status: `http_${response.status}` }));
      return null;
    }

    const payload = await response.json() as { query?: { pages?: WikimediaPage[] | Record<string, WikimediaPage> } };
    const pages = payload.query?.pages;
    // `formatversion: 2` answers with an array; older wikis answer with an
    // object keyed by page id. Both are read rather than assumed.
    const list: WikimediaPage[] = Array.isArray(pages) ? pages : Object.values(pages ?? {});

    return bestWikimedia(list, wanted, orientation, skip);
  } catch (failure) {
    console.warn(JSON.stringify({
      event: "photo_provider",
      provider: "wikimedia",
      status: timedOut ? "timeout" : "error",
      detail: timedOut ? `no answer within ${TIMEOUT_MS / 1000}s` : String(failure).slice(0, 120),
    }));
    return null;
  } finally {
    clearTimeout(alarm);
  }
}
