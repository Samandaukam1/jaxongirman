import {
  ANALYZER_PROMPT, compile, elementHealth, expansionPrompt, familyHealth,
  findDuplicates, findInternalDuplicates, type JElementFamily,
} from "@jaxongirman/jelement";
import { Copy, Download, FileCode2, Plus, Search, Shapes, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, Modal, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, stamp } from "@/lib/format";
import { navigate } from "@/lib/router";
import { supabase } from "@/lib/supabase";

/**
 * The JElement library.
 *
 * An admin gives a vision model a reference sheet and the standard prompt,
 * pastes what comes back, and reviews it before anything is published. The
 * review is the point: a specification is a machine's reading of a picture, and
 * the one thing it cannot check about itself is whether it saw the picture
 * correctly.
 *
 * So nothing here publishes on import. A pasted family lands as a draft with
 * its warnings visible, and publishing is a separate, deliberate act.
 */

type FamilyRow = {
  id: string;
  slug: string;
  name: string;
  category: string;
  style: string;
  status: "draft" | "published" | "archived";
  color_tokens: Record<string, string>;
  published_version: number;
  updated_at: string;
  element_count: number;
  usage_count: number;
};

const STATUS_LABEL: Record<FamilyRow["status"], string> = {
  draft: "Qoralama",
  published: "Nashr qilingan",
  archived: "Arxivlangan",
};

