import { Check, History, Languages, Save } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  ENTITY_LABELS,
  FIELD_LABELS,
  LANGUAGES,
  LANGUAGE_NAMES,
  loadLanguageOverview,
  loadTranslationEntries,
  saveLanguageSettings,
  saveTranslation,
  type Language,
  type LanguageOverview,
  type LanguageSettings,
  type TranslationEntry,
} from "@/lib/languages";
import { useAuth } from "@/providers/AuthProvider";

/**
 * Tillar va tarjimalar.
 *
 * Which languages the app offers, who uses which, what decks in each cost, and
 * the English and Russian of everything an operator writes. The interface's
 * own words are not here: they ship with the app, in static tables, so no
 * model and no network is asked to translate a screen.
 */
export function LanguagesPage() {
  const { isSuperAdmin } = useAuth();
  const [overview, setOverview] = useState<LanguageOverview | null>(null);
  const [entries, setEntries] = useState<TranslationEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [nextOverview, nextEntries] = await Promise.all([loadLanguageOverview(), loadTranslationEntries()]);
      setOverview(nextOverview);
      setEntries(nextEntries);
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error && !overview) return <div className="page-stack"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!overview) return <div className="page-stack"><p className="muted">Yuklanmoqda…</p></div>;

  const done = async (message: string) => {
    setNotice(message);
    await load();
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="TILLAR"
        title="Tillar va tarjimalar"
        description="Ilova interfeysi o‘zbek, ingliz va rus tillarida (matnlar ilova ichida, statik). Bu yerda qaysi tillar yoqilgani va admin yozadigan kontentning tarjimalari boshqariladi."
      />

      {notice ? <div className="panel economy-notice">{notice}</div> : null}

      <div className="metric-grid four">
        {LANGUAGES.map((language) => (
          <div key={language} className="metric-card">
            <span>{LANGUAGE_NAMES[language]}</span>
            <strong>{(overview.users[language] ?? 0).toLocaleString("uz-UZ")} foydalanuvchi</strong>
            <span className="muted">
              {overview.decks[language]?.total ?? 0} taqdimot · 30 kunda {overview.decks[language]?.last_30_days ?? 0}
            </span>
          </div>
        ))}
        <div className="metric-card">
          <span>Tarjima qamrovi</span>
          <strong>EN {overview.coverage.en}/{overview.coverage.total} · RU {overview.coverage.ru}/{overview.coverage.total}</strong>
          <span className="muted">Admin kontenti</span>
        </div>
      </div>

      <SettingsPanel settings={overview.settings} canEdit={isSuperAdmin} onDone={done} />
      <UsagePanel overview={overview} />
      <TranslationsPanel entries={entries} onDone={done} />
      <HistoryPanel overview={overview} />
    </div>
  );
}

/* ------------------------------------------------------------ the switches */

