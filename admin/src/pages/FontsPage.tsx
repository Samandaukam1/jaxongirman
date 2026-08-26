import type { Database } from "@jaxongirman/types";
import { Check, Search, Star, Type } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type FamilyRow = Database["public"]["Tables"]["font_families"]["Row"];
type FaceRow = Database["public"]["Tables"]["font_faces"]["Row"];
type Family = FamilyRow & { font_faces: FaceRow[] };

const CATEGORIES = [
  { key: "", label: "Barchasi" },
  { key: "sans-serif", label: "Sans Serif" },
  { key: "serif", label: "Serif" },
  { key: "display", label: "Display" },
  { key: "handwriting", label: "Handwriting" },
  { key: "monospace", label: "Monospace" },
] as const;

const PAGE = 48;
const DEFAULT_PREVIEW = "Jaxongirman — professional taqdimotlar";

/**
 * The public read URL of a face.
 *
 * `design-fonts` is a public bucket, so a face has a stable URL and the browser
 * can load it as a `FontFace` directly. Signing every preview would mean a round
 * trip per card before a single word could be drawn in its own typeface.
 */
function faceUrl(path: string): string {
  const base = import.meta.env.VITE_SUPABASE_URL as string;
  return `${base}/storage/v1/object/public/design-fonts/${path}`;
}

/** The face a preview should use: the upright one nearest a normal weight. */
function previewFace(faces: FaceRow[]): FaceRow | null {
  const upright = faces.filter((face) => !face.italic);
  const pool = upright.length > 0 ? upright : faces;
  return pool.slice().sort((a, b) => Math.abs(a.weight - 400) - Math.abs(b.weight - 400))[0] ?? null;
}

/**
 * Loads one family's face into the document, once, and says when it is ready.
 *
 * The browser is the cache: a `FontFace` added to `document.fonts` stays for the
 * life of the page, and the HTTP layer keeps the bytes beyond it. What this has
 * to avoid is asking for two thousand of them — hence the observer on the card,
 * which only calls this for the ones that have actually been scrolled to.
 */
const loading = new Map<string, Promise<boolean>>();

function loadFace(cssName: string, url: string, weight: number): Promise<boolean> {
  const known = loading.get(cssName);
  if (known) return known;

  const attempt = (async () => {
    try {
      const face = new FontFace(cssName, `url(${JSON.stringify(url)})`, { weight: String(weight) });
      await face.load();
      document.fonts.add(face);
      return true;
    } catch {
      return false;
    }
  })();
  loading.set(cssName, attempt);
  return attempt;
}

