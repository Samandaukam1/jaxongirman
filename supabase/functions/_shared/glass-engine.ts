/**
 * The Liquid Glass engine, wired to the things a real deck needs.
 *
 * `glass/` decides what a deck looks like and knows nothing about Supabase,
 * Gemini or the image service, which is what lets it be tested on any machine.
 * This is the seam: the model calls, the font library, the photograph search
 * and the rows the apps read.
 *
 * Cost is the design constraint here. A deck is two model calls for its words
 * (an outline that also carries the art direction, then the copy in batches),
 * on top of the research call the pipeline already makes — a few cents of
 * tokens for a ten-slide deck, against three calls per slide for the engine
 * this replaces. The look costs nothing: it is computed.
 */

import { SYSTEM_PROMPT, type DeckLanguage } from "./glass/language.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js";

import { hashOf, turn } from "./glass/color.ts";
import { composeDeck, pageFaults, type ComposedSlide, type Picture } from "./glass/compose.ts";
import {
  contentPrompt, contentSchema, outlinePrompt, outlineSchema, readOutline, readSlide, slideFromOutline, sourcesFromNotes,
  type DeckOutline, type SlideContent,
} from "./glass/content.ts";
import { buildDNA, candidateFaces, PALETTES, readArtDirection, type ArtDirection, type DeckStyle, type DesignDNA, type DesignRequest, type FontPick } from "./glass/dna.ts";
import { inBatches } from "./glass/batches.ts";
import { checkSources, citable } from "./glass/sources.ts";
import { cleanLine, clip } from "./glass/text.ts";
import type { Attachment } from "./writer.ts";

export type Usage = { input_tokens?: number; output_tokens?: number };

export type GlassWriter = {
  writingModel: string;
  structured<T>(input: {
    prompt: string;
    system?: string;
    schemaName: string;
    schema: Record<string, unknown>;
    maxOutputTokens?: number;
    attachments?: readonly Attachment[];
    attempts?: number;
  }): Promise<{ data: T; usage: Usage; provider: string; model: string; attempts: number; requestId: string | null }>;
};

export type Call = { operation: string; usage: Usage; provider: string; model: string; attempts: number; metadata?: Record<string, unknown> };

/** The writer's role; its last sentence says which language to answer in. */
const systemFor = (language: DeckLanguage = "uz") => SYSTEM_PROMPT[language];

/* --------------------------------------------------------------- words */

export async function writeOutline(input: {
  writer: GlassWriter;
  language?: DeckLanguage;
  topic: string;
  count: number;
  research: string;
  requirements: string;
  attachments: readonly Attachment[];
  calls: Call[];
}): Promise<DeckOutline> {
  const answer = await input.writer.structured<unknown>({
    prompt: outlinePrompt({ language: input.language, topic: input.topic, count: input.count, research: input.research, requirements: input.requirements, attachments: input.attachments.length > 0 }),
    system: systemFor(input.language),
    schemaName: "glass_outline",
    schema: outlineSchema(input.count),
    attachments: input.attachments,
    maxOutputTokens: 2_400 + input.count * 120,
  });
  input.calls.push({ operation: "presentation_outline", usage: answer.usage, provider: answer.provider, model: answer.model, attempts: answer.attempts });
  return readOutline(answer.data, { topic: input.topic, count: input.count });
}

/** Pages per copy call: small enough to answer quickly, large enough to stay cheap. */
const BATCH = 4;

/**
 * The copy for every page, in parallel batches of four.
 *
 * A failed batch is split and asked again down to a single page
 * (`inBatches`), so one bad answer costs one page rather than a batch. Only a
 * page that fails on its own is written from what the outline said about it,
 * and every failure is recorded with its reason in `ai_usage`, where it can be
 * read without the function's logs.
 *
 * One attempt per request: the split is the retry, and three levels of a
 * 45-second call (4 → 2 → 1) still finish inside the stage's 150 seconds.
 */
