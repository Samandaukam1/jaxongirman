/**
 * JSLAYD 1.0 — JAXONGIRMAN's universal presentation design language.
 *
 * One package, one source of truth (§55, §103). The admin console, the user
 * app, the web viewer, the generator and both exporters all read the same
 * document model from here; none of them defines its own.
 *
 * The authoring half — parser, compiler, analyzer, standard — runs wherever an
 * admin edits a design. The reading half — `readDocument`, the document types,
 * the colour resolver — is what a renderer needs, and is deliberately free of
 * any dependency on the authoring half so a runtime never carries the compiler.
 */

export {
  JSLAYD_EXTENSION,
  JSLAYD_FORMAT,
  JSLAYD_HEADER,
  JSLAYD_KIND,
  JSLAYD_MIME,
  JSLAYD_VERSION,
  SUPPORTED_VERSIONS,
  CANVAS_HEIGHT,
  CANVAS_LABEL,
  CANVAS_WIDTH,
  RENDER_HEIGHT,
  RENDER_SCALE,
  RENDER_WIDTH,
  LIMITS,
  TIERS,
  TIER_LABELS,
  COLOR_ROLES,
  REQUIRED_COLOR_ROLES,
  FONT_ROLES,
  FONT_FORMATS,
  FONT_MIME_TYPES,
  ELEMENT_TYPES,
  SHAPE_KINDS,
  CHART_KINDS,
  CHART_FALLBACKS,
  ARCHETYPE_PURPOSES,
  LEGACY_LAYOUT_TO_PURPOSE,
  BINDINGS,
  CONDITIONS,
  IMAGE_SOURCE_STRATEGIES,
  MIN_READABLE_FONT_SIZE,
  SLUG_PATTERN,
  toSlug,
  isTier,
  isSupportedVersion,
  type Anchor,
  type ArchetypePurpose,
  type Binding,
  type ChartKind,
  type ColorRole,
  type Condition,
  type ElementType,
  type FontFormat,
  type FontRole,
  type ImageSourceStrategy,
  type ShapeKind,
  type TextEffect,
  type Tier,
} from "./spec.ts";

export type {
  Archetype,
  Border,
  ChartElement,
  ChartStyle,
  ColorFamily,
  ColorValue,
  Corners,
  DesignMeta,
  FontDeclaration,
  Geometry,
  Gradient,
  GradientStop,
  GroupElement,
  IconElement,
  ImageElement,
  JslaydDocument,
  JslaydElement,
  ListElement,
  SelectionRules,
  Shadow,
  ShapeElement,
  StatElement,
  TableElement,
  TableStyle,
  TextElement,
  TextSource,
  TextStyle,
  VisualDNA,
} from "./document.ts";
export { elementsOfType, walkElements } from "./document.ts";

export {
  contrastRatio,
  deriveColorFamily,
  extendChartPalette,
  luminance,
  mix,
  parseHex,
  readableOn,
  resolveColor,
  toHex,
  type Rgba,
} from "./colors.ts";

export {
  DiagnosticBag,
  formatDiagnostic,
  nearestName,
  type Diagnostic,
  type Diagnostics,
  type Severity,
} from "./diagnostics.ts";

export { compile, type CompileResult } from "./compile.ts";
export { decompile } from "./decompile.ts";
export { parse, type ParseNode, type ParseResult, type ParseSection } from "./parser.ts";
export {
  contentHash,
  readDocument,
  serialize,
  serializePretty,
  type ReadResult,
} from "./serialize.ts";
export { analyze, type CheckName, type CheckResult, type HealthReport } from "./analyze.ts";
export { AI_INSTRUCTION, PROMPT_STANDARD, SAMPLE_PROMPT, STANDARD_DOCUMENT } from "./standard.ts";

export {
  DEFAULT_META,
  conditionHolds,
  previewSlide,
  resolveBinding,
  resolveBullets,
  textVolume,
  type ChartData,
  type DeckMeta,
  type ImageRef,
  type SlideData,
  type TableData,
} from "./content.ts";
export {
  bundledFace,
  renderAllPreviews,
  renderArchetype,
  renderPreview,
  type RenderedElement,
  type RenderedSlide,
} from "./render.ts";
export { planArchetypes, purposeForLayout, selectArchetypes, selectOne, type Selection } from "./select.ts";
export {
  buildWritingBrief,
  checkFit,
  type ArchetypeWritingBrief,
  type SlotFit,
  type SlotRole,
  type TextSlotBudget,
  type VisualZone,
} from "./budget.ts";
export {
  characterCapacity,
  charactersPerLine,
  densityFor,
  linesThatFit,
  GLYPH_RATIO,
} from "./text-metrics.ts";

export { inspectBatch, readBatch, summarise } from "./batch.ts";
export type { BatchEntry, BatchInput, BatchReport } from "./batch.ts";

export { GRADIENT_PRESETS, THEME_FAMILIES, auditFamily, themeFamily, themePalette, themeVariants } from "./themes.ts";
export type { GradientPreset, ThemeFamily, ThemeFamilyId, ThemeVariant } from "./themes.ts";
export { IMAGE_ROLES, extractPalette, fromHsl, harmonise, temper, toHsl, veilFor } from "./palette.ts";
export type { Harmonised, ImagePalette } from "./palette.ts";
