import { chooseEntity, HUMAN, type EntityFacts } from "../entity-match.ts";
import type { PersonResult } from "../photo-order.ts";
import { plainText, type Orientation } from "../wikimedia-results.ts";
import type { PhotoHit } from "../unsplash-results.ts";

/**
 * The picture of a named person, established rather than guessed.
 *
 * Searching an image index by name cannot promise the right human. Commons
 * answers "Sherzodxon Qudratxo'ja" with a comedy premiere and two files titled
 * in Cyrillic; a stock library answers with a confident portrait of somebody
 * else entirely. Neither is checkable.
 *
 * Wikidata is. An item states what it is an instance of and which file is its
 * picture, so the identity is the entity's own statement and the picture is
 * whatever that statement points at — in whichever script the file happens to
 * be named. If no item matches the name, or the item is not a person, or it
 * records no picture, the honest answer is nothing.
 *
 * Public read only: no key, no token, no account. Nothing is uploaded and
 * nothing is edited.
 */

const WIKIDATA = "https://www.wikidata.org/w/api.php";
const COMMONS = "https://commons.wikimedia.org/w/api.php";
const AGENT = "Jaxongirman/1.0 presentation-generator (https://jaxongirman.uz)";
const TIMEOUT_MS = 10_000;
const RENDER_WIDTH = 1600;

/** A search that answers slowly must not become a deck that never finishes. */
async function ask(url: string): Promise<unknown | null> {
  const clock = new AbortController();
  const alarm = setTimeout(() => clock.abort(), TIMEOUT_MS);
  let timedOut = false;
  clock.signal.addEventListener("abort", () => { timedOut = true; }, { once: true });

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": AGENT, Accept: "application/json" },
      signal: clock.signal,
    });
    if (!response.ok) {
      console.warn(JSON.stringify({ event: "photo_provider", provider: "wikidata", status: `http_${response.status}` }));
      return null;
    }
    return await response.json();
  } catch (failure) {
    console.warn(JSON.stringify({
      event: "photo_provider", provider: "wikidata",
      status: timedOut ? "timeout" : "error",
      detail: timedOut ? `no answer within ${TIMEOUT_MS / 1000}s` : String(failure).slice(0, 120),
    }));
    return null;
  } finally {
    clearTimeout(alarm);
  }
}

type SearchHit = { id?: string };
type Entity = {
  id?: string;
  labels?: Record<string, { value?: string }>;
  aliases?: Record<string, Array<{ value?: string }>>;
  descriptions?: Record<string, { value?: string }>;
  claims?: Record<string, Array<{ mainsnak?: { datavalue?: { value?: unknown } } }>>;
};

const claimIds = (entity: Entity, property: string): string[] =>
  (entity.claims?.[property] ?? [])
    .map((claim) => (claim.mainsnak?.datavalue?.value as { id?: string } | undefined)?.id)
    .filter((id): id is string => typeof id === "string");

function factsOf(entity: Entity): EntityFacts {
  const labels = Object.values(entity.labels ?? {}).map((label) => String(label?.value ?? "")).filter(Boolean);
  const aliases = Object.values(entity.aliases ?? {})
    .flat()
    .map((alias) => String(alias?.value ?? ""))
    .filter(Boolean);
  const image = (entity.claims?.P18 ?? [])
    .map((claim) => claim.mainsnak?.datavalue?.value)
    .find((value): value is string => typeof value === "string") ?? null;

  return {
    id: String(entity.id ?? ""),
    labels,
    aliases,
    instanceOf: claimIds(entity, "P31"),
    image,
    description: Object.values(entity.descriptions ?? {})[0]?.value,
  };
}

/**
 * The photograph a named person's own entity records, or nothing.
 *
 * Returns null rather than a near-miss on purpose: for a person, no picture is
 * a slide the design already knows how to draw, and the wrong picture is
 * somebody else's face on a stranger's biography.
 */
