import { slugOf, type FontFamily } from "@/lib/fontFaces";
import { supabase } from "@/lib/supabase";

/**
 * The shelf, as the app sees it.
 *
 * Two thousand families live in `font_families`; the app is shown the ones an
 * administrator switched on, which the read policy enforces rather than this
 * module remembering to ask. Nothing here downloads a byte — a list of names is
 * a list of names, and the file only matters once somebody picks one.
 */

type Row = {
  id: string;
  canonical_name: string;
  normalized_name: string;
  category: string;
  is_variable: boolean;
  is_featured: boolean;
  font_faces: {
    weight: number; italic: boolean; style_name: string;
    format: string; storage_path: string; content_hash: string;
  }[] | null;
};

const shape = (row: Row): FontFamily => ({
  id: row.id,
  name: row.canonical_name,
  slug: row.normalized_name,
  category: row.category,
  variable: row.is_variable,
  featured: row.is_featured,
  faces: (row.font_faces ?? []).map((face) => ({
    weight: face.weight,
    italic: face.italic,
    styleName: face.style_name,
    format: face.format,
    storagePath: face.storage_path,
    hash: face.content_hash,
  })).sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic)),
});

const SELECT = "id, canonical_name, normalized_name, category, is_variable, is_featured, font_faces(weight, italic, style_name, format, storage_path, content_hash)";

export async function listFonts(options: { search?: string; featured?: boolean; limit?: number; offset?: number } = {}): Promise<FontFamily[]> {
  let request = supabase.from("font_families").select(SELECT).order("canonical_name");
  if (options.featured) request = request.eq("is_featured", true);
  // Prefix rather than `%term%`: it is what the index answers, and it is what
  // somebody typing "mont" is asking for.
  if (options.search) request = request.like("normalized_name", `${slugOf(options.search)}%`);
  const from = options.offset ?? 0;
  request = request.range(from, from + (options.limit ?? 40) - 1);

  const { data, error } = await request;
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(shape);
}

export async function fontsByName(names: readonly string[]): Promise<FontFamily[]> {
  if (names.length === 0) return [];
  const { data, error } = await supabase.from("font_families").select(SELECT)
    .in("normalized_name", names.map(slugOf));
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).map(shape);
}

export { faceFor, faceId, slugOf, slugOfFaceId } from "@/lib/fontFaces";
export type { FontFace, FontFamily } from "@/lib/fontFaces";