export function JElementsPage() {
  const [families, setFamilies] = useState<FamilyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | FamilyRow["status"]>("all");

  const [standardOpen, setStandardOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [expansionFor, setExpansionFor] = useState<FamilyRow | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error: listError } = await supabase.rpc("admin_list_jelement_families");
    if (listError) setError(errorMessage(listError));
    else { setFamilies((data ?? []) as unknown as FamilyRow[]); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return families.filter((family) => {
      if (statusFilter !== "all" && family.status !== statusFilter) return false;
      if (!needle) return true;
      return `${family.name} ${family.slug} ${family.category} ${family.style}`.toLowerCase().includes(needle);
    });
  }, [families, query, statusFilter]);

  const totals = useMemo(() => ({
    families: families.length,
    elements: families.reduce((sum, family) => sum + Number(family.element_count ?? 0), 0),
    published: families.filter((family) => family.status === "published").length,
    draft: families.filter((family) => family.status === "draft").length,
    usage: families.reduce((sum, family) => sum + Number(family.usage_count ?? 0), 0),
  }), [families]);

  async function publish(family: FamilyRow) {
    setBusy(family.id); setError(null); setMessage(null);
    const { error: publishError } = await supabase.rpc("admin_publish_jelement_family", { p_family_id: family.id });
    if (publishError) setError(errorMessage(publishError));
    else { setMessage(`«${family.name}» nashr qilindi.`); await load(); }
    setBusy(null);
  }

  async function archive(family: FamilyRow) {
    setBusy(family.id); setError(null); setMessage(null);
    const restore = family.status === "archived";
    const { error: archiveError } = await supabase.rpc("admin_archive_jelement_family", {
      p_family_id: family.id, p_restore: restore,
    });
    if (archiveError) setError(errorMessage(archiveError));
    else {
      // Archiving is not deletion: the decks that already use these elements
      // keep rendering from the versions they pinned.
      setMessage(restore ? `«${family.name}» qaytarildi.` : `«${family.name}» arxivlandi — mavjud taqdimotlar buzilmaydi.`);
      await load();
    }
    setBusy(null);
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="JELEMENT DESIGN ENGINE"
      title="JElement kutubxonasi"
      description="JSLAYD taqdimotlari uchun qayta ishlatiladigan, ranglanadigan va AI tomonidan semantik topiladigan vizual elementlar."
      action={
        <div className="header-actions">
          <button className="secondary-button" type="button" onClick={() => setStandardOpen(true)}>
            <FileCode2 size={16} /> JElement standarti
          </button>
          <button className="secondary-button" type="button" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Import
          </button>
        </div>
      }
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    <div className="stat-grid">
      <Stat label="Oilalar" value={totals.families} />
      <Stat label="Elementlar" value={totals.elements} />
      <Stat label="Nashr qilingan" value={totals.published} />
      <Stat label="Qoralama" value={totals.draft} />
      <Stat label="Ishlatilgan" value={totals.usage} />
    </div>

    <form className="toolbar" onSubmit={(event) => event.preventDefault()}>
      <div className="search-box">
        <Search size={18} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Oila, kategoriya yoki uslub…"
        />
      </div>
      <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
        <option value="all">Barcha holatlar</option>
        <option value="published">Nashr qilingan</option>
        <option value="draft">Qoralama</option>
        <option value="archived">Arxivlangan</option>
      </select>
    </form>

    {loading ? <TableSkeleton /> : visible.length === 0 ? (
      <section className="panel">
        <p className="panel-hint">
          Hozircha oila yo‘q. <strong>JElement standarti</strong>ni nusxalab, uni ChatGPT‘ga
          reference rasm bilan bering — qaytgan spetsifikatsiyani <strong>Import</strong> orqali joylang.
        </p>
      </section>
    ) : (
      <div className="family-grid">
        {visible.map((family) => (
          <article key={family.id} className="panel family-card">
            <header>
              <div>
                <h2>{family.name}</h2>
                <p className="family-meta">{family.category || "—"} · {family.style || "—"}</p>
              </div>
              <span className={`status-pill status-${family.status}`}>{STATUS_LABEL[family.status]}</span>
            </header>

            {/* The family's colour roles, which are what recolouring changes. */}
            <div className="token-row">
              {Object.entries(family.color_tokens ?? {}).slice(0, 8).map(([role, value]) => (
                <span key={role} className="token-swatch" title={`${role} ${value}`} style={{ background: value }} />
              ))}
            </div>

            <dl className="family-stats">
              <div><dt>Elementlar</dt><dd>{family.element_count}</dd></div>
              <div><dt>Versiya</dt><dd>{family.published_version || "—"}</dd></div>
              <div><dt>Ishlatilgan</dt><dd>{family.usage_count}</dd></div>
              <div><dt>Yangilangan</dt><dd>{stamp(family.updated_at)}</dd></div>
            </dl>

            <div className="family-actions">
              <button className="primary-button" type="button" onClick={() => navigate(`/jelements/${family.id}`)}>
                Ochish
              </button>
              {family.status !== "published" && family.status !== "archived" ? (
                <button className="secondary-button" type="button" disabled={busy === family.id} onClick={() => void publish(family)}>
                  Nashr qilish
                </button>
              ) : null}
              <button className="secondary-button" type="button" onClick={() => setExpansionFor(family)}>
                <Plus size={15} /> Elementlarni ko‘paytirish
              </button>
              <button className="secondary-button" type="button" disabled={busy === family.id} onClick={() => void archive(family)}>
                {family.status === "archived" ? "Qaytarish" : "Arxivlash"}
              </button>
            </div>
          </article>
        ))}
      </div>
    )}

    {standardOpen ? <StandardModal onClose={() => setStandardOpen(false)} /> : null}
    {importOpen ? (
      <ImportModal
        onClose={() => setImportOpen(false)}
        onSaved={(name) => { setMessage(`«${name}» qoralama sifatida saqlandi.`); void load(); }}
      />
    ) : null}
    {expansionFor ? (
      <ExpansionModal family={expansionFor} onClose={() => setExpansionFor(null)} />
    ) : null}
  </div>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="stat-card"><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong></div>;
}

