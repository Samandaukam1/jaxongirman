import { AlertTriangle, ArrowLeft, FileUp, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  importTemplate, inspectTemplate, resolveDesignFonts, uploadTemplate,
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

const ROLE_GROUPS: { label: string; roles: string[] }[] = [
  {
    label: "Hikoya",
    roles: [
      "welcome", "introduction", "overview", "key_concepts", "importance",
      "types", "structure", "process", "methods", "analysis", "challenges",
      "solutions", "applications", "examples", "results", "recommendations",
      "conclusion", "thanks",
    ],
  },
  {
    label: "Ko‘rinish",
    roles: ["agenda", "timeline", "comparison", "big_number", "quote", "case_study", "data", "chart", "table", "image_story", "references"],
  },
];

const ROLE_LABELS: Record<string, string> = {
  welcome: "Ochilish", introduction: "Kirish", overview: "Umumiy ko‘rinish",
  key_concepts: "Asosiy tushunchalar", importance: "Ahamiyati", types: "Turlari",
  structure: "Tuzilishi", process: "Jarayon", methods: "Usullar", analysis: "Tahlil",
  challenges: "Muammolar", solutions: "Yechimlar", applications: "Qo‘llanilishi",
  examples: "Misollar", results: "Natijalar", recommendations: "Tavsiyalar",
  conclusion: "Xulosa", thanks: "Yakun", agenda: "Reja", timeline: "Vaqt chizig‘i",
  comparison: "Taqqoslash", big_number: "Katta raqam", quote: "Iqtibos",
  case_study: "Amaliy misol", data: "Ma’lumot", chart: "Diagramma", table: "Jadval",
  image_story: "Rasmli sahifa", references: "Manbalar",
};

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
        description="Tayyor .pptx shabloni JSLAYD dizayniga aylantiriladi. Shablonning o‘z matni hech qachon saqlanmaydi — sahifalar faqat joy sifatida olinadi."
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
                Mavzular: {(report.keywords ?? []).map((topic) => `${topic.slug} (${topic.score})`).join(", ")}
              </p>
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
                    <th>Matn</th><th>Rasm</th><th>Bezak</th>
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
