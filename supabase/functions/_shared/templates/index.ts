import type { SlideTemplate } from "../design-types.ts";
import type { PresentationStyle } from "../presentation-types.ts";
import { goodTemplates } from "./good.ts";
import { greatTemplates } from "./great.ts";
import { simpleTemplates } from "./simple.ts";
import { retiredSuperProfessionalTemplates, superProfessionalTemplates } from "./super-professional.ts";

export const slideTemplates: readonly SlideTemplate[] = [
  ...simpleTemplates,
  ...goodTemplates,
  ...greatTemplates,
  ...superProfessionalTemplates,
];

/**
 * Codes that are no longer offered but must still resolve.
 *
 * A deck generated while a design was live records its template code. Dropping
 * the blueprint outright would make those slides unrenderable on a re-export, so
 * withdrawn designs stay lookup-able and simply never appear in `slideTemplates`
 * — which is what the picker and the catalogue are built from.
 */
const retired: readonly SlideTemplate[] = [...retiredSuperProfessionalTemplates];

/**
 * Codes the catalogue must deactivate. The seed builder reads this to emit the
 * update that actually removes a withdrawn design from the picker — the upsert
 * alone would leave its old row active.
 */
export const retiredTemplateCodes: readonly string[] = retired.map((template) => template.code);

export const templateByCode = new Map(
  [...slideTemplates, ...retired].map((template) => [template.code, template]),
);

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
