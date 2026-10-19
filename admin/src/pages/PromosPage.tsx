import {
  emptyPromoBlock, plainInline, PROMO_BANNER_RATIO, PROMO_BANNER_SIZE, PROMO_GRADIENTS, PROMO_HERO_RATIO, PROMO_HERO_SIZE, PROMO_TEXT_COLORS,
  type Promo, type PromoBlock, type PromoBlockType, type PromoButton, type PromoFont, type PromoMediaKind,
} from "@jaxongirman/types";
import {
  AlignCenter, AlignLeft, ArrowDown, BadgeCheck, ArrowLeft, ArrowUp, Bold, Copy, Eye, Film, Heading, Highlighter, Image as ImageIcon, Italic, Link2, List,
  Megaphone, MessageSquareQuote, Minus, MousePointerClick, Music, Palette, Pencil, Plus, Save, Strikethrough, Trash2, Type, Underline,
  Upload, X, Info,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { PromoPhonePreview } from "@/components/PromoPreview";
import { errorMessage } from "@/lib/format";
import {
  APP_ROUTES, deletePromo, FONT_FACES, draftOf, draftProblem, emptyDraft, listPromos, MEDIA_ACCEPT, measureMedia, savePromo, setPromoPositions,
  setPromoStatus, uploadPromoMedia, type MediaInfo, type PromoDraft,
} from "@/lib/promos";

type Filter = "all" | "recommendation" | "ad" | "draft";

const STATUS_LABEL: Record<Promo["status"], string> = { draft: "Qoralama", published: "E’lon qilingan", archived: "Arxiv" };

/**
 * Tavsiya va reklama.
 *
 * Everything in the "Jaxongirman tavsiya qiladi" strip on the app's Bosh
 * sahifa: the list in the order the app shows it, and an editor for one entry
 * with a live phone beside it. An entry is a 16:6 banner and either an external
 * link or an article — formatted text, pictures, video, audio, quotes and
 * buttons — under a large hero picture or video.
 */
export function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [editing, setEditing] = useState<PromoDraft | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setPromos(await listPromos());
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shown = useMemo(() => promos.filter((promo) =>
    filter === "all" ? true : filter === "draft" ? promo.status !== "published" : promo.kind === filter), [filter, promos]);

  async function act(id: string, work: () => Promise<void>) {
    setBusyId(id);
    try {
      await work();
      await load();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusyId(null);
    }
  }

  async function move(promo: Promo, direction: -1 | 1) {
    const ordered = [...promos];
    const from = ordered.findIndex((item) => item.id === promo.id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ordered.length) return;
    [ordered[from], ordered[to]] = [ordered[to]!, ordered[from]!];
    await act(promo.id, () => setPromoPositions(ordered.map((item, index) => ({ id: item.id, position: (index + 1) * 10 }))));
  }

  if (editing) {
    return (
      <PromoEditor
        initial={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => { setEditing(draftOf(saved)); void load(); }}
      />
    );
  }

  const live = promos.filter((promo) => promo.status === "published");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="BOSH SAHIFA"
        title="Tavsiya va reklama"
        description="Ilovadagi «Jaxongirman tavsiya qiladi» bo‘limi: 16:6 bannerlar va ular ochadigan maqolalar yoki havolalar. Reklama ilovada doim «Reklama» belgisi bilan ko‘rinadi."
        action={
          <button className="secondary-button compact promo-new" type="button" onClick={() => setEditing(emptyDraft(((promos.at(-1)?.position ?? 0) + 10)))}>
            <Plus size={16} /> Yangi qo‘shish
          </button>
        }
      />

      <section className="promo-summary">
        <div><strong>{live.length}</strong><span>ilovada ko‘rinmoqda</span></div>
        <div><strong>{promos.filter((promo) => promo.kind === "ad").length}</strong><span>reklama</span></div>
        <div><strong>{promos.reduce((sum, promo) => sum + promo.view_count, 0).toLocaleString("uz-UZ")}</strong><span>ko‘rishlar</span></div>
        <div><strong>{promos.reduce((sum, promo) => sum + promo.click_count, 0).toLocaleString("uz-UZ")}</strong><span>bosishlar</span></div>
      </section>

      <div className="promo-filters" role="tablist">
        {([
          { key: "all", label: "Hammasi" },
          { key: "recommendation", label: "Tavsiyalar" },
          { key: "ad", label: "Reklamalar" },
          { key: "draft", label: "Qoralama va arxiv" },
        ] as const).map((option) => (
          <button key={option.key} type="button" role="tab" aria-selected={filter === option.key} className={filter === option.key ? "on" : undefined} onClick={() => setFilter(option.key)}>
            {option.label}
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading && promos.length === 0 ? <TableSkeleton rows={3} /> : null}
      {!loading && shown.length === 0 ? (
        <div className="panel"><EmptyState title="Hozircha hech narsa yo‘q" detail="«Yangi qo‘shish» bilan birinchi tavsiya yoki reklamani yarating. U e’lon qilinguncha ilovada ko‘rinmaydi." /></div>
      ) : null}

      <div className="promo-grid">
        {shown.map((promo) => {
          const index = promos.findIndex((item) => item.id === promo.id);
          const ctr = promo.view_count > 0 ? `${((promo.click_count / promo.view_count) * 100).toFixed(1)}%` : "—";
          const outOfDates = (promo.starts_at && new Date(promo.starts_at) > new Date()) || (promo.ends_at && new Date(promo.ends_at) <= new Date());
          return (
            <article key={promo.id} className={`promo-card${promo.status !== "published" ? " is-off" : ""}`}>
              <div className="promo-card-banner" style={{ aspectRatio: String(PROMO_BANNER_RATIO) }}>
                {promo.banner_url
                  ? promo.banner_kind === "video"
                    ? <video src={promo.banner_url} muted loop autoPlay playsInline />
                    : <img src={promo.banner_url} alt="" />
                  : <span className="promo-card-nobanner">Banner yuklanmagan</span>}
                <span className={`promo-kind ${promo.kind}`}>{promo.kind === "ad" ? <><Megaphone size={11} /> Reklama</> : "Tavsiya"}</span>
              </div>
              <div className="promo-card-body">
                <div className="promo-card-title">
                  <strong>{promo.title}</strong>
                  <span className={`status-badge status-${promo.status}`}>{STATUS_LABEL[promo.status]}</span>
                </div>
                <p>{promo.kind === "ad" && promo.sponsor ? `${promo.sponsor} · ` : ""}{promo.action === "link" ? `Havola: ${promo.link_url}` : `Maqola · ${promo.body.length} blok`}</p>
                {outOfDates && promo.status === "published" ? <p className="promo-warn">Sana oralig‘idan tashqarida — hozir ilovada ko‘rinmaydi.</p> : null}
                <dl>
                  <div><dt>Ko‘rishlar</dt><dd>{promo.view_count.toLocaleString("uz-UZ")}</dd></div>
                  <div><dt>Bosishlar</dt><dd>{promo.click_count.toLocaleString("uz-UZ")}</dd></div>
                  <div><dt>CTR</dt><dd>{ctr}</dd></div>
                </dl>
                <div className="promo-card-actions">
                  <button className="secondary-button compact" type="button" onClick={() => setEditing(draftOf(promo))}><Pencil size={14} /> Tahrirlash</button>
                  {promo.status === "published"
                    ? <button className="secondary-button compact" type="button" disabled={busyId === promo.id} onClick={() => void act(promo.id, () => setPromoStatus(promo.id, "draft"))}>Yashirish</button>
                    : <button className="secondary-button compact is-active" type="button" disabled={busyId === promo.id || !promo.banner_url} title={promo.banner_url ? undefined : "Avval banner yuklang"} onClick={() => void act(promo.id, () => setPromoStatus(promo.id, "published"))}>E’lon qilish</button>}
                  <button className="icon-button" type="button" title="Yuqoriga" disabled={index <= 0 || busyId !== null} onClick={() => void move(promo, -1)}><ArrowUp size={15} /></button>
                  <button className="icon-button" type="button" title="Pastga" disabled={index >= promos.length - 1 || busyId !== null} onClick={() => void move(promo, 1)}><ArrowDown size={15} /></button>
                  <button
                    className="icon-button danger"
                    type="button"
                    title="O‘chirish"
                    disabled={busyId === promo.id}
                    onClick={() => { if (window.confirm(`«${promo.title}» butunlay o‘chirilsinmi? Bu amalni ortga qaytarib bo‘lmaydi.`)) void act(promo.id, () => deletePromo(promo.id)); }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

/* ================================================================ editor */

function PromoEditor({ initial, onClose, onSaved }: { initial: PromoDraft; onClose: () => void; onSaved: (promo: Promo) => void }) {
  const [draft, setDraft] = useState<PromoDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [view, setView] = useState<"home" | "article">("home");
  const [dirty, setDirty] = useState(false);

  const update = useCallback((patch: Partial<PromoDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
    setDirty(true);
  }, []);
  const updateBlock = useCallback((id: string, next: PromoBlock) => {
    setDraft((current) => ({ ...current, body: current.body.map((block) => (block.id === id ? next : block)) }));
    setDirty(true);
  }, []);

  function addBlock(type: PromoBlockType) {
    setDraft((current) => ({ ...current, body: [...current.body, emptyPromoBlock(type)] }));
    setDirty(true);
    setView("article");
  }
  function moveBlock(id: string, direction: -1 | 1) {
    setDraft((current) => {
      const body = [...current.body];
      const from = body.findIndex((block) => block.id === id);
      const to = from + direction;
      if (from < 0 || to < 0 || to >= body.length) return current;
      [body[from], body[to]] = [body[to]!, body[from]!];
      return { ...current, body };
    });
    setDirty(true);
  }
  function duplicateBlock(id: string) {
    setDraft((current) => {
      const at = current.body.findIndex((block) => block.id === id);
      if (at < 0) return current;
      const copy = { ...structuredClone(current.body[at]!), id: emptyPromoBlock("divider").id };
      return { ...current, body: [...current.body.slice(0, at + 1), copy, ...current.body.slice(at + 1)] };
    });
    setDirty(true);
  }
  function removeBlock(id: string) {
    setDraft((current) => ({ ...current, body: current.body.filter((block) => block.id !== id) }));
    setDirty(true);
  }

  const problem = draftProblem(draft);

  async function save(status?: PromoDraft["status"]) {
    const next = status ? { ...draft, status } : draft;
    const why = draftProblem(next);
    if (why) { setError(why); return; }
    setSaving(true);
    setError(null);
    try {
      const saved = await savePromo(next);
      setDraft(draftOf(saved));
      setDirty(false);
      setSavedAt(Date.now());
      onSaved(saved);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setSaving(false);
    }
  }

  function leave() {
    if (dirty && !window.confirm("Saqlanmagan o‘zgarishlar bor. Baribir chiqasizmi?")) return;
    onClose();
  }

  return (
    <div className="page-stack promo-editor">
      <div className="promo-editor-bar">
        <button className="secondary-button compact" type="button" onClick={leave}><ArrowLeft size={15} /> Ro‘yxatga qaytish</button>
        <div className="promo-editor-title">
          <p className="eyebrow">{draft.id ? "TAHRIRLASH" : "YANGI"}</p>
          <h1>{draft.title || (draft.kind === "ad" ? "Yangi reklama" : "Yangi tavsiya")}</h1>
        </div>
        <div className="promo-editor-save">
          {savedAt && !dirty ? <span className="promo-saved">Saqlandi</span> : dirty ? <span className="promo-dirty">Saqlanmagan</span> : null}
          <button className="secondary-button compact" type="button" disabled={saving} onClick={() => void save()}><Save size={15} /> Saqlash</button>
          {draft.status !== "published"
            ? <button className="secondary-button compact is-active" type="button" disabled={saving} onClick={() => void save("published")}>E’lon qilish</button>
            : <button className="secondary-button compact" type="button" disabled={saving} onClick={() => void save("draft")}>Yashirish</button>}
        </div>
      </div>
      {error ? <div className="inline-state error-state"><Info size={18} /><div><strong>Saqlanmadi</strong><p>{error}</p></div></div> : null}
      {!error && problem && draft.status === "published" ? <p className="field-problem">{problem}</p> : null}

      <div className="promo-layout">
        <div className="promo-form">
          {/* ------------------------------------------------ basics */}
          <Section title="Asosiy" hint="Turi, sarlavha va qachon ko‘rinishi.">
            <div className="promo-segment">
              <button type="button" className={draft.kind === "recommendation" ? "on" : undefined} onClick={() => update({ kind: "recommendation" })}><BadgeCheck size={15} /> Tavsiya</button>
              <button type="button" className={draft.kind === "ad" ? "on" : undefined} onClick={() => update({ kind: "ad" })}><Megaphone size={15} /> Reklama</button>
            </div>
            <div className="form-grid">
              <label className="wide">Sarlavha *
                <input value={draft.title} maxLength={140} onChange={(event) => update({ title: event.target.value })} placeholder="Masalan: Taqdimotni 1 daqiqada yarating" />
              </label>
              <label className="wide">Qisqa izoh
                <input value={draft.subtitle} maxLength={280} onChange={(event) => update({ subtitle: event.target.value })} placeholder="Banner ostida bir qatorda ko‘rinadi" />
              </label>
              {draft.kind === "ad" ? (
                <label className="wide">Reklama beruvchi *
                  <input value={draft.sponsor} maxLength={80} onChange={(event) => update({ sponsor: event.target.value })} placeholder="Kompaniya yoki brend nomi" />
                </label>
              ) : null}
              <label>Ko‘rinish boshlanishi
                <input type="datetime-local" value={draft.starts_at} onChange={(event) => update({ starts_at: event.target.value })} />
              </label>
              <label>Ko‘rinish tugashi
                <input type="datetime-local" value={draft.ends_at} onChange={(event) => update({ ends_at: event.target.value })} />
              </label>
              <label>Holati
                <select value={draft.status} onChange={(event) => update({ status: event.target.value as PromoDraft["status"] })}>
                  <option value="draft">Qoralama — ko‘rinmaydi</option>
                  <option value="published">E’lon qilingan</option>
                  <option value="archived">Arxiv</option>
                </select>
              </label>
              <label>Tartib raqami
                <input type="number" value={draft.position} onChange={(event) => update({ position: Number(event.target.value) })} />
              </label>
            </div>
          </Section>

          {/* ------------------------------------------------ banner */}
          <Section title="Bosh sahifa banneri" hint="Ilovaning bosh sahifasida karuselda ko‘rinadigan keng banner.">
            <MediaField
              label="Banner (rasm yoki video)"
              url={draft.banner_url}
              kind={draft.banner_kind}
              allowVideo
              ratio={PROMO_BANNER_RATIO}
              spec={
                <>
                  <b>Tavsiya etilgan o‘lcham: {PROMO_BANNER_SIZE.width} × {PROMO_BANNER_SIZE.height} px (16:6).</b> Portret emas — keng, past rasm.
                  Rasm: JPG, PNG yoki WebP, 1 MB gacha. Video: MP4, {PROMO_BANNER_SIZE.width} × {PROMO_BANNER_SIZE.height}, ovozsiz, 5–15 soniya, 8 MB gacha — ilovada avtomatik, ovozsiz, takrorlanib o‘ynaydi.
                  Muhim matn va logotipni chap-pastki burchakdan uzoqroq joylang: u yerda sarlavha yoziladi.
                </>
              }
              onChange={(url, kind) => update({ banner_url: url, banner_kind: kind })}
            />
            <div className="promo-banner-style">
              <span>Banner belgisi</span>
              <div className="promo-segment small">
                {([
                  ["auto", draft.kind === "ad" ? "Avtomatik: REKLAMA" : "Avtomatik: belgisiz"],
                  ["hidden", "Yashirish"],
                  ["custom", "O‘z matni"],
                ] as const).map(([mode, label]) => (
                  <button key={mode} type="button" className={draft.badge_mode === mode ? "on" : undefined} onClick={() => { update({ badge_mode: mode }); setView("home"); }}>{label}</button>
                ))}
              </div>
              {draft.badge_mode === "custom" ? (
                <input
                  value={draft.badge_text}
                  maxLength={24}
                  onChange={(event) => update({ badge_text: event.target.value.toUpperCase() })}
                  placeholder="Masalan: YANGI, AKSIYA, HAMKOR"
                  aria-label="Belgi matni"
                />
              ) : null}
              <p className="promo-hint">
                {draft.badge_mode === "hidden"
                  ? "Bannerda va maqolada hech qanday belgi ko‘rinmaydi."
                  : draft.badge_mode === "custom"
                    ? "Bannerning chap yuqori burchagida shu matn ko‘rinadi (24 belgigacha)."
                    : draft.kind === "ad"
                      ? "Bannerda «REKLAMA» va reklama beruvchining nomi ko‘rinadi."
                      : "Tavsiyada bannerda belgi yo‘q; maqolada «Jaxongirman tavsiya qiladi» yoziladi."}
                {draft.kind === "ad" && draft.badge_mode !== "auto" ? " Eslatma: qonunga ko‘ra reklama odatda «Reklama» deb belgilanishi kerak." : ""}
              </p>
            </div>
            <div className="promo-banner-style">
              <span>Banner ustida</span>
              <div className="promo-segment small">
                <button type="button" className={draft.banner_style === "overlay" ? "on" : undefined} onClick={() => { update({ banner_style: "overlay" }); setView("home"); }}>
                  <Type size={14} /> Sarlavha, soya va tugma
                </button>
                <button type="button" className={draft.banner_style === "image" ? "on" : undefined} onClick={() => { update({ banner_style: "image" }); setView("home"); }}>
                  <ImageIcon size={14} /> Faqat rasm
                </button>
              </div>
              <p className="promo-hint">
                {draft.banner_style === "image"
                  ? "Bannerda faqat rasm (yoki video) ko‘rinadi — yozuv, soya va strelka tugmasi chizilmaydi. Matn rasmning o‘zida bo‘lsa shuni tanlang. Belgi qo‘yilgan bo‘lsa, burchakda kichik ko‘rinishda qoladi (yuqoridagi «Banner belgisi»dan boshqariladi)."
                  : "Sarlavha va qisqa izoh rasmning pastki qismida, quyuq soya ustida yoziladi; o‘ngda strelka tugmasi."}
              </p>
            </div>
          </Section>

          {/* ------------------------------------------------ action */}
          <Section title="Bosilganda nima ochiladi" hint="Ichki maqola — ilova ichida chiroyli sahifa. Tashqi havola — sayt brauzerda ochiladi.">
            <div className="promo-segment">
              <button type="button" className={draft.action === "article" ? "on" : undefined} onClick={() => { update({ action: "article" }); setView("article"); }}><Type size={15} /> Ichki maqola</button>
              <button type="button" className={draft.action === "link" ? "on" : undefined} onClick={() => update({ action: "link" })}><Link2 size={15} /> Tashqi havola</button>
            </div>
            {draft.action === "link" ? (
              <label>Havola (https://…) *
                <input value={draft.link_url} onChange={(event) => update({ link_url: event.target.value })} placeholder="https://example.uz/aksiya" inputMode="url" />
              </label>
            ) : null}
          </Section>

          {draft.action === "article" ? (
            <>
              {/* -------------------------------------------- hero */}
              <Section title="Maqola sahifasining bosh rasmi" hint="Maqola ochilganda ekranning tepasiga yopishib turadigan katta rasm yoki video. Matn uning ustidan suriladi.">
                <MediaField
                  label="Hero (rasm yoki video)"
                  url={draft.hero_url}
                  kind={draft.hero_kind}
                  allowVideo
                  ratio={PROMO_HERO_RATIO}
                  spec={
                    <>
                      <b>Tavsiya etilgan o‘lcham: {PROMO_HERO_SIZE.width} × {PROMO_HERO_SIZE.height} px.</b> Telefon ekranining yuqori ~60% qismini egallaydi.
                      Rasm: JPG yoki WebP, 1.5 MB gacha. Video: MP4, shu o‘lchamda, ovozsiz, 5–15 soniya, 10 MB gacha.
                      Yuklanmasa, banner rasmi ishlatiladi. Asosiy obyektni markazga va yuqoriroqqa joylang — pastki qismi matn bilan yopiladi.
                    </>
                  }
                  onChange={(url, kind) => update({ hero_url: url, hero_kind: kind })}
                />
              </Section>

              {/* -------------------------------------------- look */}
              <Section title="Maqola ko‘rinishi" hint="Shrift va asosiy rang: iqtiboslar, havolalar, ro‘yxat belgilari va ajratuvchilar shu rangda bo‘ladi.">
                <div className="promo-fonts">
                  {(Object.keys(FONT_FACES) as PromoFont[]).map((font) => (
                    <button key={font} type="button" className={draft.theme.font === font ? "on" : undefined} onClick={() => update({ theme: { ...draft.theme, font } })}>
                      <span style={{ fontFamily: FONT_FACES[font].display }}>Aa</span>
                      <strong>{FONT_FACES[font].label}</strong>
                      <small>{FONT_FACES[font].detail}</small>
                    </button>
                  ))}
                </div>
                <div className="promo-accent">
                  <span>Asosiy rang</span>
                  {PROMO_TEXT_COLORS.map((color) => (
                    <button key={color} type="button" title={color} className={draft.theme.accent === color ? "on" : undefined} style={{ background: color }} onClick={() => update({ theme: { ...draft.theme, accent: color } })} />
                  ))}
                  <input type="color" value={draft.theme.accent} onChange={(event) => update({ theme: { ...draft.theme, accent: event.target.value.toUpperCase() } })} />
                </div>
              </Section>

              {/* -------------------------------------------- body */}
              <Section title="Maqola" hint="Bloklarni qo‘shing va tartiblang. Matnni belgilab, panel tugmalari bilan qalin, qiya, rangli qiling yoki havola qo‘shing.">
                <div className="promo-blocks">
                  {draft.body.length === 0 ? <p className="muted">Hali blok yo‘q. Quyidan birinchisini qo‘shing.</p> : null}
                  {draft.body.map((block, index) => (
                    <BlockEditor
                      key={block.id}
                      block={block}
                      first={index === 0}
                      last={index === draft.body.length - 1}
                      onChange={(next) => updateBlock(block.id, next)}
                      onMove={(direction) => moveBlock(block.id, direction)}
                      onDuplicate={() => duplicateBlock(block.id)}
                      onRemove={() => removeBlock(block.id)}
                    />
                  ))}
                </div>
                <AddBlockBar onAdd={addBlock} />
              </Section>
            </>
          ) : null}
        </div>

        {/* ------------------------------------------------ preview */}
        <aside className="promo-preview">
          <div className="promo-segment small">
            <button type="button" className={view === "home" ? "on" : undefined} onClick={() => setView("home")}><Eye size={14} /> Bosh sahifa</button>
            <button type="button" className={view === "article" ? "on" : undefined} disabled={draft.action !== "article"} onClick={() => setView("article")}><Type size={14} /> Maqola</button>
          </div>
          <PromoPhonePreview draft={draft} view={draft.action === "article" ? view : "home"} />
          <p className="muted promo-preview-note">Taxminiy ko‘rinish. Ilovada shriftlar va o‘lchamlar telefon ekraniga moslashadi.</p>
        </aside>
      </div>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <section className="panel promo-section">
      <header><h2>{title}</h2><p>{hint}</p></header>
      {children}
    </section>
  );
}

/* ================================================================= media */

function MediaField({ label, url, kind, allowVideo, ratio, spec, onChange }: {
  label: string;
  url: string | null;
  kind: PromoMediaKind;
  allowVideo: boolean;
  ratio: number;
  spec: ReactNode;
  onChange: (url: string | null, kind: PromoMediaKind) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [info, setInfo] = useState<MediaInfo | null>(null);

  async function pick(file: File) {
    setBusy(true);
    setProblem(null);
    try {
      const nextKind: PromoMediaKind = file.type.startsWith("video/") ? "video" : "image";
      const measured = await measureMedia(file);
      setInfo(measured);
      const uploaded = await uploadPromoMedia(file);
      onChange(uploaded, nextKind);
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  const off = info && info.width > 0 ? Math.abs(info.width / info.height - ratio) / ratio : 0;

  return (
    <div className="promo-media">
      <div className="promo-media-spec"><Info size={16} /><p>{spec}</p></div>
      <div className="promo-media-row">
        <div className="promo-media-frame" style={{ aspectRatio: String(ratio) }}>
          {url ? (kind === "video" ? <video src={url} muted loop autoPlay playsInline /> : <img src={url} alt="" />) : <span>{label}</span>}
        </div>
        <div className="promo-media-actions">
          <input
            ref={input}
            type="file"
            hidden
            accept={allowVideo ? `${MEDIA_ACCEPT.image},${MEDIA_ACCEPT.video}` : MEDIA_ACCEPT.image}
            onChange={(event) => { const file = event.target.files?.[0]; if (file) void pick(file); }}
          />
          <button className="secondary-button compact" type="button" disabled={busy} onClick={() => input.current?.click()}>
            <Upload size={15} /> {busy ? "Yuklanmoqda…" : url ? "Almashtirish" : "Yuklash"}
          </button>
          {url ? <button className="secondary-button compact danger" type="button" disabled={busy} onClick={() => { onChange(null, "image"); setInfo(null); }}><X size={15} /> Olib tashlash</button> : null}
          {info && info.width > 0 ? (
            <p className={off > 0.04 ? "promo-warn" : "promo-ok"}>
              Yuklangan: {info.width} × {info.height} px{info.duration ? `, ${Math.round(info.duration)} s` : ""}.
              {off > 0.04 ? " Nisbat tavsiya etilganidan farq qiladi — ilovada chetlari kesiladi." : " Nisbat to‘g‘ri."}
            </p>
          ) : null}
          {problem ? <p className="promo-warn">{problem}</p> : null}
        </div>
      </div>
    </div>
  );
}

function InlineUpload({ accept, label, onUploaded }: { accept: string; label: string; onUploaded: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        accept={accept}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (!file) return;
          setBusy(true);
          setProblem(null);
          void uploadPromoMedia(file)
            .then(onUploaded, (failure) => setProblem(errorMessage(failure)))
            .finally(() => { setBusy(false); if (input.current) input.current.value = ""; });
        }}
      />
      <button className="secondary-button compact" type="button" disabled={busy} onClick={() => input.current?.click()}>
        <Upload size={14} /> {busy ? "Yuklanmoqda…" : label}
      </button>
      {problem ? <span className="promo-warn">{problem}</span> : null}
    </>
  );
}

/* ================================================================ blocks */

const BLOCK_TYPES: { type: PromoBlockType; label: string; icon: typeof Type }[] = [
  { type: "heading", label: "Sarlavha", icon: Heading },
  { type: "text", label: "Matn", icon: Type },
  { type: "quote", label: "Iqtibos", icon: MessageSquareQuote },
  { type: "callout", label: "Ajratilgan matn", icon: Highlighter },
  { type: "image", label: "Rasm", icon: ImageIcon },
  { type: "video", label: "Video", icon: Film },
  { type: "audio", label: "Audio", icon: Music },
  { type: "list", label: "Ro‘yxat", icon: List },
  { type: "divider", label: "Ajratuvchi", icon: Minus },
  { type: "button", label: "Tugma", icon: MousePointerClick },
];

function AddBlockBar({ onAdd }: { onAdd: (type: PromoBlockType) => void }) {
  return (
    <div className="promo-add">
      <span><Plus size={14} /> Blok qo‘shish</span>
      {BLOCK_TYPES.map(({ type, label, icon: Icon }) => (
        <button key={type} type="button" onClick={() => onAdd(type)}><Icon size={15} /> {label}</button>
      ))}
    </div>
  );
}

function BlockEditor({ block, first, last, onChange, onMove, onDuplicate, onRemove }: {
  block: PromoBlock;
  first: boolean;
  last: boolean;
  onChange: (next: PromoBlock) => void;
  onMove: (direction: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const meta = BLOCK_TYPES.find((item) => item.type === block.type)!;
  const Icon = meta.icon;
  return (
    <div className={`promo-block promo-block-${block.type}`}>
      <div className="promo-block-head">
        <span><Icon size={14} /> {meta.label}{block.type === "button" && block.button.pinned ? " · ekranga qadalgan" : ""}</span>
        <div>
          <button className="icon-button" type="button" title="Yuqoriga" disabled={first} onClick={() => onMove(-1)}><ArrowUp size={14} /></button>
          <button className="icon-button" type="button" title="Pastga" disabled={last} onClick={() => onMove(1)}><ArrowDown size={14} /></button>
          <button className="icon-button" type="button" title="Nusxa" onClick={onDuplicate}><Copy size={14} /></button>
          <button className="icon-button danger" type="button" title="O‘chirish" onClick={onRemove}><Trash2 size={14} /></button>
        </div>
      </div>
      <BlockFields block={block} onChange={onChange} />
    </div>
  );
}

function BlockFields({ block, onChange }: { block: PromoBlock; onChange: (next: PromoBlock) => void }) {
  switch (block.type) {
    case "heading":
      return (
        <div className="promo-inline">
          <select value={block.level} onChange={(event) => onChange({ ...block, level: Number(event.target.value) === 1 ? 1 : 2 })}>
            <option value={1}>Katta sarlavha</option>
            <option value={2}>O‘rta sarlavha</option>
          </select>
          <input value={block.text} onChange={(event) => onChange({ ...block, text: event.target.value })} placeholder="Sarlavha matni" />
        </div>
      );
    case "text":
      return (
        <>
          <RichTextArea value={block.text} onChange={(text) => onChange({ ...block, text })} rows={5} placeholder="Matnni yozing. Belgilab, yuqoridagi tugmalar bilan formatlang." />
          <div className="promo-inline small">
            <select value={block.size} onChange={(event) => onChange({ ...block, size: event.target.value === "large" ? "large" : "regular" })}>
              <option value="regular">Oddiy o‘lcham</option>
              <option value="large">Katta (kirish matni)</option>
            </select>
            <div className="promo-toggle-pair">
              <button type="button" className={block.align === "left" ? "on" : undefined} title="Chapga" onClick={() => onChange({ ...block, align: "left" })}><AlignLeft size={14} /></button>
              <button type="button" className={block.align === "center" ? "on" : undefined} title="Markazga" onClick={() => onChange({ ...block, align: "center" })}><AlignCenter size={14} /></button>
            </div>
          </div>
        </>
      );
    case "quote":
      return (
        <>
          <RichTextArea value={block.text} onChange={(text) => onChange({ ...block, text })} rows={3} placeholder="Iqtibos matni" />
          <input value={block.cite} onChange={(event) => onChange({ ...block, cite: event.target.value })} placeholder="Muallif (ixtiyoriy)" />
        </>
      );
    case "callout":
      return (
        <>
          <RichTextArea value={block.text} onChange={(text) => onChange({ ...block, text })} rows={3} placeholder="Ajratib ko‘rsatiladigan muhim matn" />
          <select value={block.tone} onChange={(event) => onChange({ ...block, tone: event.target.value as typeof block.tone })}>
            <option value="brand">Binafsha</option>
            <option value="gold">Oltin</option>
            <option value="success">Yashil</option>
            <option value="danger">Qizil</option>
          </select>
        </>
      );
    case "image":
    case "video":
      return (
        <>
          <div className="promo-inline">
            <input value={block.url} onChange={(event) => onChange({ ...block, url: event.target.value })} placeholder={block.type === "image" ? "Rasm havolasi yoki yuklang" : "Video havolasi (MP4) yoki yuklang"} />
            <InlineUpload accept={block.type === "image" ? MEDIA_ACCEPT.image : MEDIA_ACCEPT.video} label="Yuklash" onUploaded={(url) => onChange({ ...block, url })} />
          </div>
          {block.url ? (block.type === "image" ? <img className="promo-block-media" src={block.url} alt="" /> : <video className="promo-block-media" src={block.url} controls />) : null}
          <p className="promo-hint">{block.type === "image" ? "Kenglik kamida 1290 px; har qanday nisbat — ilovada asl nisbatda ko‘rsatiladi." : "MP4 (H.264), 16:9 yaxshi; 50 MB gacha. Ilovada boshqaruv tugmalari bilan o‘ynaydi."}</p>
          <input value={block.caption} onChange={(event) => onChange({ ...block, caption: event.target.value })} placeholder="Izoh (ixtiyoriy)" />
        </>
      );
    case "audio":
      return (
        <>
          <div className="promo-inline">
            <input value={block.url} onChange={(event) => onChange({ ...block, url: event.target.value })} placeholder="Audio havolasi (MP3, M4A) yoki yuklang" />
            <InlineUpload accept={MEDIA_ACCEPT.audio} label="Yuklash" onUploaded={(url) => onChange({ ...block, url })} />
          </div>
          {block.url ? <audio className="promo-block-media" src={block.url} controls /> : null}
          <input value={block.title} onChange={(event) => onChange({ ...block, title: event.target.value })} placeholder="Audio nomi" />
          <input value={block.caption} onChange={(event) => onChange({ ...block, caption: event.target.value })} placeholder="Izoh (ixtiyoriy)" />
        </>
      );
    case "list":
      return (
        <>
          <label className="checkbox-line"><input type="checkbox" checked={block.ordered} onChange={(event) => onChange({ ...block, ordered: event.target.checked })} /> Raqamlangan ro‘yxat</label>
          <RichTextArea
            value={block.items.join("\n")}
            onChange={(text) => onChange({ ...block, items: text.split("\n") })}
            rows={4}
            placeholder={"Har bir qator — alohida band\nIkkinchi band"}
          />
        </>
      );
    case "divider":
      return <p className="promo-hint">Bo‘limlar orasidagi chiroyli ajratuvchi chiziq.</p>;
    case "button":
      return <ButtonFields button={block.button} onChange={(button) => onChange({ ...block, button })} />;
  }
}

function ButtonFields({ button, onChange }: { button: PromoButton; onChange: (button: PromoButton) => void }) {
  const preset = APP_ROUTES.find((route) => route.path === button.url)?.path ?? "";
  return (
    <div className="promo-button-fields">
      <div className="form-grid">
        <label>Tugma matni
          <input value={button.label} maxLength={60} onChange={(event) => onChange({ ...button, label: event.target.value })} placeholder="Masalan: Hoziroq sinab ko‘ring" />
        </label>
        <label>Ilova ichidagi sahifa
          <select value={preset} onChange={(event) => onChange({ ...button, url: event.target.value || button.url })}>
            <option value="">— tashqi havola —</option>
            {APP_ROUTES.map((route) => <option key={route.path} value={route.path}>{route.label}</option>)}
          </select>
        </label>
        <label className="wide">Havola
          <input value={button.url} onChange={(event) => onChange({ ...button, url: event.target.value })} placeholder="https://… yoki /(app)/create" />
        </label>
      </div>

      <div className="promo-segment small">
        {([["gradient", "Gradient"], ["solid", "Bir rang"], ["outline", "Kontur"]] as const).map(([fill, label]) => (
          <button key={fill} type="button" className={button.fill === fill ? "on" : undefined} onClick={() => onChange({ ...button, fill })}>{label}</button>
        ))}
      </div>

      <div className="promo-gradients">
        {PROMO_GRADIENTS.map((gradient) => (
          <button
            key={gradient.name}
            type="button"
            title={gradient.name}
            className={button.colors[0] === gradient.colors[0] && button.colors[1] === gradient.colors[1] ? "on" : undefined}
            style={{ background: `linear-gradient(135deg, ${gradient.colors[0]}, ${gradient.colors[1]})` }}
            onClick={() => onChange({ ...button, colors: [...gradient.colors] })}
          />
        ))}
        <label className="promo-color"><Palette size={14} />
          <input type="color" value={button.colors[0]} onChange={(event) => onChange({ ...button, colors: [event.target.value.toUpperCase(), button.colors[1]] })} />
          {button.fill === "gradient" ? <input type="color" value={button.colors[1]} onChange={(event) => onChange({ ...button, colors: [button.colors[0], event.target.value.toUpperCase()] })} /> : null}
        </label>
      </div>

      <div className="promo-switches">
        <label className="checkbox-line"><input type="checkbox" checked={button.glow} onChange={(event) => onChange({ ...button, glow: event.target.checked })} /> Glow animatsiya (atrofida nur va yaltirash)</label>
        <label className="checkbox-line"><input type="checkbox" checked={button.pinned} onChange={(event) => onChange({ ...button, pinned: event.target.checked })} /> Ekranga qadab qo‘yish — maqola o‘qilayotganda pastda doim ko‘rinib turadi</label>
      </div>
    </div>
  );
}

/* ============================================================ rich text */

/**
 * A textarea with a formatting bar. The buttons wrap the selection in the same
 * light markup the app reads (`packages/types/src/promo.ts`): select a word,
 * press B, and it becomes **so‘z**.
 */
function RichTextArea({ value, onChange, rows, placeholder }: { value: string; onChange: (value: string) => void; rows: number; placeholder: string }) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [palette, setPalette] = useState<"color" | "highlight" | null>(null);

  function wrap(before: string, after: string, fallback = "matn") {
    const element = area.current;
    if (!element) return;
    const start = element.selectionStart;
    const end = element.selectionEnd;
    const selected = value.slice(start, end) || fallback;
    const next = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(next);
    requestAnimationFrame(() => {
      element.focus();
      element.setSelectionRange(start + before.length, start + before.length + selected.length);
    });
  }

  function link() {
    const url = window.prompt("Havola: https://… yoki ilova sahifasi (/(app)/create)", "https://");
    if (!url || !/^(https?:\/\/\S+|\/\S*)$/i.test(url.trim())) return;
    wrap("[", `](${url.trim()})`, "havola");
  }

  return (
    <div className="promo-rich">
      <div className="promo-rich-bar">
        <button type="button" title="Qalin (**matn**)" onClick={() => wrap("**", "**")}><Bold size={14} /></button>
        <button type="button" title="Qiya (*matn*)" onClick={() => wrap("*", "*")}><Italic size={14} /></button>
        <button type="button" title="Tagiga chizilgan (__matn__)" onClick={() => wrap("__", "__")}><Underline size={14} /></button>
        <button type="button" title="O‘chirilgan (~~matn~~)" onClick={() => wrap("~~", "~~")}><Strikethrough size={14} /></button>
        <button type="button" title="Havola" onClick={link}><Link2 size={14} /></button>
        <span className="promo-rich-sep" />
        <button type="button" title="Matn rangi" className={palette === "color" ? "on" : undefined} onClick={() => setPalette(palette === "color" ? null : "color")}><Palette size={14} /></button>
        <button type="button" title="Fon bilan belgilash" className={palette === "highlight" ? "on" : undefined} onClick={() => setPalette(palette === "highlight" ? null : "highlight")}><Highlighter size={14} /></button>
        <button type="button" title="Formatni olib tashlash" onClick={() => onChange(plainInline(value))}><X size={14} /></button>
        {palette ? (
          <div className="promo-rich-palette">
            {(palette === "color" ? PROMO_TEXT_COLORS : ["#FFE66D", "#FDE68A", "#BBF7D0", "#BFDBFE", "#FBCFE8", "#DDD6FE"]).map((color) => (
              <button
                key={color}
                type="button"
                title={color}
                style={{ background: color }}
                onClick={() => { wrap(palette === "color" ? `{${color}}` : `{bg:${color}}`, "{/}"); setPalette(null); }}
              />
            ))}
          </div>
        ) : null}
      </div>
      <textarea ref={area} value={value} rows={rows} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}
