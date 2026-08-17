/**
 * JElement 1.0 — reusable visual objects.
 *
 * JSLAYD decides where a picture goes on a slide; JElement decides what the
 * picture is. Two systems, one seam: a design declares a visual slot, an
 * element fills it.
 */
export * from "./spec.ts";
export * from "./document.ts";
export { compile, type CompileResult } from "./compile.ts";
export { ANALYZER_PROMPT, expansionPrompt } from "./standard.ts";
