import type { Tables } from "@jaxongirman/types";

import { searchProjects as filter } from "./project-search";
import { supabase } from "./supabase";

/**
 * Everything this account has made, in one list.
 *
 * "Loyihalar" showed presentations and nothing else, while a 3×4 sheet, an
 * obyektivka and an academic work were each findable only from the screen that
 * created them — so the thing you made last week existed, and you could not get
 * back to it. A project is anything with a name, a date and somewhere to open
 * it; which table it lives in is our problem, not the reader's.
 *
 * Four reads rather than one view: the tables have different owners, different
 * policies and different lifecycles, and a database view over them would be a
 * fifth thing to keep in step for a list that is assembled once on a phone.
 */

export type ProjectKind = "presentation" | "portrait" | "objective" | "academic";

export type Project = {
  id: string;
  kind: ProjectKind;
  title: string;
  detail: string;
  status: string | null;
  updatedAt: string;
  /** Where opening it goes. */
  href: string;
};

export const KIND_LABEL: Record<ProjectKind, string> = {
  presentation: "Taqdimot",
  portrait: "3×4 rasm",
  objective: "Obyektivka",
  academic: "Ilmiy ish",
};

const ACADEMIC_LABEL: Record<string, string> = {
  article: "Ilmiy maqola",
  independent: "Mustaqil ish",
  referat: "Referat",
  coursework: "Kurs ishi",
};

const STATUS_LABEL: Record<string, string> = {
  ready: "Tayyor",
  draft: "Qoralama",
  writing: "Yozilmoqda",
  planning: "Reja tuzilmoqda",
  paused: "To‘xtatilgan",
  failed: "Xatolik",
  generating: "Yaratilmoqda",
};

export const statusLabel = (status: string | null): string | null =>
  (status ? STATUS_LABEL[status] ?? status : null);

const when = (value: unknown): string => String(value ?? new Date(0).toISOString());

/**
 * The whole workbench, newest first.
 *
 * One failing table does not empty the list: a person whose academic works
 * cannot be read should still see their presentations, because the alternative
 * is a screen that says they have made nothing.
 */
export async function listProjects(): Promise<Project[]> {
  const [decks, portraits, objectives, works] = await Promise.allSettled([
    supabase.from("presentations")
      .select("id, title, status, generated_slide_count, updated_at, created_at")
      .order("created_at", { ascending: false }).limit(50),
    supabase.from("portrait_sheets")
      .select("id, created_at").order("created_at", { ascending: false }).limit(20),
    supabase.from("objective_documents")
      .select("id, full_name, updated_at").order("updated_at", { ascending: false }).limit(20),
    supabase.from("academic_works")
      .select("id, kind, topic, status, updated_at").order("updated_at", { ascending: false }).limit(20),
  ]);

  const out: Project[] = [];

  if (decks.status === "fulfilled" && decks.value.data) {
    for (const row of decks.value.data as Tables<"presentations">[]) {
      out.push({
        id: row.id,
        kind: "presentation",
        title: row.title,
        detail: `${row.generated_slide_count ?? 0} slayd`,
        status: row.status,
        updatedAt: when(row.updated_at ?? row.created_at),
        href: row.status === "ready" ? `/(app)/presentation/${row.id}` : `/(app)/generation/${row.id}`,
      });
    }
  }

  if (portraits.status === "fulfilled" && portraits.value.data) {
    for (const row of portraits.value.data as { id: string; created_at: string }[]) {
      out.push({
        id: row.id,
        kind: "portrait",
        title: "3×4 rasm",
        detail: "A6 chop etish varag‘i",
        status: "ready",
        updatedAt: when(row.created_at),
        href: "/(app)/portrait",
      });
    }
  }

  if (objectives.status === "fulfilled" && objectives.value.data) {
    for (const row of objectives.value.data as { id: string; full_name: string; updated_at: string }[]) {
      out.push({
        id: row.id,
        kind: "objective",
        title: row.full_name?.trim() || "Obyektivka",
        detail: "Ma’lumotnoma",
        status: null,
        updatedAt: when(row.updated_at),
        href: "/(app)/obyektivka",
      });
    }
  }

  if (works.status === "fulfilled" && works.value.data) {
    for (const row of works.value.data as { id: string; kind: string; topic: string; status: string; updated_at: string }[]) {
      out.push({
        id: row.id,
        kind: "academic",
        title: row.topic?.trim() || "Ilmiy ish",
        detail: ACADEMIC_LABEL[row.kind] ?? "Ilmiy ish",
        status: row.status,
        updatedAt: when(row.updated_at),
        href: "/(app)/ilmiy",
      });
    }
  }

  return out.sort((first, second) => second.updatedAt.localeCompare(first.updatedAt));
}

/** Searching this list, with the matching rules kept where they are testable. */
export const searchProjects = (projects: readonly Project[], query: string): Project[] =>
  filter(projects.map((project) => ({ ...project, kind: KIND_LABEL[project.kind] })), query)
    .map((entry) => projects.find((project) => project.id === (entry as Project).id)!)
    .filter(Boolean);