export async function writeSlides(input: {
  writer: GlassWriter;
  language?: DeckLanguage;
  topic: string;
  outline: DeckOutline;
  research: string;
  requirements: string;
  calls: Call[];
}): Promise<{ slides: SlideContent[]; fallbacks: number[] }> {
  const items = input.outline.slides.map((entry, index) => ({ index, entry }));
  const written = await inBatches({
    items,
    size: BATCH,
    ask: async (batch, attempts) => {
      const answer = await input.writer.structured<{ slides?: unknown[] }>({
        prompt: contentPrompt({ language: input.language, topic: input.topic, slides: batch, research: input.research, requirements: input.requirements }),
        system: systemFor(input.language),
        schemaName: "glass_slides",
        schema: contentSchema(),
        maxOutputTokens: 1_200 * batch.length + 800,
        attempts,
      });
      input.calls.push({ operation: "presentation_slide_write", usage: answer.usage, provider: answer.provider, model: answer.model, attempts: answer.attempts, metadata: { slides: batch.map((one) => one.index) } });
      const pages = Array.isArray(answer.data?.slides) ? answer.data.slides : [];
      const found = new Map<number, SlideContent>();
      batch.forEach((one, position) => {
        // Matched by the index the model echoed, then by position, so a
        // reordered answer still lands on the right pages.
        const match = pages.find((page) => (page as { index?: unknown })?.index === one.index) ?? pages[position];
        if (match) found.set(one.index, readSlide(match, one.entry));
      });
      return found;
    },
    failed: (batch, attempts, reason) => {
      console.error(JSON.stringify({ event: "glass_batch_failed", slides: batch.map((one) => one.index), detail: reason }));
      input.calls.push({
        operation: "presentation_slide_write",
        usage: {},
        provider: "google",
        model: input.writer.writingModel,
        attempts,
        metadata: { slides: batch.map((one) => one.index), failed: true, reason },
      });
    },
  });

  const fallbacks: number[] = [];
  return {
    slides: items.map(({ index, entry }) => {
      const slide = written.get(index);
      if (slide) return slide;
      fallbacks.push(index);
      return slideFromOutline(entry);
    }),
    fallbacks,
  };
}

/* --------------------------------------------------------------- faces */

type FaceRow = { canonical_name: string; normalized_name: string; font_faces: { weight: number; italic: boolean; storage_path: string }[] | null };

/**
 * What the library holds of the faces the engine knows, and how to name them.
 *
 * Every text row carries four names for its face, one per reader: the id the
 * phone registers a downloaded file under (`jx_<slug>_<weight>`), the bundled
 * face to draw with until it lands, the object key the PDF exporter embeds,
 * and the family name PowerPoint asks the opener's machine for.
 */
export async function libraryFaces(service: SupabaseClient): Promise<{
  available: (family: string, weight: number) => boolean;
  face: (pick: FontPick) => Record<string, unknown>;
}> {
  const families = [...candidateFaces().map((entry) => entry.family), "DM Serif Display"];
  const { data, error } = await service
    .from("font_families")
    .select("canonical_name, normalized_name, font_faces(weight, italic, storage_path)")
    .eq("is_active", true)
    .in("canonical_name", [...new Set(families)]);
  if (error) console.error(JSON.stringify({ event: "glass_fonts_unreadable", reason: error.message }));

  const faces = new Map<string, { slug: string; path: string; name: string; weight: number }>();
  for (const row of (data ?? []) as FaceRow[]) {
    for (const face of row.font_faces ?? []) {
      if (face.italic) continue;
      faces.set(`${row.canonical_name}|${face.weight}`, { slug: row.normalized_name, path: face.storage_path, name: row.canonical_name, weight: face.weight });
    }
  }

  return {
    available: (family, weight) => faces.has(`${family}|${weight}`),
    face: (pick) => {
      const fallback = pick.weight >= 600 ? "Manrope_700Bold" : "Manrope_400Regular";
      const found = faces.get(`${pick.family}|${pick.weight}`);
      if (!found) return { fontFamily: fallback, fontFallback: fallback, fontWeight: String(pick.weight) };
      return {
        fontFamily: `jx_${found.slug}_${found.weight}`,
        fontFallback: fallback,
        fontAsset: found.path,
        fontDisplayName: found.name,
        fontWeight: String(found.weight),
      };
    },
  };
}

/* ----------------------------------------------------------- the design */

/**
 * The deck's design, invented for it.
 *
 * Seeded by the presentation's id, so a retry draws the same deck. One
 * correction for the person rather than the topic: if their last deck was in
 * nearly the same colour and mood, this one turns round the wheel, so three
 * decks on three related subjects do not arrive looking like a set.
 */
