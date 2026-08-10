import type { Json } from "./database.generated";

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
