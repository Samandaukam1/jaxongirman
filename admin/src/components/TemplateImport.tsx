import { AlertTriangle, ArrowLeft, Check, ClipboardCopy, FileUp, Loader2, ScanLine, ShieldAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { buildPrompt, readDesignCode, type CodeReading, type Topic } from "@/lib/design-code";
import { ROLE_GROUPS, ROLE_LABELS } from "@/lib/design-roles";
import {
  importTemplate, inspectTemplate, listTopics, resolveDesignFonts, uploadTemplate,
  type FontResolution, type TemplatePage, type TemplateReport,
} from "@/lib/jslayd";
import { TIER_LABELS, TIERS, type Tier } from "@jaxongirman/jslayd";

/**
 * Importing a design a designer built in PowerPoint.
 *
 * The order of this screen is the point. A template is a file somebody was
 * sent, and the questions worth asking about it — is it safe to open, is it
 * already in the catalogue, what are its pages actually for — all have answers
 * before anything is written. So the upload and the inspection happen first and
 * create nothing; the admin reads what would happen, corrects the roles they
 * disagree with, and only then is a design made.
 *
 * The roles are sent back with the import rather than recomputed. A classifier
 * is not obliged to answer the same way twice, and a screen that shows one list
 * and saves another is worse than one that shows nothing.
 */

/** A design's own name, guessed from the file so the admin edits rather than types. */
function slugFrom(name: string): string {
  return name
    .toLowerCase()
    .replace(/\.pptx?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "shablon";
}

type Stage = "choose" | "working" | "review" | "done";

export function TemplateImport({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [stage, setStage] = useState<Stage>("choose");
  const [busyLabel, setBusyLabel] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [report, setReport] = useState<TemplateReport | null>(null);
  const [storagePath, setStoragePath] = useState("");
  const [originalName, setOriginalName] = useState("");
  const [pages, setPages] = useState<TemplatePage[]>([]);
  const [fonts, setFonts] = useState<FontResolution[] | null>(null);
  const [fontsBusy, setFontsBusy] = useState(false);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [tier, setTier] = useState<Tier>("great");
  const [premium, setPremium] = useState(false);

  // The analysis is done elsewhere — in a chat window with the file open — so
  // this screen's job is to hand over a prompt and take back a code.
  const [topics, setTopics] = useState<Topic[]>([]);
  const [code, setCode] = useState("");
  const [reading, setReading] = useState<CodeReading | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    listTopics().then(setTopics).catch(() => setTopics([]));
  }, []);

  const prompt = useMemo(
    () => buildPrompt({ designName: name, pageCount: pages.length || null, topics }),
    [name, pages.length, topics],
  );

  /**
   * The pasted analysis, applied to the pages the file actually has.
   *
   * Matched by the page's position in the file rather than by its position in
   * this list: a page with nothing drawable is dropped on import, so the fourth
   * usable page can be the fifth slide, and an analyst counting slides in
   * PowerPoint counted the fifth.
   */
  function recognise() {
    const result = readDesignCode(code, { topics, pageCount: Math.max(pages.length, report?.slides ?? 0) });
    setReading(result);
    if (result.pages.length === 0) return;

    const byPage = new Map(result.pages.map((entry) => [entry.page - 1, entry.role]));
    setPages((current) => current.map((page) => {
      const role = byPage.get(page.sourceIndex);
      return role ? { ...page, role } : page;
    }));
  }

  async function choose(file: File) {
    setProblem(null);
    setReport(null);
    setStage("working");
    try {
      setBusyLabel("Fayl yuklanmoqda…");
      const path = await uploadTemplate(file);
      setStoragePath(path);
      setOriginalName(file.name);

      setBusyLabel("Shablon tekshirilmoqda…");
      const answer = await inspectTemplate({ storagePath: path, originalName: file.name });
      setReport(answer);

      if (answer.code !== "inspected") { setStage("choose"); return; }
      setPages(answer.pages ?? []);
      setName(answer.name ?? file.name.replace(/\.pptx?$/i, ""));
      setSlug(slugFrom(answer.name ?? file.name));
      setStage("review");
    } catch (uploadError) {
      setProblem(errorMessage(uploadError));
      setStage("choose");
    }
  }

  async function commit() {
    setProblem(null);
    setStage("working");
    setBusyLabel("Dizayn yaratilmoqda…");
    try {
      const answer = await importTemplate({
        storagePath,
        originalName,
        name,
        slug,
        tier,
        premium,
        pages: pages.map((page) => ({
          archetypeId: page.archetypeId,
          role: page.role,
          recommendedStoryPosition: page.recommendedStoryPosition,
        })),
        /**
         * The subjects, sent back rather than worked out again.
         *
         * The analyst's code wins where there is one. Where there is not, what
         * the inspection already established is returned unchanged — otherwise
         * the import asks the classifier a second time for the same file, which
         * costs a second call and can answer differently, so the admin approves
         * one list and a different one is stored.
         */
        keywords: (reading && reading.keywords.length > 0 ? reading.keywords : (report?.keywords ?? []))
          .map((entry) => ({ keyword: entry.keyword, score: entry.score })),
      });
      setReport(answer);
      setStage(answer.code === "imported" ? "done" : "review");
      if (answer.code === "imported") onImported();
    } catch (importError) {
      setProblem(errorMessage(importError));
      setStage("review");
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="DIZAYN MANBASI"
        title="PowerPoint shablonini import qilish"
        description="Original PowerPoint shablonini yuklang. Jaxongir AI kerakli sahifalarni tanlaydi va faqat matnlarni mavzuga mos ravishda almashtiradi. Dizayn, rasmlar va elementlar original holatda saqlanadi."
        action={
          <button className="secondary-button" type="button" onClick={onClose}>
            <ArrowLeft size={16} /> Ro‘yxatga qaytish
          </button>
        }
      />

      {problem ? <p className="field-problem">{problem}</p> : null}

      {/* A refusal is an answer: which rule, and which part of the file. */}
      {report?.code === "rejected" ? (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2><ShieldAlert size={18} /> Shablon qabul qilinmadi</h2>
              <p className="panel-hint">Quyidagilar tuzatilsa, fayl qayta yuklanadi.</p>
            </div>
          </div>
          <ul className="problem-list">
            {(report.problems ?? []).map((entry, index) => (
              <li key={`${entry.code}-${index}`}>
                <strong>{entry.message}</strong>
                {entry.part ? <small>{entry.part}</small> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {report?.code === "duplicate" ? (
        <section className="panel">
          <p className="panel-hint">
            {report.message} Mavjud dizayn: <strong>{report.design?.name}</strong> (<code>{report.design?.slug}</code>).
          </p>
        </section>
      ) : null}

      {stage === "choose" ? (
        <section className="panel">
          <label className="upload-drop">
            <input
              type="file"
              accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void choose(file);
                event.target.value = "";
              }}
            />
            <FileUp size={28} />
            <strong>.pptx faylni tanlang</strong>
            <span>Eng ko‘pi 25 ta slayd. Makros, ichki obyekt va tashqi havolali fayllar qabul qilinmaydi.</span>
          </label>
        </section>
      ) : null}

      {stage === "working" ? (
        <section className="panel">
          <p className="panel-hint"><Loader2 size={16} className="spin" /> {busyLabel}</p>
        </section>
      ) : null}

      {stage === "review" && report?.pages ? (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Dizayn ma’lumotlari</h2>
                <p className="panel-hint">
                  {report.slides} ta slayd o‘qildi, {pages.length} tasi sahifa sifatida olindi.
                </p>
              </div>
            </div>
            <div className="form-grid">
              <label>
                <span>Nomi</span>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} />
              </label>
              <label>
                <span>Slug</span>
                <input value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} />
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
            </div>

            {(report.fonts ?? []).length > 0 ? (
              <p className="panel-hint">
                Shriftlar: {(report.fonts ?? []).join(", ")}. Fayllari yuklanmaguncha dizayn zaxira shriftda chiziladi.
              </p>
            ) : null}
            {(report.keywords ?? []).length > 0 ? (
              <p className="panel-hint">
                Mavzular: {(report.keywords ?? []).map((topic) => `${topic.keyword} — ${topic.score}%`).join(", ")}
              </p>
            ) : null}
          </section>

          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Tahlil kodi</h2>
                <p className="panel-hint">
                  Promptni nusxalang, uni <code>.pptx</code> fayl bilan birga tahlilchiga (ChatGPT) bering,
                  qaytgan kodni shu yerga qo‘ying. Sahifa vazifalari va mavzu foizlari shundan olinadi.
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

            <textarea
              className="code-input"
              rows={6}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder={'Tahlilchi qaytargan kodni shu yerga qo\u2018ying. Masalan:\n{ "keywords": [ { "keyword": "jurnalistika", "score": 100 } ], "pages": [ { "page": 1, "role": "welcome" } ] }'}
              spellCheck={false}
            />

            <button className="primary-button compact" type="button" onClick={recognise} disabled={!code.trim()}>
              <ScanLine size={16} /> Kodni tanib olish
            </button>

            {reading?.problem ? <p className="field-problem">{reading.problem}</p> : null}

            {reading && !reading.problem ? (
              <div className="code-result">
                {/* The percentages, which is what the phone compares. Strongest
                    first, because that is the one it will take. */}
                {reading.keywords.length > 0 ? (
                  <div className="match-list">
                    {reading.keywords.map((entry) => (
                      <div key={entry.keyword} className="match">
                        <span className="match-name">{entry.label}</span>
                        <span className="match-bar"><i style={{ width: `${entry.score}%` }} /></span>
                        <span className="match-score">{entry.score}%</span>
                      </div>
                    ))}
                  </div>
                ) : null}

                <p className="panel-hint">
                  {reading.pages.length} ta sahifa vazifasi qo‘llanildi
                  {reading.keywords.length > 0 ? `, ${reading.keywords.length} ta mavzu tanildi` : ""}.
                </p>

                {reading.unknownTopics.length > 0 ? (
                  <p className="field-problem">
                    Ro‘yxatda yo‘q mavzular tashlab yuborildi: {reading.unknownTopics.join(", ")}.
                  </p>
                ) : null}
                {reading.unknownRoles.length > 0 ? (
                  <p className="field-problem">
                    Noma’lum vazifalar: {reading.unknownRoles.join(", ")}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>

          {(report.warnings ?? []).length > 0 ? (
            <section className="panel">
              <div className="panel-heading">
                <div><h2><AlertTriangle size={18} /> Eslatmalar</h2></div>
              </div>
              <ul className="problem-list">
                {(report.warnings ?? []).map((warning, index) => <li key={index}>{warning}</li>)}
              </ul>
            </section>
          ) : null}

          <section className="panel flush">
            <div className="panel-heading">
              <div>
                <h2>Sahifalar</h2>
                <p className="panel-hint">
                  Har bir sahifaning vazifasi. Rozi bo‘lmasangiz o‘zgartiring — saqlanadigan qiymat shu.
                </p>
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>#</th><th>Tuzilma</th><th>Vazifasi</th><th>O‘rni</th>
                    <th>Matn</th><th>Qutilar</th><th>Rasm</th><th>Bezak</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page, index) => (
                    <tr key={page.archetypeId}>
                      <td><strong>{page.sourceIndex + 1}</strong></td>
                      <td>{page.purpose}</td>
                      <td>
                        <select
                          value={page.role}
                          onChange={(event) => setPages((current) =>
                            current.map((entry, position) =>
                              position === index ? { ...entry, role: event.target.value } : entry))}
                        >
                          {ROLE_GROUPS.map((group) => (
                            <optgroup key={group.label} label={group.label}>
                              {group.roles.map((role) => (
                                <option key={role} value={role}>{ROLE_LABELS[role] ?? role}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      </td>
                      <td>{page.recommendedStoryPosition >= 999 ? "oxirida" : page.recommendedStoryPosition}</td>
                      <td>{page.textSlots}</td>
                      {/* Every editable box of the source slide. Larger than
                          the field count on almost every real page, and it is
                          the number that decides whether the export can run. */}
                      <td>{page.boxes ?? "—"}</td>
                      <td>{page.imageSlots}</td>
                      <td>{page.artwork || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="header-actions">
            <button className="primary-button" type="button" onClick={() => void commit()}>
              Dizayn yaratish
            </button>
          </div>
        </>
      ) : null}

      {stage === "done" && report?.code === "imported" ? (
        <section className="panel">
          <p className="panel-hint">
            <strong>{report.name}</strong> qoralama sifatida yaratildi. Chop etishdan oldin
            sahifalarni ko‘rib chiqing.
          </p>

          {/* The typefaces, which is most of what a template is. Offered here
              rather than left for later: a design published without them is
              published in the wrong font. */}
          {(report.fonts ?? []).length > 0 ? (
            <>
              <p className="panel-hint">
                Shablon so‘ragan shriftlar: {(report.fonts ?? []).join(", ")}.
              </p>
              <button
                className="secondary-button compact"
                type="button"
                disabled={fontsBusy}
                onClick={() => {
                  if (!report.designId) return;
                  setFontsBusy(true);
                  resolveDesignFonts(report.designId)
                    .then(setFonts)
                    .catch((fontError) => setProblem(errorMessage(fontError)))
                    .finally(() => setFontsBusy(false));
                }}
              >
                {fontsBusy ? "Shriftlar olinmoqda…" : "Shriftlarni topib olish"}
              </button>
            </>
          ) : null}

          {fonts ? (
            <ul className="problem-list">
              {fonts.map((entry) => (
                <li key={entry.font}>
                  <strong>
                    {entry.name}: {entry.faces > 0
                      ? `${entry.faces} ta fayl (${entry.source === "library" ? "kutubxonadan" : "yuklab olindi"})`
                      : "topilmadi — faylni qo‘lda yuklang"}
                  </strong>
                  {entry.note ? <small>{entry.note}</small> : null}
                </li>
              ))}
            </ul>
          ) : null}

          <button className="secondary-button" type="button" onClick={onClose}>Ro‘yxatga qaytish</button>
        </section>
      ) : null}
    </div>
  );
}