export async function inventDesign(input: {
  service: SupabaseClient;
  ownerId: string;
  presentationId: string;
  topic: string;
  art: unknown;
  available: (family: string, weight: number) => boolean;
  /** The author's own choice from the create screen, when automatic was turned off. */
  request?: DesignRequest | null;
}): Promise<DesignDNA> {
  const direction: ArtDirection = readArtDirection(input.art, input.topic);
  // A colour family the author chose moves the topic's hue into it, with a
  // little of the deck's own so two decks in one family are not one palette.
  if (input.request?.palette) direction.hue = turn(PALETTES[input.request.palette], (hashOf(input.presentationId) % 17) - 8);
  const seed = hashOf(input.presentationId);
  const { data: recent } = await input.service
    .from("presentations")
    .select("design_dna")
    .eq("owner_id", input.ownerId)
    .neq("id", input.presentationId)
    .eq("design_engine", "glass_v1")
    .order("created_at", { ascending: false })
    .limit(2);
  /**
   * Which style: the author's choice when they made one, and otherwise the
   * next after the author's last deck, so whoever makes a few decks sees them
   * all. Decks made before the other styles existed were all glass. A first
   * deck is decided by its own seed.
   */
  const last = recent?.length ? ((recent[0]!.design_dna as { style?: string } | null)?.style ?? "glass") : null;
  // An author's choice wins; otherwise the next of the three after the last deck.
  const cycle: DeckStyle[] = ["glass", "editorial", "soft3d", "corporate", "naqsh", "spektr", "mozaika"];
  const style: DeckStyle = input.request?.style
    ?? (last && cycle.includes(last as DeckStyle) ? cycle[(cycle.indexOf(last as DeckStyle) + 1) % cycle.length]! : cycle[seed % cycle.length]!);
  for (const row of recent ?? []) {
    const previous = (row.design_dna as { direction?: { hue?: number; mood?: string } } | null)?.direction;
    if (typeof previous?.hue !== "number") continue;
    const distance = Math.min(Math.abs(previous.hue - direction.hue), 360 - Math.abs(previous.hue - direction.hue));
    if (distance < 28 && previous.mood === direction.mood && !input.request?.palette) {
      direction.hue = turn(direction.hue, 40 + (seed % 50));
      break;
    }
  }
  return buildDNA({ direction, seed, available: input.available, style });
}

/* ------------------------------------------------------------ pictures */

/**
 * Photographs for the cover and the photo pages, asked of the image service.
 *
 * In parallel and bounded: a search that hangs costs its page the photograph,
 * never the deck its completion. The service decides everything about which
 * picture answers a query — licence, provider ladder, attribution.
 */
export async function findPictures(input: {
  service: SupabaseClient;
  ownerId: string;
  presentationId: string;
  topic: string;
  wanted: { query: string; title?: string; orientation: "landscape" | "portrait" | "square" }[];
}): Promise<Map<string, Picture>> {
  const found = new Map<string, Picture>();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) return found;
  const unique = input.wanted.filter((one, index, list) => one.query && list.findIndex((other) => other.query === one.query) === index).slice(0, 6);
  await Promise.all(unique.map(async (intent) => {
    try {
      const answer = await Promise.race([
        input.service.functions.invoke("image-resolution-service", {
          headers: { Authorization: `Bearer ${key}` },
          body: { action: "resolve", ownerId: input.ownerId, presentationId: input.presentationId, query: intent.query, title: intent.title ?? null, topic: input.topic, orientation: intent.orientation },
        }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 30_000)),
      ]);
      const data = (answer as { data?: { status?: string; bucket?: string; path?: string } } | null)?.data;
      if (data?.status === "selected" && data.path) found.set(intent.query, { bucket: data.bucket ?? "stock-images", path: data.path });
    } catch (failure) {
      console.error(JSON.stringify({ event: "glass_picture_failed", query: intent.query, detail: String((failure as Error)?.message ?? failure).slice(0, 160) }));
    }
  }));
  return found;
}

/* ----------------------------------------------------------- the deck */

