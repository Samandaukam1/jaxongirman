/**
 * The generative scene graph: what one slide is, before anything draws it.
 *
 * JSLAYD describes a *design* — a set of compositions somebody authored, which
 * slides are then fitted into. This describes a *slide*: the elements this
 * particular page needs, placed for the content it actually carries. Nothing
 * here is reusable across slides and nothing is chosen from a catalogue, which
 * is the whole difference.
 *
 * Two rules make that safe rather than chaotic.
 *
 * Placement is expressed on a grid rather than in pixels, so a composition can
 * be asymmetric, cinematic or split without any element landing at a number
 * somebody typed. The compiler turns a placement into absolute geometry once,
 * and every renderer — the phone, the web preview, the PowerPoint exporter —
 * reads that one result.
 *
 * And the vocabulary is closed. A scene naming a role, a treatment or a chart
 * type that does not exist here is rejected with the name it got wrong, rather
 * than being drawn wrongly. A model writes these; a closed vocabulary is how a
 * typo becomes an error instead of a blank slide.
 */

/* ------------------------------------------------------------------ canvas */

export const CANVAS = { width: 1920, height: 1080 } as const;

/**
 * The safe area, and the grid inside it.
 *
 * Twelve columns because it divides into halves, thirds and quarters — the
 * three splits editorial layout actually uses. Eight rows because a 16:9 page
 * has room for that many bands of type before they stop being bands.
 */
export const GRID = {
  margin: 96,
  columns: 12,
  rows: 8,
  gutter: 24,
} as const;

/* --------------------------------------------------------------- vocabulary */

export const TEXT_ROLES = [
  "eyebrow", "title", "subtitle", "lead", "body", "bullets",
  "statistic", "statistic_label", "quote", "attribution", "caption", "footer",
] as const;
export type TextRole = (typeof TEXT_ROLES)[number];

export const IMAGE_TREATMENTS = ["full_bleed", "rounded", "circle", "framed", "duotone"] as const;
export type ImageTreatment = (typeof IMAGE_TREATMENTS)[number];

export const CARD_TREATMENTS = ["solid", "glass", "outline", "gradient", "dark", "light"] as const;
export type CardTreatment = (typeof CARD_TREATMENTS)[number];

