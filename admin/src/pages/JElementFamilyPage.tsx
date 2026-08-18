import {
  COLOR_TOKENS, elementHealth, previewMatrix,
  type ColorToken, type JElement, type JElementFamily,
} from "@jaxongirman/jelement";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { JElementPreview } from "@/components/JElementPreview";
import { JElementSheet } from "@/components/JElementSheet";
import { ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { navigate } from "@/lib/router";
import { supabase } from "@/lib/supabase";

/**
 * One family, drawn.
 *
 * The first place an element is actually visible. Everything here renders
 * through the same `renderElement` the server uses, so an admin looking at a
 * preview is looking at what a slide will get — a preview computed some other
 * way would quietly become a second opinion about the same geometry.
 *
 * Recolouring is live and local until saved: an accent dragged to a new value
 * repaints every element bound to it, immediately, which is the only way to
 * judge whether a palette works.
 */

type FamilyRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  style: string;
  status: string;
  color_tokens: Record<string, string>;
  visual_dna: Record<string, unknown>;
  published_version: number;
};

type ElementRow = {
  id: string;
  canonical_name: string;
  display_name: string;
  object_class: string;
  status: string;
  semantic: Record<string, unknown>;
  render_spec: JElement["geometry"] | null;
  usage_rules: Record<string, unknown>;
  transform_rules: Record<string, unknown>;
  usage_count: number;
  published_version: number;
  asset_path: string | null;
  asset_accent_hue: number | null;
  asset_variants: Record<string, string> | null;
};

/** The database row, in the shape the drawing code reads. */
function toElement(row: ElementRow): JElement {
  return {
    index: 0,
    canonicalName: row.canonical_name,
    // A row with a picture is drawn by the picture; one without is drawn by its
    // components, which is what the compiler defaulted it to.
    rendering: row.asset_path ? "asset" : "geometry",
    assetPath: row.asset_path,
    assetAccentHue: row.asset_accent_hue,
    assetVariants: row.asset_variants ?? {},
    displayName: row.display_name || row.canonical_name,
    objectClass: row.object_class as JElement["objectClass"],
    category: "",
    subcategory: "",
    semantic: {
      aliases: [], uzbekTerms: [], englishTerms: [], russianTerms: [],
      industries: [], concepts: [], actions: [], contexts: [],
      ...(row.semantic as object),
    } as JElement["semantic"],
    geometry: row.render_spec ?? {
      aspectRatio: 1,
      bounds: { x: 0, y: 0, width: 1, height: 1 },
      visualBounds: { x: 0, y: 0, width: 1, height: 1 },
      safeBounds: { x: 0, y: 0, width: 1, height: 1 },
      visualCenter: { x: 0.5, y: 0.5 },
      dominantAxis: "balanced",
      originalRotation: 0,
      naturalFacing: "neutral",
      anchors: {},
      components: [],
    },
    appearance: {
      materials: [], roughness: 0.5, metalness: 0.5, edgeSoftness: 0.3,
      shadowDirection: "", shadowSoftness: 0.5, highlightDirection: "", emissiveAreas: [],
    },
    usage: {
      slideRoles: [], bestFor: [], avoidFor: [],
      visualWeight: 5, detailDensity: 5, recommendedMaxSlideCoverage: 0.45,
      ...(row.usage_rules as object),
    } as JElement["usage"],
    transform: {
      scalable: true, rotatable: true, recolorable: true, opacityEditable: true,
      flipHorizontal: true, flipVertical: false, freeTransform: false,
      ...(row.transform_rules as object),
    } as JElement["transform"],
  };
}

