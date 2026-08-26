import type { Archetype, JslaydDocument } from "@jaxongirman/jslayd";
import { ChevronDown, ChevronUp, Copy, Eye, EyeOff, Lock, LockOpen, Trash2 } from "lucide-react";
import { useState } from "react";

import { duplicateElement, removeElement, renameElement, reorder, stackingOrder } from "@/lib/studioEdit";

/**
 * The stack, as a list somebody can rearrange.
 *
 * Reordering here is a list operation; turning that back into `zIndex` numbers
 * is `reorder`'s problem, which is the point — a panel that edits the numbers
 * directly makes the author do the arithmetic and discover collisions.
 *
 * Lock and hide are **not** written into the design. They are workbench state:
 * a locked element is one this person does not want to grab by accident, which
 * is nothing to do with what the slide is. Putting them in the DSL would extend
 * a closed vocabulary for the convenience of one screen, and every renderer and
 * exporter would then have to have an opinion about them.
 */

export type LayerFlags = { locked: Set<string>; hidden: Set<string> };

export function StudioLayers({
  document: design,
  archetype,
  selectedId,
  flags,
  onSelect,
  onChange,
  onFlags,
}: {
  document: JslaydDocument;
  archetype: Archetype | null;
  selectedId: string | null;
  flags: LayerFlags;
  onSelect: (id: string | null) => void;
  onChange: (next: JslaydDocument) => void;
  onFlags: (next: LayerFlags) => void;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!archetype) return <p className="studio-empty">Slayd tanlanmagan.</p>;

  // Top of the panel is the top of the stack, which is how a person reads it.
  const ordered = stackingOrder(archetype).slice().reverse();

  const move = (id: string, by: -1 | 1) => {
    const ids = ordered.map((element) => element.id);
    const at = ids.indexOf(id);
    const to = at + by;
    if (at < 0 || to < 0 || to >= ids.length) return;
    const next = ids.slice();
    next.splice(to, 0, ...next.splice(at, 1));
    // The list is drawn top-first; `reorder` numbers from the bottom.
    onChange(reorder(design, archetype.id, next.slice().reverse()));
  };

  const toggle = (set: Set<string>, id: string): Set<string> => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  };

  const commitRename = (id: string) => {
    const result = renameElement(design, archetype.id, id, draft);
    if (result.error) { setError(result.error); return; }
    onChange(result.document);
    if (selectedId === id) onSelect(draft.trim());
    setRenaming(null);
    setError(null);
  };

  return (
    <div className="studio-layers">
      {ordered.map((element, index) => {
        const isSelected = element.id === selectedId;
        const locked = flags.locked.has(element.id);
        const hidden = flags.hidden.has(element.id);

        return (
          <div key={element.id} className={`studio-layer${isSelected ? " selected" : ""}`}>
            <button
              type="button"
              className="studio-layer-name"
              onClick={() => onSelect(element.id)}
              onDoubleClick={() => { setRenaming(element.id); setDraft(element.id); setError(null); }}
            >
              {renaming === element.id ? (
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={() => commitRename(element.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") commitRename(element.id);
                    if (event.key === "Escape") { setRenaming(null); setError(null); }
                  }}
                />
              ) : (
                <>
                  <span className="studio-layer-type">{element.type}</span>
                  <span className={hidden ? "studio-layer-dim" : undefined}>{element.id}</span>
                </>
              )}
            </button>

            <div className="studio-layer-actions">
              <button type="button" title="Yuqoriga" disabled={index === 0} onClick={() => move(element.id, -1)}><ChevronUp size={14} /></button>
              <button type="button" title="Pastga" disabled={index === ordered.length - 1} onClick={() => move(element.id, 1)}><ChevronDown size={14} /></button>
              <button type="button" title={hidden ? "Ko‘rsatish" : "Yashirish"} onClick={() => onFlags({ ...flags, hidden: toggle(flags.hidden, element.id) })}>
                {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
              <button type="button" title={locked ? "Qulfni ochish" : "Qulflash"} onClick={() => onFlags({ ...flags, locked: toggle(flags.locked, element.id) })}>
                {locked ? <Lock size={14} /> : <LockOpen size={14} />}
              </button>
              <button type="button" title="Nusxalash" onClick={() => {
                const result = duplicateElement(design, archetype.id, element.id);
                onChange(result.document);
                if (result.id) onSelect(result.id);
              }}><Copy size={14} /></button>
              <button type="button" title="O‘chirish" onClick={() => {
                onChange(removeElement(design, archetype.id, element.id));
                if (selectedId === element.id) onSelect(null);
              }}><Trash2 size={14} /></button>
            </div>
          </div>
        );
      })}
      {error && <p className="studio-layer-error">{error}</p>}
    </div>
  );
}
