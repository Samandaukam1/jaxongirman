import type { Json } from "./database.generated";

export * from "./payment-cards";

/**
 * Account roles, ordered from least to most privileged. `super_admin` is a
 * strict superset of `admin`: everywhere an admin is allowed, a super admin is
 * too, and a handful of operations are reserved for the super admin alone.
 *
 * Never compare a role with `===` at a call site. The moment a fourth role
 * appears, string comparisons scattered across the apps go quietly stale —
 * these helpers are the single place that has to change.
 */
export type AppRole = "user" | "admin" | "super_admin";

/** Higher wins. Used to pick the strongest role a person holds. */
const ROLE_RANK: Record<AppRole, number> = { user: 0, admin: 1, super_admin: 2 };

export const ROLE_LABELS: Record<AppRole, string> = {
  user: "Foydalanuvchi",
  admin: "Administrator",
  super_admin: "Bosh administrator",
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && value in ROLE_RANK;
}

/** True for anyone who may open the admin console at all. */
export function isAdminRole(role: unknown): boolean {
  return isAppRole(role) && ROLE_RANK[role] >= ROLE_RANK.admin;
}

/** True only for the top of the ladder. */
export function isSuperAdminRole(role: unknown): boolean {
  return isAppRole(role) && role === "super_admin";
}

/** The strongest role in a list, since user_roles may hold several rows. */
export function highestRole(roles: readonly unknown[]): AppRole {
  return roles.filter(isAppRole).reduce<AppRole>((best, role) => (ROLE_RANK[role] > ROLE_RANK[best] ? role : best), "user");
}

/**
 * Named capabilities rather than role checks, so a screen asks for what it
 * needs and the rule behind it can move without touching the screen.
 */
export type AdminPermission =
  | "admin.access"
  | "users.view"
  | "users.adjustCredits"
  | "users.setStatus"
  | "presentations.view"
  | "usage.view"
  | "audit.view"
  | "pricing.edit"
  | "settings.edit"
  | "roles.manage";

/**
 * Reserved for the super admin. Only `roles.manage` sits here today, because it
 * is the one capability that did not exist before this tier did — narrowing an
 * existing admin permission would take away access people already have, and the
 * database still grants it to them, so the console would disagree with the
 * server. Moving a permission into this list is a two-line change: add it here,
 * and swap `is_admin()` for `is_super_admin()` in the RPC that performs it.
 */
const SUPER_ADMIN_ONLY: readonly AdminPermission[] = ["roles.manage"];

export function can(role: unknown, permission: AdminPermission): boolean {
  if (!isAdminRole(role)) return false;
  if (SUPER_ADMIN_ONLY.includes(permission)) return isSuperAdminRole(role);
  return true;
}

export type PresentationStyle = "simple" | "good" | "great" | "super_professional";
export type PresentationStatus = "draft" | "queued" | "generating" | "ready" | "failed" | "archived";
export type JobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ElementType = "text" | "image" | "shape" | "icon" | "chart" | "table" | "line" | "group";

/**
 * Every presentation surface works in this single 16:9 coordinate space. The
 * editor, the phone preview and the projector only scale this model to their
 * own pixels; element positions never become device coordinates.
 */
export const SLIDE_MODEL_WIDTH = 1000;
export const SLIDE_MODEL_HEIGHT = 562.5;

export interface RenderableSlide {
  id: string;
  position: number;
  title?: string | null;
  layout?: string;
  background: Json;
}

export interface RenderableSlideElement {
  id: string;
  slide_id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  z_index: number;
  opacity: number;
  locked?: boolean;
  style: Json;
  content: Json;
}

export interface PresentationScreenDeck {
  title: string;
  slides: RenderableSlide[];
  elements: RenderableSlideElement[];
}

/** Translation is expressed in model units after scale, relative to centre. */
export interface PresentationViewport {
  scale: number;
  translateX: number;
  translateY: number;
}

export const MIN_PRESENTATION_SCALE = 1;
export const MAX_PRESENTATION_SCALE = 4;
export const RESET_PRESENTATION_VIEWPORT: Readonly<PresentationViewport> = {
  scale: 1,
  translateX: 0,
  translateY: 0,
};

