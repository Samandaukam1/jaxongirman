/**
 * Generate, measure, repair, measure again — and say what happened.
 *
 * The loop the brief asks for, with the model held at arm's length: it is
 * passed in, so the whole cycle can be tested against fakes that fail in
 * chosen ways rather than against a service that fails in unpredictable ones.
 *
 * Two rules it exists to enforce. A slide is never accepted because the model
 * says it is fine — acceptance is a number the arithmetic produced. And a slide
 * that never reaches the threshold is reported as such rather than shipped
 * quietly: the caller decides whether to keep the best attempt or fail the
 * deck, and either way the score travels with it.
 */

import { readScene, type Scene, type SceneProblem } from "./scene-spec.ts";
import { findCollisions, findOutOfBounds, measureText, placeScene, type PlacedElement } from "./scene-geometry.ts";
import { scoreScene, type QualityReport } from "./scene-quality.ts";

export type Validation = {
  scene: Scene | null;
  placed: PlacedElement[];
  report: QualityReport | null;
  /** Schema failures. A scene that does not read cannot be scored. */
  problems: SceneProblem[];
};

export function validateScene(raw: unknown, language = "uz"): Validation {
  const { scene, problems } = readScene(raw);
  if (!scene) return { scene: null, placed: [], report: null, problems };
  const placed = placeScene(scene);
  const report = scoreScene({
    scene,
    placed,
    fits: measureText(placed, language),
    collisions: findCollisions(placed),
    outOfBounds: findOutOfBounds(placed),
  });
  return { scene, placed, report, problems };
}

export type CycleResult = {
  scene: Scene | null;
  report: QualityReport | null;
  /** True only when the arithmetic agreed, never because a model said so. */
  accepted: boolean;
  attempts: number;
  /** Every attempt's score, so a deck can be audited after the fact. */
  history: Array<{ attempt: number; score: number; faults: string[] }>;
};

export type CycleOptions = {
  /** Below this a slide is repaired rather than kept. */
  threshold?: number;
  /** Including the first generation. */
  maxAttempts?: number;
  language?: string;
};

/**
 * Run one slide through the cycle.
 *
 * `generate` is called once with no argument, then once per repair with the
 * previous scene and what was wrong with it. Returning the best attempt rather
 * than the last matters: a repair can make a slide worse, and shipping the
 * worse one because it happened to be last is a bug that would be very hard to
 * see afterwards.
 */
export async function runSceneCycle(
  generate: (previous: { scene: Scene; report: QualityReport } | null) => Promise<unknown>,
  options: CycleOptions = {},
): Promise<CycleResult> {
  const threshold = options.threshold ?? 90;
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);

  let best: { scene: Scene; report: QualityReport } | null = null;
  const history: CycleResult["history"] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const raw = await generate(best);
    const validation = validateScene(raw, options.language);

    if (!validation.scene || !validation.report) {
      history.push({
        attempt,
        score: 0,
        faults: validation.problems.map((problem) => `${problem.path}: ${problem.message}`),
      });
      continue;
    }

    history.push({
      attempt,
      score: validation.report.score,
      faults: validation.report.faults.map((fault) => fault.code),
    });

    if (!best || validation.report.score > best.report.score) {
      best = { scene: validation.scene, report: validation.report };
    }
    if (validation.report.score >= threshold) break;
  }

  return {
    scene: best?.scene ?? null,
    report: best?.report ?? null,
    accepted: Boolean(best && best.report.score >= threshold),
    attempts: history.length,
    history,
  };
}