/** The bibliography the deck shows: what the author cited, then what was read. */
/** The research notes' own source list, every address in it opened first. */
export async function notesSources(notes: string): Promise<string[]> {
  const listed = sourcesFromNotes(notes);
  if (!listed.length) return [];
  return await Promise.race([
    checkSources(listed),
    // A slow site costs its line, never the deck: past this, sites only.
    new Promise<string[]>((resolve) => setTimeout(() => resolve(listed.map((line) => line.match(/^(?:https?:\/\/)?(?:www\.)?([^/\s]+\.[a-z]{2,})\//i)?.[1] ?? line)), 8_000)),
  ]);
}

export function deckSources(entered: readonly string[], citations: readonly { title: string; url: string }[], fromNotes: readonly string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (value: string) => {
    const line = clip(cleanLine(value, 300), 220);
    const key = line.toLowerCase();
    if (!line || seen.has(key)) return;
    seen.add(key);
    out.push(line);
  };
  entered.forEach(add);
  for (const citation of citations) {
    // A social network or a file-sharing page is not something to cite.
    if (!citable(citation.title) || (!/vertexaisearch|grounding-api-redirect/.test(citation.url) && !citable(citation.url))) continue;
    // Grounding links are redirects nobody can read on a slide; the title is
    // the page's own name and is what a bibliography line should say.
    const redirect = /vertexaisearch|grounding-api-redirect/.test(citation.url);
    let host = "";
    try { host = new URL(citation.url).hostname.replace(/^www\./, ""); } catch { host = ""; }
    add(redirect || !host || citation.title.includes(host) ? citation.title : `${citation.title} — ${host}`);
  }
  // Without links from the live web, the sources the research notes list —
  // already opened and checked by the caller (`notesSources`).
  if (out.length < 3) fromNotes.forEach(add);
  return out.slice(0, 12);
}

export function composeGlassDeck(input: {
  dna: DesignDNA;
  language?: DeckLanguage;
  face: (pick: FontPick) => Record<string, unknown>;
  topic: string;
  outline: DeckOutline;
  slides: SlideContent[];
  author: string | null;
  teacher: string | null;
  sources: string[];
  pictures: ReadonlyMap<string, Picture>;
}): ComposedSlide[] {
  return composeDeck({
    language: input.language ?? "uz",
    dna: input.dna,
    face: input.face,
    topic: cleanLine(input.topic, 180),
    shortTitle: input.outline.shortTitle,
    subtitle: input.outline.subtitle,
    author: input.author,
    teacher: input.teacher,
    year: new Date().getFullYear(),
    slides: input.slides,
    sources: input.sources,
    cover: input.pictures.get(input.outline.coverQuery) ?? null,
    pictures: input.pictures,
  });
}

/** The composed pages as the rows the `slides` and `slide_elements` tables hold. */
export function glassRows(pages: ComposedSlide[], input: { ownerId: string; presentationId: string; newId: () => string }) {
  const slideRows: Record<string, unknown>[] = [];
  const elementRows: Record<string, unknown>[] = [];
  let faults = 0;
  pages.forEach((page, position) => {
    const slideId = input.newId();
    const pageFaultList = pageFaults(page.rows);
    faults += pageFaultList.length;
    slideRows.push({
      id: slideId,
      presentation_id: input.presentationId,
      owner_id: input.ownerId,
      position,
      title: page.title.slice(0, 300),
      layout: page.layout,
      background: page.background,
      quality_score: pageFaultList.length ? Math.max(0, 100 - pageFaultList.length * 20) : 100,
      quality_report: page.report,
    });
    for (const row of page.rows) {
      elementRows.push({
        id: input.newId(),
        slide_id: slideId,
        presentation_id: input.presentationId,
        owner_id: input.ownerId,
        type: row.type,
        x: row.x,
        y: row.y,
        width: row.width,
        height: row.height,
        rotation: row.rotation,
        z_index: row.z_index,
        opacity: row.opacity,
        locked: row.locked,
        style: row.style,
        content: row.content,
      });
    }
  });
  return { slideRows, elementRows, faults };
}

/** What a picture query is, for the pages that want one. */
/**
 * What each photograph should show, and what it is for.
 *
 * The query alone is three English words; the resolver also reads the title of
 * the page it is for and the deck's topic — that is how "crown portrait" on a
 * deck about Amir Temur is understood as Amir Temur, and answered from
 * Wikidata, instead of as any painting of anybody with a crown.
 */
export function pictureWishes(outline: DeckOutline, slides: SlideContent[]): { query: string; title: string; orientation: "landscape" | "portrait" | "square" }[] {
  return [
    { query: outline.coverQuery, title: outline.shortTitle, orientation: "portrait" as const },
    ...slides.filter((slide) => slide.kind === "photo" && slide.imageQuery).map((slide) => ({ query: slide.imageQuery!, title: slide.title, orientation: "portrait" as const })),
  ];
}
