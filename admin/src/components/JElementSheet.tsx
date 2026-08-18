import {
  dominantHue, hexToHsl, recolour, sliceSheet, type Pixels,
} from "@jaxongirman/jelement";
import { Scissors, Upload } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

import { errorMessage } from "@/lib/format";
import { attachAsset, deckAccents, uploadElementAsset } from "@/lib/jelement";

/**
 * A reference sheet, cut into the library's elements.
 *
 * The alternative was asking an analyzer to describe a studio render as boxes
 * and paths, and it produced twelve objects nobody could identify. That is a
 * limit of the format rather than of the model: a lit, shadowed, physically
 * plausible object is not a stack of rectangles, and writing a better prompt
 * cannot make it one.
 *
 * So the render itself becomes the element. Nothing here draws anything — the
 * pixels that arrive are the pixels that ship, cut apart and shifted in hue,
 * which is why an element still recolours with the deck it lands on.
 *
 * The whole operation runs in this tab. That is not a shortcut: the browser
 * already has an image decoder and a canvas, and doing it here means no image
 * library on the server and no round trip per variant.
 */

type Cut = { index: number; pixels: Pixels; url: string };

/** Reads a file into raw pixels, which is the only form the rules understand. */
async function pixelsOf(file: File): Promise<Pixels> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Brauzer canvas kontekstini bermadi.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return { width: image.width, height: image.height, data: image.data };
}

/** Back to a PNG, with its transparency intact. */
async function toPng(pixels: Pixels): Promise<Blob> {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Brauzer canvas kontekstini bermadi.");
  // Built through the context rather than `new ImageData(...)`: the constructor
  // insists on a buffer it owns, and these bytes came out of a crop.
  const image = context.createImageData(pixels.width, pixels.height);
  image.data.set(pixels.data);
  context.putImageData(image, 0, 0);
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("PNG yaratilmadi."))), "image/png");
  });
}