export function JElementFamilyPage({ familyId }: { familyId: string }) {
  const [family, setFamily] = useState<FamilyRow | null>(null);
  const [elements, setElements] = useState<ElementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  /** Local until saved, so a palette can be judged before it is committed. */
  const [tokens, setTokens] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [familyResult, elementResult] = await Promise.all([
      supabase.from("jelement_families").select("*").eq("id", familyId).maybeSingle(),
      supabase.from("jelements").select("*").eq("family_id", familyId).order("position"),
    ]);

    const failure = familyResult.error ?? elementResult.error;
    if (failure) setError(errorMessage(failure));
    else {
      const row = familyResult.data as unknown as FamilyRow;
      setFamily(row);
      setTokens({ ...(row?.color_tokens ?? {}) });
      setElements((elementResult.data ?? []) as unknown as ElementRow[]);
      setError(null);
    }
    setLoading(false);
  }, [familyId]);

  useEffect(() => { void load(); }, [load]);

  const asFamily = useMemo<JElementFamily | null>(() => family ? {
    format: "JELEMENT",
    version: "1.0",
    family: {
      name: family.name, slug: family.slug, category: family.category,
      subcategory: "", style: family.style, description: "",
    },
    visualDNA: family.visual_dna as JElementFamily["visualDNA"],
    colorTokens: tokens as JElementFamily["colorTokens"],
    search: { keywords: [], industries: [], concepts: [] },
    elements: [],
  } : null, [family, tokens]);

  const dirty = useMemo(
    () => family ? JSON.stringify(tokens) !== JSON.stringify(family.color_tokens) : false,
    [family, tokens],
  );

  async function saveColours() {
    if (!family) return;
    setSaving(true); setError(null); setMessage(null);

    // Colours are the family's, so this touches the family row and nothing
    // else: every element bound to a role follows automatically, which is the
    // whole reason the roles exist.
    const { error: saveError } = await supabase.rpc("admin_recolor_jelement_family", {
      p_family_id: family.id,
      p_color_tokens: tokens as never,
    });

    if (saveError) setError(errorMessage(saveError));
    else { setMessage("Ranglar saqlandi — barcha bog'langan elementlar yangilandi."); await load(); }
    setSaving(false);
  }

  if (loading) return <TableSkeleton />;
  if (!family || !asFamily) return <ErrorState message="Oila topilmadi." onRetry={() => void load()} />;

  const chosen = elements.find((row) => row.id === selected) ?? null;

  return <div className="page-stack">
    <PageHeader
      eyebrow="JELEMENT"
      title={family.name}
      description={`${family.category || "—"} · ${family.style || "—"} · ${elements.length} ta element`}
      action={
        <button className="secondary-button" type="button" onClick={() => navigate("/jelements")}>
          <ArrowLeft size={16} /> Kutubxona
        </button>
      }
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    {/* Recolouring, live. A palette cannot be judged from hex strings. */}
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">RANG ROLLARI</p><h2>Palitra</h2></div>
        {dirty ? (
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={() => setTokens({ ...family.color_tokens })}>
              <RotateCcw size={15} /> Bekor qilish
            </button>
            <button className="primary-button" type="button" disabled={saving} onClick={() => void saveColours()}>
              {saving ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </div>
        ) : null}
      </div>

      <div className="token-editor">
        {COLOR_TOKENS.filter((role) => tokens[role] !== undefined).map((role) => (
          <label key={role} className="token-field">
            <span>{role}</span>
            <input
              type="color"
              value={tokens[role] ?? "#000000"}
              onChange={(event) => setTokens({ ...tokens, [role]: event.target.value.toUpperCase() })}
            />
            <code>{tokens[role]}</code>
          </label>
        ))}
      </div>
    </section>

    {family ? (
      <JElementSheet
        familySlug={family.slug}
        elements={elements.map((row) => ({
          id: row.id,
          canonicalName: row.canonical_name,
          displayName: row.display_name || row.canonical_name,
        }))}
        onDone={(text) => { setMessage(text); void load(); }}
      />
    ) : null}

    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">ELEMENTLAR</p><h2>{elements.length} ta</h2></div>
      </div>

      <div className="element-grid">
        {elements.map((row) => {
          const element = toElement(row);
          const health = elementHealth(element, asFamily);
          return (
            <button
              key={row.id}
              type="button"
              className={`element-card ${selected === row.id ? "is-selected" : ""}`}
              onClick={() => setSelected(selected === row.id ? null : row.id)}
            >
              <JElementPreview element={element} family={asFamily} size={128} />
              <strong>{row.display_name || row.canonical_name}</strong>
              <span className="family-meta">{row.canonical_name}</span>
              <span className={health.score >= 85 ? "health-good" : health.score >= 65 ? "health-fair" : "health-poor"}>
                {health.score}/100
              </span>
            </button>
          );
        })}
      </div>
    </section>

    {chosen ? <ElementDetail row={chosen} family={asFamily} /> : null}
  </div>;
}

/**
 * One element, at every size and angle it will meet.
 *
 * Two grounds, three sizes, four rotations — the conditions under which detail
 * disappears and a colour binding turns out wrong, none of which show up
 * looking at one large preview on white.
 */
function ElementDetail({ row, family }: { row: ElementRow; family: JElementFamily }) {
  const element = useMemo(() => toElement(row), [row]);
  const health = useMemo(() => elementHealth(element, family), [element, family]);
  const matrix = useMemo(() => previewMatrix(), []);

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{row.canonical_name}</p>
          <h2>{row.display_name || row.canonical_name}</h2>
        </div>
        <span className={health.score >= 85 ? "health-good" : health.score >= 65 ? "health-fair" : "health-poor"}>
          {health.score}/100
        </span>
      </div>

      <div className="preview-matrix">
        {matrix.map((entry, index) => (
          <figure key={`${entry.background}-${entry.size}-${entry.rotation}-${index}`}>
            <JElementPreview
              element={element}
              family={family}
              size={entry.size}
              rotation={entry.rotation}
              background={entry.background}
            />
            <figcaption>{entry.size}px · {entry.rotation}°</figcaption>
          </figure>
        ))}
      </div>

      {health.deductions.length > 0 ? (
        <section className="diagnostics diagnostics-warning">
          <h3>Nimalarni yaxshilash mumkin</h3>
          <ul>
            {health.deductions.map((deduction, index) => (
              <li key={`${deduction.dimension}-${index}`}>
                −{deduction.points} {deduction.reason}
                {deduction.fix ? <span> {deduction.fix}</span> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <p className="panel-hint">Bu elementda tuzatiladigan narsa topilmadi.</p>
      )}
    </section>
  );
}

export type { ColorToken };