/** Copyable text with the one affordance that matters: it actually copied. */
function CopyBlock({ text, filename }: { text: string; filename: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function download() {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return <>
    <div className="header-actions">
      <button className="primary-button" type="button" onClick={() => void copy()}>
        <Copy size={16} /> {copied ? "Nusxalandi" : "Nusxalash"}
      </button>
      <button className="secondary-button" type="button" onClick={download}>
        <Download size={16} /> .txt
      </button>
    </div>
    <pre className="prompt-block">{text}</pre>
  </>;
}

function StandardModal({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="JElement standarti"
      description="Bu promptni nusxalab, reference rasm bilan birga vision modelga bering. Qaytgan spetsifikatsiya Import orqali joylanadi."
      onClose={onClose}
    >
      <CopyBlock text={ANALYZER_PROMPT} filename="jelement-analyzer-v1.txt" />
    </Modal>
  );
}

function ExpansionModal({ family, onClose }: { family: FamilyRow; onClose: () => void }) {
  const [prompt, setPrompt] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      // The expansion prompt has to carry what already exists, or the analyzer
      // returns another excavator under a different name and the duplicate is
      // caught only after somebody spent the round trip.
      const { data, error } = await supabase
        .from("jelements")
        .select("canonical_name, semantic")
        .eq("family_id", family.id)
        .neq("status", "archived");

      if (!active) return;
      if (error) { setFailure(errorMessage(error)); return; }

      const shaped = {
        format: "JELEMENT" as const,
        version: "1.0",
        family: {
          name: family.name, slug: family.slug, category: family.category,
          subcategory: "", style: family.style, description: "",
        },
        visualDNA: {} as never,
        colorTokens: family.color_tokens ?? {},
        search: { keywords: [], industries: [], concepts: [] },
        elements: (data ?? []).map((row, index) => ({
          index,
          canonicalName: row.canonical_name,
          semantic: { aliases: ((row.semantic as { aliases?: string[] })?.aliases ?? []) },
        })),
      } as unknown as JElementFamily;

      setPrompt(expansionPrompt(shaped, 12));
    })();
    return () => { active = false; };
  }, [family]);

  return (
    <Modal
      title={`${family.name} — elementlarni ko‘paytirish`}
      description="Bu prompt oilaning mavjud elementlarini va rang rollarini olib yuradi, shuning uchun model borini takrorlamaydi."
      onClose={onClose}
    >
      {failure ? <ErrorState message={failure} /> : null}
      {prompt ? <CopyBlock text={prompt} filename={`${family.slug}-expansion.txt`} /> : <TableSkeleton />}
    </Modal>
  );
}

/**
 * Paste, read, review, save as a draft.
 *
 * The preview is not decoration. An analyzer's reading of a picture is a guess
 * about geometry, and the admin who has the picture in front of them is the
 * only one who can tell whether it was seen correctly — so every warning is
 * shown, and saving never publishes.
 */
