/**
 * Unsaved JSLAYD workbench text, kept where a reload cannot reach it.
 *
 * A design prompt is long, and writing one means leaving the tab: to fetch a
 * font file, to look up a hex value, to copy a paragraph from somewhere else.
 * Anything that unmounts the page — a reload, a crash, a stray navigation —
 * used to take the whole draft with it.
 *
 * The rule here is that this store never decides anything on its own. It hands
 * back what it kept and says how old it is; the page shows that to the admin
 * and lets them keep it or throw it away. A draft is never silently applied
 * over a design that may have changed elsewhere in the meantime.
 */

const PREFIX = "jaxongirman.jslayd.workbench.";
const KEEP_FOR_MS = 7 * 24 * 60 * 60 * 1000;

export type WorkbenchDraft = {
  id: string | null;
  slug: string;
  name: string;
  tier: string;
  description: string;
  premium: boolean;
  source: string;
  recovered: boolean;
  thumbnailPath: string | null;
};

export type KeptDraft<T extends WorkbenchDraft = WorkbenchDraft> = {
  draft: T;
  savedAt: number;
};

/** One slot per design, so two designs open in two tabs do not overwrite each other. */
function slotFor(id: string | null): string {
  return `${PREFIX}${id ?? "new"}`;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    // Private windows and locked-down profiles throw on access rather than
    // return null. Losing the safety net is survivable; a crash here is not.
    return null;
  }
}

export function keepDraft<T extends WorkbenchDraft>(draft: T): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(slotFor(draft.id), JSON.stringify({ draft, savedAt: Date.now() } satisfies KeptDraft<T>));
  } catch {
    // A full quota is not worth interrupting the admin's typing over.
  }
}

export function forgetDraft(id: string | null): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(slotFor(id));
  } catch {
    /* nothing to undo */
  }
}

/**
 * What was kept for this design, if it is still worth offering.
 *
 * Returns nothing when the kept text matches what the server just handed back:
 * there is no recovery to offer if the two already agree, and showing a notice
 * for that would train the admin to dismiss it without reading.
 */
export function recallDraft<T extends WorkbenchDraft>(id: string | null, current: T): KeptDraft<T> | null {
  const store = storage();
  if (!store) return null;
  let raw: string | null;
  try {
    raw = store.getItem(slotFor(id));
  } catch {
    return null;
  }
  if (!raw) return null;

  let kept: KeptDraft<T>;
  try {
    kept = JSON.parse(raw) as KeptDraft<T>;
  } catch {
    forgetDraft(id);
    return null;
  }

  const savedAt = typeof kept?.savedAt === "number" ? kept.savedAt : 0;
  if (!kept?.draft || typeof kept.draft.source !== "string") {
    forgetDraft(id);
    return null;
  }
  if (Date.now() - savedAt > KEEP_FOR_MS) {
    forgetDraft(id);
    return null;
  }
  if (sameDraft(kept.draft, current)) return null;
  return { draft: { ...current, ...kept.draft, id }, savedAt };
}

export function sameDraft(first: WorkbenchDraft, second: WorkbenchDraft): boolean {
  return first.source === second.source
    && first.slug === second.slug
    && first.name === second.name
    && first.tier === second.tier
    && first.description === second.description
    && first.premium === second.premium
    && first.thumbnailPath === second.thumbnailPath;
}
