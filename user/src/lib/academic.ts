import * as ImageManipulator from "expo-image-manipulator";

import { i18n } from "../i18n";

import { localizeError } from "./errors";
import { supabase } from "./supabase";

/**
 * An academic work, written a section at a time.
 *
 * The client drives the loop rather than the server: it asks for one section,
 * shows what came back, then asks for the next. That is what lets the screen
 * show real progress, lets a person stop and come back, and lets running out of
 * coins be a pause with a button rather than a failure with an apology.
 *
 * Around the prose, the work carries what a journal asks for (§5.6): the
 * language, an article's structure, the authors with their organisations and
 * ORCID iDs, the UDC code, acknowledgements and funding, the citation style
 * and the layout. Those are the person's to set and change at any time — they
 * take effect on the next preview or download, with nothing rewritten.
 */

export type WorkKind = "article" | "independent" | "referat" | "coursework";
export type Structure = "imrad" | "ilmrad" | "review" | "case_study" | "short" | "theoretical";
export type CitationStyle = "gost" | "apa" | "mla" | "chicago" | "ieee" | "vancouver";
export type WorkLanguage = "uz" | "ru" | "en" | "tr";
export type LayoutPreset = "uz" | "journal" | "apa";

export const KINDS: { kind: WorkKind }[] = [{ kind: "article" }, { kind: "independent" }, { kind: "referat" }, { kind: "coursework" }];
export const STRUCTURES: Structure[] = ["imrad", "ilmrad", "review", "case_study", "short", "theoretical"];
export const STYLES: CitationStyle[] = ["gost", "apa", "mla", "chicago", "ieee", "vancouver"];
export const WORK_LANGUAGES: WorkLanguage[] = ["uz", "ru", "en", "tr"];

export type Layout = {
  preset: LayoutPreset;
  fontSize: number;
  lineSpacing: number;
  margins: { top: number; right: number; bottom: number; left: number };
  indent: number;
  pageNumbers: boolean;
};

/** The same three presets the document engine sets (supabase/functions/_shared/academic.ts). */
export const PRESETS: Record<LayoutPreset, Layout> = {
  uz: { preset: "uz", fontSize: 14, lineSpacing: 1.5, margins: { top: 2, right: 1.5, bottom: 2, left: 3 }, indent: 1.25, pageNumbers: true },
  journal: { preset: "journal", fontSize: 12, lineSpacing: 1.15, margins: { top: 2, right: 2, bottom: 2, left: 2 }, indent: 1, pageNumbers: true },
  apa: { preset: "apa", fontSize: 12, lineSpacing: 2, margins: { top: 2.54, right: 2.54, bottom: 2.54, left: 2.54 }, indent: 1.27, pageNumbers: true },
};

export type Author = { name: string; affiliation: string; orcid: string; email: string };
export const emptyAuthor = (): Author => ({ name: "", affiliation: "", orcid: "", email: "" });
/** An ORCID iD: four groups of four, the last character a digit or X. */
export const ORCID = /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/;

export type Source = {
  title: string;
  year?: string;
  /** Older works stored one author string; newer ones a list. */
  author?: string;
  authors?: { family: string; given: string }[];
};

export type Work = {
  id: string;
  kind: WorkKind;
  topic: string;
  field: string;
  requirements: string;
  status: "draft" | "planning" | "writing" | "paused" | "ready" | "failed";
  empirical: boolean;
  sources: Source[];
  estimatedCredits: number;
  spentCredits: number;
  pausedReason: string | null;
  failureReason: string | null;
  language: WorkLanguage;
  structure: Structure | null;
  citationStyle: CitationStyle;
  authors: Author[];
  udc: string;
  acknowledgements: string;
  funding: string;
  layout: Layout;
};

export type Figure = { path: string; caption: string; width: number; height: number };

export type Section = {
  id: string;
  position: number;
  key: string;
  heading: string;
  status: "pending" | "writing" | "ready" | "failed";
  body: string;
  words: number;
  figures: Figure[];
  edited_at: string | null;
};

