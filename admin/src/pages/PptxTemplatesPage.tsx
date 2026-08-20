import { FileUp, Pencil, Rocket, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { PptxTemplateEditor } from "@/components/PptxTemplateEditor";
import { TemplateImport } from "@/components/TemplateImport";
import { archive, duplicate, publish, remove, restore } from "@/lib/design-actions";
import { dateTime, errorMessage } from "@/lib/format";
import { listDesigns, templateCoverUrl, type DesignRow, type DesignStatus } from "@/lib/jslayd";
import { useDismissable } from "@/lib/router";
import { TIER_LABELS, type Tier } from "@jaxongirman/jslayd";

/**
 * PowerPoint templates, which are not JSLAYD designs.
 *
 * They shared a screen because they share a table, and that was the wrong
 * reading of what they are. A JSLAYD design is a document an admin writes,
 * compiles and previews; nearly every control on that screen — the prompt, the
 * editor, the health score, the archetype count — is about authoring something.
 * A template is a file somebody else designed. Nothing is authored, nothing is
 * compiled, and the only questions worth asking are which subjects it suits,
 * what its pages are for, and whether it is published.
 *
 * The deeper reason is that they are two generation engines. A written design
 * is drawn from its document. A template is never drawn at all: the uploaded
 * package is the design, and a finished deck is that package with the chosen
 * slides kept and their words replaced. Two screens is the honest shape of it.
 */

export function PptxTemplatesPage() {
  const [items, setItems] = useState<DesignRow[]>([]);
  const [status, setStatus] = useState<DesignStatus | "all">("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listDesigns({
        status: status === "all" ? null : status,
        query,
        source: "pptx",
      }));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [query, status]);

  useEffect(() => { void load(); }, [load]);

  // Back closes the importer rather than leaving the section: it is React state
  // inside this page, so the browser never knew it opened.
  const closeImport = useCallback(() => { setImporting(false); void load(); }, [load]);
  const dismissImport = useDismissable(importing, closeImport);
  const closeEditor = useCallback(() => { setEditing(null); void load(); }, [load]);
  const dismissEditor = useDismissable(editing !== null, closeEditor);

  const sorted = useMemo(
    () => [...items].sort((first, second) =>
      new Date(second.updated_at).getTime() - new Date(first.updated_at).getTime()),
    [items],
  );

  if (importing) {
    return <TemplateImport onClose={dismissImport} onImported={() => { void load(); }} />;
  }

  if (editing) {
    return <PptxTemplateEditor designId={editing} onClose={dismissEditor} onSaved={() => { void load(); }} />;
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PPTX SHABLONLAR"
        title="PowerPoint shablonlar"
        description="Original PowerPoint fayllari. Jaxongir AI mavzuga mos sahifalarni tanlaydi va faqat matnlarni almashtiradi — dizayn, rasmlar va elementlar original holatda qoladi."
        action={
          <button className="primary-button" type="button" onClick={() => setImporting(true)}>
            <FileUp size={16} strokeWidth={1.9} /> Shablon yuklash
          </button>
        }
      />

      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Bu bo‘lim qanday ishlaydi</h2>
            <p className="panel-hint">
              Yuklangan <code>.pptx</code> fayl saqlanadi va o‘zgartirilmaydi. Taqdimot yaratilganda
              o‘sha fayldan kerakli sahifalar nusxalanadi, matn qutilariga o‘zbekcha matn yoziladi va
              natija PowerPoint fayli sifatida beriladi. Shablon JSLAYD dizayniga aylantirilmaydi.
            </p>
          </div>
        </div>
      </section>

      <div className="toolbar">
        <div className="search-box">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nomi yoki slug" />
        </div>
        <select value={status} onChange={(event) => setStatus(event.target.value as DesignStatus | "all")}>
          <option value="all">Barcha holatlar</option>
          <option value="draft">Qoralama</option>
          <option value="published">Chop etilgan</option>
          <option value="archived">Arxivlangan</option>
        </select>
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <section className="panel flush">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : sorted.length === 0 ? (
          <EmptyState detail="Hali PowerPoint shabloni yuklanmagan. Tepadagi tugma orqali .pptx faylni yuklang." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Shablon</th><th>Uslub</th><th>Sahifa</th><th>Mavzular</th>
                  <th>Versiya</th><th>Ishlatilgan</th><th>Holat</th><th>Yangilangan</th><th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id}>
                    <td className="template-cell">
                      {/* The first slide as PowerPoint itself drew it, copied
                          out of the package at import. Not a reconstruction —
                          it and the exported file come from the same file. */}
                      {templateCoverUrl(item.thumbnail_path)
                        ? <img className="template-cover" src={templateCoverUrl(item.thumbnail_path)!} alt="" loading="lazy" />
                        : null}
                      <span>
                        <strong>{item.name}</strong>
                        <small>{item.slug}{item.is_premium ? " · Premium" : ""}</small>
                      </span>
                    </td>
                    <td>{TIER_LABELS[item.tier as Tier]}</td>
                    <td>{item.page_count || "—"}</td>
                    <td><Subjects keywords={item.keywords} /></td>
                    <td>{item.published_version || "—"}</td>
                    <td>{item.used_by}</td>
                    <td><StatusBadge value={item.status} /></td>
                    <td>{dateTime.format(new Date(item.updated_at))}</td>
                    <td className="row-actions">
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => setEditing(item.id)}
                      >
                        <Pencil size={15} strokeWidth={1.9} /> Tahrirlash
                      </button>
                      {item.status === "archived" ? null : (
                        <button
                          className="primary-button compact"
                          type="button"
                          onClick={() => void publish(item, load, setError)}
                        >
                          <Rocket size={15} strokeWidth={1.9} />
                          {item.published_version > 0 ? "Qayta chop etish" : "Chop etish"}
                        </button>
                      )}
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => void duplicate(item, load, setError)}
                      >
                        Nusxa
                      </button>
                      {item.status === "archived" ? (
                        <button className="secondary-button compact" type="button" onClick={() => void restore(item, load, setError)}>
                          Tiklash
                        </button>
                      ) : (
                        <button className="danger-button compact" type="button" onClick={() => void archive(item, load, setError)}>
                          Arxivlash
                        </button>
                      )}
                      <button
                        className="danger-button compact"
                        type="button"
                        title={item.used_by > 0
                          ? `${item.used_by} ta taqdimot bu shablon bilan yaratilgan`
                          : "Shablonni butunlay o‘chirish"}
                        onClick={() => void remove(item, load, setError)}
                      >
                        <Trash2 size={15} strokeWidth={1.9} /> O‘chirish
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Which subjects a template suits, and how well.
 *
 * The number is the whole point: the phone compares a deck's topic against
 * these and takes the highest, so a template claiming journalism at 100 and
 * technology at 40 is a different template from one claiming both at 70. Three
 * are shown because a row is a row; the rest are in the count.
 */
function Subjects({ keywords }: { keywords: unknown }) {
  const list = Array.isArray(keywords)
    ? (keywords as { keyword?: string; score?: number }[]).filter((entry) => entry?.keyword)
    : [];
  if (list.length === 0) return <small>—</small>;
  const top = [...list].sort((first, second) => (second.score ?? 0) - (first.score ?? 0));
  return (
    <small>
      {top.slice(0, 3).map((entry) => `${entry.keyword} ${entry.score ?? 0}%`).join(", ")}
      {top.length > 3 ? ` +${top.length - 3}` : ""}
    </small>
  );
}