export const CHART_TYPES = ["bar", "pie", "doughnut", "line", "area"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

export const SHAPE_KINDS = ["rule", "panel", "orb", "grid_lines", "number"] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const BACKGROUND_KINDS = ["solid", "gradient", "image", "panel_split"] as const;
export type BackgroundKind = (typeof BACKGROUND_KINDS)[number];

/** Where a colour comes from. Never a hex a model invented — see `scene-dna`. */
export const COLOR_ROLES = [
  "background", "surface", "ink", "inkMuted", "onImage", "primary", "accent", "chart1", "chart2", "chart3", "chart4",
] as const;
export type ColorRole = (typeof COLOR_ROLES)[number];

/** Type sizes are named, so a scene cannot ask for eleven-point body copy. */
export const TYPE_SCALE = {
  display: 132,
  title: 84,
  heading: 56,
  lead: 34,
  body: 26,
  caption: 20,
  micro: 16,
  statistic: 180,
} as const;
export type TypeStep = keyof typeof TYPE_SCALE;

/** Which library font a role is set in. Resolved against the font library. */
export const FONT_ROLES = ["display", "heading", "body", "data", "quote"] as const;
export type FontRole = (typeof FONT_ROLES)[number];

/* -------------------------------------------------------------- placement */

/**
 * Where an element sits, in grid terms.
 *
 * `bleed` is the one escape from the safe area, and it exists for exactly one
 * thing: a photograph that is the page. Anything else that bleeds is a mistake,
 * so the validator says so.
 */
export type Placement = {
  column: number;
  span: number;
  row: number;
  rows: number;
  bleed?: boolean;
};

/** What a placement compiles to. The only thing a renderer reads. */
export type Box = { x: number; y: number; width: number; height: number };

/* ---------------------------------------------------------------- elements */

export type Typography = {
  font: FontRole;
  step: TypeStep;
  color: ColorRole;
  align?: "start" | "center" | "end";
  lineHeight?: number;
  /** Set only where the design wants type tighter than the step's default. */
  tracking?: number;
};

export type TextElement = {
  type: "text";
  role: TextRole;
  place: Placement;
  typography: Typography;
  text: string;
};

export type ImageElement = {
  type: "image";
  place: Placement;
  treatment: ImageTreatment;
  radius?: number;
  /** What the picture should be of. The image service answers this, not us. */
  intent: { query: string; orientation: "landscape" | "portrait" | "square" };
  /** Where the subject sits, so the crop keeps it. 0–1 in each axis. */
  focus?: { x: number; y: number };
  overlay?: "none" | "scrim_bottom" | "scrim_left" | "veil";
};

export type CardElement = {
  type: "card";
  place: Placement;
  treatment: CardTreatment;
  radius?: number;
  children: SceneElement[];
};

export type ChartElement = {
  type: "chart";
  place: Placement;
  chart: { kind: ChartType; labels: string[]; values: number[]; unit?: string };
};

export type ShapeElement = {
  type: "shape";
  kind: ShapeKind;
  place: Placement;
  color: ColorRole;
  opacity?: number;
  text?: string;
};

export type SceneElement = TextElement | ImageElement | CardElement | ChartElement | ShapeElement;

export type Background =
  | { kind: "solid"; color: ColorRole }
  | { kind: "gradient"; from: ColorRole; to: ColorRole; angle: number }
  | { kind: "image"; intent: ImageElement["intent"]; overlay: ImageElement["overlay"]; focus?: { x: number; y: number } }
  | { kind: "panel_split"; color: ColorRole; panel: ColorRole; at: number };

export type Scene = {
  /** What this page is for, in the deck's own words. Drives nothing; explains. */
  purpose: string;
  background: Background;
  elements: SceneElement[];
};

/* ---------------------------------------------------------------- reading */

export type SceneProblem = { path: string; message: string };

/**
 * Bounds the schema cannot carry.
 *
 * Gemini rejects a schema containing `minItems`/`maxItems` outright, so the
 * counts that make a slide a slide are checked here instead — which is the
 * better home for them anyway.
 */
export const MAX_ELEMENTS = 10;
export const MAX_CARD_CHILDREN = 4;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const oneOf = <T extends readonly string[]>(list: T, value: unknown): value is T[number] =>
  typeof value === "string" && (list as readonly string[]).includes(value);

function readPlacement(value: unknown, path: string, problems: SceneProblem[]): Placement | null {
  if (!isRecord(value)) {
    problems.push({ path, message: "placement is missing" });
    return null;
  }
  const numbers = ["column", "span", "row", "rows"] as const;
  const out: Record<string, number> = {};
  for (const key of numbers) {
    const raw = value[key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      problems.push({ path: `${path}.${key}`, message: `${key} must be a number` });
      return null;
    }
    out[key] = Math.round(raw);
  }
  const bleed = value.bleed === true;
  const placement: Placement = { column: out.column!, span: out.span!, row: out.row!, rows: out.rows!, ...(bleed ? { bleed } : {}) };

  // Bounds are checked here rather than at compile time: a scene that cannot
  // be placed is a scene to reject, not one to clamp into something nobody
  // designed.
  if (!bleed) {
    if (placement.column < 0 || placement.column >= GRID.columns) {
      problems.push({ path: `${path}.column`, message: `column ${placement.column} is outside 0…${GRID.columns - 1}` });
    }
    if (placement.span < 1 || placement.column + placement.span > GRID.columns) {
      problems.push({ path: `${path}.span`, message: `span ${placement.span} runs past the grid` });
    }
    if (placement.row < 0 || placement.row >= GRID.rows) {
      problems.push({ path: `${path}.row`, message: `row ${placement.row} is outside 0…${GRID.rows - 1}` });
    }
    if (placement.rows < 1 || placement.row + placement.rows > GRID.rows) {
      problems.push({ path: `${path}.rows`, message: `rows ${placement.rows} runs past the grid` });
    }
  }
  return placement;
}

/**
 * What each role is set in, when the model did not say.
 *
 * Almost every typographic field is optional in the schema, because a schema
 * small enough for the provider to accept could not require them — and a model
 * given optional fields omits them. The first real run lost two slides
 * entirely to elements with a role and nothing else. These are the choices a
 * renderer can make on its own, so it makes them.
 */
const TEXT_DEFAULTS: Record<TextRole, { font: FontRole; step: TypeStep; color: ColorRole }> = {
  eyebrow: { font: "body", step: "micro", color: "inkMuted" },
  title: { font: "display", step: "title", color: "ink" },
  subtitle: { font: "heading", step: "heading", color: "ink" },
  lead: { font: "body", step: "lead", color: "ink" },
  body: { font: "body", step: "body", color: "ink" },
  bullets: { font: "body", step: "body", color: "ink" },
  statistic: { font: "data", step: "statistic", color: "primary" },
  statistic_label: { font: "body", step: "caption", color: "inkMuted" },
  quote: { font: "quote", step: "lead", color: "ink" },
  attribution: { font: "body", step: "caption", color: "inkMuted" },
  caption: { font: "body", step: "caption", color: "inkMuted" },
  footer: { font: "body", step: "micro", color: "inkMuted" },
};

/** The role a type step implies, for a model that named one and not the other. */
function roleForStep(value: Record<string, unknown>): TextRole | null {
  const typography = isRecord(value.typography) ? value.typography : value;
  const step = typography.step;
  switch (step) {
    case "display": case "title": return "title";
    case "heading": return "subtitle";
    case "lead": return "lead";
    case "body": return "body";
    case "statistic": return "statistic";
    case "caption": return "caption";
    case "micro": return "eyebrow";
    default: return null;
  }
}

function readElement(input: unknown, path: string, problems: SceneProblem[]): SceneElement | null {
  if (!isRecord(input)) {
    problems.push({ path, message: "element must be an object" });
    return null;
  }
  const value: Record<string, unknown> = input;
  const place = readPlacement(value.place, `${path}.place`, problems);
  if (!place) return null;

  switch (value.type) {
    case "text": {
      /**
       * A missing role is inferred, not refused.
       *
       * A model that sets `step: "title"` and forgets `role` has said what it
       * meant; throwing the slide away over the omission cost a whole page in
       * the first real run. The type step is the same decision under another
       * name, so it answers for it.
       */
      const text = typeof value.text === "string" ? value.text : "";
      // Said before anything else about the element: an empty box is empty
      // whatever role it claims, and "no text" is the useful message.
      /**
       * Dropped rather than fatal, like an empty card.
       *
       * A model that emits a text element and forgets its words has produced
       * an empty box; the page is better off without it and no worse for the
       * omission. Taking the slide down instead cost a whole page in a real
       * run — twice.
       */
      if (!text.trim()) return null;
      const inferred = oneOf(TEXT_ROLES, value.role)
        ? value.role
        // A step names the role when the role does not; and an element with
        // words and neither is a paragraph, which is what most of them are.
        : roleForStep(value) ?? "body";
      if (!inferred) {
        problems.push({ path: `${path}.role`, message: `unknown text role ${JSON.stringify(value.role)}` });
        return null;
      }
      const fallback = TEXT_DEFAULTS[inferred];
      /**
       * Flat or nested, the same slide.
       *
       * Gemini refused the nested form: `typography` inside an element inside
       * a card is four levels of object, and the provider rejects a schema
       * past a depth it does not name. So `font`, `step` and `color` may sit
       * on the element itself — which is also less for a model to keep track
       * of — and both shapes read the same.
       */
      const typography = isRecord(value.typography) ? value.typography : value;
      const font = oneOf(FONT_ROLES, typography.font) ? typography.font : fallback.font;
      const step = typeof typography.step === "string" && typography.step in TYPE_SCALE
        ? typography.step as TypeStep
        : fallback.step;
      const color = oneOf(COLOR_ROLES, typography.color) ? typography.color : fallback.color;
      return {
        type: "text",
        role: inferred,
        place,
        text,
        typography: {
          font,
          step,
          color,
          ...(typography.align === "center" || typography.align === "end" || typography.align === "start"
            ? { align: typography.align }
            : {}),
          ...(typeof typography.lineHeight === "number" ? { lineHeight: typography.lineHeight } : {}),
          ...(typeof typography.tracking === "number" ? { tracking: typography.tracking } : {}),
        },
      };
    }
    case "image": {
      /**
       * The two treatment vocabularies share one field, so they get confused.
       *
       * A card asked for `rounded` and an image asked for `glass` are both
       * clear about everything except the word: the element type already says
       * which family was meant. Falling back beats losing the page.
       */
      const treatment = oneOf(IMAGE_TREATMENTS, value.treatment) ? value.treatment : "rounded";
      const intent = isRecord(value.intent) ? value.intent : {};
      if (typeof intent.query !== "string" || !intent.query.trim()) {
        problems.push({ path: `${path}.intent.query`, message: "an image needs to say what it is of" });
        return null;
      }
      const orientation = intent.orientation === "portrait" || intent.orientation === "square" ? intent.orientation : "landscape";
      return {
        type: "image",
        place,
        treatment,
        intent: { query: intent.query.trim(), orientation },
        ...(typeof value.radius === "number" ? { radius: value.radius } : {}),
        ...(isRecord(value.focus) && typeof value.focus.x === "number" && typeof value.focus.y === "number"
          ? { focus: { x: value.focus.x, y: value.focus.y } }
          : {}),
        ...(value.overlay === "scrim_bottom" || value.overlay === "scrim_left" || value.overlay === "veil" || value.overlay === "none"
          ? { overlay: value.overlay }
          : {}),
      };
    }
    case "card": {
      const treatment = oneOf(CARD_TREATMENTS, value.treatment) ? value.treatment : "solid";
      /**
       * Children stack, and are given their rows here.
       *
       * A caption inside a card that has to say which column it is in is a
       * placement nobody needs and a model gets wrong. The card is a column;
       * what it holds sits in it in order.
       */
      const children: SceneElement[] = [];
      const raw = Array.isArray(value.children) ? value.children : [];
      raw.forEach((child, index) => {
        const stacked = isRecord(child) && !isRecord(child.place)
          ? { type: "text", ...child, place: { column: 0, span: 1, row: index, rows: 1 } }
          : child;
        const read = readElement(stacked, `${path}.children[${index}]`, problems);
        if (read) children.push(read);
      });
      if (children.length > MAX_CARD_CHILDREN) {
        problems.push({ path: `${path}.children`, message: `a card holding ${children.length} things is a slide of its own` });
        return null;
      }
      if (children.length === 0) {
        /**
         * Dropped, not fatal.
         *
         * An empty card is decoration the model forgot to fill, and taking the
         * whole slide down with it cost two pages in the first real run. The
         * page keeps everything else and scores on what it actually has.
         */
        return null;
      }
      return {
        type: "card",
        place,
        treatment,
        children,
        ...(typeof value.radius === "number" ? { radius: value.radius } : {}),
      };
    }
    case "chart": {
      const chart = isRecord(value.chart) ? value.chart : {};
      if (!oneOf(CHART_TYPES, chart.kind)) {
        problems.push({ path: `${path}.chart.kind`, message: `unknown chart type ${JSON.stringify(chart.kind)}` });
        return null;
      }
      const labels = Array.isArray(chart.labels) ? chart.labels.filter((one) => typeof one === "string") as string[] : [];
      const values = Array.isArray(chart.values) ? chart.values.filter((one) => typeof one === "number" && Number.isFinite(one)) as number[] : [];
      if (labels.length < 2 || labels.length !== values.length || labels.length > 8) {
        problems.push({ path: `${path}.chart`, message: "a chart needs 2–8 labelled values" });
        return null;
      }
      if ((chart.kind === "pie" || chart.kind === "doughnut") && (values.some((one) => one < 0) || values.every((one) => one === 0))) {
        problems.push({ path: `${path}.chart`, message: "a pie is parts of a whole; these values are not" });
        return null;
      }
      return {
        type: "chart",
        place,
        chart: { kind: chart.kind, labels, values, ...(typeof chart.unit === "string" ? { unit: chart.unit } : {}) },
      };
    }
    case "shape": {
      if (!oneOf(SHAPE_KINDS, value.kind)) {
        problems.push({ path: `${path}.kind`, message: `unknown shape ${JSON.stringify(value.kind)}` });
        return null;
      }
      if (!oneOf(COLOR_ROLES, value.color)) {
        problems.push({ path: `${path}.color`, message: `unknown colour role ${JSON.stringify(value.color)}` });
        return null;
      }
      return {
        type: "shape",
        kind: value.kind,
        place,
        color: value.color,
        ...(typeof value.opacity === "number" ? { opacity: value.opacity } : {}),
        ...(typeof value.text === "string" ? { text: value.text } : {}),
      };
    }
    default:
      problems.push({ path: `${path}.type`, message: `unknown element type ${JSON.stringify(value.type)}` });
      return null;
  }
}

function readBackground(value: unknown, problems: SceneProblem[]): Background {
  if (!isRecord(value) || !oneOf(BACKGROUND_KINDS, value.kind)) {
    problems.push({ path: "background", message: "background is missing or unknown" });
    return { kind: "solid", color: "background" };
  }
  switch (value.kind) {
    case "gradient": {
      const from = oneOf(COLOR_ROLES, value.from) ? value.from : "background";
      const to = oneOf(COLOR_ROLES, value.to) ? value.to : "surface";
      const angle = typeof value.angle === "number" ? value.angle : 180;
      return { kind: "gradient", from, to, angle };
    }
    case "image": {
      const intent = isRecord(value.intent) ? value.intent : {};
      if (typeof intent.query !== "string" || !intent.query.trim()) {
        problems.push({ path: "background.intent.query", message: "an image background needs to say what it is of" });
        return { kind: "solid", color: "background" };
      }
      return {
        kind: "image",
        intent: {
          query: intent.query.trim(),
          orientation: intent.orientation === "portrait" || intent.orientation === "square" ? intent.orientation : "landscape",
        },
        overlay: value.overlay === "scrim_left" || value.overlay === "veil" || value.overlay === "none" ? value.overlay : "scrim_bottom",
        ...(isRecord(value.focus) && typeof value.focus.x === "number" && typeof value.focus.y === "number"
          ? { focus: { x: value.focus.x, y: value.focus.y } }
          : {}),
      };
    }
    case "panel_split": {
      return {
        kind: "panel_split",
        color: oneOf(COLOR_ROLES, value.color) ? value.color : "background",
        panel: oneOf(COLOR_ROLES, value.panel) ? value.panel : "surface",
        at: typeof value.at === "number" ? Math.min(0.8, Math.max(0.2, value.at)) : 0.5,
      };
    }
    default:
      return { kind: "solid", color: oneOf(COLOR_ROLES, value.color) ? value.color : "background" };
  }
}

/**
 * Read a scene a model produced.
 *
 * Every rejection names the path it happened at, because these are read by a
 * repair pass that has to say what to change — "unknown text role" with no
 * location is a message nothing can act on.
 */
export function readScene(value: unknown): { scene: Scene | null; problems: SceneProblem[] } {
  const problems: SceneProblem[] = [];
  if (!isRecord(value)) {
    return { scene: null, problems: [{ path: "", message: "scene must be an object" }] };
  }
  const background = readBackground(value.background, problems);
  const elements: SceneElement[] = [];
  const raw = Array.isArray(value.elements) ? value.elements : [];
  raw.forEach((entry, index) => {
    const read = readElement(entry, `elements[${index}]`, problems);
    if (read) elements.push(read);
  });
  if (elements.length === 0) {
    problems.push({ path: "elements", message: "a slide with no elements is not a slide" });
  } else if (elements.length > MAX_ELEMENTS) {
    problems.push({ path: "elements", message: `${elements.length} elements is more than a page can hold (${MAX_ELEMENTS})` });
  }
  const scene: Scene = {
    purpose: typeof value.purpose === "string" ? value.purpose : "",
    background,
    elements,
  };
  return { scene: problems.length > 0 && elements.length === 0 ? null : scene, problems };
}
