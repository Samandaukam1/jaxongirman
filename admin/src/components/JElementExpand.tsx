import { manifestToFamily, readManifest } from "@jaxongirman/jelement";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { errorMessage } from "@/lib/format";
import { appendManifest } from "@/lib/jelement";

/**
 * Adding a second sheet's worth of objects to a family that already has some.
 *
 * Saving a family replaces it — anything absent from the document gets archived
 * — which is right when editing a specification and destructive when adding to
 * one. So this appends: the elements already there are not mentioned, and not
 * mentioning them now means nothing at all.
 *
 * Only the names arrive here. The pictures come next, from the panel below,
 * which by default targets exactly the elements that do not have one yet.
 */
export function JElementExpand({
  familyId,
  onAdded,
}: {
  familyId: string;
  onAdded: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const result = useMemo(() => (source.trim() ? readManifest(source) : null), [source]);

  async function save() {
    if (!result?.manifest) return;
    setSaving(true);
    setProblem(null);
    try {
      const added = await appendManifest(familyId, manifestToFamily(result.manifest));
      setSource("");
      setOpen(false);
      onAdded(added);
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Kengaytirish</h2>
          <p className="panel-hint">
            Yangi varaq uchun manifestni joylang. Mavjud elementlarga tegilmaydi — yangilari
            oxiriga qo‘shiladi. Keyin quyidagi panelda o‘sha varaqni kesib biriktirasiz.
          </p>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => setOpen((value) => !value)}>
          <Plus size={15} /> {open ? "Yopish" : "Manifest qo‘shish"}
        </button>
      </div>

      {open ? (
        <>
          <textarea
            className="import-area"
            rows={10}
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder={'{\n  "grid": { "columns": 4, "rows": 3 },\n  "elements": [ … ]\n}'}
          />

          {result && result.errors.length > 0 ? (
            <section className="diagnostics diagnostics-error">
              <h3>{result.errors.length} ta xato</h3>
              <ul>{result.errors.slice(0, 10).map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>
          ) : null}

          {result?.manifest ? (
            <ol className="element-list">
              {result.manifest.elements.map((element) => (
                <li key={element.cell}>
                  <strong>{element.cell}. {element.displayName}</strong>
                  <span className="family-meta">
                    {element.canonicalName}{element.group ? ` · ${element.group}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          ) : null}

          {problem ? <p className="field-problem">{problem}</p> : null}

          <button
            className="primary-button"
            type="button"
            disabled={!result?.manifest || saving}
            onClick={() => void save()}
          >
            <Plus size={16} /> {saving ? "Qo‘shilmoqda…" : "Elementlarni qo‘shish"}
          </button>
        </>
      ) : null}
    </section>
  );
}
