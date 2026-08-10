import type { SlideTemplate } from "../design-types.ts";
import type { PresentationStyle } from "../presentation-types.ts";
import { goodTemplates } from "./good.ts";
import { greatTemplates } from "./great.ts";
import { simpleTemplates } from "./simple.ts";
import { superProfessionalTemplates } from "./super-professional.ts";

export const slideTemplates: readonly SlideTemplate[] = [
  ...simpleTemplates,
  ...goodTemplates,
  ...greatTemplates,
  ...superProfessionalTemplates,
];

export const templateByCode = new Map(slideTemplates.map((template) => [template.code, template]));

export function templatesForStyle(style: PresentationStyle): SlideTemplate[] {
  return slideTemplates.filter((template) => template.style === style).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function defaultTemplateFor(style: PresentationStyle): SlideTemplate {
  return templatesForStyle(style)[0]!;
}

/** Falls back to the style's first template when the code is unknown or missing. */
export function resolveTemplate(code: string | null | undefined, style: PresentationStyle): SlideTemplate {
  const found = code ? templateByCode.get(code) : undefined;
  return found && found.style === style ? found : defaultTemplateFor(style);
}
