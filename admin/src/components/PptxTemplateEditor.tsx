import { AlertTriangle, ArrowLeft, Check, ClipboardCopy, Loader2, Save, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/AdminUI";
import { buildPrompt, readDesignCode, type CodeReading, type Topic } from "@/lib/design-code";
import { ROLE_GROUPS, ROLE_LABELS } from "@/lib/design-roles";
import { errorMessage } from "@/lib/format";
import { listTopics, loadTemplate, updateTemplate, type TemplateDetail } from "@/lib/jslayd";
import { TIER_LABELS, TIERS, type Tier } from "@jaxongirman/jslayd";

/**
 * Editing an imported PowerPoint template.
 *
 * Not the JSLAYD workbench, and deliberately so. A written design is edited by
 * editing the prompt it was compiled from; a template has no prompt, and its
 * document was read out of a file rather than authored. Rewriting that document
 * by hand would leave the design describing something other than the package it
 * clones — the one thing that must stay true.
 *
 * So this edits the three things about a template that are genuinely decisions
 * rather than facts about the file: what it is called and who may use it, which
 * subjects it suits and how strongly, and what each of its pages is for. The
 * geometry, the pictures and the page-to-slide links are not reachable from
 * here; changing those means importing the file again, which is the honest
 * operation for it.
 *
 * The subjects arrive the same way they do at import — as a code from an
 * analysis done with the file open — so the prompt is offered here too. Somebody
 * who only wants to fix one page's role never has to touch it.
 */

export function PptxTemplateEditor({
  designId,
  onClose,
  onSaved,
}: {
  designId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [saved, setSaved] = useState(false);

  const [name, setName] = useState("");
  const [tier, setTier] = useState<Tier>("great");
  const [description, setDescription] = useState("");
  const [premium, setPremium] = useState(false);
  const [pages, setPages] = useState<TemplateDetail["pages"]>([]);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [code, setCode] = useState("");
  const [reading, setReading] = useState<CodeReading | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBusy(true);
    Promise.all([loadTemplate(designId), listTopics().catch(() => [] as Topic[])])
      .then(([loaded, taxonomy]) => {
        if (cancelled) return;
        setDetail(loaded);
        setName(loaded.name);
        setTier(loaded.tier);
        setDescription(loaded.description);
        setPremium(loaded.premium);
        setPages(loaded.pages);
        setTopics(taxonomy);
      })
      .catch((error) => { if (!cancelled) setProblem(errorMessage(error)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [designId]);

  const prompt = useMemo(
    () => buildPrompt({ designName: name, pageCount: pages.length || null, topics }),
    [name, pages.length, topics],
  );

  /** The subjects as they will be saved: the pasted code, or what is stored. */
  const subjects = reading && reading.keywords.length > 0
    ? reading.keywords.map((entry) => ({ keyword: entry.keyword, score: entry.score, label: entry.label }))
    : (detail?.keywords ?? []).map((entry) => ({
      keyword: entry.keyword,
      score: entry.score,
      label: topics.find((topic) => topic.slug === entry.keyword)?.label ?? entry.keyword,
    }));

  function recognise() {
    const result = readDesignCode(code, { topics, pageCount: pages.length });
    setReading(result);
    if (result.pages.length === 0) return;
    // Matched by the page's position in the file, which is what an analyst
    // counting slides in PowerPoint counted.
    const byPage = new Map(result.pages.map((entry) => [entry.page - 1, entry.role]));
    setPages((current) => current.map((page) => {
      const role = byPage.get(page.sourceIndex);
      return role ? { ...page, role } : page;
    }));
  }

  async function save() {
    if (!detail) return;
    setProblem(null);
    setBusy(true);
    setSaved(false);
    try {
      await updateTemplate({
        id: detail.id,
        name,
        tier,
        description,
        premium,
        ...(reading && reading.keywords.length > 0
          ? { keywords: reading.keywords.map((entry) => ({ keyword: entry.keyword, score: entry.score })) }
          : {}),
        pages: pages.map((page) => ({
          archetypeId: page.archetypeId,
          role: page.role,
          recommendedStoryPosition: page.recommendedStoryPosition,
        })),
      });
      setSaved(true);
      onSaved();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const unmeasured = pages.filter((page) => page.boxes === 0).length;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="PPTX SHABLON"
        title={detail ? detail.name : "Shablon"}
        description="Nomi, mavzulari va sahifa vazifalari. Dizaynning o‘zi — rasmlari, ranglari va joylashuvi — original faylda va bu yerdan o‘zgarmaydi."
        action={
          <div className="header-actions">
            <button className="secondary-button" type="button" onClick={onClose}>
              <ArrowLeft size={16} /> Ro‘yxatga qaytish
            </button>
            <button className="primary-button" type="button" onClick={() => void save()} disabled={busy || !detail}>
              {busy ? <Loader2 size={16} className="spin" /> : <Save size={16} />} Saqlash
            </button>
          </div>
        }
      />

      {problem ? <p className="field-problem">{problem}</p> : null}
      {saved && !problem ? <p className="panel-hint"><Check size={16} /> Saqlandi.</p> : null}

      {busy && !detail ? (
        <section className="panel"><p className="panel-hint"><Loader2 size={16} className="spin" /> Yuklanmoqda…</p></section>
      ) : null}

      {detail ? (
        <>
          {/* A template imported before its boxes were measured cannot be
              published, and the reason is not visible anywhere else. */}
          {unmeasured > 0 ? (
            <section className="panel">
              <div className="panel-heading">
                <div>
                  <h2><AlertTriangle size={18} /> Bu shablon eski formatda</h2>
                  <p className="panel-hint">
                    {unmeasured} ta sahifaning matn qutilari o‘lchanmagan, shuning uchun uni chop etib bo‘lmaydi.
                    Shablonni o‘chirib, <code>.pptx</code> faylni qaytadan yuklang — bu yerdagi sozlamalar tuzatmaydi.
                  </p>
                </div>
              </div>
            </section>
          ) : null}

          <section className="panel">
            <div className="panel-heading">
              <div><h2>Ma’lumotlari</h2></div>
            </div>
            <div className="form-grid">
              <label>
                <span>Nomi</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
              </label>
              <label>
                <span>Slug</span>
                {/* Read-only: the slug names the folder its pictures live in. */}
                <input value={detail.slug} readOnly disabled />
              </label>
              <label>
                <span>Uslub</span>
                <select value={tier} onChange={(event) => setTier(event.target.value as Tier)}>
                  {TIERS.map((value) => <option key={value} value={value}>{TIER_LABELS[value]}</option>)}
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={premium} onChange={(event) => setPremium(event.target.checked)} />
                <span>Premium</span>
              </label>
              <label className="wide">
                <span>Tavsif</span>
                <input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} />
              </label>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Mavzular</h2>
                <p className="panel-hint">
                  Telefon taqdimot mavzusini shu foizlar bilan solishtiradi va eng mosini oladi.
                  O‘zgartirish uchun promptni nusxalab, <code>.pptx</code> bilan tahlilchiga bering va
                  qaytgan kodni pastga qo‘ying.
                </p>
              </div>
              <button
                className="secondary-button compact"
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(prompt);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? <><Check size={16} /> Nusxalandi</> : <><ClipboardCopy size={16} /> Promptni nusxalash</>}
              </button>
            </div>

            {subjects.length > 0 ? (
              <div className="match-list">
                {[...subjects].sort((first, second) => second.score - first.score).map((entry) => (
                  <div key={entry.keyword} className="match">
                    <span className="match-name">{entry.label}</span>
                    <span className="match-bar"><i style={{ width: `${entry.score}%` }} /></span>
                    <span className="match-score">{entry.score}%</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="panel-hint">Mavzu belgilanmagan — bu shablon avtomatik tanlovda hech qachon chiqmaydi.</p>
            )}

            <textarea
              className="code-input"
              rows={5}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={'Yangi tahlil kodini shu yerga qo‘ying (ixtiyoriy).'}
              spellCheck={false}
            />
            <button className="secondary-button compact" type="button" onClick={recognise} disabled={!code.trim()}>
              <ScanLine size={16} /> Kodni tanib olish
            </button>

            {reading?.problem ? <p className="field-problem">{reading.problem}</p> : null}
            {reading && !reading.problem ? (
              <p className="panel-hint">
                {reading.keywords.length} ta mavzu va {reading.pages.length} ta sahifa vazifasi o‘qildi.
                Saqlaganda qo‘llanadi.
              </p>
            ) : null}
            {reading && reading.unknownTopics.length > 0 ? (
              <p className="field-problem">Ro‘yxatda yo‘q mavzular: {reading.unknownTopics.join(", ")}.</p>
            ) : null}
          </section>

          <section className="panel flush">
            <div className="panel-heading">
              <div>
                <h2>Sahifalar</h2>
                <p className="panel-hint">
                  Har bir sahifaning vazifasi — AI qaysi original slaydni qayerda ishlatishini shu hal qiladi.
                  Versiya {detail.version}.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>#</th><th>Vazifasi</th><th>O‘rni</th><th>Matn qutilari</th></tr>
                </thead>
                <tbody>
                  {pages.map((page, index) => (
                    <tr key={page.archetypeId}>
                      <td><strong>{page.sourceIndex + 1}</strong></td>
                      <td>
                        <select
                          value={page.role}
                          onChange={(event) => setPages((current) => current.map((entry, position) =>
                            position === index ? { ...entry, role: event.target.value } : entry))}
                        >
                          {/* A stored role outside the groups still shows, so
                              nothing silently changes on save. */}
                          {ROLE_GROUPS.some((group) => group.roles.includes(page.role))
                            ? null
                            : <option value={page.role}>{ROLE_LABELS[page.role] ?? page.role}</option>}
                          {ROLE_GROUPS.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.roles.map((role) => (
                                <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td>
                        {page.isTerminal ? "oxirida" : (
                          <input
                            type="number"
                            min={1}
                            max={18}
                            value={page.recommendedStoryPosition}
                            onChange={(event) => setPages((current) => current.map((entry, position) =>
                              position === index
                                ? { ...entry, recommendedStoryPosition: Number(event.target.value) || entry.recommendedStoryPosition }
                                : entry))}
                          />
                        )}
                      </td>
                      <td>{page.boxes || <span className="field-problem">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