function readLayout(raw: unknown): Layout {
  const value = (raw ?? {}) as Partial<Layout>;
  const preset = PRESETS[value.preset && value.preset in PRESETS ? value.preset : "uz"];
  return { ...preset, ...value, margins: { ...preset.margins, ...(value.margins ?? {}) }, preset: preset.preset };
}

const shape = (row: Record<string, unknown>): Work => ({
  id: String(row.id),
  kind: row.kind as WorkKind,
  topic: String(row.topic ?? ""),
  field: String(row.field ?? ""),
  requirements: String(row.requirements ?? ""),
  status: row.status as Work["status"],
  empirical: Boolean(row.empirical),
  sources: (row.sources ?? []) as Source[],
  estimatedCredits: Number(row.estimated_credits ?? 0),
  spentCredits: Number(row.spent_credits ?? 0),
  pausedReason: (row.paused_reason as string | null) ?? null,
  failureReason: (row.failure_reason as string | null) ?? null,
  language: (WORK_LANGUAGES as string[]).includes(String(row.language)) ? row.language as WorkLanguage : "uz",
  structure: (row.structure as Structure | null) ?? null,
  citationStyle: (STYLES as string[]).includes(String(row.citation_style)) ? row.citation_style as CitationStyle : "gost",
  authors: Array.isArray(row.authors) ? (row.authors as Author[]).map((author) => ({ ...emptyAuthor(), ...author })) : [],
  udc: String(row.udc ?? ""),
  acknowledgements: String(row.acknowledgements ?? ""),
  funding: String(row.funding ?? ""),
  layout: readLayout(row.layout),
});

/** "Karimov A., Rasulova B." for a source, whichever way it was stored. */
export function sourceAuthors(source: Source): string {
  if (source.authors?.length) {
    const names = source.authors.map((person) => [person.family, person.given].filter(Boolean).join(" "));
    return names.length > 3 ? `${names.slice(0, 3).join(", ")} …` : names.join(", ");
  }
  return source.author ?? "";
}

export async function myWorks(): Promise<Work[]> {
  const { data, error } = await supabase
    .from("academic_works").select("*").order("updated_at", { ascending: false }).limit(20);
  if (error) throw error;
  return (data ?? []).map(shape);
}

export type NewWork = {
  kind: WorkKind;
  topic: string;
  field: string;
  requirements: string;
  language: WorkLanguage;
  structure: Structure | null;
  citationStyle: CitationStyle;
  authors: Author[];
  udc: string;
  acknowledgements: string;
  funding: string;
  layout: Layout;
};

const trimAuthors = (authors: Author[]) => authors
  .map((author) => ({ name: author.name.trim(), affiliation: author.affiliation.trim(), orcid: author.orcid.trim().toUpperCase(), email: author.email.trim() }))
  .filter((author) => author.name)
  .slice(0, 10);

export async function createWork(input: NewWork): Promise<Work> {
  const { data: user } = await supabase.auth.getUser();
  const owner = user.user?.id;
  if (!owner) throw new Error(i18n.t("tools:academic.signIn"));
  const { data, error } = await supabase.from("academic_works").insert({
    owner_id: owner,
    kind: input.kind,
    topic: input.topic.trim(),
    field: input.field.trim(),
    requirements: input.requirements.trim(),
    language: input.language,
    structure: input.kind === "article" ? input.structure : null,
    citation_style: input.citationStyle,
    authors: trimAuthors(input.authors),
    udc: input.udc.trim(),
    acknowledgements: input.acknowledgements.trim(),
    funding: input.funding.trim(),
    layout: input.layout,
  } as never).select("*").single();
  if (error) throw error;
  return shape(data as Record<string, unknown>);
}

/** What the person may change after the work is written: everything around the prose. */
export async function updateWork(id: string, patch: Partial<Pick<Work, "topic" | "authors" | "udc" | "acknowledgements" | "funding" | "citationStyle" | "layout">>): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.topic !== undefined) row.topic = patch.topic.trim();
  if (patch.authors !== undefined) row.authors = trimAuthors(patch.authors);
  if (patch.udc !== undefined) row.udc = patch.udc.trim();
  if (patch.acknowledgements !== undefined) row.acknowledgements = patch.acknowledgements.trim();
  if (patch.funding !== undefined) row.funding = patch.funding.trim();
  if (patch.citationStyle !== undefined) row.citation_style = patch.citationStyle;
  if (patch.layout !== undefined) row.layout = patch.layout;
  const { error } = await supabase.from("academic_works").update(row as never).eq("id", id);
  if (error) throw error;
}

