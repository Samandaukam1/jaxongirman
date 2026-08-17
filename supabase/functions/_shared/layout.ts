import { MODEL_HEIGHT, MODEL_WIDTH } from "./export-model.ts";
import type { ElementRow } from "./presentation-types.ts";

/**
 * Last line of defence after a design has placed its elements.
 *
 * Content-bearing elements are clamped into the canvas; decorative shapes and
 * icons are left alone, because bleeding past the edge is a deliberate motif
 * and not damage to repair.
 *
 * This is the only thing left of the built-in renderer. It knows nothing about
 * any particular design — it takes rows and returns rows — which is why it
 * outlived the blueprints it was written beside.
 */
export function validateAndRepair(
  rows: ElementRow[],
  options: { authoredGeometry?: boolean } = {},
): { rows: ElementRow[]; score: number; report: Record<string, unknown> } {
  const issues: string[] = [];
  const repaired = rows.map((row) => {
    if (row.type === "shape" || row.type === "icon") return row;
    // A JSLAYD design places every box itself, and its compiler already refuses
    // a chart or a table that leaves the canvas. Only text changes size with the
    // content, so only text can overflow at render time — clamping the rest
    // would drag a deliberately bleeding photograph into the middle of a slide
    // the designer composed around it.
    if (options.authoredGeometry && row.type !== "text") return row;
    const next = { ...row };
    if (next.x < 0 || next.y < 0 || next.x + next.width > MODEL_WIDTH || next.y + next.height > MODEL_HEIGHT) issues.push(`bounds:${next.id}`);
    next.width = Math.max(10, Math.min(next.width, MODEL_WIDTH - 40));
    next.height = Math.max(10, Math.min(next.height, MODEL_HEIGHT - 40));
    next.x = Math.max(20, Math.min(next.x, MODEL_WIDTH - 20 - next.width));
    next.y = Math.max(20, Math.min(next.y, MODEL_HEIGHT - 20 - next.height));
    if (next.type === "text") {
      const fontSize = Number(next.style.fontSize ?? 24);
      if (fontSize < 12) { issues.push(`font:${next.id}`); next.style = { ...next.style, fontSize: 12, lineHeight: 15 }; }
    }
    return next;
  });

  const texts = repaired.filter((row) => row.type === "text");
  for (let first = 0; first < texts.length; first += 1) {
    for (let second = first + 1; second < texts.length; second += 1) {
      const a = texts[first]!;
      const b = texts[second]!;
      const overlapX = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      if (overlapX * overlapY > Math.min(a.width * a.height, b.width * b.height) * 0.12) issues.push(`text-overlap:${a.id}:${b.id}`);
    }
  }

  return {
    rows: repaired,
    score: Math.max(70, 100 - issues.length * 8),
    report: { passed: issues.length === 0, issues, checked: ["bounds", "font_size", "text_overlap", "margins"] },
  };
}