export async function searchPerson(
  name: string,
  orientation: Orientation,
  skip = 0,
): Promise<PersonResult> {
  const wanted = name.trim();
  // `skip` is "another picture of the same subject". An entity records one
  // picture of itself, so there is no second one to step to — and stepping
  // into a search would be exactly the guess this exists to avoid.
  if (!wanted || skip > 0) return { kind: "unverified", reason: "no_second_portrait" };

  const search = new URLSearchParams({
    action: "wbsearchentities", format: "json", formatversion: "2",
    search: wanted, language: "uz", uselang: "uz", type: "item", limit: "5",
  });
  let found = await ask(`${WIKIDATA}?${search}`) as { search?: SearchHit[] } | null;
  let ids = (found?.search ?? []).map((hit) => hit.id).filter((id): id is string => Boolean(id));

  /**
   * Nothing under the whole phrase. Ask about its longest word.
   *
   * "Registan Samarkand" is not a label anywhere — the square is "Registon
   * majmuasi" — so the full string finds nothing, and treating that as an
   * unverifiable person would block a picture of a place for no reason. The
   * longest word usually names the thing: "Registan" resolves to a monument,
   * which settles that this is not somebody.
   *
   * A real person's surname resolves to a person, or to nothing at all, and
   * nothing at all keeps the fail-safe.
   */
  if (ids.length === 0) {
    const longest = wanted.split(/\s+/).filter(Boolean).sort((a, b) => b.length - a.length)[0];
    if (longest && longest !== wanted) {
      const wider = new URLSearchParams({
        action: "wbsearchentities", format: "json", formatversion: "2",
        search: longest, language: "uz", uselang: "uz", type: "item", limit: "5",
      });
      found = await ask(`${WIKIDATA}?${wider}`) as { search?: SearchHit[] } | null;
      ids = (found?.search ?? []).map((hit) => hit.id).filter((id): id is string => Boolean(id));
    }
  }

  if (ids.length === 0) {
    /**
     * Nobody by that name, anywhere.
     *
     * Treated as an unverified person rather than as "not a person": a name
     * the encyclopaedia has never heard of is exactly the case where a stock
     * library would confidently supply a stranger.
     */
    console.log(JSON.stringify({ event: "person_search", query: wanted, candidates: 0, accepted: false, reason: "no_entity" }));
    return { kind: "unverified", reason: "no_entity" };
  }

  const details = new URLSearchParams({
    action: "wbgetentities", format: "json", formatversion: "2",
    ids: ids.join("|"), props: "labels|aliases|descriptions|claims",
  });
  const payload = await ask(`${WIKIDATA}?${details}`) as { entities?: Record<string, Entity> } | null;
  const entities = Object.values(payload?.entities ?? {}).map(factsOf);

  const chosen = chooseEntity(entities, wanted);
  if (!chosen?.image) {
    /**
     * Nothing here is a person at all — a building, a film, a district named
     * after somebody. That is not a failed portrait, it is a subject the
     * ordinary providers handle well, so the caller is told to carry on.
     */
    const anyHuman = entities.some((entity) => entity.instanceOf.includes(HUMAN));
    if (!anyHuman) {
      console.log(JSON.stringify({ event: "person_search", query: wanted, candidates: entities.length, accepted: false, reason: "not_a_person" }));
      return { kind: "not_a_person" };
    }

    // Which wall it hit, so a missing portrait can be explained without
    // re-running the search by hand.
    const reason = entities.some((entity) => entity.image) ? "entity_name_mismatch" : "no_image";
    console.log(JSON.stringify({ event: "person_search", query: wanted, candidates: entities.length, accepted: false, reason }));
    return { kind: "unverified", reason };
  }

  /**
   * The file, at a size worth putting on a slide.
   *
   * Asked for by title rather than searched for: this is the exact file the
   * entity points at, and searching for it again would reintroduce the guess.
   */
  const file = new URLSearchParams({
    action: "query", format: "json", formatversion: "2",
    titles: `File:${chosen.image}`,
    prop: "imageinfo", iiprop: "url|size|mime|extmetadata", iiurlwidth: String(RENDER_WIDTH),
  });
  const info = await ask(`${COMMONS}?${file}`) as {
    query?: { pages?: Array<{ imageinfo?: Array<Record<string, unknown>> }> };
  } | null;

  const image = info?.query?.pages?.[0]?.imageinfo?.[0];
  if (!image) {
    console.log(JSON.stringify({ event: "person_search", query: wanted, accepted: false, reason: "no_image_url" }));
    return { kind: "unverified", reason: "no_image_url" };
  }

  const mime = String(image.mime ?? "").toLowerCase();
  const vector = mime === "image/svg+xml";
  const url = String((vector ? image.thumburl : image.thumburl ?? image.url) ?? "");
  if (!url) {
    console.log(JSON.stringify({ event: "person_search", query: wanted, accepted: false, reason: "unsupported_asset" }));
    return { kind: "unverified", reason: "unsupported_asset" };
  }

  const meta = (image.extmetadata ?? {}) as Record<string, { value?: unknown }>;
  const width = Number(image.thumbwidth ?? image.width ?? 0);
  const height = Number(image.thumbheight ?? image.height ?? 0);

  console.log(JSON.stringify({
    event: "person_search",
    query: wanted,
    entity: chosen.id,
    accepted: true,
    orientation,
    photo_width: width,
    photo_height: height,
  }));

  return {
    kind: "photo",
    hit: {
    url,
    width,
    height,
    mimeType: vector ? "image/png" : mime,
    originalUrl: String(image.url ?? url),
    attribution: {
      title: plainText(meta.ObjectName?.value) || chosen.labels[0] || wanted,
      creator: plainText(meta.Artist?.value) || plainText(meta.Credit?.value) || "Wikimedia Commons",
      license: plainText(meta.LicenseShortName?.value) || plainText(meta.UsageTerms?.value) || "unknown",
      licenseUrl: plainText(meta.LicenseUrl?.value),
      sourceUrl: String(image.descriptionurl ?? `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(chosen.image)}`),
      provider: "wikidata",
    },
    },
  };
}
