export type PresentationStyle = "simple" | "good" | "great" | "super_professional";
export type LayoutName = "cover" | "agenda" | "title_body" | "two_columns" | "statistic" | "quote" | "comparison" | "timeline" | "chart" | "conclusion" | "references" | "thanks";

/** A researched claim with the page it came from, used to ground the writing. */
export type ResearchFinding = { claim: string; sourceUrl: string | null };
export type ResearchSource = { label: string; url: string | null };
export type Research = { summary: string; findings: ResearchFinding[]; sources: ResearchSource[] };

export type Palette = {
  background: string;
  surface: string;
  primary: string;
  secondary: string;
  accent: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
};

/**
 * The AI no longer chooses colours — the palette below is always the family the
 * user picked, merged in by the pipeline after the model has written content.
 */
export type VisualDna = {
  mood: string;
  era: string;
  visualStyle: string;
  palette: Palette;
  typography: { display: string; body: string };
  textures: string[];
  illustrationStyle: string;
  iconStyle: string;
  imageDirection: string;
  decorativeElements: string[];
  spacingStyle: string;
  chartStyle: string;
  templateCode: string;
  paletteCode: string;
};

export type SemanticSlide = {
  title: string;
  subtitle: string | null;
  purpose: string;
  layout: LayoutName;
  bullets: string[];
  body: string | null;
  quote: { text: string; attribution: string } | null;
  statistic: { value: string; label: string } | null;
  chart: { type: "bar" | "line" | "donut"; labels: string[]; values: number[] } | null;
  /**
   * Tabular data the writer researched. Only a JSLAYD design draws one — the
   * built-in blueprints have no table slot — so a deck on the built-in path
   * simply carries it unused.
   */
  table: { columns: string[]; rows: string[][] } | null;
  visualPrompt: string | null;
};

export type PresentationPlan = { visualDna: VisualDna; slides: SemanticSlide[] };

export type GeneratedImage = { slideIndex: number; bucket: string; path: string; provider: string; costUsd: number };

export type SlideRow = {
  id: string;
  presentation_id: string;
  owner_id: string;
  position: number;
  title: string;
  layout: string;
  background: Record<string, unknown>;
  quality_score: number;
  quality_report: Record<string, unknown>;
};

export type ElementRow = {
  id: string;
  slide_id: string;
  presentation_id: string;
  owner_id: string;
  type: "text" | "image" | "shape" | "icon" | "chart" | "table" | "line" | "group";
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  locked: boolean;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
};
