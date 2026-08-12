import type { PaletteFamily, SlideTemplate } from "./design-types.ts";
import type { ElementRow, GeneratedImage, SemanticSlide, SlideRow } from "./presentation-types.ts";
import { MODEL_HEIGHT, MODEL_WIDTH, renderSlide } from "./template-engine.ts";

type BuildInput = {
  presentationId: string;
  ownerId: string;
  template: SlideTemplate;
  palette: PaletteFamily;
  slides: SemanticSlide[];
  sources: string[];
  generatedImages: GeneratedImage[];
  uploadedImages: string[];
};

/**
 * Last line of defence after the template engine. Content-bearing elements are
 * clamped into the canvas; decorative shapes and icons are left alone because
 * bleeding past the edge is a deliberate motif in several templates.
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

export function buildSlides(input: BuildInput): { slides: SlideRow[]; elements: ElementRow[] } {
  const slideRows: SlideRow[] = [];
  const elementRows: ElementRow[] = [];
  const generated = new Map(input.generatedImages.map((item) => [item.slideIndex, item]));
  let uploadedIndex = 0;

  input.slides.forEach((semantic, index) => {
    const slideId = crypto.randomUUID();
    const generatedImage = generated.get(index);
    const uploadedPath = !generatedImage && input.uploadedImages.length
      ? input.uploadedImages[uploadedIndex++ % input.uploadedImages.length]
      : null;
    const image = generatedImage
      ? { bucket: generatedImage.bucket, path: generatedImage.path }
      : uploadedPath
        ? { bucket: "user-uploads", path: uploadedPath }
        : null;

    const rendered = renderSlide(input.template, input.palette, {
      presentationId: input.presentationId,
      ownerId: input.ownerId,
      slideId,
      index,
      total: input.slides.length,
      semantic,
      image,
      sources: input.sources,
    });

    const checked = validateAndRepair(rendered.elements);
    slideRows.push({
      id: slideId,
      presentation_id: input.presentationId,
      owner_id: input.ownerId,
      position: index,
      title: semantic.title,
      layout: semantic.layout,
      background: { color: rendered.background },
      quality_score: checked.score,
      quality_report: { ...checked.report, template: input.template.code, palette: input.palette.code },
    });
    elementRows.push(...checked.rows);
  });

  return { slides: slideRows, elements: elementRows };
}
