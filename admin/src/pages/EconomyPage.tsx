import { AlertTriangle, Gift, History, Pencil, Plus, Send } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ErrorState, Modal, PageHeader } from "@/components/AdminUI";
import {
  SERVICE_LABELS,
  backfillWelcome,
  deckCoins,
  formatUzs,
  grantPresentationPages,
  loadEconomy,
  publishEconomy,
  savePackage,
  savePlanEconomy,
  type EconomyOverview,
  type EconomyPackage,
  type EconomyPlan,
  type I18n,
  type Rounding,
  type ServiceKey,
  type ServicePrice,
  type WelcomeSettings,
} from "@/lib/economy";
import { errorMessage } from "@/lib/format";

/**
 * J Tanga iqtisodiyoti.
 *
 * One page for everything the operator decides about money: what a J Tanga is
 * worth, what each service costs, what each tariff grants, the packs on sale,
 * and the welcome. A price change is published as a new version — what was
 * charged before keeps the price it was charged at — and only a super admin
 * may publish one. The warnings at the top are the server's, recomputed for
 * the prices in force.
 */
export function EconomyPage() {
  const [data, setData] = useState<EconomyOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingPlan, setEditingPlan] = useState<EconomyPlan | null>(null);
  const [editingPackage, setEditingPackage] = useState<Partial<EconomyPackage> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await loadEconomy());
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const done = async (message: string) => {
    setNotice(message);
    await load();
  };

  if (error && !data) return <div className="page-stack"><ErrorState message={error} onRetry={() => void load()} /></div>;
  if (!data) return <div className="page-stack"><p className="muted">{loading ? "Yuklanmoqda…" : ""}</p></div>;

  const presentation = data.services.find((service) => service.service === "presentation");

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="IQTISOD"
        title="J Tanga iqtisodiyoti"
        description={`Hozirgi versiya: ${data.current.version}. Narx o‘zgarishi yangi versiya bo‘lib e’lon qilinadi; avvalgi to‘lovlar o‘z narxida qoladi.`}
      />

      {notice ? <div className="panel economy-notice">{notice}</div> : null}
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <div className="metric-grid">
        <Metric label="1 J Tanga qiymati" value={formatUzs(data.current.coin_value_uzs)} />
        <Metric label="Tarifsiz sahifa narxi" value={presentation ? `${(presentation.coins_per_unit * data.current.no_plan_multiplier).toFixed(2)} J` : "—"} />
        <Metric label="Muomaladagi J Tanga" value={`${data.liability.coins.toLocaleString("uz-UZ")} J ≈ ${formatUzs(data.liability.coins * data.liability.coin_value_uzs)}`} />
        <Metric label="Shundan tarif tangalari" value={`${data.liability.plan_coins.toLocaleString("uz-UZ")} J`} />
        <Metric label="Sotilgan sahifalar qoldig‘i" value={`${data.liability.bought_pages} sahifa`} />
        <Metric label="Bonus olganlar" value={`${data.welcome.accounts} ta · ${data.welcome.pages_left} sahifa qoldi`} />
      </div>

      {data.warnings.length > 0 ? (
        <section className="panel economy-section economy-warnings">
          <h2><AlertTriangle size={18} /> Ogohlantirishlar</h2>
          <ul>
            {data.warnings.map((warning, index) => (
              <li key={`${warning.code}-${index}`} className={warning.level === "error" ? "economy-error" : "economy-warn"}>{warning.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <PricesPanel data={data} onDone={done} />
      <PlansPanel data={data} onEdit={setEditingPlan} />
      <PackagesPanel data={data} onEdit={setEditingPackage} />
      <WelcomePanel data={data} onDone={done} />
      <HistoryPanel data={data} />

      {editingPlan ? (
        <PlanModal plan={editingPlan} data={data} onClose={() => setEditingPlan(null)}
          onSaved={async () => { setEditingPlan(null); await done("Tarif saqlandi."); }} />
      ) : null}
      {editingPackage ? (
        <PackageModal pack={editingPackage} onClose={() => setEditingPackage(null)}
          onSaved={async () => { setEditingPackage(null); await done("Paket saqlandi."); }} />
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

/* --------------------------------------------------------------- prices */

function PricesPanel({ data, onDone }: { data: EconomyOverview; onDone: (message: string) => Promise<void> }) {
  const [coinValue, setCoinValue] = useState(String(data.current.coin_value_uzs));
  const [rounding, setRounding] = useState<Rounding>(data.current.rounding);
  const [noPlan, setNoPlan] = useState(String(data.current.no_plan_multiplier));
  const [minCharge, setMinCharge] = useState(String(data.current.min_charge));
  const [maxCharge, setMaxCharge] = useState(String(data.current.max_charge));
  const [services, setServices] = useState<Record<string, ServicePrice>>(
    () => Object.fromEntries(data.services.map((service) => [service.service, { ...service }])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setService = (key: string, field: keyof ServicePrice, value: string | boolean) =>
    setServices((current) => ({ ...current, [key]: { ...current[key]!, [field]: value } }));

  async function publish() {
    if (!note.trim()) { setError("O‘zgarish sababini yozing."); return; }
    setBusy(true);
    setError(null);
    try {
      const changes: Partial<Record<ServiceKey, Partial<ServicePrice>>> = {};
      for (const service of data.services) {
        const draft = services[service.service]!;
        changes[service.service] = {
          coins_per_unit: Number(draft.coins_per_unit), ai_markup: Number(draft.ai_markup),
          min_units: Number(draft.min_units), max_units: Number(draft.max_units),
          min_charge: Number(draft.min_charge), max_charge: Number(draft.max_charge),
          promo_percent: Number(draft.promo_percent), is_enabled: Boolean(draft.is_enabled),
        };
      }
      const result = await publishEconomy({
        coin_value_uzs: Number(coinValue), rounding, no_plan_multiplier: Number(noPlan),
        min_charge: Number(minCharge), max_charge: Number(maxCharge),
      }, changes, note.trim());
      setNote("");
      await onDone(`Versiya ${result.version} e’lon qilindi.${result.warnings.length ? ` Ogohlantirishlar: ${result.warnings.length}.` : ""}`);
    } catch (failure) {
      setError(errorMessage(failure) === "forbidden" ? "Narxlarni faqat super admin o‘zgartira oladi." : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel economy-section">
      <h2>Narxlar</h2>
      <div className="form-grid">
        <label>1 J Tanga qiymati (so‘m)<input type="number" min={0} step="0.01" value={coinValue} onChange={(e) => setCoinValue(e.target.value)} /></label>
        <label>Yaxlitlash
          <select value={rounding} onChange={(e) => setRounding(e.target.value as Rounding)}>
            <option value="ceil">Yuqoriga</option><option value="round">Eng yaqin</option><option value="floor">Pastga</option>
          </select>
        </label>
        <label>Tarifsiz koeffitsient<input type="number" min={0} step="0.000000001" value={noPlan} onChange={(e) => setNoPlan(e.target.value)} /></label>
        <label>Eng kam to‘lov (J)<input type="number" min={0} value={minCharge} onChange={(e) => setMinCharge(e.target.value)} /></label>
        <label>Eng ko‘p to‘lov (J)<input type="number" min={1} value={maxCharge} onChange={(e) => setMaxCharge(e.target.value)} /></label>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Xizmat</th><th>J / birlik</th><th>AI ustama ×</th><th>Min birlik</th><th>Max birlik</th><th>Min J</th><th>Max J</th><th>Chegirma %</th><th>Yoqilgan</th></tr>
          </thead>
          <tbody>
            {data.services.map((service) => {
              const draft = services[service.service]!;
              return (
                <tr key={service.service}>
                  <td>{SERVICE_LABELS[service.service]}</td>
                  <td><input className="cell-input" type="number" min={0} step="0.01" value={draft.coins_per_unit} disabled={service.unit === "ai_cost"} onChange={(e) => setService(service.service, "coins_per_unit", e.target.value)} /></td>
                  <td><input className="cell-input" type="number" min={0.01} step="0.01" value={draft.ai_markup} disabled={service.unit !== "ai_cost"} onChange={(e) => setService(service.service, "ai_markup", e.target.value)} /></td>
                  <td><input className="cell-input" type="number" min={0} value={draft.min_units} onChange={(e) => setService(service.service, "min_units", e.target.value)} /></td>
                  <td><input className="cell-input" type="number" min={1} value={draft.max_units} onChange={(e) => setService(service.service, "max_units", e.target.value)} /></td>
                  <td><input className="cell-input" type="number" min={0} value={draft.min_charge} onChange={(e) => setService(service.service, "min_charge", e.target.value)} /></td>
                  <td><input className="cell-input" type="number" min={1} value={draft.max_charge} onChange={(e) => setService(service.service, "max_charge", e.target.value)} /></td>
                  <td><input className="cell-input" type="number" min={0} max={99} value={draft.promo_percent} onChange={(e) => setService(service.service, "promo_percent", e.target.value)} /></td>
                  <td><input type="checkbox" checked={draft.is_enabled} onChange={(e) => setService(service.service, "is_enabled", e.target.checked)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="form-grid">
        <label className="wide">O‘zgarish sababi (audit jurnaliga yoziladi)<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Masalan: sahifa narxi 12 J ga oshirildi" /></label>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="header-actions">
        <button className="primary-button" type="button" disabled={busy} onClick={() => void publish()}>
          <Send size={16} /> {busy ? "E’lon qilinmoqda…" : "Yangi versiyani e’lon qilish"}
        </button>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- plans */

function PlansPanel({ data, onEdit }: { data: EconomyOverview; onEdit: (plan: EconomyPlan) => void }) {
  const perPage = data.services.find((service) => service.service === "presentation")?.coins_per_unit ?? 10;
  return (
    <section className="panel flush">
      <h2 className="panel-title">Tariflar iqtisodi</h2>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Tarif</th><th>Narx</th><th>Hisob</th><th>Oylik J</th><th>Taqdimot</th><th>Sahifa narxi</th><th>Kerak J</th><th>Ko‘rinadi</th><th /></tr>
          </thead>
          <tbody>
            {data.plans.map((plan) => {
              const deck = deckCoins(plan.pages_per_unit, perPage, Number(plan.page_multiplier), data.current.rounding);
              const needed = plan.presentation_units * deck;
              return (
                <tr key={plan.id}>
                  <td><strong>{plan.name}</strong><br /><span className="muted">{plan.code}</span></td>
                  <td>{formatUzs(plan.price_amount)}</td>
                  <td>{plan.billing_model === "coins" ? "J Tanga" : "Haftalik limit"}</td>
                  <td>{plan.billing_model === "coins" ? plan.included_coins.toLocaleString("uz-UZ") : "—"}</td>
                  <td>{plan.billing_model === "coins" ? `${plan.presentation_units} × ${plan.pages_per_unit}` : "—"}</td>
                  <td>{plan.billing_model === "coins" ? `${(perPage * Number(plan.page_multiplier)).toFixed(4)} J` : "—"}</td>
                  <td className={plan.billing_model === "coins" && plan.included_coins < needed ? "economy-error" : undefined}>
                    {plan.billing_model === "coins" ? needed.toLocaleString("uz-UZ") : "—"}
                  </td>
                  <td>{plan.is_visible && plan.is_active ? "Ha" : "Yo‘q"}</td>
                  <td><button className="secondary-button compact" type="button" onClick={() => onEdit(plan)}><Pencil size={14} /> Tahrirlash</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="muted panel-note">Narx, nom va xususiyatlar “Tariflar” sahifasida tahrirlanadi. Sotib olingan tarif o‘z nusxasi (snapshot) bilan ishlaydi — keyingi o‘zgarishlar unga ta’sir qilmaydi.</p>
    </section>
  );
}

function I18nFields({ label, value, onChange }: { label: string; value: I18n; onChange: (value: I18n) => void }) {
  return (
    <>
      {(["uz", "en", "ru"] as const).map((language) => (
        <label key={language}>{label} ({language.toUpperCase()})
          <input value={value[language] ?? ""} onChange={(e) => onChange({ ...value, [language]: e.target.value })} />
        </label>
      ))}
    </>
  );
}

function PlanModal({ plan, data, onClose, onSaved }: { plan: EconomyPlan; data: EconomyOverview; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<EconomyPlan>({ ...plan });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const perPage = data.services.find((service) => service.service === "presentation")?.coins_per_unit ?? 10;
  const deck = deckCoins(draft.pages_per_unit, perPage, Number(draft.page_multiplier), data.current.rounding);
  const set = <K extends keyof EconomyPlan>(key: K, value: EconomyPlan[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePlanEconomy(plan.id, {
        billing_model: draft.billing_model, included_coins: Number(draft.included_coins),
        presentation_units: Number(draft.presentation_units), pages_per_unit: Number(draft.pages_per_unit),
        page_multiplier: Number(draft.page_multiplier), is_visible: draft.is_visible,
        name_i18n: draft.name_i18n, description_i18n: draft.description_i18n, badge_i18n: draft.badge_i18n,
      });
      await onSaved();
    } catch (failure) {
      setError(errorMessage(failure) === "forbidden" ? "Tarif iqtisodini faqat super admin o‘zgartira oladi." : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={`${plan.name} — iqtisod`} description="Oylik J Tanga, taqdimot soni, sahifa koeffitsienti va uch tildagi matnlar." onClose={onClose}>
      <div className="form-grid">
        <label>Hisob turi
          <select value={draft.billing_model} onChange={(e) => set("billing_model", e.target.value as EconomyPlan["billing_model"])}>
            <option value="coins">J Tanga (oylik)</option><option value="quota">Haftalik limit (eski)</option>
          </select>
        </label>
        <label>Oylik J Tanga<input type="number" min={0} value={draft.included_coins} onChange={(e) => set("included_coins", Number(e.target.value))} /></label>
        <label>Taqdimotlar soni<input type="number" min={0} value={draft.presentation_units} onChange={(e) => set("presentation_units", Number(e.target.value))} /></label>
        <label>Bitta taqdimot sahifasi<input type="number" min={1} value={draft.pages_per_unit} onChange={(e) => set("pages_per_unit", Number(e.target.value))} /></label>
        <label>Sahifa koeffitsienti<input type="number" min={0} step="0.000000001" value={draft.page_multiplier} onChange={(e) => set("page_multiplier", Number(e.target.value))} /></label>
        <label className="checkbox"><input type="checkbox" checked={draft.is_visible} onChange={(e) => set("is_visible", e.target.checked)} /> Ilovada ko‘rinadi</label>
        <I18nFields label="Nomi" value={draft.name_i18n} onChange={(value) => set("name_i18n", value)} />
        <I18nFields label="Tavsif" value={draft.description_i18n} onChange={(value) => set("description_i18n", value)} />
        <I18nFields label="Belgi" value={draft.badge_i18n} onChange={(value) => set("badge_i18n", value)} />
      </div>
      <p className="muted">Bitta taqdimot: {deck} J. {draft.presentation_units} ta uchun kerak: {(draft.presentation_units * deck).toLocaleString("uz-UZ")} J.
        {draft.billing_model === "coins" && draft.included_coins < draft.presentation_units * deck ? " Oylik J Tanga va’da qilingan taqdimotlarga yetmaydi!" : ""}</p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="header-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Bekor qilish</button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saqlanmoqda…" : "Saqlash"}</button>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- packages */

function PackagesPanel({ data, onEdit }: { data: EconomyOverview; onEdit: (pack: Partial<EconomyPackage>) => void }) {
  return (
    <section className="panel flush">
      <div className="panel-title-row">
        <h2 className="panel-title">Tanga paketlari va taqdimot sahifalari</h2>
        <button className="secondary-button compact" type="button" onClick={() => onEdit({ is_active: true, coins: 0, bonus_coins: 0, presentation_pages: 0, price_amount: 0, sort_order: 50, label_i18n: {}, description_i18n: {} })}>
          <Plus size={14} /> Yangi paket
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Paket</th><th>Turi</th><th>Miqdor</th><th>Narx</th><th>1 birlik</th><th>Limit</th><th>Muddat</th><th>Holat</th><th /></tr></thead>
          <tbody>
            {data.packages.map((pack) => {
              const units = pack.presentation_pages > 0 ? pack.presentation_pages : pack.coins + pack.bonus_coins;
              return (
                <tr key={pack.id}>
                  <td><strong>{pack.label}</strong><br /><span className="muted">{pack.code}</span></td>
                  <td>{pack.presentation_pages > 0 ? "Faqat taqdimot" : "J Tanga"}</td>
                  <td>{pack.presentation_pages > 0 ? `${pack.presentation_pages} sahifa` : `${pack.coins}${pack.bonus_coins ? ` + ${pack.bonus_coins}` : ""} J`}</td>
                  <td>{formatUzs(Number(pack.price_amount))}</td>
                  <td>{units > 0 ? `${(Number(pack.price_amount) / units).toFixed(2)} so‘m` : "—"}</td>
                  <td>{pack.purchase_limit ?? "—"}</td>
                  <td>{pack.starts_at || pack.ends_at ? `${pack.starts_at?.slice(0, 10) ?? "…"} – ${pack.ends_at?.slice(0, 10) ?? "…"}` : "Doimiy"}</td>
                  <td>{pack.is_active ? "Sotuvda" : "O‘chirilgan"}</td>
                  <td><button className="secondary-button compact" type="button" onClick={() => onEdit(pack)}><Pencil size={14} /> Tahrirlash</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PackageModal({ pack, onClose, onSaved }: { pack: Partial<EconomyPackage>; onClose: () => void; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState<Partial<EconomyPackage>>({ ...pack });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pages = (draft.presentation_pages ?? 0) > 0;
  const set = <K extends keyof EconomyPackage>(key: K, value: EconomyPackage[K]) => setDraft((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await savePackage({
        ...draft,
        coins: pages ? 0 : Number(draft.coins ?? 0),
        bonus_coins: pages ? 0 : Number(draft.bonus_coins ?? 0),
        presentation_pages: Number(draft.presentation_pages ?? 0),
        price_amount: Number(draft.price_amount ?? 0),
        sort_order: Number(draft.sort_order ?? 0),
      });
      await onSaved();
    } catch (failure) {
      setError(errorMessage(failure) === "forbidden" ? "Paketlarni faqat super admin o‘zgartira oladi." : errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={pack.id ? pack.label ?? "Paket" : "Yangi paket"} description="J Tanga paketi yoki faqat taqdimot uchun sahifalar. Ikkalasi bitta paketda bo‘lmaydi." onClose={onClose}>
      <div className="form-grid">
        <label>Kod<input value={draft.code ?? ""} onChange={(e) => set("code", e.target.value)} placeholder="jt_500" /></label>
        <label>Nomi<input value={draft.label ?? ""} onChange={(e) => set("label", e.target.value)} /></label>
        <label>Turi
          <select value={pages ? "pages" : "coins"} onChange={(e) => setDraft((current) => (e.target.value === "pages"
            ? { ...current, presentation_pages: current.presentation_pages || 10, coins: 0, bonus_coins: 0 }
            : { ...current, presentation_pages: 0, coins: current.coins || 100 }))}>
            <option value="coins">J Tanga</option><option value="pages">Faqat taqdimot sahifalari</option>
          </select>
        </label>
        {pages ? (
          <label>Sahifalar<input type="number" min={1} value={draft.presentation_pages ?? 0} onChange={(e) => set("presentation_pages", Number(e.target.value))} /></label>
        ) : (
          <>
            <label>J Tanga<input type="number" min={1} value={draft.coins ?? 0} onChange={(e) => set("coins", Number(e.target.value))} /></label>
            <label>Bonus J<input type="number" min={0} value={draft.bonus_coins ?? 0} onChange={(e) => set("bonus_coins", Number(e.target.value))} /></label>
          </>
        )}
        <label>Narx (so‘m)<input type="number" min={0} value={draft.price_amount ?? 0} onChange={(e) => set("price_amount", Number(e.target.value))} /></label>
        <label>Tartib<input type="number" value={draft.sort_order ?? 0} onChange={(e) => set("sort_order", Number(e.target.value))} /></label>
        <label>Bir kishiga limit<input type="number" min={1} value={draft.purchase_limit ?? ""} onChange={(e) => set("purchase_limit", e.target.value ? Number(e.target.value) : null)} placeholder="Cheksiz" /></label>
        <label>Sotuv boshlanishi<input type="date" value={draft.starts_at?.slice(0, 10) ?? ""} onChange={(e) => set("starts_at", e.target.value ? `${e.target.value}T00:00:00+05:00` : null)} /></label>
        <label>Sotuv tugashi<input type="date" value={draft.ends_at?.slice(0, 10) ?? ""} onChange={(e) => set("ends_at", e.target.value ? `${e.target.value}T23:59:59+05:00` : null)} /></label>
        <label className="checkbox"><input type="checkbox" checked={draft.is_active ?? true} onChange={(e) => set("is_active", e.target.checked)} /> Sotuvda</label>
        <I18nFields label="Nomi" value={draft.label_i18n ?? {}} onChange={(value) => set("label_i18n", value)} />
        <I18nFields label="Tavsif" value={draft.description_i18n ?? {}} onChange={(value) => set("description_i18n", value)} />
      </div>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="header-actions">
        <button className="secondary-button" type="button" onClick={onClose}>Bekor qilish</button>
        <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>{busy ? "Saqlanmoqda…" : "Saqlash"}</button>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- welcome */

function WelcomePanel({ data, onDone }: { data: EconomyOverview; onDone: (message: string) => Promise<void> }) {
  const settings = data.welcome.settings;
  const [draft, setDraft] = useState<WelcomeSettings>({ ...settings });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState("");
  const [pages, setPages] = useState("10");
  const [reason, setReason] = useState("");

  async function run(key: string, action: () => Promise<string>) {
    setBusy(key);
    setError(null);
    try {
      await onDone(await action());
    } catch (failure) {
      setError(errorMessage(failure) === "forbidden" ? "Bu amal uchun ruxsat yo‘q." : errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="panel economy-section">
      <h2><Gift size={18} /> Bepul imkoniyatlar</h2>
      <p className="muted">Yangi foydalanuvchiga bir martalik bepul taqdimot sahifalari. Faqat taqdimotga sarflanadi, sotilmaydi va o‘tkazilmaydi. Bir email/telefon — bir marta.</p>
      <div className="form-grid">
        <label className="checkbox"><input type="checkbox" checked={draft.enabled ?? false} onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })} /> Yoqilgan</label>
        <label>Sahifalar<input type="number" min={0} value={draft.pages ?? 30} onChange={(e) => setDraft({ ...draft, pages: Number(e.target.value) })} /></label>
        <label>Amal qilish muddati (kun)<input type="number" min={1} value={draft.expires_days ?? ""} placeholder="Muddatsiz" onChange={(e) => setDraft({ ...draft, expires_days: e.target.value ? Number(e.target.value) : null })} /></label>
        <label className="checkbox"><input type="checkbox" checked={draft.retroactive ?? false} onChange={(e) => setDraft({ ...draft, retroactive: e.target.checked })} /> Eski akkauntlarga ham</label>
      </div>
      <p className="muted">Faqat shu sanadan keyin ochilgan akkauntlar: {settings.eligible_from ? new Date(settings.eligible_from).toLocaleString("uz-UZ") : "—"}</p>
      <div className="header-actions">
        <button className="primary-button" type="button" disabled={busy !== null} onClick={() => void run("welcome", async () => {
          const result = await publishEconomy({ welcome: draft }, {}, "Bepul imkoniyatlar sozlamasi");
          return `Bonus sozlamasi saqlandi (versiya ${result.version}).`;
        })}>{busy === "welcome" ? "Saqlanmoqda…" : "Saqlash"}</button>
        <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => {
          if (!window.confirm("Bonusni hali olmagan barcha eski akkauntlarga berasizmi? Har bir email/telefon faqat bir marta oladi.")) return;
          void run("backfill", async () => {
            const result = await backfillWelcome(1000);
            return `${result.checked} ta akkaunt tekshirildi, ${result.granted} tasiga bonus berildi.`;
          });
        }}>{busy === "backfill" ? "Berilmoqda…" : "Eski akkauntlarga berish"}</button>
      </div>

      <h3>Foydalanuvchiga sahifa sovg‘a qilish</h3>
      <div className="form-grid">
        <label>Foydalanuvchi ID<input value={userId} onChange={(e) => setUserId(e.target.value.trim())} placeholder="uuid" /></label>
        <label>Sahifalar<input type="number" min={1} max={1000} value={pages} onChange={(e) => setPages(e.target.value)} /></label>
        <label className="wide">Sabab<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Masalan: texnik nosozlik uchun kompensatsiya" /></label>
      </div>
      <div className="header-actions">
        <button className="secondary-button" type="button" disabled={busy !== null || !userId || !reason.trim()} onClick={() => void run("grant", async () => {
          await grantPresentationPages(userId, Number(pages), reason.trim());
          setReason("");
          return `${pages} sahifa sovg‘a qilindi.`;
        })}>{busy === "grant" ? "Berilmoqda…" : "Sovg‘a qilish"}</button>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </section>
  );
}

/* -------------------------------------------------------------- history */

function HistoryPanel({ data }: { data: EconomyOverview }) {
  return (
    <section className="panel flush">
      <h2 className="panel-title"><History size={18} /> Versiyalar tarixi</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Versiya</th><th>Kuchga kirgan</th><th>1 J</th><th>Tarifsiz koeff.</th><th>Yaxlitlash</th><th>Kim</th><th>Sabab</th></tr></thead>
          <tbody>
            {data.history.map((row) => (
              <tr key={row.version}>
                <td>{row.version}</td>
                <td>{new Date(row.effective_from).toLocaleString("uz-UZ")}</td>
                <td>{formatUzs(row.coin_value_uzs)}</td>
                <td>{Number(row.no_plan_multiplier).toFixed(6)}</td>
                <td>{row.rounding}</td>
                <td>{row.created_by ?? "—"}</td>
                <td>{row.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
