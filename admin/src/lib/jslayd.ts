import {
  analyze,
  compile,
  contentHash,
  decompile,
  readDocument,
  renderAllPreviews,
  renderPreview,
  serializePretty,
  type Diagnostics,
  type HealthReport,
  type JslaydDocument,
  type RenderedSlide,
  type Tier,
} from "@jaxongirman/jslayd";
import type { Database } from "@jaxongirman/types";

import { supabase } from "@/lib/supabase";

/**
 * The admin's JSLAYD data layer.
 *
 * Compilation happens here, in the browser, and only the result is sent to the
 * server (§47). That keeps the compiler out of the Edge bundle, gives the
 * editor its diagnostics without a round trip, and leaves the server checking
 * what it should check — that what arrived is a JSLAYD document and that the
 * caller may write it.
 */

export type DesignRow = Database["public"]["Functions"]["admin_list_designs"]["Returns"][number];
export type DesignStatus = Database["public"]["Enums"]["jslayd_design_status"];

export const FONT_BUCKET = "design-fonts";
export const PREVIEW_BUCKET = "design-previews";

export type CompileOutcome = {
  document: JslaydDocument | null;
  diagnostics: Diagnostics;
  health: HealthReport | null;
  hash: string | null;
};

/** Parse, validate, compile and score in one pass — what the buttons call. */
export async function compilePrompt(source: string): Promise<CompileOutcome> {
  const { document, diagnostics } = compile(source);
  if (!document) return { document: null, diagnostics, health: null, hash: null };
  return { document, diagnostics, health: analyze(document), hash: await contentHash(document) };
}

export function previewOf(document: JslaydDocument, family?: string | null): RenderedSlide {
  return renderPreview(document, undefined, family);
}

/**
 * A rendered slide as the shared canvas wants it.
 *
 * The engine emits rows without database identity, because it has none to give
 * — a preview was never a row in `slide_elements`. The keys added here exist
 * only so React can tell one element from another.
 */
export function toCanvas(rendered: RenderedSlide, key: string) {
  return {
    slide: { title: null, background: rendered.background as never },
    elements: rendered.elements.map((element, index) => ({
      ...element,
      id: `${key}-${index}`,
      slide_id: key,
      presentation_id: key,
      owner_id: key,
      created_at: "",
      updated_at: "",
    })) as never[],
  };
}

export function allPreviewsOf(document: JslaydDocument, family?: string | null) {
  return renderAllPreviews(document, family);
}

export async function listDesigns(filters: {
  status?: DesignStatus | null;
  tier?: Tier | null;
  query?: string;
}): Promise<DesignRow[]> {
  const { data, error } = await supabase.rpc("admin_list_designs", {
    p_status: filters.status ?? undefined,
    p_tier: filters.tier ?? undefined,
    p_query: filters.query?.trim() || undefined,
    p_limit: 200,
    p_offset: 0,
  });
  if (error) throw error;
  return data ?? [];
}

export async function loadDesign(id: string) {
  const [design, fonts] = await Promise.all([
    supabase.from("presentation_designs").select("*").eq("id", id).single(),
    supabase.from("presentation_design_fonts").select("*").eq("design_id", id).order("font_id"),
  ]);
  if (design.error) throw design.error;
  if (fonts.error) throw fonts.error;
  return { design: design.data, fonts: fonts.data };
}

export type SaveInput = {
  /** The design being edited, when there is one — so a rename stays one design. */
  id: string | null;
  slug: string;
  name: string;
  tier: Tier;
  description: string;
  premium: boolean;
  source: string;
  outcome: CompileOutcome;
  thumbnailPath: string | null;
};

export async function saveDesign(input: SaveInput): Promise<string> {
  const { data, error } = await supabase.rpc("admin_save_design", {
    p_id: input.id ?? undefined,
    p_slug: input.slug,
    p_name: input.name,
    p_tier: input.tier,
    p_description: input.description,
    p_is_premium: input.premium,
    p_source_prompt: input.source,
    p_compiled_config: (input.outcome.document ?? null) as never,
    p_preview: (input.outcome.document ? previewOf(input.outcome.document) : {}) as never,
    p_content_hash: input.outcome.hash ?? undefined,
    p_health_score: input.outcome.health?.score ?? undefined,
    p_thumbnail_path: input.thumbnailPath ?? undefined,
  });
  if (error) throw error;
  return data as string;
}

export async function publishDesign(id: string): Promise<number> {
  const { data, error } = await supabase.rpc("admin_publish_design", { p_design_id: id });
  if (error) throw error;
  return data as number;
}

export async function archiveDesign(id: string, reason: string | null) {
  const { error } = await supabase.rpc("admin_archive_design", { p_design_id: id, p_reason: reason ?? undefined });
  if (error) throw error;
}

export async function restoreDesign(id: string) {
  const { error } = await supabase.rpc("admin_restore_design", { p_design_id: id });
  if (error) throw error;
}

