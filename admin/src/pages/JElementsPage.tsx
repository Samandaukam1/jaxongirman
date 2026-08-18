import {
  manifestToFamily, readManifest, SHEET_PROMPT, sheetExpansionPrompt,
} from "@jaxongirman/jelement";
import { Copy, Download, FileCode2, Plus, Search, Shapes, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, Modal, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, stamp } from "@/lib/format";
import { deleteFamily } from "@/lib/jelement";
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

  /**
   * Deletes a family and everything in it.
   *
   * Confirmed by name rather than by a bare "are you sure": the two buttons sit
   * side by side and one of them is recoverable. Naming what is about to go —
   * and how many elements go with it — is what tells the two apart at the
   * moment of clicking.
   *
   * The refusal, when a deck is still using something here, comes back from the
   * database naming the elements. It is shown as written.
   */
  async function remove(family: FamilyRow) {
    const confirmed = window.confirm(
      `«${family.name}» va uning ${family.element_count} ta elementi butunlay o‘chiriladi.\n\n`
      + "Rasm fayllari ham o‘chadi. Bu amalni qaytarib bo‘lmaydi.\n\n"
      + "Slaydlarda ishlatilayotgan element bo‘lsa, o‘chirish rad etiladi.",
    );
    if (!confirmed) return;

    setBusy(family.id); setError(null); setMessage(null);
    try {
      await deleteFamily(family.id);
      setMessage(`«${family.name}» o‘chirildi.`);
      await load();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
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
            <FileCode2 size={16} /> Varaq promti
          </button>
          <button className="secondary-button" type="button" onClick={() => setImportOpen(true)}>
            <Upload size={16} /> Manifestdan oila
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
              <button className="danger-button" type="button" disabled={busy === family.id} onClick={() => void remove(family)}>
                <Trash2 size={15} /> O‘chirish
              </button>
            </div>
          </article>
        ))}
      </div>
    )}

    {standardOpen ? <StandardModal onClose={() => setStandardOpen(false)} /> : null}
    {importOpen ? (
      <ManifestModal
        onClose={() => setImportOpen(false)}
        onSaved={(name) => { setMessage(`«${name}» yaratildi — endi rasm varag‘ini biriktiring.`); void load(); }}
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
      title="Varaq promti"
      description="Buni rasm modeliga bering. Ikkita narsa qaytadi: 4×3 to‘rda joylashgan shaffof PNG varaq va uni nomlaydigan JSON manifest. Ikkalasi ham kerak."
      onClose={onClose}
    >
      <CopyBlock text={SHEET_PROMPT} filename="jelement-sheet-prompt.txt" />
    </Modal>
  );
}

/**
 * A family, created from the manifest that came back with its sheet.
 *
 * This replaced a flow that asked a model to describe each object as boxes and
 * paths in an indented language of its own. That language nested by leading
 * spaces, chat flattens leading spaces, and the result was a library of empty
 * squares — so the description is JSON now, and it describes only what things
 * are called. The drawing is the render, attached afterwards.
 */
function ManifestModal({ onClose, onSaved }: { onClose: () => void; onSaved: (name: string) => void }) {
  const [source, setSource] = useState("");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const result = useMemo(() => (source.trim() ? readManifest(source) : null), [source]);

  async function save() {
    if (!result?.manifest) return;
    setSaving(true);
    setFailure(null);
    const { error } = await supabase.rpc("admin_save_jelement_family", {
      p_spec: manifestToFamily(result.manifest) as never,
      p_source_prompt: source,
    });
    setSaving(false);
    if (error) { setFailure(errorMessage(error)); return; }
    onSaved(result.manifest.family.name);
    onClose();
  }

  return (
    <Modal
      title="Manifestdan oila"
      description="Rasm modeli qaytargan JSON manifestni joylang. Oila va elementlar nomlari bilan yaratiladi; rasmlar keyin oila sahifasida biriktiriladi."
      onClose={onClose}
    >
      <textarea
        className="import-area"
        rows={12}
        value={source}
        onChange={(event) => setSource(event.target.value)}
        placeholder={'{\n  "family": { "name": "…", "slug": "…" },\n  "grid": { "columns": 4, "rows": 3 },\n  "elements": [ … ]\n}'}
      />

      {result && result.errors.length > 0 ? (
        <section className="diagnostics diagnostics-error">
          <h3>{result.errors.length} ta xato — saqlab bo‘lmaydi</h3>
          <ul>{result.errors.slice(0, 12).map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>
      ) : null}

      {result && result.warnings.length > 0 ? (
        <section className="diagnostics diagnostics-warning">
          <h3>{result.warnings.length} ta ogohlantirish</h3>
          <ul>{result.warnings.slice(0, 8).map((item, index) => <li key={index}>{item}</li>)}</ul>
        </section>
      ) : null}

      {result?.manifest ? (
        <section className="import-preview">
          <h3>{result.manifest.family.name}</h3>
          <p className="family-meta">
            {result.manifest.grid.columns}×{result.manifest.grid.rows} to‘r ·{" "}
            {result.manifest.elements.length} ta element
          </p>
          <ol className="element-list">
            {result.manifest.elements.map((element) => (
              <li key={element.cell}>
                <strong>{element.cell}. {element.displayName}</strong>
                <span className="family-meta">{element.canonicalName}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {failure ? <ErrorState message={failure} /> : null}

      <button
        className="primary-button"
        type="button"
        disabled={!result?.manifest || saving}
        onClick={() => void save()}
      >
        <Shapes size={16} /> {saving ? "Saqlanmoqda…" : "Oilani yaratish"}
      </button>
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

      setPrompt(sheetExpansionPrompt(
        { name: family.name, slug: family.slug, category: family.category, style: family.style },
        (data ?? []).map((row) => row.canonical_name),
        12,
      ));
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