function FamilyCard({
  family, preview, onToggle,
}: { family: Family; preview: string; onToggle: (patch: { is_active?: boolean; is_featured?: boolean }) => void }) {
  const card = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [seen, setSeen] = useState(false);

  const face = useMemo(() => previewFace(family.font_faces ?? []), [family.font_faces]);
  const cssName = `jx-${family.normalized_name}`;

  // Only ask for the bytes once the card is near the viewport. Two thousand
  // cards asking on mount is two thousand requests for type nobody has looked at.
  useEffect(() => {
    const element = card.current;
    if (!element || seen) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { rootMargin: "300px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [seen]);

  useEffect(() => {
    if (!seen || !face) return;
    let alive = true;
    void loadFace(cssName, faceUrl(face.storage_path), face.weight)
      .then((ok) => { if (alive) setReady(ok); });
    return () => { alive = false; };
  }, [cssName, face, seen]);

  const cuts = (family.font_faces ?? [])
    .slice()
    .sort((a, b) => a.weight - b.weight || Number(a.italic) - Number(b.italic));

  return (
    <div className="font-card" ref={card}>
      <div className="font-card-top">
        <div>
          <strong>{family.canonical_name}</strong>
          <small>{family.category}{family.is_variable ? " · variable" : ""} · {cuts.length} ta ko‘rinish</small>
        </div>
        <div className="font-card-actions">
          <button
            className={`icon-toggle${family.is_featured ? " on" : ""}`}
            type="button"
            title={family.is_featured ? "Tavsiyadan olib tashlash" : "Tavsiya qilinganlarga qo‘shish"}
            onClick={() => onToggle({ is_featured: !family.is_featured })}
          >
            <Star size={15} />
          </button>
          <button
            className={`icon-toggle${family.is_active ? " on" : ""}`}
            type="button"
            title={family.is_active ? "Ilovada ko‘rinmasin" : "Ilovada ko‘rsatilsin"}
            onClick={() => onToggle({ is_active: !family.is_active })}
          >
            <Check size={15} />
          </button>
        </div>
      </div>

      {/* The point of the card. Until the face is in, a skeleton rather than the
          same sentence in the interface font pretending to be the answer. */}
      {ready
        ? <p className="font-preview" style={{ fontFamily: `"${cssName}", system-ui` }}>{preview}</p>
        : <span className="font-preview-skeleton" aria-label="Shrift yuklanmoqda" />}

      <div className="font-cuts">
        {cuts.map((cut) => (
          <span key={cut.id} className="font-cut">{cut.style_name} {cut.weight}{cut.italic ? "i" : ""}</span>
        ))}
      </div>
    </div>
  );
}

/**
 * The font shelf, as something a person can look through.
 *
 * Two thousand families is not a table. It is a wall of type, and the only way
 * to judge one is to see the same sentence set in it — which is why the preview
 * text is editable and why every card renders in its own face rather than in a
 * label saying what it would look like.
 */
export function FontsPage() {
  const [families, setFamilies] = useState<Family[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [preview, setPreview] = useState(DEFAULT_PREVIEW);
  const [page, setPage] = useState(0);
  const [done, setDone] = useState(false);
  const [loadingPage, setLoadingPage] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (nextPage: number, replace: boolean) => {
    setLoadingPage(true);
    let request = supabase
      .from("font_families")
      .select("*, font_faces(*)")
      .order("canonical_name")
      .range(nextPage * PAGE, nextPage * PAGE + PAGE - 1);
    if (category) request = request.eq("category", category);
    // Prefix, not `%term%`: it is what the index can answer, and it is what
    // somebody typing "mont" means.
    if (search) request = request.like("normalized_name", `${search}%`);

    const { data, error: requestError } = await request;
    if (requestError) setError(errorMessage(requestError));
    else {
      const rows = (data ?? []) as unknown as Family[];
      setError(null);
      setFamilies((current) => (replace ? rows : [...current, ...rows]));
      setDone(rows.length < PAGE);
    }
    setLoadingPage(false);
  }, [category, search]);

  useEffect(() => { setPage(0); void load(0, true); }, [load]);

  async function toggle(family: Family, patch: { is_active?: boolean; is_featured?: boolean }) {
    // Optimistic: the switch is the whole interaction, and waiting on a round
    // trip to move it makes the page feel like it did not hear the click.
    setFamilies((current) => current.map((row) => (row.id === family.id ? { ...row, ...patch } : row)));
    // Only the key being changed is sent. The function defaults the rest to
    // null and coalesces, so an absent key means "leave this as it is" — and
    // sending `undefined` would drop the key anyway, which is the trap
    // `rpc-arguments.test.mjs` exists to catch.
    const { error: writeError } = await supabase.rpc("admin_set_font_family", {
      p_family_id: family.id,
      ...(patch.is_active === undefined ? {} : { p_is_active: patch.is_active }),
      ...(patch.is_featured === undefined ? {} : { p_is_featured: patch.is_featured }),
    });
    if (writeError) {
      setError(errorMessage(writeError));
      setFamilies((current) => current.map((row) => (row.id === family.id ? family : row)));
    }
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="SHRIFTLAR"
      title="Shrift kutubxonasi"
      description="Google Fonts kutubxonasi. Yoqilgan oilalar ilovadagi shrift tanlagichida ko‘rinadi; qolganlari faqat shu yerda turadi."
    />

    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim().toLowerCase().replace(/[^a-z0-9]+/g, "")); }}>
      <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Shrift nomi bo‘yicha qidirish" /></div>
      <button className="secondary-button compact" type="submit">Qidirish</button>
    </form>

    <div className="toolbar" style={{ flexWrap: "wrap" }}>
      {CATEGORIES.map((entry) => (
        <button
          key={entry.key || "all"}
          className={`secondary-button compact${category === entry.key ? " selected" : ""}`}
          type="button"
          onClick={() => setCategory(entry.key)}
        >
          {entry.label}
        </button>
      ))}
    </div>

    <label className="preview-field">Namuna matni
      <input value={preview} onChange={(event) => setPreview(event.target.value)} placeholder={DEFAULT_PREVIEW} />
    </label>

    {error && <ErrorState message={error} onRetry={() => void load(0, true)} />}

    {loadingPage && families.length === 0 ? <TableSkeleton rows={6} /> : families.length === 0 ? (
      <EmptyState detail="Qidiruvga mos shrift topilmadi. Import skripti ishga tushirilganmi?" />
    ) : (
      <>
        <div className="font-grid">
          {families.map((family) => (
            <FamilyCard
              key={family.id}
              family={family}
              preview={preview || DEFAULT_PREVIEW}
              onToggle={(patch) => void toggle(family, patch)}
            />
          ))}
        </div>
        {!done && (
          <button
            className="secondary-button"
            type="button"
            disabled={loadingPage}
            onClick={() => { const next = page + 1; setPage(next); void load(next, false); }}
          >
            <Type size={15} /> {loadingPage ? "Yuklanmoqda…" : "Yana yuklash"}
          </button>
        )}
      </>
    )}
  </div>;
}