export async function duplicateDesign(id: string, slug: string, name: string): Promise<string> {
  const { data, error } = await supabase.rpc("admin_duplicate_design", { p_design_id: id, p_slug: slug, p_name: name });
  if (error) throw error;
  return data as string;
}

/**
 * Uploads a font file and records it against the design.
 *
 * The object key is `<slug>/<file>` and is rebuilt server-side too, so a
 * crafted file name cannot reach another design's prefix even if this call is
 * replayed by hand (§82).
 */
export async function uploadFont(params: {
  designId: string;
  slug: string;
  fontId: string;
  name: string;
  roles: string[];
  file: File;
  weight: number;
  italic: boolean;
  fallback: string;
}) {
  const extension = params.file.name.toLowerCase().split(".").pop() ?? "";
  if (!["ttf", "otf", "woff"].includes(extension)) {
    throw new Error("Faqat .ttf, .otf va .woff qo‘llab-quvvatlanadi. WOFF2 PDF eksportida ishlamaydi.");
  }
  // One file per weight and slope, so a package can hold a whole family rather
  // than whichever face was uploaded last.
  const fileName = `${params.fontId}-${params.weight}${params.italic ? "i" : ""}.${extension}`;
  const upload = await supabase.storage
    .from(FONT_BUCKET)
    .upload(`${params.slug}/${fileName}`, params.file, { upsert: true, contentType: params.file.type || "font/ttf" });
  if (upload.error) throw upload.error;

  const { error } = await supabase.rpc("admin_save_design_font", {
    p_design_id: params.designId,
    p_font_id: params.fontId,
    p_name: params.name,
    p_roles: params.roles,
    p_file_name: fileName,
    p_format: extension,
    p_weight: params.weight,
    p_italic: params.italic,
    p_fallback: params.fallback,
    p_byte_size: params.file.size,
  });
  if (error) throw error;
  return `${params.slug}/${fileName}`;
}

export async function uploadThumbnail(slug: string, file: File): Promise<string> {
  const extension = file.name.toLowerCase().split(".").pop() ?? "png";
  const key = `${slug}/cover.${extension}`;
  const { error } = await supabase.storage
    .from(PREVIEW_BUCKET)
    .upload(key, file, { upsert: true, contentType: file.type || "image/png" });
  if (error) throw error;
  return key;
}

export type DesignFontFace = {
  font_id: string;
  name: string;
  roles: string[];
  asset_path: string | null;
  format: string | null;
  weight: number;
  italic: boolean;
  fallback: string;
};

/** Every face a design ships, newest slot first, heaviest last. */
export async function listDesignFonts(designId: string): Promise<DesignFontFace[]> {
  const { data, error } = await supabase
    .from("presentation_design_fonts")
    .select("font_id, name, roles, asset_path, format, weight, italic, fallback")
    .eq("design_id", designId)
    .order("font_id")
    .order("weight")
    .order("italic");
  if (error) throw error;
  return (data ?? []) as DesignFontFace[];
}

/**
 * Detaches one face and deletes the file it pointed at.
 *
 * The row goes first: a bucket object with no row is litter, but a row pointing
 * at a deleted object is a design that renders a missing font.
 */
export async function removeDesignFont(designId: string, fontId: string, weight: number, italic: boolean) {
  const { data, error } = await supabase.rpc("admin_remove_design_font", {
    p_design_id: designId,
    p_font_id: fontId,
    p_weight: weight,
    p_italic: italic,
  });
  if (error) throw error;
  const path = data as string | null;
  if (path) await supabase.storage.from(FONT_BUCKET).remove([path]);
}

export function publicAssetUrl(bucket: string, path: string | null): string | null {
  if (!path) return null;
  return supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/**
 * The text an admin edits a stored design through.
 *
 * A design saved from this console keeps the prompt that produced it, and that
 * prompt is what comes back — the admin sees their own words, comments and all.
 *
 * The designs translated from the old TypeScript templates never had a prompt,
 * and neither does an imported `.jslayd`. Those are recovered from the compiled
 * document instead. The decompiler is an exact inverse — every built-in design
 * is checked to compile back byte for byte — so editing a recovered design
 * changes what the admin changed and nothing else.
 */
export function editableSource(design: {
  source_prompt: string | null;
  compiled_config: unknown;
}): { source: string; recovered: boolean } {
  const stored = design.source_prompt?.trim();
  if (stored) return { source: design.source_prompt as string, recovered: false };
  // Postgres does not keep jsonb key order, so the stored document is read back
  // through the same validator an imported file goes through rather than
  // trusted as it arrives.
  const { document } = readDocument(design.compiled_config);
  if (!document) return { source: "", recovered: false };
  return { source: decompile(document), recovered: true };
}

/** Reads an imported `.jslayd`, refusing anything this build cannot render (§81). */
export function importDocument(text: string) {
  return readDocument(text);
}

export function downloadDocument(document: JslaydDocument) {
  const blob = new Blob([serializePretty(document)], { type: "application/vnd.jaxongirman.jslayd+json" });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = url;
  anchor.download = `${document.design.slug}.jslayd`;
  anchor.click();
  URL.revokeObjectURL(url);
}