export async function loadWork(id: string): Promise<{ work: Work; sections: Section[] }> {
  const [work, sections] = await Promise.all([
    supabase.from("academic_works").select("*").eq("id", id).single(),
    supabase.from("academic_sections").select("id, position, key, heading, status, body, words, figures, edited_at")
      .eq("work_id", id).order("position"),
  ]);
  if (work.error) throw work.error;
  if (sections.error) throw sections.error;
  return {
    work: shape(work.data as Record<string, unknown>),
    sections: ((sections.data ?? []) as unknown as Section[]).map((section) => ({ ...section, figures: Array.isArray(section.figures) ? section.figures : [] })),
  };
}

/** The author's correction of a written section. */
export async function editSection(id: string, heading: string, body: string): Promise<void> {
  const { error } = await supabase.rpc("academic_section_edit" as never, { p_section_id: id, p_heading: heading, p_body: body } as never);
  if (error) throw error;
}

export async function setSectionFigures(id: string, figures: Figure[]): Promise<void> {
  const { error } = await supabase.rpc("academic_section_figures" as never, { p_section_id: id, p_figures: figures } as never);
  if (error) throw error;
}

/** A picture for a figure: made no wider than 1600 px, stored in the work's folder. */
export async function uploadFigure(workId: string, ownerId: string, uri: string, width: number, height: number): Promise<Figure> {
  const resize = Math.max(width, height) > 1600 ? [width >= height ? { resize: { width: 1600 } } : { resize: { height: 1600 } }] : [];
  const small = await ImageManipulator.manipulateAsync(uri, resize, { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
  const path = `${ownerId}/ilmiy/${workId}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}.jpg`;
  const body = await (await fetch(small.uri)).arrayBuffer();
  const { error } = await supabase.storage.from("user-uploads").upload(path, body, { contentType: "image/jpeg", upsert: false });
  if (error) throw error;
  return { path, caption: "", width: small.width, height: small.height };
}

async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("generate-academic", { body });
  if (error) {
    const context = (error as { context?: unknown }).context;
    if (context && typeof (context as Response).json === "function") {
      const payload = await (context as Response).json().catch(() => null) as { error?: string; code?: string } | null;
      if (payload?.error) throw new Error(localizeError(payload.error, payload.code));
    }
    throw error;
  }
  return data as T;
}

export const planWork = (workId: string) =>
  invoke<{ sections: unknown[]; sources: unknown[]; empirical: boolean }>({ workId, action: "plan" });

/** Writes exactly one section — the next one that is not finished. */
export const writeNextSection = (workId: string) =>
  invoke<{ done: boolean; remaining: number; heading?: string }>({ workId, action: "section" });

export async function workFile(workId: string, format: "docx" | "pdf"): Promise<string> {
  const { storagePath } = await invoke<{ storagePath: string }>({ workId, action: "document", format });
  const signed = await supabase.storage.from("exports").createSignedUrl(storagePath, 300);
  if (signed.error || !signed.data) throw signed.error ?? new Error(i18n.t("tools:academic.noLink"));
  return signed.data.signedUrl;
}

/**
 * One item on a preview page: a word `[x, y, size, flags, text]` (flags: 1
 * bold, 2 italic; y is the baseline), a cell's rule `["b", x, y, w, h]`, or a
 * picture `["i", x, y, w, h, index]`. Points, from the page's top left.
 */
export type PreviewItem = [number, number, number, number, string] | ["b", number, number, number, number] | ["i", number, number, number, number, number];
export type Preview = { width: number; height: number; pictures: (string | null)[]; pages: PreviewItem[][] };

/** The A4 pages exactly as the PDF will set them. */
export const previewWork = (workId: string) => invoke<Preview>({ workId, action: "preview" });
