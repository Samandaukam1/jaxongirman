/**
 * Making a deck with the generative engine, end to end.
 *
 * Every outside thing this needs is passed in — the model, the font library,
 * the image service — so the whole sequence can be run against fakes that fail
 * in chosen ways. That is not test convenience: this orchestrator is where a
 * bad model answer, a missing font library and an image that cannot be found
 * all have to become something other than a broken deck, and each of those is
 * hard to arrange on purpose against the real services.
 *
 * The order is the brief's: understand the deck, fix its visual language, then
 * for each slide understand the meaning before building a composition for it,
 * and accept nothing the arithmetic has not agreed to.
 */

import { buildDNA, type DesignDNA, type DesignDirection, type LibraryFamily, MOODS, GROUNDS } from "./scene-dna.ts";
import { runSceneCycle, validateScene, type CycleResult } from "./scene-cycle.ts";
import { renderScene, imageIntents, type RenderedSlide, type ResolvedPicture } from "./scene-render.ts";
import { findRepetition, mirrorScene, sceneFromBrief, withRescuedContent } from "./scene-quality.ts";
import {
  briefPrompt, briefSchema, directionPrompt, directionSchema, repairPrompt, scenePrompt, sceneSchema,
  type SemanticBrief,
} from "./scene-writer.ts";
import * as readerFor from "./scene-spec.ts";
import type { Scene } from "./scene-spec.ts";

export type Ask = (input: {
  prompt: string;
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens?: number;
}) => Promise<unknown>;

export type Deps = {
  ask: Ask;
  /** The families the operator has enabled. An empty library stops the deck. */
  fonts: () => Promise<LibraryFamily[]>;
  /** The existing image service. This engine only says what a picture is of. */
  findImage: (intent: { query: string; orientation: string }) => Promise<ResolvedPicture | null>;
  /** Progress, so a long stage can say where it is. */
  beat?: (note: string) => void;
};

export type DeckInput = {
  topic: string;
  language?: string;
  slides: Array<{ title: string; research?: string | null }>;
  /** Below this a slide is repaired; a slide that never reaches it is reported. */
  threshold?: number;
  maxAttempts?: number;
};

export type GeneratedSlide = {
  index: number;
  title: string;
  brief: SemanticBrief | null;
  scene: Scene | null;
  rendered: RenderedSlide | null;
  score: number;
  accepted: boolean;
  /** True when the engine built the page from the brief because the model did not. */
  synthesised: boolean;
  /** True when the engine flipped the composition to break a repetition. */
  mirrored: boolean;
  attempts: number;
  faults: string[];
};

export type GeneratedDeck = {
  engine: "generative_v1";
  dna: DesignDNA;
  slides: GeneratedSlide[];
  /** Everything §38 asks to be kept, computed rather than described. */
  observability: {
    fontSelection: Record<string, string>;
    palette: Record<string, string>;
    scores: number[];
    repairCount: number;
    unacceptedSlides: number[];
    synthesisedSlides: number[];
    mirroredSlides: number[];
    repeatedCompositions: number[];
    askCount: number;
  };
};

export class GenerativeFailure extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "GenerativeFailure";
  }
}

const clamp01 = (value: unknown, fallback: number): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;

function readDirection(value: unknown): DesignDirection {
  const raw = (value ?? {}) as Record<string, unknown>;
  const mood = MOODS.includes(raw.mood as never) ? raw.mood as DesignDirection["mood"] : "editorial";
  const ground = GROUNDS.includes(raw.ground as never) ? raw.ground as DesignDirection["ground"] : "near_black";
  const brand = typeof raw.brand === "string" && /^#[0-9a-f]{6}$/i.test(raw.brand.trim())
    ? raw.brand.trim()
    // A model that answers with a colour name or a malformed hex gets the
    // house blue rather than an exception: the palette is derived either way,
    // and a deck is not worth failing over one field.
    : "#5A78F0";
  const corner = raw.cornerLanguage === "sharp" || raw.cornerLanguage === "pill" ? raw.cornerLanguage : "soft";
  return { mood, ground, brand, cornerLanguage: corner, gradients: raw.gradients !== false };
}