function ImportModal({ onClose, onSaved }: { onClose: () => void; onSaved: (name: string) => void }) {
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [existing, setExisting] = useState<{ canonicalName: string; semantic: Record<string, unknown> }[]>([]);

  const result = useMemo(() => (source.trim() ? compile(source) : null), [source]);

  /**
   * What the family being imported already holds, when it is not new.
   *
   * An expansion returns siblings, and an analyzer that does not know an
   * excavator is taken will return another one under a different name. Checking
   * before the save is what makes the duplicate cost a click rather than
   * living in the library forever.
   */
  useEffect(() => {
    const slug = result?.family?.family.slug;
    if (!slug) { setExisting([]); return; }

    let active = true;
    void (async () => {
      const { data } = await supabase
        .from("jelements")
        .select("canonical_name, semantic, jelement_families!inner(slug)")
        .eq("jelement_families.slug", slug)
        .neq("status", "archived");

      if (!active) return;
      setExisting((data ?? []).map((row) => ({
        canonicalName: (row as { canonical_name: string }).canonical_name,
        semantic: (row as { semantic: Record<string, unknown> }).semantic ?? {},
      })));
    })();
    return () => { active = false; };
  }, [result?.family?.family.slug]);

  const duplicates = useMemo(() => {
    if (!result?.family) return [];
    const shaped = result.family.elements.map((element) => ({
      canonicalName: element.canonicalName, semantic: element.semantic,
    }));
    const shapedExisting = existing.map((row) => ({
      canonicalName: row.canonicalName,
      semantic: {
        aliases: [], uzbekTerms: [], englishTerms: [], russianTerms: [],
        industries: [], concepts: [], actions: [], contexts: [],
        ...(row.semantic as object),
      },
    })) as never;

    return [
      ...findInternalDuplicates(shaped as never),
      ...findDuplicates(shaped as never, shapedExisting),
    ];
  }, [result, existing]);

  async function save() {
    if (!result?.family) return;
    setSaving(true); setFailure(null);
    const { error } = await supabase.rpc("admin_save_jelement_family", {
      p_spec: result.family as never,
      p_source_prompt: source,
    });
    setSaving(false);
    if (error) { setFailure(errorMessage(error)); return; }
    onSaved(result.family.family.name);
    onClose();
  }

  return (
    <Modal
      title="JElement import"
      description="Vision model qaytargan spetsifikatsiyani joylang. Tekshiruvdan o‘tgach qoralama sifatida saqlanadi — nashr alohida qadam."
      onClose={onClose}
    >
      <textarea
        className="import-area"
        rows={12}
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder="JELEMENT-FAMILY 1.0&#10;&#10;[FAMILY]&#10;name: …"
      />

      {result ? (
        <div className="import-report">
          {result.diagnostics.errors.length > 0 ? (
            <section className="diagnostics diagnostics-error">
              <h3>{result.diagnostics.errors.length} ta xato — saqlab bo‘lmaydi</h3>
              <ul>
                {result.diagnostics.errors.slice(0, 12).map((item, index) => (
                  <li key={`${item.code}-${index}`}>
                    <strong>{item.message}</strong>
                    {item.hint ? <span> {item.hint}</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {duplicates.length > 0 ? (
            <section className="diagnostics diagnostics-warning">
              <h3>{duplicates.length} ta ehtimoliy takror</h3>
              <ul>
                {duplicates.map((match, index) => (
                  <li key={`${match.candidate}-${index}`}>
                    <strong>{match.candidate}</strong> ↔ {match.existing}
                    <span> {match.reason}</span>
                  </li>
                ))}
              </ul>
              {/* A warning, not a refusal: two similar names are sometimes two
                  objects, and the admin has the reference sheet in front of
                  them. Saving is still allowed. */}
            </section>
          ) : null}

          {result.diagnostics.warnings.length > 0 ? (
            <section className="diagnostics diagnostics-warning">
              <h3>{result.diagnostics.warnings.length} ta ogohlantirish</h3>
              <ul>
                {result.diagnostics.warnings.slice(0, 12).map((item, index) => (
                  <li key={`${item.code}-${index}`}>{item.message}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {result.family ? (
            <section className="import-preview">
              <h3>{result.family.family.name}</h3>
              <p className="family-meta">
                {result.family.family.category} · {result.family.family.style} ·
                {" "}{result.family.elements.length} ta element ·
                {" "}<strong>{familyHealth(result.family).score}/100</strong>
              </p>
              <div className="token-row">
                {Object.entries(result.family.colorTokens).map(([role, value]) => (
                  <span key={role} className="token-swatch" title={`${role} ${value}`} style={{ background: value }} />
                ))}
              </div>
              {/* The score is a way of sorting; the deductions are what an
                  admin can act on, so those are what is shown. A total on its
                  own says something is wrong and never says what. */}
              <ol className="element-list">
                {result.family.elements.map((element) => {
                  const health = elementHealth(element, result.family!);
                  return (
                    <li key={element.canonicalName}>
                      <strong>{element.canonicalName}</strong>
                      <span className={health.score >= 85 ? "health-good" : health.score >= 65 ? "health-fair" : "health-poor"}>
                        {health.score}/100 · {element.geometry.components.length} komponent
                      </span>
                      {health.deductions.length > 0 ? (
                        <ul className="deduction-list">
                          {health.deductions.slice(0, 4).map((deduction, index) => (
                            <li key={`${deduction.dimension}-${index}`}>
                              −{deduction.points} {deduction.reason}
                              {deduction.fix ? <em> {deduction.fix}</em> : null}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            </section>
          ) : null}
        </div>
      ) : null}

      {failure ? <ErrorState message={failure} /> : null}

      <button
        className="primary-button"
        type="button"
        disabled={!result?.family || saving}
        onClick={() => void save()}
      >
        <Shapes size={16} /> {saving ? "Saqlanmoqda…" : "Qoralama sifatida saqlash"}
      </button>
    </Modal>
  );
}
