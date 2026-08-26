import {
  IMAGE_ROLES, THEME_FAMILIES, auditFamily, extractPalette, harmonise, themePalette, veilFor,
  type ColorFamily, type ImagePalette, type JslaydDocument,
} from "@jaxongirman/jslayd";
import { Check, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { applyTheme, removeTheme, themeCode } from "@/lib/studioEdit";

/**
 * Sixteen ready-made palettes, and what a photograph does to one.
 *
 * A theme is not a preview setting. The renderer draws whichever named family
 * the document carries, so applying one writes it into the design — where it
 * saves, publishes and reaches the user app — rather than tinting this canvas
 * in a way that vanishes on reload and never existed for anybody else.
 *
 * Every palette is audited for contrast before it can be applied, and a failing
 * one says which pair fails and by how much. That check is the reason the
 * families are only partly authored: four or five roles are chosen and the rest
 * derived, so there is no way to hand-pick a surface that cannot hold its own
 * text.
 */

type Props = {
  document: JslaydDocument;
  /** The family code currently being drawn, or null for the design's own. */
  family: string | null;
  /** A photograph on the sample slide, when there is one. */
  photoUrl: string | null;
  onFamily: (code: string | null) => void;
  onChange: (next: JslaydDocument) => void;
  /** Applies a veil to whichever image slots the shown blueprint draws. */
  onVeil: (veil: string, opacity: number) => void;
};

export function StudioThemes({ document: design, family, photoUrl, onFamily, onChange, onVeil }: Props) {
  const [familyId, setFamilyId] = useState<string>(THEME_FAMILIES[0]?.id ?? "");
  const [variantId, setVariantId] = useState<string>(THEME_FAMILIES[0]?.variants[0]?.id ?? "");
  const [image, setImage] = useState<ImagePalette | null>(null);
  const [harmonised, setHarmonised] = useState<ReturnType<typeof harmonise> | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const chosen = THEME_FAMILIES.find((entry) => entry.id === familyId) ?? THEME_FAMILIES[0];
  // Memoised because the effect below depends on it: `?? []` is a fresh array
  // every render, which would re-run the effect on every keystroke elsewhere.
  const variants = useMemo(() => chosen?.variants ?? [], [chosen]);

  // A family change leaves the old variant id pointing at nothing.
  useEffect(() => {
    if (!variants.some((entry) => entry.id === variantId)) setVariantId(variants[0]?.id ?? "");
  }, [variantId, variants]);

  const palette = useMemo(
    () => (familyId && variantId ? themePalette(familyId, variantId) : null),
    [familyId, variantId],
  );

  // What would actually be applied: the palette, or the palette after the
  // photograph has had its say.
  const effective: ColorFamily | null = harmonised?.colors ?? palette;
  const problems = useMemo(() => (effective ? auditFamily(effective) : []), [effective]);

  const code = familyId && variantId ? themeCode(familyId, variantId) : null;
  const applied = code ? (design.colorFamilies ?? []).some((entry) => entry.code === code) : false;

  // The photograph is the sample's, so a new sample invalidates what was read
  // from the old one — otherwise the palette on screen belongs to a picture
  // nobody is looking at any more.
  useEffect(() => { setImage(null); setHarmonised(null); }, [photoUrl]);

  /**
   * What it takes to put words on this photograph.
   *
   * Text over an image is the one place where the picture wins by default and
   * the words lose, and it loses silently: the contrast check reads the
   * design's colours, which say nothing about the photograph behind them. This
   * answers with the ink that reads better and the scrim that gets it over 4.5.
   */
  const veil = useMemo(() => (image ? veilFor(image) : null), [image]);

  /**
   * Reading a photograph's colours, in the browser that is showing it.
   *
   * Drawn small on purpose: a palette is a handful of dominant hues, and
   * sampling four megapixels to find them is four megapixels of work for the
   * same five colours. 160 across keeps every region that matters.
   */
  async function readPhoto() {
    if (!photoUrl) return;
    setProblem(null);
    try {
      const pixels = await pixelsOf(photoUrl);
      const found = extractPalette(pixels);
      setImage(found);
      if (palette) setHarmonised(harmonise(palette, found, IMAGE_ROLES));
    } catch {
      // Almost always the photo host refusing a cross-origin read. Said plainly,
      // because "failed" would send somebody looking for a bug in the extractor.
      setProblem("Surat ranglari o‘qilmadi — manba brauzerga ruxsat bermadi.");
    }
  }

  return (
    <div className="studio-themes">
      <div className="studio-theme-pickers">
        <label className="studio-field">
          <span>Tema oilasi</span>
          <select value={familyId} onChange={(event) => setFamilyId(event.target.value)}>
            {THEME_FAMILIES.map((entry) => (
              <option key={entry.id} value={entry.id}>{entry.name}</option>
            ))}
          </select>
        </label>
        <label className="studio-field">
          <span>Variant</span>
          <select value={variantId} onChange={(event) => setVariantId(event.target.value)}>
            {variants.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
      </div>
      {chosen ? <p className="studio-note">{chosen.description}</p> : null}

      {effective ? <Swatches colors={effective} /> : null}

      {problems.length ? (
        <div className="studio-fit-report" role="status">
          <strong>Kontrast yetarli emas</strong>
          <ul>{problems.map((entry) => <li key={entry}>{entry}</li>)}</ul>
        </div>
      ) : null}

      {photoUrl ? (
        <div className="studio-theme-actions">
          <button type="button" className="secondary-button compact" onClick={() => void readPhoto()}>
            <Wand2 size={15} strokeWidth={1.9} /> Suratga moslash
          </button>
          {harmonised ? (
            <span className="studio-note">
              {harmonised.applied.length
                ? `${harmonised.applied.join(", ")} suratdan olindi`
                : "Suratdan hech narsa olinmadi"}
              {harmonised.rejected.length
                ? ` · rad etildi: ${harmonised.rejected.map((entry) => `${entry.role} (${entry.reason})`).join(", ")}`
                : ""}
            </span>
          ) : null}
          {image && !harmonised ? <span className="studio-note">Avval variant tanlang.</span> : null}
        </div>
      ) : null}

      {veil ? (
        <div className="studio-theme-actions">
          <span className="studio-note">
            Bu surat ustidagi matn {veil.ink === "#FFFFFF" ? "oq" : "qora"} bo‘lsin
            {veil.opacity > 0
              ? ` va ${Math.round(veil.opacity * 100)}% ${veil.veil === "#000000" ? "qora" : "oq"} qoplama kerak.`
              : " — qoplamasiz ham o‘qiladi."}
          </span>
          {veil.opacity > 0 ? (
            <button
              type="button"
              className="secondary-button compact"
              onClick={() => onVeil(veil.veil, veil.opacity)}
            >
              Qoplamani qo‘yish
            </button>
          ) : null}
        </div>
      ) : null}

      {problem ? <p className="studio-layer-error">{problem}</p> : null}

      <div className="studio-theme-actions">
        <button
          type="button"
          className="primary-button compact"
          // A palette that cannot hold its own text is not a palette this design
          // should carry, and refusing it here is cheaper than finding out in a
          // customer's deck.
          disabled={!effective || !code || problems.length > 0}
          onClick={() => {
            if (!effective || !code || !chosen) return;
            const variant = variants.find((entry) => entry.id === variantId);
            const name = `${chosen.name} · ${variant?.name ?? variantId}`;
            onChange(applyTheme(design, code, name, effective));
            onFamily(code);
          }}
        >
          {applied ? <><Check size={15} strokeWidth={2} /> Yangilash</> : "Dizaynga qo‘shish"}
        </button>

        {applied && code ? (
          <button
            type="button"
            className="secondary-button compact"
            onClick={() => {
              onChange(removeTheme(design, code));
              if (family === code) onFamily(null);
            }}
          >
            Olib tashlash
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Swatches({ colors }: { colors: ColorFamily }) {
  const shown = ["background", "surface", "primary", "secondary", "accent", "text"] as const;
  return (
    <div className="studio-swatches">
      {shown.map((role) => (
        <span key={role} title={`${role} · ${colors[role]}`}>
          <i style={{ background: colors[role] }} />
          {role}
        </span>
      ))}
    </div>
  );
}

/**
 * A photograph's pixels, without asking the server for them again.
 *
 * `crossOrigin` is what makes the canvas readable: without it the draw succeeds
 * and `getImageData` throws, which reads as a bug in the extractor rather than
 * as a permission the host did not grant.
 */
function pixelsOf(url: string): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.crossOrigin = "anonymous";
    picture.onerror = () => reject(new Error("image_unreadable"));
    picture.onload = () => {
      const width = 160;
      const height = Math.max(1, Math.round((picture.naturalHeight / picture.naturalWidth) * width));
      const canvas = window.document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;

      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) { reject(new Error("no_canvas")); return; }
      context.drawImage(picture, 0, 0, width, height);
      try {
        resolve(context.getImageData(0, 0, width, height).data);
      } catch {
        reject(new Error("tainted"));
      }
    };
    picture.src = url;
  });
}
