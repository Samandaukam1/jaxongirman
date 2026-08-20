import { decompile, SAMPLE_PROMPT, SLUG_PATTERN, TIERS, TIER_LABELS, toSlug, type Tier } from "@jaxongirman/jslayd";
import { ScaledSlide } from "@jaxongirman/slide-dom";
import { Download, FileUp, Plus, Search, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { TemplateImport } from "@/components/TemplateImport";
import { DiagnosticList, JslaydEditor } from "@/components/JslaydEditor";
import { JslaydStandardCard } from "@/components/JslaydStandard";
import { dateTime, errorMessage } from "@/lib/format";
import {
  allPreviewsOf,
  archiveDesign,
  deleteDesign,
  compilePrompt,
  downloadDocument,
  duplicateDesign,
  editableSource,
  importDocument,
  listDesignFonts,
  removeDesignFont,
  listDesigns,
  loadDesign,
  previewOf,
  publishDesign,
  restoreDesign,
  saveDesign,
  toCanvas,
  uploadFont,
  type CompileOutcome,
  type DesignFontFace,
  type DesignRow,
  type DesignStatus,
} from "@/lib/jslayd";
import { forgetDraft, keepDraft, recallDraft, sameDraft, type KeptDraft } from "@/lib/workbench-draft";

/**
 * JSLAYD dizaynlar — the console an admin creates a design from (§4, §47).
 *
 * The flow the whole system exists for: copy the standard, get a prompt from an
 * AI, paste it, check it, compile it, look at what it will actually render,
 * publish. Everything on this page except the network calls is deterministic,
 * and the preview is the real engine on sample content rather than a mock-up of
 * it (§61, §62).
 */

const FONT_SLOTS = ["font_1", "font_2", "font_3", "font_4"] as const;
const FALLBACKS = ["Manrope", "League Spartan", "Arimo", "Pinyon Script", "Inter", "Caveat Brush"] as const;

type Draft = {
  id: string | null;
  slug: string;
  name: string;
  tier: Tier;
  description: string;
  premium: boolean;
  source: string;
  /** True when the text was recovered from the compiled design, not authored. */
  recovered: boolean;
};

const BLANK: Draft = {
  id: null,
  slug: "",
  name: "",
  tier: "super_professional",
  description: "",
  premium: false,
  source: SAMPLE_PROMPT,
  recovered: false,
};

export function JslaydDesignsPage() {
  const [items, setItems] = useState<DesignRow[]>([]);
  const [status, setStatus] = useState<DesignStatus | "all">("all");
  const [tier, setTier] = useState<Tier | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"newest" | "oldest" | "name">("newest");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await listDesigns({
        status: status === "all" ? null : status,
        tier: tier === "all" ? null : tier,
        query,
      }));
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, [query, status, tier]);

  useEffect(() => { void load(); }, [load]);

  // Sorting is client-side: the listing RPC caps at 200 rows, so the whole set
  // is already here and a round trip would only add latency.
  const sorted = useMemo(() => {
    const rows = [...items];
    if (sort === "name") return rows.sort((first, second) => first.name.localeCompare(second.name, "uz"));
    return rows.sort((first, second) => {
      const compared = new Date(first.created_at).getTime() - new Date(second.created_at).getTime();
      return sort === "newest" ? -compared : compared;
    });
  }, [items, sort]);

  if (draft) {
    return (
      <Workbench
        draft={draft}
        onClose={() => { setDraft(null); void load(); }}
      />
    );
  }

  // A template is a second way to author the same thing, so it lives behind the
  // same catalogue rather than in a screen of its own: one list of designs,
  // however each of them was made.
  if (importing) {
    return (
      <TemplateImport
        onClose={() => { setImporting(false); void load(); }}
        onImported={() => { void load(); }}
      />
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="JSLAYD DESIGN ENGINE"
        title="JSLAYD dizaynlar"
        description="Prompt orqali yaratiladigan, versiyalanadigan va ilovani yangilamasdan chiqariladigan taqdimot dizaynlari."
        action={
          <div className="header-actions">
            <ImportButton onImported={(next) => setDraft(next)} />
            <button className="secondary-button" type="button" onClick={() => setImporting(true)}>
              <FileUp size={16} strokeWidth={1.9} /> PowerPoint shablon
            </button>
            <button className="primary-button" type="button" onClick={() => setDraft({ ...BLANK })}>
              <Plus size={16} strokeWidth={2.1} /> Yangi JSLAYD dizayn
            </button>
          </div>
        }
      />

      <JslaydStandardCard />

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
        <select value={tier} onChange={(event) => setTier(event.target.value as Tier | "all")}>
          <option value="all">Barcha uslublar</option>
          {TIERS.map((value) => <option key={value} value={value}>{TIER_LABELS[value]}</option>)}
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}>
          <option value="newest">Avval yangilari</option>
          <option value="oldest">Avval eskilari</option>
          <option value="name">Nomi bo‘yicha</option>
        </select>
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <section className="panel flush">
        {loading ? (
          <TableSkeleton rows={6} />
        ) : sorted.length === 0 ? (
          <EmptyState detail="Hali JSLAYD dizayn yaratilmagan. Tepadagi standartni nusxalab boshlang." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Dizayn</th><th>Uslub</th><th>Arxetip</th><th>Shrift</th>
                  <th>Sog‘lomlik</th><th>Versiya</th><th>Ishlatilgan</th><th>Holat</th><th>Yangilangan</th><th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <strong>{item.name}</strong>
                      <small>{item.slug}{item.is_premium ? " · Premium" : ""}</small>
                    </td>
                    <td>{TIER_LABELS[item.tier as Tier]}</td>
                    <td>{item.archetype_count}</td>
                    <td>{item.font_count}</td>
                    <td>{item.health_score === null ? "—" : `${item.health_score}/100`}</td>
                    <td>{item.published_version || "—"}</td>
                    <td>{item.used_by}</td>
                    <td><StatusBadge value={item.status} /></td>
                    <td>{dateTime.format(new Date(item.updated_at))}</td>
                    <td className="row-actions">
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => void openDesign(item.id, setDraft, setError)}
                      >
                        Tahrirlash
                      </button>
                      <button
                        className="secondary-button compact"
                        type="button"
                        onClick={() => void duplicate(item, load, setError)}
                      >
                        Nusxa
                      </button>
                      {item.status === "archived" ? (
                        <button className="secondary-button compact" type="button" onClick={() => void guard(() => restoreDesign(item.id), load, setError)}>
                          Tiklash
                        </button>
                      ) : (
                        <button className="danger-button compact" type="button" onClick={() => void archive(item, load, setError)}>
                          Arxivlash
                        </button>
                      )}
                      {/* Only where it can succeed: a design a deck was made
                          with is refused by the server, and offering a button
                          that always fails teaches nobody anything. */}
                      {item.used_by === 0 ? (
                        <button
                          className="danger-button compact"
                          type="button"
                          title="Dizaynni butunlay o‘chirish"
                          onClick={() => void remove(item, load, setError)}
                        >
                          <Trash2 size={15} strokeWidth={1.9} /> O‘chirish
                        </button>
                      ) : null}
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

async function guard(action: () => Promise<unknown>, reload: () => Promise<void>, onError: (message: string) => void) {
  try {
    await action();
    await reload();
  } catch (error) {
    onError(errorMessage(error));
  }
}

async function archive(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  // Archiving is reversible and decks keep rendering from their pinned version,
  // but a design in use is still worth pausing over.
  const warning = item.used_by > 0
    ? `«${item.name}» ${item.used_by} ta taqdimotda ishlatilgan. Arxivlash uni tanlash ro‘yxatidan olib tashlaydi, mavjud taqdimotlar ochilaveradi. Davom etamizmi?`
    : `«${item.name}» arxivlansinmi?`;
  if (!window.confirm(warning)) return;
  await guard(() => archiveDesign(item.id, null), reload, onError);
}

/**
 * Deleting, which is not archiving.
 *
 * A design a deck was made with cannot be deleted — the server refuses it and
 * says how many are in the way — so the button is not offered there at all: an
 * action that is always going to fail is worse than no action, because the
 * person clicking it learns nothing until after they have decided.
 *
 * What is left is the design that never became anything: a draft, a template
 * imported to see what it looked like, a duplicate made to try a colour. The
 * confirmation names the design and says plainly that this one does not come
 * back, since `Arxivlash` sits right beside it and does.
 */
async function remove(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  const warning = `«${item.name}» butunlay o‘chirilsinmi?\n\n`
    + "Sahifalari, shriftlari va yuklangan shablon fayli ham o‘chadi. Bu amalni qaytarib bo‘lmaydi.";
  if (!window.confirm(warning)) return;
  await guard(() => deleteDesign(item.id), reload, onError);
}

async function duplicate(item: DesignRow, reload: () => Promise<void>, onError: (message: string) => void) {
  const slug = window.prompt("Yangi slug", `${item.slug}-copy`);
  if (!slug) return;
  await guard(() => duplicateDesign(item.id, slug, `${item.name} Copy`), reload, onError);
}

async function openDesign(id: string, setDraft: (draft: Draft) => void, onError: (message: string) => void) {
  try {
    const { design } = await loadDesign(id);
    // Every design is editable, including the fifteen translated from the old
    // templates, which carry no prompt. Handing those the sample prompt would
    // have let one save overwrite a real design with the example.
    const { source, recovered } = editableSource(design);
    if (!source) {
      onError("Bu dizaynning manbasi o‘qilmadi — kompilyatsiya qilingan hujjat buzuq ko‘rinadi.");
      return;
    }
    setDraft({
      id: design.id,
      slug: design.slug,
      name: design.name,
      tier: design.tier as Tier,
      description: design.description,
      premium: design.is_premium,
      source,
      recovered,
    });
  } catch (error) {
    onError(errorMessage(error));
  }
}

function ImportButton({ onImported }: { onImported: (draft: Draft) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function read(file: File) {
    const { document, diagnostics } = importDocument(await file.text());
    if (!document) {
      setProblem(diagnostics.errors[0]?.message ?? "Fayl o‘qilmadi.");
      return;
    }
    setProblem(null);
    // An imported document carries no prompt — it was compiled elsewhere — so
    // the editable text is recovered from the document itself.
    onImported({
      id: null,
      slug: document.design.slug,
      name: document.design.name,
      tier: document.design.tier,
      description: document.design.description,
      premium: document.design.premium,
      source: decompile(document),
      recovered: true,
    });
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept=".jslayd,application/json"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void read(file);
          event.target.value = "";
        }}
      />
      <button className="secondary-button" type="button" onClick={() => input.current?.click()} title={problem ?? undefined}>
        <Upload size={16} strokeWidth={1.9} /> JSLAYD import
      </button>
    </>
  );
}

/* ------------------------------------------------------------- workbench */

function Workbench({ draft, onClose }: { draft: Draft; onClose: () => void }) {
  const [form, setForm] = useState(draft);
  const [outcome, setOutcome] = useState<CompileOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [family, setFamily] = useState<string | null>(null);
  const [fonts, setFonts] = useState<DesignFontFace[]>([]);
  const [kept, setKept] = useState<KeptDraft<Draft> | null>(() => recallDraft(draft.id, draft));
  const [saved, setSaved] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setForm((current) => ({ ...current, [key]: value }));
  };

  // The faces a design ships, reloaded whenever one is attached or detached so
  // the list is what the database holds rather than what this screen remembers.
  const loadFonts = useCallback(async () => {
    if (!form.id) { setFonts([]); return; }
    try {
      setFonts(await listDesignFonts(form.id));
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, [form.id]);

  useEffect(() => { void loadFonts(); }, [loadFonts]);

  // Every keystroke is kept locally, so nothing is riding on the tab staying
  // open. Writing on a short delay keeps a long prompt from touching storage on
  // each character.
  useEffect(() => {
    if (saved) return;
    const timer = window.setTimeout(() => keepDraft(form), 400);
    return () => window.clearTimeout(timer);
  }, [form, saved]);

  /**
   * The preview follows the prompt, without being asked.
   *
   * It used to appear only after the check button was pressed, which meant
   * opening a design showed its text and none of its design — an admin had to
   * know that a button labelled "Tekshirish" was also the way to see the thing
   * they had just made. The compiler runs in this tab and takes milliseconds,
   * so there is no reason for a person to be the trigger.
   *
   * Errors stay silent here. A prompt is invalid for most of the time somebody
   * is typing one, and shouting about it mid-word is noise; the button still
   * reports properly when it is pressed, and the errors below it are drawn from
   * the same outcome.
   */
  useEffect(() => {
    let live = true;
    const timer = window.setTimeout(() => {
      void compilePrompt(form.source)
        .then((next) => { if (live) setOutcome(next); })
        .catch(() => {});
    }, 350);
    return () => { live = false; window.clearTimeout(timer); };
  }, [form.source]);

  // A reload with work in hand still deserves the browser's own warning: the
  // local copy is a safety net, not a reason to lose the admin's place.
  useEffect(() => {
    const dirty = () => !saved && !sameDraft(form, draft);
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirty()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draft, form, saved]);

  function restoreKept() {
    if (!kept) return;
    setForm(kept.draft);
    setKept(null);
    // The preview recompiles itself from the restored text, so there is nothing
    // left to ask the admin to do.
    setMessage("Saqlanmagan tahrir tiklandi.");
  }

  function discardKept() {
    forgetDraft(draft.id);
    setKept(null);
  }

  async function validate() {
    setBusy(true);
    setError(null);
    try {
      const next = await compilePrompt(form.source);
      setOutcome(next);
      setMessage(
        next.document
          ? `Tekshiruv o‘tdi — ${next.document.archetypes.length} ta arxetip, ${next.health?.score ?? 0}/100 sog‘lomlik.`
          : `${next.diagnostics.errors.length} ta xato topildi.`,
      );
    } finally {
      setBusy(false);
    }
  }

  /**
   * Saves, compiling first if that has not happened yet.
   *
   * The font panel needs a saved design — the files are stored under its slug —
   * but the save button lives in the section below it and only wakes up once
   * the prompt has been checked. Telling somebody to "save the draft first"
   * while the way to do that is further down the page and switched off is not
   * an instruction, it is a puzzle. So saving compiles on the way.
   */
  async function save(thenPublish: boolean) {
    let ready = outcome;
    if (!ready?.document) {
      setBusy(true);
      try {
        ready = await compilePrompt(form.source);
        setOutcome(ready);
      } finally {
        setBusy(false);
      }
    }
    if (!ready?.document) {
      // Said plainly, and once. The errors themselves are listed below the
      // button on a new design, and in the prompt section on an existing one —
      // a count on its own is not information, and neither is being sent
      // somewhere else to find out.
      setError("Prompt kompilyatsiya qilinmadi, shuning uchun qoralama saqlanmadi.");
      return;
    }
    // Narrowed once, so the rest of the body is not re-proving it.
    const compiled = { ...ready, document: ready.document };

    // A slug is a storage prefix and a URL segment, so the database refuses
    // anything outside a narrow shape — and it refuses it by naming a
    // constraint, which tells the reader nothing about what to write instead.
    const slugToSave = form.slug || compiled.document.design.slug;
    if (!SLUG_PATTERN.test(slugToSave) || slugToSave.length < 3 || slugToSave.length > 64) {
      const suggestion = toSlug(slugToSave);
      setError(
        `Slug faqat kichik lotin harflari, raqamlar va chiziqchadan iborat bo‘ladi (3–64 belgi): “${slugToSave}”.`
        + (suggestion ? ` Masalan: “${suggestion}”.` : " Lotin harflaridan foydalaning."),
      );
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // The prompt supplies a slug and a name when the fields are left empty,
      // and until now only the id came back — so a design saved that way had a
      // blank slug in the form. The font panel is keyed on that slug, so it sat
      // disabled with no way to find out why.
      const slug = form.slug || compiled.document.design.slug;
      const name = form.name || compiled.document.design.name;
      const id = await saveDesign({
        id: form.id,
        slug,
        name,
        tier: form.tier,
        description: form.description,
        premium: form.premium,
        source: form.source,
        outcome: compiled,
      });
      setForm((current) => ({ ...current, id, slug, name }));
      // The recovered text is now the design's own prompt, so the notice
      // explaining where it came from has nothing left to explain.
      set("recovered", false);
      // The server now holds this text, so the local copy has nothing left to
      // protect and must not resurface as an "unsaved edit" next time.
      forgetDraft(draft.id);
      forgetDraft(id);
      setSaved(true);
      if (thenPublish) {
        const version = await publishDesign(id);
        setMessage(`Chop etildi — v${version}. Foydalanuvchilar uni ilovani yangilamasdan ko‘radi.`);
      } else {
        setMessage("Qoralama saqlandi.");
      }
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  const families = outcome?.document?.colorFamilies ?? [];
  const previews = useMemo(
    () => (outcome?.document ? allPreviewsOf(outcome.document, family) : []),
    [family, outcome],
  );
  const cover = useMemo(
    () => (outcome?.document ? previewOf(outcome.document, family) : null),
    [family, outcome],
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow={form.id ? "TAHRIRLASH" : "YANGI DIZAYN"}
        title={form.name || "Nomsiz dizayn"}
        description="Prompt → tekshiruv → kompilyatsiya → jonli ko‘rinish → chop etish."
        action={<button className="secondary-button" type="button" onClick={onClose}>Ro‘yxatga qaytish</button>}
      />

      {error ? <ErrorState title="Saqlanmadi" message={error} /> : null}
      {message ? <p className="jslayd-message">{message}</p> : null}

      {kept ? (
        <div className="jslayd-notice" role="status">
          <div>
            <strong>Saqlanmagan tahrir topildi</strong>
            <span>{describeWhen(kept.savedAt)} shu brauzerda qoldirilgan matn bor. Tiklaysizmi?</span>
          </div>
          <div className="jslayd-notice-actions">
            <button className="primary-button" type="button" onClick={restoreKept}>Tiklash</button>
            <button className="secondary-button" type="button" onClick={discardKept}>O‘chirish</button>
          </div>
        </div>
      ) : null}

      {form.recovered ? (
        <div className="jslayd-notice muted" role="status">
          <div>
            <strong>Manba kompilyatsiya qilingan dizayndan tiklandi</strong>
            <span>
              Bu dizayn prompt bilan saqlanmagan edi. Quyidagi matn uning aynan o‘zi — tekshirib saqlasangiz,
              dizayn o‘zgarmaydi, faqat siz o‘zgartirgan joyi o‘zgaradi.
            </span>
          </div>
        </div>
      ) : null}

      <section className="panel">
        <h3>1. Asosiy</h3>
        <div className="form-grid">
          <label>Nomi<input value={form.name} onChange={(event) => set("name", event.target.value)} /></label>
          <label>
            Slug
            <input value={form.slug} onChange={(event) => set("slug", event.target.value)} placeholder="apelsen-futuristik" />
            {form.slug && !SLUG_PATTERN.test(form.slug) ? (
              <small className="field-problem">
                Kichik lotin harflari, raqamlar va chiziqcha.
                {toSlug(form.slug) ? (
                  <>
                    {" "}
                    <button type="button" className="text-button" onClick={() => set("slug", toSlug(form.slug) as string)}>
                      “{toSlug(form.slug)}” ga o‘zgartirish
                    </button>
                  </>
                ) : null}
              </small>
            ) : null}
          </label>
          <label>
            Uslub
            <select value={form.tier} onChange={(event) => set("tier", event.target.value as Tier)}>
              {TIERS.map((value) => <option key={value} value={value}>{TIER_LABELS[value]}</option>)}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" checked={form.premium} onChange={(event) => set("premium", event.target.checked)} />
            Premium
          </label>
          <label className="wide">Tavsif<input value={form.description} onChange={(event) => set("description", event.target.value)} /></label>
        </div>
      </section>

      <section className="panel">
        <h3>2. Fontlar</h3>
        <p className="panel-hint">
          1-shrift majburiy, 2–4 ixtiyoriy. .ttf, .otf va .woff qabul qilinadi — WOFF2 emas, chunki PDF eksporti uni
          joylay olmaydi. PPTX’da maxsus shrift ochuvchining kompyuterida almashtirilishi mumkin.
        </p>
        {FONT_SLOTS.map((slot, index) => (
          <FontSlot
            key={slot}
            slot={slot}
            required={index === 0}
            disabled={!form.id || !form.slug}
            designId={form.id}
            slug={form.slug}
            faces={fonts}
            onError={setError}
            onSaved={(text) => { setMessage(text); void loadFonts(); }}
          />
        ))}
        {!form.id ? (
          // The instruction and the way to follow it, in the same place. Saying
          // "save the draft first" while the save button is in the next section
          // and disabled until the prompt is checked is a puzzle, not guidance.
          <div className="jslayd-font-gate">
            <p className="panel-hint">
              Shrift fayllari dizayn nomi ostida saqlanadi, shuning uchun avval qoralama kerak.
              Prompt tekshiriladi va qoralama saqlanadi — bir bosishda.
            </p>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => void save(false)}>
              {busy ? "Saqlanmoqda…" : "Qoralamani saqlash"}
            </button>

            {outcome && !outcome.document ? (
              <>
                <p className="jslayd-font-empty">Quyidagilarni tuzatib, qaytadan bosing:</p>
                <DiagnosticList diagnostics={outcome.diagnostics.errors.slice(0, 6)} />
              </>
            ) : null}
          </div>
        ) : !form.slug ? (
          <p className="panel-hint">Dizaynning slugi aniqlanmadi. Yuqoridagi “Slug” maydonini to‘ldirib qayta saqlang.</p>
        ) : null}
      </section>

      <section className="panel">
        <h3>3. JSLAYD prompt</h3>
        <JslaydEditor
          value={form.source}
          onChange={(next) => { set("source", next); setOutcome(null); }}
          diagnostics={outcome?.diagnostics.all ?? []}
          disabled={busy}
        />
        <div className="jslayd-actions">
          <button className="secondary-button" type="button" disabled={busy} onClick={() => void validate()}>
            Promptni tekshirish
          </button>
          <button className="primary-button" type="button" disabled={busy || !outcome?.document} onClick={() => void save(false)}>
            JSLAYD yaratish va saqlash
          </button>
          <button className="primary-button" type="button" disabled={busy || !outcome?.document} onClick={() => void save(true)}>
            Chop etish
          </button>
          {outcome?.document ? (
            <button className="secondary-button" type="button" onClick={() => downloadDocument(outcome.document!)}>
              <Download size={15} strokeWidth={1.9} /> .jslayd yuklab olish
            </button>
          ) : null}
        </div>
        <DiagnosticList diagnostics={outcome?.diagnostics.all ?? []} />
      </section>

      {outcome?.health ? (
        <section className="panel">
          <h3>JSLAYD Health · {outcome.health.score}/100</h3>
          <ul className="jslayd-health">
            {outcome.health.checks.map((check) => (
              <li key={check.name} className={check.passed ? "ok" : "bad"}>
                <span>{check.label}</span>
                <strong>{check.passed ? "✓" : "✕"} {check.score}</strong>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {cover ? (
        <section className="panel">
          <h3>4. Jonli ko‘rinish</h3>
          <p className="panel-hint">
            Bu haqiqiy renderer va namunaviy ma’lumot. Foydalanuvchi paneli ham, eksport ham ayni shu modeldan chizadi.
          </p>
          {families.length > 1 ? (
            <div className="jslayd-family-row">
              {families.map((entry) => (
                <button
                  key={entry.code}
                  type="button"
                  className={(family ?? families[0]?.code) === entry.code ? "primary-button compact" : "secondary-button compact"}
                  onClick={() => setFamily(entry.code)}
                >
                  <span className="jslayd-family-dot" style={{ background: entry.colors.primary, borderColor: entry.colors.border }} />
                  {entry.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="jslayd-preview-main">
            <ScaledSlide width={720} {...toCanvas(cover, "cover")} />
          </div>
          <button className="secondary-button compact" type="button" onClick={() => setShowAll((open) => !open)}>
            {showAll ? "Yopish" : `Barcha slaydlar (${previews.length})`}
          </button>
          {showAll ? (
            <div className="jslayd-preview-grid">
              {previews.map((preview) => (
                <figure key={preview.id}>
                  <ScaledSlide width={260} {...toCanvas(preview.slide, preview.id)} />
                  <figcaption>{preview.id}<small>{preview.purpose}</small></figcaption>
                </figure>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One slot, which is a family rather than a file.
 *
 * Regular, Medium, SemiBold, Bold and their italics are separate files of one
 * typeface. A design that sets 700 somewhere and ships only the 400 does not
 * get bold — it gets the 400 smeared sideways, which is what faux bold is and
 * what it looks like. So each slot lists what it has and takes up to ten.
 */
function FontSlot({
  slot, required, disabled, designId, slug, faces, onError, onSaved,
}: {
  slot: string;
  required: boolean;
  disabled: boolean;
  designId: string | null;
  slug: string;
  faces: DesignFontFace[];
  onError: (message: string) => void;
  onSaved: (message: string) => void;
}) {
  const mine = faces.filter((face) => face.font_id === slot);
  const first = mine[0];
  const [name, setName] = useState(first?.name ?? "");
  const [roles, setRoles] = useState(first?.roles.join(", ") ?? (required ? "display, heading" : "body"));
  const [weight, setWeight] = useState(400);
  const [italic, setItalic] = useState(false);
  const [fallback, setFallback] = useState<string>(first?.fallback ?? "Manrope");
  const [busy, setBusy] = useState(false);

  const full = mine.length >= 10;
  const taken = mine.some((face) => face.weight === weight && face.italic === italic);

  async function attach(file: File) {
    setBusy(true);
    try {
      await uploadFont({
        designId: designId as string,
        slug,
        fontId: slot,
        name: name || file.name.replace(/\.[^.]+$/, ""),
        roles: roles.split(/[,\s]+/).filter(Boolean),
        file,
        weight,
        italic,
        fallback,
      });
      onSaved(`${slot}: ${weight}${italic ? " italic" : ""} yuklandi.`);
    } catch (requestError) {
      onError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  async function detach(face: DesignFontFace) {
    setBusy(true);
    try {
      await removeDesignFont(designId as string, slot, face.weight, face.italic);
      onSaved(`${slot}: ${face.weight}${face.italic ? " italic" : ""} o‘chirildi.`);
    } catch (requestError) {
      onError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jslayd-font-slot">
      <div className="jslayd-font-head">
        <strong>{slot}{required ? " · majburiy" : ""}</strong>
        <span>{mine.length}/10 fayl</span>
      </div>

      <div className="jslayd-font-family">
        <input placeholder="Nomi" value={name} onChange={(event) => setName(event.target.value)} />
        <input placeholder="Rollar" value={roles} onChange={(event) => setRoles(event.target.value)} />
        <select value={fallback} onChange={(event) => setFallback(event.target.value)}>
          {FALLBACKS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </div>

      {mine.length > 0 ? (
        <ul className="jslayd-font-faces">
          {mine.map((face) => (
            <li key={`${face.weight}-${face.italic}`}>
              <span>{face.weight}{face.italic ? " italic" : ""}</span>
              <code>{face.asset_path?.split("/").pop() ?? "—"}</code>
              <button type="button" disabled={busy || disabled} onClick={() => void detach(face)}>O‘chirish</button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="jslayd-font-empty">Hali fayl yo‘q — zaxira shrift chiziladi.</p>
      )}

      <div className="jslayd-font-add">
        <select value={weight} onChange={(event) => setWeight(Number(event.target.value))}>
          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={italic} onChange={(event) => setItalic(event.target.checked)} />
          Kursiv
        </label>
        <input
          type="file"
          accept=".ttf,.otf,.woff"
          disabled={disabled || busy || full}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void attach(file);
            event.target.value = "";
          }}
        />
      </div>

      {full ? <p className="jslayd-font-empty">Paket to‘ldi — yangi fayl qo‘shish uchun bittasini o‘chiring.</p> : null}
      {taken && !full ? (
        <p className="jslayd-font-empty">
          {weight}{italic ? " kursiv" : ""} allaqachon bor — yangi fayl uni almashtiradi.
        </p>
      ) : null}
    </div>
  );
}

/** "12 daqiqa oldin" — enough for the admin to recognise their own work. */
function describeWhen(at: number): string {
  const minutes = Math.max(1, Math.round((Date.now() - at) / 60000));
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  return `${Math.round(hours / 24)} kun oldin`;
}