function SettingsPanel({ settings, canEdit, onDone }: {
  settings: LanguageSettings; canEdit: boolean; onDone: (message: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<LanguageSettings>(settings);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDraft(settings); }, [settings]);

  const toggle = (kind: keyof LanguageSettings, language: Language) => setDraft((current) => ({
    ...current,
    [kind]: current[kind].includes(language)
      ? current[kind].filter((entry) => entry !== language)
      : [...current[kind], language],
  }));

  const changed = JSON.stringify([...draft.ui].sort()) !== JSON.stringify([...settings.ui].sort())
    || JSON.stringify([...draft.deck].sort()) !== JSON.stringify([...settings.deck].sort());

  async function save() {
    if (!reason.trim()) { setError("O‘zgarish sababini yozing."); return; }
    setBusy(true);
    setError(null);
    try {
      await saveLanguageSettings(draft, reason.trim());
      setReason("");
      await onDone("Til sozlamalari saqlandi.");
    } catch (failure) {
      setError(errorMessage(failure) === "forbidden" ? "Tillarni faqat super admin yoqib-o‘chira oladi." : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel economy-section">
      <h2><Languages size={18} /> Yoqilgan tillar</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Til</th><th>Ilova interfeysi</th><th>Taqdimot yaratish</th></tr></thead>
          <tbody>
            {LANGUAGES.map((language) => (
              <tr key={language}>
                <td><strong>{LANGUAGE_NAMES[language]}</strong> <span className="muted">{language.toUpperCase()}</span></td>
                {(["ui", "deck"] as const).map((kind) => (
                  <td key={kind}>
                    <input
                      type="checkbox"
                      aria-label={`${LANGUAGE_NAMES[language]} — ${kind === "ui" ? "interfeys" : "taqdimot"}`}
                      checked={draft[kind].includes(language)}
                      disabled={!canEdit || language === "uz"}
                      onChange={() => toggle(kind, language)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted panel-note">O‘zbek tili asosiy til — uni o‘chirib bo‘lmaydi. Taqdimot tili o‘chirilsa, server shu tilda yangi taqdimot yaratishni rad etadi.</p>
      {canEdit ? (
        <>
          <div className="form-grid">
            <label className="wide">O‘zgarish sababi (audit jurnaliga yoziladi)
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: rus tilidagi taqdimotlar vaqtincha to‘xtatildi" />
            </label>
          </div>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="header-actions">
            <button className="primary-button" type="button" disabled={busy || !changed} onClick={() => void save()}>
              <Save size={16} /> {busy ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </div>
        </>
      ) : <p className="muted panel-note">Tillarni yoqish-o‘chirish faqat super admin uchun.</p>}
    </section>
  );
}

/* ------------------------------------------------------------- the costs */

function UsagePanel({ overview }: { overview: LanguageOverview }) {
  return (
    <section className="panel flush">
      <h2 className="panel-title">AI xarajati tillar bo‘yicha (30 kun)</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Til</th><th>Taqdimotlar</th><th>Kiruvchi token</th><th>Chiquvchi token</th><th>Xarajat (USD)</th><th>1 taqdimotga</th></tr></thead>
          <tbody>
            {LANGUAGES.map((language) => {
              const usage = overview.usage[language];
              const perDeck = usage && usage.decks > 0 ? Number(usage.cost_usd) / usage.decks : null;
              return (
                <tr key={language}>
                  <td>{LANGUAGE_NAMES[language]}</td>
                  <td>{usage?.decks ?? 0}</td>
                  <td>{(usage?.input_tokens ?? 0).toLocaleString("uz-UZ")}</td>
                  <td>{(usage?.output_tokens ?? 0).toLocaleString("uz-UZ")}</td>
                  <td>{usage ? `$${Number(usage.cost_usd).toFixed(4)}` : "—"}</td>
                  <td>{perDeck !== null ? `$${perDeck.toFixed(4)}` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted panel-note">Taqdimot tili generatsiya so‘roviga bitta qisqa ko‘rsatma sifatida qo‘shiladi — qo‘shimcha tarjima chaqiruvi yo‘q. Token sarfi tillar orasida farq qilishi mumkin; bu jadval haqiqiy sarfni ko‘rsatadi.</p>
    </section>
  );
}

/* -------------------------------------------------------- the translations */

function TranslationsPanel({ entries, onDone }: { entries: TranslationEntry[]; onDone: (message: string) => Promise<void> }) {
  const [entity, setEntity] = useState<"all" | TranslationEntry["entity"]>("all");
  const [missingOnly, setMissingOnly] = useState(false);

  const shown = useMemo(() => entries.filter((entry) =>
    (entity === "all" || entry.entity === entity)
    && (!missingOnly || !entry.values.en || !entry.values.ru)), [entity, entries, missingOnly]);

  return (
    <section className="panel flush">
      <div className="panel-title-row">
        <h2 className="panel-title">Kontent tarjimalari</h2>
        <div className="language-filters">
          <select value={entity} onChange={(e) => setEntity(e.target.value as typeof entity)} aria-label="Kontent turi">
            <option value="all">Barchasi</option>
            {(Object.keys(ENTITY_LABELS) as TranslationEntry["entity"][]).map((key) => <option key={key} value={key}>{ENTITY_LABELS[key]}</option>)}
          </select>
          <label className="language-check">
            <input type="checkbox" checked={missingOnly} onChange={(e) => setMissingOnly(e.target.checked)} /> Faqat tarjimasizlar
          </label>
        </div>
      </div>
      <div className="table-wrap">
        <table className="language-table">
          <thead><tr><th>Kontent</th><th>O‘zbekcha (asl)</th><th>English</th><th>Русский</th><th /></tr></thead>
          <tbody>
            {shown.map((entry) => <TranslationRow key={`${entry.entity}:${entry.id}:${entry.field}`} entry={entry} onDone={onDone} />)}
            {shown.length === 0 ? <tr><td colSpan={5} className="muted">Ko‘rsatiladigan kontent yo‘q.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <p className="muted panel-note">O‘zbekcha matn kontentning o‘z sahifasida tahrirlanadi (Tariflar, J Tanga iqtisodiyoti, Do‘kon, iOS to‘lov siyosati). Bo‘sh qoldirilgan tarjima o‘rniga ilova o‘zbekcha matnni ko‘rsatadi.</p>
    </section>
  );
}

function TranslationRow({ entry, onDone }: { entry: TranslationEntry; onDone: (message: string) => Promise<void> }) {
  const [en, setEn] = useState(entry.values.en ?? "");
  const [ru, setRu] = useState(entry.values.ru ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const long = entry.source.length > 90;
  const dirty = en !== (entry.values.en ?? "") || ru !== (entry.values.ru ?? "");

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await saveTranslation(entry, { en: en.trim(), ru: ru.trim() });
      await onDone(`${entry.group} — ${FIELD_LABELS[entry.field] ?? entry.field}: tarjima saqlandi.`);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const Field = long ? "textarea" : "input";
  return (
    <tr>
      <td>
        <strong>{entry.group}</strong>
        <br />
        <span className="muted">{ENTITY_LABELS[entry.entity]} · {FIELD_LABELS[entry.field] ?? entry.field}{entry.active ? "" : " · faol emas"}</span>
      </td>
      <td className="language-source">{entry.source}</td>
      <td><Field className="cell-input language-input" value={en} onChange={(e: { target: { value: string } }) => setEn(e.target.value)} lang="en" /></td>
      <td><Field className="cell-input language-input" value={ru} onChange={(e: { target: { value: string } }) => setRu(e.target.value)} lang="ru" /></td>
      <td>
        <button className="secondary-button compact" type="button" disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? "…" : dirty ? <><Save size={14} /> Saqlash</> : <Check size={14} />}
        </button>
        {error ? <p className="form-error">{error}</p> : null}
      </td>
    </tr>
  );
}

/* ----------------------------------------------------------- the history */

function HistoryPanel({ overview }: { overview: LanguageOverview }) {
  return (
    <section className="panel flush">
      <h2 className="panel-title"><History size={18} /> O‘zgarishlar tarixi</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Vaqt</th><th>Kim</th><th>Nima</th><th>Avval</th><th>Keyin</th><th>Sabab</th></tr></thead>
          <tbody>
            {overview.history.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString("uz-UZ")}</td>
                <td>{row.admin_name || "—"}</td>
                <td>{row.action === "languages.updated" ? "Yoqilgan tillar" : `${ENTITY_LABELS[row.target_type as TranslationEntry["entity"]] ?? row.target_type} · ${row.target_id}`}</td>
                <td><code className="language-json">{describe(row.before_data)}</code></td>
                <td><code className="language-json">{describe(row.after_data)}</code></td>
                <td>{row.reason ?? "—"}</td>
              </tr>
            ))}
            {overview.history.length === 0 ? <tr><td colSpan={6} className="muted">Hali o‘zgarish yo‘q.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function describe(value: Record<string, unknown> | null): string {
  if (!value) return "—";
  const values = (value.values ?? value) as Record<string, unknown>;
  return Object.entries(values).map(([key, text]) => `${key}: ${Array.isArray(text) ? text.join(", ") : String(text)}`).join(" · ") || "—";
}