export function JElementSheet({
  familySlug,
  elements,
  onDone,
}: {
  familySlug: string;
  /** In the order the analyzer returned them, which is the sheet's reading order. */
  elements: { id: string; canonicalName: string; displayName: string }[];
  onDone: (message: string) => void;
}) {
  const [columns, setColumns] = useState(4);
  const [rows, setRows] = useState(3);
  const [sheet, setSheet] = useState<Pixels | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [accent, setAccent] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const slice = useCallback(async (pixels: Pixels, across: number, down: number) => {
    // Revoked before they are replaced: a preview URL held after its blob is
    // dropped is a leak that only shows up after twenty re-cuts.
    setCuts((previous) => { previous.forEach((cut) => URL.revokeObjectURL(cut.url)); return []; });

    const pieces = sliceSheet(pixels, across, down);
    const next: Cut[] = [];
    for (let index = 0; index < pieces.length; index += 1) {
      const piece = pieces[index];
      if (!piece) continue;
      next.push({ index, pixels: piece, url: URL.createObjectURL(await toPng(piece)) });
    }
    setCuts(next);
    setAccent(dominantHue(pixels));
  }, []);

  async function read(file: File) {
    setProblem(null);
    setBusy("O‘qilmoqda…");
    try {
      const pixels = await pixelsOf(file);
      setSheet(pixels);
      await slice(pixels, columns, rows);
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  async function recut(across: number, down: number) {
    setColumns(across);
    setRows(down);
    if (!sheet) return;
    setBusy("Kesilmoqda…");
    try {
      await slice(sheet, across, down);
    } finally {
      setBusy(null);
    }
  }

  /**
   * What the cuts will be matched against.
   *
   * The nth object on the sheet becomes the nth element, because that is the
   * order the analyzer prompt asks for and the order the specification was
   * written in. Shown rather than assumed: a mismatch here is somebody's whole
   * library silently mislabelled, and it costs one glance to catch.
   */
  const pairs = useMemo(
    () => cuts.map((cut) => ({ cut, element: elements[cut.index] ?? null })),
    [cuts, elements],
  );

  const unmatched = pairs.filter((pair) => !pair.element).length;

  async function save() {
    setBusy("Saqlanmoqda…");
    setProblem(null);
    try {
      /**
       * The colours a deck can actually ask for.
       *
       * Read from the published designs rather than invented, so the variants
       * that get made are exactly the ones something will request — and no
       * more. Twelve elements against forty guessed hues would be five hundred
       * files nobody fetches.
       */
      const targets = await deckAccents();

      let saved = 0;
      for (const { cut, element } of pairs) {
        if (!element) continue;

        const master = await uploadElementAsset(familySlug, element.id, "master", await toPng(cut.pixels));

        const variants: Record<string, string> = {};
        if (accent !== null) {
          for (const target of targets) {
            const parsed = hexToHsl(target);
            if (!parsed) continue;
            const hue = Math.round(parsed[0]);
            // Already this colour. Serving the original is both cheaper and
            // better: it has never been through a recolour.
            if (Math.abs(((hue - accent + 540) % 360) - 180) <= 20) continue;
            const shifted = recolour(cut.pixels, accent, hue);
            variants[String(hue)] = await uploadElementAsset(
              familySlug, element.id, String(hue), await toPng(shifted),
            );
          }
        }

        await attachAsset({
          elementId: element.id,
          assetPath: master,
          accentHue: accent,
          variants,
          aspectRatio: cut.pixels.width / cut.pixels.height,
        });
        saved += 1;
        setBusy(`Saqlanmoqda… ${saved}/${pairs.length}`);
      }

      onDone(`${saved} ta elementga rasm biriktirildi.`);
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
          <h2>Rasm varag‘i</h2>
          <p className="panel-hint">
            Generatsiya qilingan shaffof PNG varaqni yuklang. U to‘rga bo‘linadi, har bir obyekt
            o‘z chegarasigacha qirqiladi va elementlarga o‘qish tartibida biriktiriladi — chapdan
            o‘ngga, yuqoridan pastga. Rasm qayta chizilmaydi: qanday kelsa, shunday saqlanadi.
          </p>
        </div>
        <button className="secondary-button compact" type="button" onClick={() => input.current?.click()}>
          <Upload size={15} /> Varaq tanlash
        </button>
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,image/webp"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = "";
        }}
      />

      {problem ? <p className="field-problem">{problem}</p> : null}

      {sheet ? (
        <>
          <div className="sheet-controls">
            <label>
              Ustun
              <input
                type="number" min={1} max={8} value={columns}
                onChange={(event) => void recut(Number(event.target.value) || 1, rows)}
              />
            </label>
            <label>
              Qator
              <input
                type="number" min={1} max={8} value={rows}
                onChange={(event) => void recut(columns, Number(event.target.value) || 1)}
              />
            </label>
            <span className="sheet-accent">
              {accent === null ? (
                "Aksent rangi topilmadi — rang almashtirish ishlamaydi."
              ) : (
                <>
                  Aksent rangi topildi
                  <i style={{ background: `hsl(${accent} 90% 45%)` }} />
                  {Math.round(accent)}°
                </>
              )}
            </span>
          </div>

          {unmatched > 0 ? (
            // Said before saving, not after: an extra cut means the grid is
            // wrong, and a wrong grid mislabels the whole family.
            <p className="field-problem">
              {unmatched} ta kesim ortiqcha — spetsifikatsiyada {elements.length} ta element bor.
              To‘r o‘lchamini to‘g‘rilang.
            </p>
          ) : null}

          <div className="sheet-grid">
            {pairs.map(({ cut, element }) => (
              <figure key={cut.index} className={element ? "" : "is-orphan"}>
                <img src={cut.url} alt={element?.displayName ?? `${cut.index + 1}`} />
                <figcaption>
                  <strong>{element?.displayName ?? "— mos element yo‘q —"}</strong>
                  <small>{element?.canonicalName ?? `${cut.index + 1}-katak`}</small>
                </figcaption>
              </figure>
            ))}
          </div>

          <button
            className="primary-button"
            type="button"
            disabled={!!busy || cuts.length === 0 || unmatched > 0}
            onClick={() => void save()}
          >
            <Scissors size={16} /> {busy ?? "Kesib saqlash va ranglarni tayyorlash"}
          </button>
        </>
      ) : null}
    </section>
  );
}
