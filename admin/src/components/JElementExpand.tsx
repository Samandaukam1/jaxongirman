import { dominantHue, manifestToFamily, readManifest, sliceSheet } from "@jaxongirman/jelement";
import { Plus, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { errorMessage } from "@/lib/format";
import {
  appendManifest, attachCuts, elementIdsByName, pixelsOf, pngFromPixels, type Cutout,
} from "@/lib/jelement";

/**
 * Adding a sheet's worth of objects to a family, names and pictures together.
 *
 * These were two panels and two buttons, and that was the wrong shape. Pasting
 * the manifest created twelve elements immediately, so the moment somebody read
 * the names and before they had chosen a file, the library held twelve empty
 * squares — a half-finished import that looked like a broken one, and stayed
 * that way if they got distracted.
 *
 * So nothing is created until both halves are in hand. The manifest names the
 * objects, the sheet supplies them, the cuts are shown against the names they
 * will take, and one button does the whole thing. Until then the family is
 * exactly as it was.
 */

type Cut = { index: number; pixels: Awaited<ReturnType<typeof pixelsOf>>; url: string };

export function JElementExpand({
  familyId,
  familySlug,
  onAdded,
}: {
  familyId: string;
  familySlug: string;
  onAdded: (count: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState("");
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [accent, setAccent] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const result = useMemo(() => (source.trim() ? readManifest(source) : null), [source]);
  const manifest = result?.manifest ?? null;

  /**
   * Cut on the grid the manifest declared, not on one chosen by hand.
   *
   * The manifest already states the layout it was written for, so asking again
   * would be asking somebody to repeat themselves and giving them a way to
   * disagree with the document they just pasted.
   */
  const cut = useCallback(async (file: File) => {
    if (!manifest) return;
    setProblem(null);
    setBusy("Kesilmoqda…");
    try {
      const sheet = await pixelsOf(file);
      setCuts((previous) => { previous.forEach((entry) => URL.revokeObjectURL(entry.url)); return []; });

      const pieces = sliceSheet(sheet, manifest.grid.columns, manifest.grid.rows);
      const next: Cut[] = [];
      for (let index = 0; index < pieces.length; index += 1) {
        const piece = pieces[index];
        if (!piece) continue;
        next.push({ index, pixels: piece, url: URL.createObjectURL(await pngFromPixels(piece)) });
      }
      setCuts(next);
      setAccent(dominantHue(sheet));
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }, [manifest]);

  const pairs = useMemo(
    () => cuts.map((entry, order) => ({ cut: entry, element: manifest?.elements[order] ?? null })),
    [cuts, manifest],
  );

  const extraCuts = pairs.filter((pair) => !pair.element).length;
  const missing = manifest && cuts.length > 0 ? Math.max(0, manifest.elements.length - cuts.length) : 0;
  const ready = Boolean(manifest) && cuts.length > 0 && extraCuts === 0 && missing === 0;

  async function save() {
    if (!manifest || !ready) return;
    setBusy("Elementlar qo‘shilmoqda…");
    setProblem(null);
    try {
      const added = await appendManifest(familyId, manifestToFamily(manifest));

      // The append returns a count, so the ids come from a read. Matched by
      // canonical name, which is unique within a family and is the same string
      // the manifest was written with.
      const ids = await elementIdsByName(familyId);
      const cutouts: Cutout[] = [];
      for (const { cut: entry, element } of pairs) {
        const id = element ? ids.get(element.canonicalName) : undefined;
        if (id && element) cutouts.push({ elementId: id, pixels: entry.pixels, recolorable: element.recolorable });
      }

      await attachCuts(familySlug, accent, cutouts, (done, total) => {
        setBusy(`Rasmlar biriktirilmoqda… ${done}/${total}`);
      });

      cuts.forEach((entry) => URL.revokeObjectURL(entry.url));
      setSource("");
      setCuts([]);
      setOpen(false);
      onAdded(added);
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Kengaytirish</h2>
          <p className="panel-hint">
            Avval manifestni joylang, so‘ng o‘sha varaqning PNG faylini tanlang. Elementlar
            faqat ikkalasi ham tayyor bo‘lganda — nomlari va rasmlari bilan birga — yaratiladi.
            Mavjud elementlarga tegilmaydi.
          </p>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => setOpen((value) => !value)}>
          <Plus size={15} /> {open ? "Yopish" : "Varaq qo‘shish"}
        </button>
      </div>

      {open ? (
        <>
          <ol className="import-steps">
            <li className={manifest ? "is-done" : ""}>1. Manifest</li>
            <li className={cuts.length > 0 ? "is-done" : ""}>2. Rasm varag‘i</li>
            <li className={ready ? "is-done" : ""}>3. Yaratish</li>
          </ol>

          <textarea
            className="import-area"
            rows={8}
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

          {manifest ? (
            <>
              <div className="sheet-controls">
                <button
                  className="secondary-button compact"
                  type="button"
                  disabled={!!busy}
                  onClick={() => input.current?.click()}
                >
                  <Upload size={15} /> {cuts.length > 0 ? "Boshqa varaq" : "Varaq tanlash"}
                </button>
                <span className="sheet-accent">
                  {manifest.grid.columns}×{manifest.grid.rows} to‘r · {manifest.elements.length} ta element
                  {accent !== null ? (
                    <>
                      <i style={{ background: `hsl(${accent} 90% 45%)` }} />
                      {Math.round(accent)}°
                    </>
                  ) : null}
                </span>
              </div>

              <input
                ref={input}
                type="file"
                accept="image/png,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void cut(file);
                  event.target.value = "";
                }}
              />
            </>
          ) : null}

          {extraCuts > 0 ? (
            <p className="field-problem">
              {extraCuts} ta kesim ortiqcha — manifestda {manifest?.elements.length} ta element bor.
            </p>
          ) : null}

          {missing > 0 ? (
            <p className="field-problem">
              Varaqda {cuts.length} ta obyekt topildi, {manifest?.elements.length} ta kerak.
              Bo‘sh kataklar bo‘lsa, varaqni to‘ldiring yoki manifestdagi to‘rni to‘g‘rilang.
            </p>
          ) : null}

          {pairs.length > 0 ? (
            <div className="sheet-grid">
              {pairs.map(({ cut: entry, element }) => (
                <figure key={entry.index} className={element ? "" : "is-orphan"}>
                  <img src={entry.url} alt={element?.displayName ?? `${entry.index + 1}`} />
                  <figcaption>
                    <strong>{element?.displayName ?? "— mos element yo‘q —"}</strong>
                    <small>
                      {element?.canonicalName ?? `${entry.index + 1}-katak`}
                      {element?.group ? ` · ${element.group}` : ""}
                    </small>
                  </figcaption>
                </figure>
              ))}
            </div>
          ) : manifest ? (
            <ol className="element-list">
              {manifest.elements.map((element) => (
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
            disabled={!ready || !!busy}
            onClick={() => void save()}
          >
            <Plus size={16} /> {busy ?? "Elementlarni yaratish va rasmlarni biriktirish"}
          </button>
        </>
      ) : null}
    </section>
  );
}