function finite(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function between(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Keeps enough of a zoomed slide over the viewport that no blank edge appears. */
export function clampPresentationViewport(viewport: Partial<PresentationViewport>): PresentationViewport {
  const scale = between(finite(viewport.scale, 1), MIN_PRESENTATION_SCALE, MAX_PRESENTATION_SCALE);
  const horizontal = (SLIDE_MODEL_WIDTH * (scale - 1)) / 2;
  const vertical = (SLIDE_MODEL_HEIGHT * (scale - 1)) / 2;
  return {
    scale,
    translateX: between(finite(viewport.translateX, 0), -horizontal, horizontal),
    translateY: between(finite(viewport.translateY, 0), -vertical, vertical),
  };
}

/**
 * Pinches around the fingers rather than the middle of the slide. Focal values
 * are model-space coordinates relative to the slide centre. Supplying a moving
 * current focal also makes a two-finger drag pan naturally while pinching.
 */
export function presentationViewportAfterPinch(
  initial: PresentationViewport,
  gestureScale: number,
  startFocalX: number,
  startFocalY: number,
  currentFocalX = startFocalX,
  currentFocalY = startFocalY,
): PresentationViewport {
  const start = clampPresentationViewport(initial);
  const scale = between(start.scale * finite(gestureScale, 1), MIN_PRESENTATION_SCALE, MAX_PRESENTATION_SCALE);
  const contentX = (startFocalX - start.translateX) / start.scale;
  const contentY = (startFocalY - start.translateY) / start.scale;
  return clampPresentationViewport({
    scale,
    translateX: currentFocalX - scale * contentX,
    translateY: currentFocalY - scale * contentY,
  });
}

export function presentationViewportAfterPan(
  initial: PresentationViewport,
  deltaX: number,
  deltaY: number,
): PresentationViewport {
  return clampPresentationViewport({
    ...initial,
    translateX: initial.translateX + finite(deltaX, 0),
    translateY: initial.translateY + finite(deltaY, 0),
  });
}

export interface VisualDna {
  mood: string;
  era: string;
  visualStyle: string;
  palette: Record<string, string>;
  typography: Record<string, string>;
  textures: string[];
  illustrationStyle: string;
  iconStyle: string;
  imageDirection: string;
  decorativeElements: string[];
  spacingStyle: string;
  chartStyle: string;
}

export interface SlideElementModel {
  id: string;
  type: ElementType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  opacity: number;
  locked?: boolean;
  style: Record<string, unknown>;
  content: Record<string, unknown>;
}

export interface SlideModel {
  id: string;
  presentationId: string;
  position: number;
  title: string | null;
  layout: string;
  background: Record<string, unknown>;
  speakerNotes: string | null;
  elements: SlideElementModel[];
}

export const STYLE_LABELS: Record<PresentationStyle, string> = {
  simple: "Oddiy",
  good: "Yaxshi",
  great: "Ajoyib",
  super_professional: "Super professional",
};

export const SLIDE_COUNT_PRESETS = [5, 7, 10, 12, 15, 20, 25, 30] as const;

/* ------------------------------------------------------------------ modules */

/** The one module code the apps hard-code; everything else about it is configuration. */
export const DATA_COLLECTION_MODULE = "data_collection";

/**
 * What `module_access_state()` answers with. The shape exists so a screen can
 * describe access truthfully — held or not, priced, enforced or not, buyable or
 * not — instead of guessing from a boolean.
 */
export interface ModuleAccessState {
  module_code: string;
  label: string | null;
  enabled: boolean;
  price_amount: number;
  currency: string;
  duration_months: number;
  retention_hours: number;
  max_image_bytes: number;
  enforce_creator_access: boolean;
  enforce_respondent_access: boolean;
  has_access: boolean;
  expires_at: string | null;
  payment_configured: boolean;
  payment_provider: string | null;
}

/* ------------------------------------------------------------------ surveys */

export type SurveyQuestionType =
  | "short_text" | "long_text" | "phone" | "image"
  | "single_choice" | "multi_choice" | "date" | "number";

export type SurveyStatus = "draft" | "open" | "closed";

export const SURVEY_QUESTION_TYPES: readonly SurveyQuestionType[] = [
  "short_text", "long_text", "phone", "number", "date", "single_choice", "multi_choice", "image",
];

export const SURVEY_QUESTION_LABELS: Record<SurveyQuestionType, string> = {
  short_text: "Qisqa matn",
  long_text: "Uzun matn",
  phone: "Telefon raqam",
  image: "Rasm yuklash",
  single_choice: "Bitta variant",
  multi_choice: "Bir nechta variant",
  date: "Sana",
  number: "Raqam",
};

export const SURVEY_STATUS_LABELS: Record<SurveyStatus, string> = {
  draft: "Qoralama",
  open: "Faol",
  closed: "Tugagan",
};

/** Choice questions are the only ones that carry options. */
export function questionHasOptions(type: SurveyQuestionType): boolean {
  return type === "single_choice" || type === "multi_choice";
}

/**
 * Only free text can be constrained to an alphabet. A phone, a number or a date
 * already has a stricter format rule of its own, and forcing Latin on them would
 * reject valid input. Mirrors the `survey_questions_latin_scope` check.
 */
export function supportsLatinOnly(type: SurveyQuestionType): boolean {
  return type === "short_text" || type === "long_text";
}

/**
 * The character set Uzbek Latin actually uses: ASCII, the Latin-1/Extended
 * supplements, and the apostrophe and dash variants keyboards emit for O‘ and
 * G‘. Cyrillic, Arabic, CJK and emoji all fall outside it.
 *
 * This is a character-by-character copy of `public.is_latin_text()`. The server
 * is the one that decides, but the client refuses to submit what the server
 * would reject, so nobody loses a filled-in form to a round trip.
 */
const NON_LATIN = /[^\u0009\u000A\u000D\u0020-\u007E\u00A0-\u024F\u02B9\u02BB\u02BC\u02BD\u2013\u2014\u2018\u2019\u201C\u201D\u2026]/;

export function isLatinText(value: string | null | undefined): boolean {
  if (!value || value.trim() === "") return true;
  return !NON_LATIN.test(value);
}

export const LATIN_ONLY_ERROR = "Javobni lotin alifbosida kiriting.";

/* ------------------------------------------------------------------- phones */

/**
 * Uzbekistan numbers, stored one way. Mirrors `public.normalize_uz_phone()`:
 * accepts what a person types and answers with +998XXXXXXXXX, or null when the
 * digits cannot be one.
 */
export function normalizeUzPhone(value: string | null | undefined): string | null {
  if (!value) return null;
  let digits = value.replace(/[^0-9]/g, "");
  if (digits.length === 9) digits = `998${digits}`;
  return digits.length === 12 && digits.startsWith("998") ? `+${digits}` : null;
}

/** The readable form: +998 90 123 45 67. Formats as far as the digits go. */
export function formatUzPhone(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/[^0-9]/g, "").replace(/^998/, "").slice(0, 9);
  const groups = [digits.slice(0, 2), digits.slice(2, 5), digits.slice(5, 7), digits.slice(7, 9)].filter(Boolean);
  return groups.length ? `+998 ${groups.join(" ")}` : "+998 ";
}

/* ------------------------------------------------------------ notifications */

export type NotificationKind =
  | "credit_gift" | "system" | "presentation"
  | "survey_invite" | "survey_deadline" | "survey_completed"
  | "project_ready" | "marketplace_sale" | "marketplace_purchase"
  | "credit_received" | "credit_sent" | "subscription_expiry";

/**
 * Where a notification leads when its row carries no explicit `deep_link`.
 * Older rows predate the column, and a kind is enough to place them.
 */
export const NOTIFICATION_FALLBACK_ROUTES: Partial<Record<NotificationKind, string>> = {
  credit_gift: "/(app)/(tabs)",
  credit_received: "/(app)/(tabs)",
  credit_sent: "/(app)/(tabs)",
  survey_invite: "/(app)/survey",
  survey_deadline: "/(app)/survey",
  survey_completed: "/(app)/survey",
  project_ready: "/(app)/(tabs)/projects",
  presentation: "/(app)/(tabs)/projects",
  marketplace_sale: "/(app)/(tabs)/marketplace",
  marketplace_purchase: "/(app)/(tabs)/marketplace",
};

export type { Database, Enums, Json, Tables, TablesInsert, TablesUpdate } from "./database.generated";

/* -------------------------------------------------------------- marketplace */

export type MarketplaceProductStatus =
  | "draft" | "pending_review" | "approved" | "rejected" | "hidden" | "archived";

export const MARKETPLACE_STATUS_LABELS: Record<MarketplaceProductStatus, string> = {
  draft: "Qoralama",
  pending_review: "Tekshiruvda",
  approved: "Sotuvda",
  rejected: "Qaytarilgan",
  hidden: "Yashirilgan",
  archived: "Arxivlangan",
};

export type MarketplaceSort = "newest" | "popular" | "rating" | "price_asc" | "price_desc";

export const MARKETPLACE_SORT_LABELS: Record<MarketplaceSort, string> = {
  newest: "Yangi",
  popular: "Ommabop",
  rating: "Yuqori baho",
  price_asc: "Arzon",
  price_desc: "Qimmat",
};

/**
 * What `marketplace_quote()` answers with. Every figure is whole som, computed
 * server-side from the commission rates in force — no client recomputes a fee.
 */
export interface MarketplaceQuote {
  base_price: number;
  currency: string;
  buyer_fee_rate: number;
  buyer_fee_amount: number;
  buyer_total: number;
  seller_fee_rate: number;
  seller_fee_amount: number;
  seller_net: number;
  platform_gross: number;
}

/** One card in the catalogue grid, as `marketplace_search()` returns it. */
export interface MarketplaceListItem {
  id: string;
  title: string;
  material_type: string;
  material_label: string | null;
  category_id: string | null;
  base_price: number;
  currency: string;
  cover_path: string | null;
  content_units: number | null;
  file_format: string | null;
  has_study_guide: boolean;
  sales_count: number;
  rating: number | null;
  rating_count: number;
  seller_id: string;
  seller_name: string;
  published_at: string | null;
  is_favorite: boolean;
}

export interface MarketplaceSearchResult {
  total: number;
  limit: number;
  offset: number;
  items: MarketplaceListItem[];
  commission: { buyer_fee_rate: number; seller_fee_rate: number } | null;
}

export interface MarketplaceMaterialType {
  code: string;
  label: string;
  description: string;
  allowed_mime_types: string[];
  max_file_bytes: number;
  supports_study_guide: boolean;
  supports_editor_import: boolean;
  is_active: boolean;
}

/** Settlement states as the earnings screen names them. */
export const SETTLEMENT_STATUS_LABELS: Record<string, string> = {
  draft: "Tayyorlanmoqda",
  pending: "To‘lov kutilmoqda",
  paid: "To‘langan",
  cancelled: "Bekor qilingan",
};

// ---------------------------------------------------------------------------
// O‘yingoh
// ---------------------------------------------------------------------------

/**
 * The twelve ways a question can ask, by internal code. The user never sees
 * these strings — GAME_TYPE_LABELS is what the screens print. team_mode is a
 * session switch rather than a question shape, which is why it is absent here.
 */
export type GameQuestionType =
  | "single_choice" | "true_false" | "multiple_choice" | "ordering"
  | "matching" | "fill_blank" | "word_cloud" | "poll"
  | "open_answer" | "image_quiz" | "hotspot";

export const GAME_QUESTION_TYPES: readonly GameQuestionType[] = [
  "single_choice", "true_false", "multiple_choice", "ordering", "matching",
  "fill_blank", "word_cloud", "poll", "open_answer", "image_quiz", "hotspot",
];

export const GAME_TYPE_LABELS: Record<GameQuestionType, string> = {
  single_choice: "Bosh qotirma",
  true_false: "Rostmi, yolg‘onmi?",
  multiple_choice: "Bir nechtasini tanlang",
  ordering: "Tartibga soling",
  matching: "Juftini toping",
  fill_blank: "Bo‘sh joyni to‘ldiring",
  word_cloud: "So‘zlar buluti",
  poll: "Ovoz berish",
  open_answer: "Erkin javob",
  image_quiz: "Rasmni toping",
  hotspot: "Rasmdan joyni toping",
};

/** The types the AI can author with text alone; the other two need a picture. */
export const GAME_AI_TYPES: readonly GameQuestionType[] = [
  "single_choice", "true_false", "multiple_choice", "ordering", "matching",
  "fill_blank", "word_cloud", "poll", "open_answer",
];

export type GameStatus = "generating" | "draft" | "ready" | "archived" | "failed";
export type GameSessionStatus =
  | "lobby" | "countdown" | "question" | "question_result"
  | "leaderboard" | "finished" | "cancelled" | "expired";

export const GAME_STATUS_LABELS: Record<GameStatus, string> = {
  generating: "Yaratilmoqda",
  draft: "Qoralama",
  ready: "Tayyor",
  archived: "Arxivda",
  failed: "Xatolik",
};

export const GAME_DIFFICULTY_LABELS: Record<string, string> = {
  oson: "Oson",
  ortacha: "O‘rtacha",
  qiyin: "Qiyin",
  aralash: "Aralash",
};

export const GAME_AUDIENCE_LABELS: Record<string, string> = {
  maktab_1_4: "1–4-sinf",
  maktab_5_9: "5–9-sinf",
  maktab_10_11: "10–11-sinf",
  maktab: "Maktab",
  universitet_bakalavr: "Bakalavriat",
  universitet_magistr: "Magistratura",
  universitet: "Universitet",
  umumiy: "Umumiy",
};

export const GAME_TIME_LIMIT_PRESETS = [5, 10, 15, 20, 30, 60] as const;
export const GAME_POINT_PRESETS = [0, 500, 1000, 1500, 2000] as const;

/** One option in a choice-style question. */
export interface GameOption { id: string; text: string }

/**
 * Question config shapes, keyed by type. On the authoring side these carry the
 * answer key; the play RPCs strip the key before anything reaches a player.
 */
export interface GameQuestionConfig {
  options?: GameOption[];
  correct?: string | string[] | boolean;
  items?: GameOption[];
  order?: string[];
  left?: GameOption[];
  right?: GameOption[];
  pairs?: Record<string, string>;
  answers?: string[];
  region?: { x: number; y: number; w: number; h: number };
  shape?: "rect" | "circle";
  reference?: string;
  ai_grading?: boolean;
}

/** A leaderboard row as game_leaderboard_rows() returns it. */
export interface GameLeaderboardPlayer {
  id: string;
  nickname: string;
  avatar_id: number;
  team: string | null;
  total_score: number;
  correct_count: number;
  rank: number;
}

/**
 * The forty faces. Twenty read as girls, twenty as boys, and the grid shows
 * all forty at once — nobody is asked to declare anything to pick a face.
 */
export const GAME_AVATAR_COUNT = 40;

/** The reward plan the host configures; whole coins, all fields optional. */
export interface GameRewardPlan {
  first?: number;
  second?: number;
  third?: number;
  participant?: number;
}

/**
 * The avatar wardrobe. Each of the forty faces is a fixed recipe over one
 * parametric bust — skin, hair style and colour, shirt, backdrop, accessory —
 * rendered by react-native-svg in the app and inline SVG on the web from this
 * same data, so a player looks identical on a phone and on the projector.
 * Indexes 0–19 read as girls, 20–39 as boys; the grid always shows all forty.
 */
export type GameAvatarHair =
  | "long" | "bob" | "ponytail" | "braids" | "bun" | "curly" | "wavy" | "headscarf"
  | "short" | "spiky" | "fade" | "crew" | "afro" | "sideswept" | "cap";

export type GameAvatarAccessory = "none" | "glasses" | "roundGlasses" | "headband" | "earrings" | "freckles";

export interface GameAvatarSpec {
  skin: string;
  hair: string;
  style: GameAvatarHair;
  shirt: string;
  bg: string;
  accessory: GameAvatarAccessory;
}

const SKINS = ["#FFD9B8", "#F2B98C", "#DE9A66", "#B97A4C", "#8C5A33"] as const;

export const GAME_AVATARS: readonly GameAvatarSpec[] = [
  // 0–19: qiz xarakterlar
  { skin: SKINS[0], hair: "#4A2C17", style: "long", shirt: "#8B54E8", bg: "#F0E9FC", accessory: "none" },
  { skin: SKINS[1], hair: "#1F1712", style: "bob", shirt: "#0F9D74", bg: "#E4F6F0", accessory: "earrings" },
  { skin: SKINS[2], hair: "#0E0A08", style: "braids", shirt: "#E8618C", bg: "#FDEBF1", accessory: "none" },
  { skin: SKINS[0], hair: "#B4690E", style: "ponytail", shirt: "#2E6FE8", bg: "#E8F0FD", accessory: "freckles" },
  { skin: SKINS[3], hair: "#0E0A08", style: "bun", shirt: "#E8A13A", bg: "#FCF3E4", accessory: "none" },
  { skin: SKINS[1], hair: "#5C3A21", style: "curly", shirt: "#12A5BC", bg: "#E3F5F8", accessory: "roundGlasses" },
  { skin: SKINS[4], hair: "#1F1712", style: "headscarf", shirt: "#6C34C9", bg: "#F0E9FC", accessory: "none" },
  { skin: SKINS[0], hair: "#8A4A1F", style: "wavy", shirt: "#C43552", bg: "#FCEBEF", accessory: "none" },
  { skin: SKINS[2], hair: "#3A2413", style: "long", shirt: "#0F9D74", bg: "#E4F6F0", accessory: "headband" },
  { skin: SKINS[1], hair: "#0E0A08", style: "bun", shirt: "#8B54E8", bg: "#F0E9FC", accessory: "earrings" },
  { skin: SKINS[3], hair: "#2A1A10", style: "braids", shirt: "#12A5BC", bg: "#E3F5F8", accessory: "none" },
  { skin: SKINS[0], hair: "#1F1712", style: "bob", shirt: "#E8A13A", bg: "#FCF3E4", accessory: "glasses" },
  { skin: SKINS[2], hair: "#4A2C17", style: "ponytail", shirt: "#6C34C9", bg: "#F0E9FC", accessory: "none" },
  { skin: SKINS[4], hair: "#0E0A08", style: "curly", shirt: "#E8618C", bg: "#FDEBF1", accessory: "none" },
  { skin: SKINS[1], hair: "#6B4423", style: "headscarf", shirt: "#2E6FE8", bg: "#E8F0FD", accessory: "none" },
  { skin: SKINS[0], hair: "#0E0A08", style: "long", shirt: "#12A5BC", bg: "#E3F5F8", accessory: "freckles" },
  { skin: SKINS[3], hair: "#1F1712", style: "wavy", shirt: "#8B54E8", bg: "#F0E9FC", accessory: "earrings" },
  { skin: SKINS[2], hair: "#0E0A08", style: "bun", shirt: "#C43552", bg: "#FCEBEF", accessory: "roundGlasses" },
  { skin: SKINS[1], hair: "#8A4A1F", style: "braids", shirt: "#0F9D74", bg: "#E4F6F0", accessory: "none" },
  { skin: SKINS[4], hair: "#1F1712", style: "ponytail", shirt: "#E8A13A", bg: "#FCF3E4", accessory: "headband" },
  // 20–39: o‘g‘il xarakterlar
  { skin: SKINS[0], hair: "#4A2C17", style: "short", shirt: "#2E6FE8", bg: "#E8F0FD", accessory: "none" },
  { skin: SKINS[1], hair: "#1F1712", style: "spiky", shirt: "#0F9D74", bg: "#E4F6F0", accessory: "none" },
  { skin: SKINS[2], hair: "#0E0A08", style: "fade", shirt: "#8B54E8", bg: "#F0E9FC", accessory: "glasses" },
  { skin: SKINS[3], hair: "#0E0A08", style: "afro", shirt: "#E8A13A", bg: "#FCF3E4", accessory: "none" },
  { skin: SKINS[0], hair: "#B4690E", style: "crew", shirt: "#C43552", bg: "#FCEBEF", accessory: "freckles" },
  { skin: SKINS[1], hair: "#5C3A21", style: "sideswept", shirt: "#12A5BC", bg: "#E3F5F8", accessory: "none" },
  { skin: SKINS[4], hair: "#0E0A08", style: "short", shirt: "#6C34C9", bg: "#F0E9FC", accessory: "none" },
  { skin: SKINS[2], hair: "#1F1712", style: "cap", shirt: "#0F9D74", bg: "#E4F6F0", accessory: "none" },
  { skin: SKINS[0], hair: "#1F1712", style: "crew", shirt: "#8B54E8", bg: "#F0E9FC", accessory: "roundGlasses" },
  { skin: SKINS[3], hair: "#2A1A10", style: "fade", shirt: "#2E6FE8", bg: "#E8F0FD", accessory: "none" },
  { skin: SKINS[1], hair: "#0E0A08", style: "spiky", shirt: "#E8618C", bg: "#FDEBF1", accessory: "none" },
  { skin: SKINS[2], hair: "#4A2C17", style: "sideswept", shirt: "#E8A13A", bg: "#FCF3E4", accessory: "glasses" },
  { skin: SKINS[4], hair: "#1F1712", style: "afro", shirt: "#12A5BC", bg: "#E3F5F8", accessory: "none" },
  { skin: SKINS[0], hair: "#8A4A1F", style: "cap", shirt: "#6C34C9", bg: "#F0E9FC", accessory: "none" },
  { skin: SKINS[1], hair: "#0E0A08", style: "crew", shirt: "#0F9D74", bg: "#E4F6F0", accessory: "freckles" },
  { skin: SKINS[3], hair: "#0E0A08", style: "short", shirt: "#C43552", bg: "#FCEBEF", accessory: "none" },
  { skin: SKINS[2], hair: "#1F1712", style: "spiky", shirt: "#2E6FE8", bg: "#E8F0FD", accessory: "none" },
  { skin: SKINS[0], hair: "#4A2C17", style: "fade", shirt: "#E8A13A", bg: "#FCF3E4", accessory: "roundGlasses" },
  { skin: SKINS[4], hair: "#0E0A08", style: "sideswept", shirt: "#8B54E8", bg: "#F0E9FC", accessory: "none" },
  { skin: SKINS[1], hair: "#5C3A21", style: "cap", shirt: "#12A5BC", bg: "#E3F5F8", accessory: "none" },
];

/** A safe lookup: any out-of-range id lands on the first face, never crashes. */
export function gameAvatar(id: number): GameAvatarSpec {
  return GAME_AVATARS[id >= 0 && id < GAME_AVATARS.length ? id : 0]!;
}

/**
 * One avatar, as ordered vector shapes in a 0–100 viewBox. Pure data: the app
 * maps these onto react-native-svg elements, the web onto inline <svg>, and
 * both draw the identical face. Renderers stay dumb on purpose — every design
 * decision lives here, once.
 */
export type GameAvatarShape =
  | { kind: "circle"; cx: number; cy: number; r: number; fill: string }
  | { kind: "ellipse"; cx: number; cy: number; rx: number; ry: number; fill: string }
  | { kind: "rect"; x: number; y: number; w: number; h: number; rx: number; fill: string }
  | { kind: "path"; d: string; fill?: string; stroke?: string; strokeWidth?: number };

export function gameAvatarShapes(id: number): readonly GameAvatarShape[] {
  const spec = gameAvatar(id);
  const dark = "#241A33";
  const shapes: GameAvatarShape[] = [
    { kind: "circle", cx: 50, cy: 50, r: 50, fill: spec.bg },
  ];

  // Hair that sits behind the head.
  if (spec.style === "long" || spec.style === "wavy") {
    shapes.push({ kind: "path", d: "M28 42 a22 22 0 0 1 44 0 l1 28 a5 5 0 0 1 -5 5 l-36 0 a5 5 0 0 1 -5 -5 z", fill: spec.hair });
  }
  if (spec.style === "afro") {
    shapes.push({ kind: "circle", cx: 50, cy: 34, r: 25, fill: spec.hair });
  }
  if (spec.style === "braids") {
    shapes.push({ kind: "rect", x: 26, y: 40, w: 8, h: 26, rx: 4, fill: spec.hair });
    shapes.push({ kind: "rect", x: 66, y: 40, w: 8, h: 26, rx: 4, fill: spec.hair });
  }
  if (spec.style === "ponytail") {
    shapes.push({ kind: "ellipse", cx: 72, cy: 52, rx: 7, ry: 13, fill: spec.hair });
  }

  // Shoulders, then the head over them.
  shapes.push({ kind: "ellipse", cx: 50, cy: 92, rx: 26, ry: 18, fill: spec.shirt });
  shapes.push({ kind: "circle", cx: 30, cy: 44, r: 4, fill: spec.skin });
  shapes.push({ kind: "circle", cx: 70, cy: 44, r: 4, fill: spec.skin });
  shapes.push({ kind: "circle", cx: 50, cy: 42, r: 21, fill: spec.skin });

  // Hair that sits on the head.
  switch (spec.style) {
    case "long": case "wavy": case "bob":
      shapes.push({ kind: "path", d: "M29 44 a21 21 0 0 1 42 0 c-2 -10 -8 -14 -21 -14 s-19 4 -21 14 z", fill: spec.hair });
      if (spec.style === "bob") {
        shapes.push({ kind: "path", d: "M29 42 a21 21 0 0 1 42 0 l0 10 a4 4 0 0 1 -6 3 l0 -8 a26 26 0 0 0 -30 0 l0 8 a4 4 0 0 1 -6 -3 z", fill: spec.hair });
      }
      break;
    case "ponytail": case "bun": case "braids": case "sideswept":
      shapes.push({ kind: "path", d: "M29 44 a21 21 0 0 1 42 0 c-1 -11 -8 -15 -21 -15 s-20 4 -21 15 z", fill: spec.hair });
      if (spec.style === "bun") shapes.push({ kind: "circle", cx: 50, cy: 20, r: 8, fill: spec.hair });
      if (spec.style === "sideswept") {
        shapes.push({ kind: "path", d: "M31 40 c4 -12 14 -15 24 -13 c-4 6 -14 10 -24 13 z", fill: spec.hair });
      }
      break;
    case "curly": {
      for (const [cx, cy, r] of [[34, 32, 8], [43, 26, 9], [53, 24, 9], [63, 28, 8], [69, 36, 7]] as const) {
        shapes.push({ kind: "circle", cx, cy, r, fill: spec.hair });
      }
      break;
    }
    case "headscarf":
      shapes.push({ kind: "path", d: "M27 46 a23 23 0 0 1 46 0 l-2 4 a21 21 0 0 0 -42 0 z", fill: spec.hair });
      shapes.push({ kind: "path", d: "M27 46 c-1 10 2 16 8 20 c-3 -7 -3 -13 -1 -18 z", fill: spec.hair });
      shapes.push({ kind: "path", d: "M73 46 c1 10 -2 16 -8 20 c3 -7 3 -13 1 -18 z", fill: spec.hair });
      break;
    case "short": case "crew": case "fade":
      shapes.push({ kind: "path", d: spec.style === "crew"
        ? "M31 38 a21 21 0 0 1 38 0 c-4 -7 -10 -10 -19 -10 s-15 3 -19 10 z"
        : "M29 42 a21 21 0 0 1 42 0 c-3 -9 -9 -13 -21 -13 s-18 4 -21 13 z", fill: spec.hair });
      break;
    case "spiky":
      shapes.push({ kind: "path", d: "M30 40 c0 -6 3 -10 6 -12 l1 6 l5 -8 l3 7 l5 -9 l4 8 l5 -6 l2 7 l6 -4 c2 3 3 7 3 11 c-6 -6 -13 -8 -20 -8 s-14 2 -20 8 z", fill: spec.hair });
      break;
    case "afro":
      break; // drawn behind already
    case "cap":
      shapes.push({ kind: "path", d: "M29 40 a21 21 0 0 1 42 0 z", fill: spec.hair });
      shapes.push({ kind: "rect", x: 27, y: 38, w: 56, h: 6, rx: 3, fill: spec.hair });
      break;
  }

  // The face.
  shapes.push({ kind: "circle", cx: 43, cy: 45, r: 2.4, fill: dark });
  shapes.push({ kind: "circle", cx: 57, cy: 45, r: 2.4, fill: dark });
  shapes.push({ kind: "path", d: "M44 52 Q50 57 56 52", stroke: dark, strokeWidth: 2 });

  switch (spec.accessory) {
    case "glasses":
      shapes.push({ kind: "path", d: "M37 44 h10 v7 h-10 z M53 44 h10 v7 h-10 z M47 46 h6", stroke: dark, strokeWidth: 1.8 });
      break;
    case "roundGlasses":
      shapes.push({ kind: "path", d: "M38 45 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M52 45 a5 5 0 1 0 10 0 a5 5 0 1 0 -10 0 M48 45 h4", stroke: dark, strokeWidth: 1.8 });
      break;
    case "headband":
      shapes.push({ kind: "rect", x: 30, y: 30, w: 40, h: 5, rx: 2.5, fill: spec.shirt });
      break;
    case "earrings":
      shapes.push({ kind: "circle", cx: 30, cy: 49, r: 2, fill: "#E8A13A" });
      shapes.push({ kind: "circle", cx: 70, cy: 49, r: 2, fill: "#E8A13A" });
      break;
    case "freckles":
      shapes.push({ kind: "circle", cx: 40, cy: 50, r: 1, fill: "#D89B72" });
      shapes.push({ kind: "circle", cx: 44, cy: 51.5, r: 1, fill: "#D89B72" });
      shapes.push({ kind: "circle", cx: 56, cy: 51.5, r: 1, fill: "#D89B72" });
      shapes.push({ kind: "circle", cx: 60, cy: 50, r: 1, fill: "#D89B72" });
      break;
    case "none":
      break;
  }

  return shapes;
}