function readBrief(value: unknown, title: string): SemanticBrief {
  const raw = (value ?? {}) as Record<string, unknown>;
  const needs = (raw.needs ?? {}) as Record<string, unknown>;
  return {
    slideGoal: typeof raw.slideGoal === "string" && raw.slideGoal.trim() ? raw.slideGoal : title,
    mainMessage: typeof raw.mainMessage === "string" && raw.mainMessage.trim() ? raw.mainMessage : title,
    supportingMessage: typeof raw.supportingMessage === "string" && raw.supportingMessage.trim() ? raw.supportingMessage : null,
    informationDensity: clamp01(raw.informationDensity, 0.6),
    visualPriority: clamp01(raw.visualPriority, 0.4),
    needs: {
      image: needs.image === true,
      chart: needs.chart === true,
      statistic: needs.statistic === true,
      quote: needs.quote === true,
      comparison: needs.comparison === true,
      timeline: needs.timeline === true,
      example: needs.example === true,
    },
  };
}

export async function generateDeck(deps: Deps, input: DeckInput): Promise<GeneratedDeck> {
  const language = input.language ?? "uz";
  let askCount = 0;
  const ask: Ask = async (call) => {
    askCount += 1;
    return await deps.ask(call);
  };

  /**
   * The library first, because there is no deck without it.
   *
   * A model naming a font we do not have produces a deck set in a fallback
   * nobody chose. Rather than let that happen quietly, an empty library stops
   * the run with a message an operator can act on.
   */
  const library = await deps.fonts();
  if (library.length === 0) {
    throw new GenerativeFailure("Font kutubxonasi bo'sh — generativ dizayn ishlay olmaydi.", "no_font_library");
  }

  deps.beat?.("vizual til tanlanmoqda");
  const direction = readDirection(await ask({
    prompt: directionPrompt(input.topic, language),
    schema: directionSchema(),
    schemaName: "design_direction",
    maxOutputTokens: 400,
  }));

  const dna = buildDNA(direction, library);
  if (!dna) throw new GenerativeFailure("Dizayn tili qurilmadi.", "no_design_dna");

  const slides: GeneratedSlide[] = [];
  const signatures: string[] = [];
  let repairCount = 0;

  for (const [index, planned] of input.slides.entries()) {
    deps.beat?.(`${index + 1}/${input.slides.length}-slayd`);

    let brief: SemanticBrief | null = null;
    try {
      brief = readBrief(await ask({
        prompt: briefPrompt({
          topic: input.topic,
          title: planned.title,
          position: index,
          total: input.slides.length,
          research: planned.research ?? null,
        }),
        schema: briefSchema(),
        schemaName: "slide_brief",
        maxOutputTokens: 700,
      }), planned.title);
    } catch {
      // A slide whose meaning could not be settled still gets a composition,
      // from what the outline already knew about it.
      brief = readBrief(null, planned.title);
    }

    /**
     * A page that came back silent gets its own sentence back.
     *
     * Applied inside the cycle rather than after it, so the rescued page is
     * measured like any other — the paragraph has to fit the band it was put
     * in, and if it does not, the repair pass sees that too.
     */
    const rescue = (raw: unknown): unknown => {
      const scene = raw as { elements?: unknown } | null;
      if (!scene || typeof scene !== "object") return raw;
      const { readScene } = readerFor;
      const read = readScene(raw);
      if (!read.scene) return raw;
      return withRescuedContent(read.scene, brief?.mainMessage ?? "");
    };

    const cycle: { -readonly [K in keyof CycleResult]: CycleResult[K] } = await runSceneCycle(async (previous) => {
      const prompt = previous
        ? repairPrompt(previous.scene, previous.report)
        : scenePrompt({ brief: brief!, topic: input.topic, fonts: dna.fonts, mood: direction.mood, used: signatures, language });
      if (previous) repairCount += 1;
      return rescue(await ask({ prompt, schema: sceneSchema(), schemaName: "slide_scene", maxOutputTokens: 3_000 }));
    }, {
      threshold: input.threshold ?? 90,
      maxAttempts: input.maxAttempts ?? 3,
      language,
      previousSignature: signatures.at(-1) ?? null,
    });

    /**
     * A page the model could not produce is built from its own brief.
     *
     * Reported as synthesised rather than passed off as designed: the score
     * and the fault list travel with it, so a deck full of these is visible
     * rather than merely quiet.
     */
    let synthesised = false;
    let mirrored = false;
    let scene = cycle.scene;
    let score = cycle.report?.score ?? 0;
    const threshold = input.threshold ?? 90;

    /**
     * A repeat the model would not fix, fixed by arithmetic.
     *
     * Two repairs and it still came back arranged like the slide before it.
     * Mirroring keeps every element's size, treatment and words and puts the
     * page the other way round — and it is only kept if it scores at least as
     * well, so this can make a deck more varied and never worse.
     */
    if (scene && cycle.report?.faults.some((fault) => fault.code === "repeats")) {
      const flipped = validateScene(mirrorScene(scene), language, signatures.at(-1) ?? null);
      if (flipped.scene && flipped.report && flipped.report.score > score) {
        scene = flipped.scene;
        score = flipped.report.score;
        mirrored = true;
        cycle.report = flipped.report;
      }
    }
    /**
     * A page that never reached the line is replaced, not shipped.
     *
     * The cycle returns its best attempt so the caller can decide; this is the
     * decision. A deck went out with a page scoring 40 — two elements on top of
     * each other — because "best attempt" and "good enough" are different
     * questions and only one of them had been asked. The page built from the
     * brief is plain, and plain beats broken.
     */
    if (!scene || score < threshold) {
      const fallback = sceneFromBrief({
        title: planned.title,
        message: brief?.mainMessage ?? "",
        supporting: brief?.supportingMessage ?? null,
      });
      const checked = validateScene(fallback, language, signatures.at(-1) ?? null);
      if (checked.scene && checked.report && checked.report.score > score) {
        scene = checked.scene;
        score = checked.report.score;
        synthesised = true;
        // The faults of a page that was thrown away describe a page nobody
        // will see. What shipped is what the record should list; the attempt's
        // own faults stay in the history.
        cycle.report = checked.report;
      }
    }

    let rendered: RenderedSlide | null = null;
    if (scene) {
      if (cycle.report) signatures.push(cycle.report.signature);

      /**
       * Pictures last, and only for the composition that was accepted.
       *
       * Asking the image service during the repair loop would pay for pictures
       * belonging to compositions that were then thrown away — and the image
       * service is the expensive half of this pipeline.
       */
      const found = new Map<string, ResolvedPicture>();
      for (const intent of imageIntents(scene)) {
        try {
          const picture = await deps.findImage(intent);
          if (picture) found.set(intent.query, picture);
        } catch {
          // A picture that cannot be found costs the slide its photograph and
          // nothing else; the renderer draws the frame empty.
        }
      }
      rendered = renderScene(scene, dna, found);
    }

    slides.push({
      index,
      title: planned.title,
      brief,
      scene,
      rendered,
      score,
      accepted: cycle.accepted || mirrored,
      synthesised,
      mirrored,
      attempts: cycle.attempts,
      faults: cycle.report?.faults.map((fault) => fault.code) ?? cycle.history.at(-1)?.faults ?? [],
    });
  }

  return {
    engine: "generative_v1",
    dna,
    slides,
    observability: {
      fontSelection: dna.fonts,
      palette: dna.colors,
      scores: slides.map((slide) => slide.score),
      repairCount,
      unacceptedSlides: slides.filter((slide) => !slide.accepted).map((slide) => slide.index),
      synthesisedSlides: slides.filter((slide) => slide.synthesised).map((slide) => slide.index),
      mirroredSlides: slides.filter((slide) => slide.mirrored).map((slide) => slide.index),
      repeatedCompositions: findRepetition(signatures),
      askCount,
    },
  };
}
