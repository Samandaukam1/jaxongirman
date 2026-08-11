import type { Database, Json } from "@jaxongirman/types";
import { CreditCard, Plus, Save, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, priceIn } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type CoinPackage = Database["public"]["Tables"]["coin_packages"]["Row"];

/** The shape stored under `app_settings.modules.data_collection`. */
type ModuleConfig = {
  code: string;
  label: string;
  enabled: boolean;
  price_amount: number;
  currency: string;
  duration_months: number;
  enforce_creator_access: boolean;
  enforce_respondent_access: boolean;
  response_retention_hours: number;
  max_questions: number;
  max_image_bytes: number;
};

type PaymentConfig = { provider: string | null; configured: boolean };
type IosCopy = { subscription?: string; jcoin?: string; marketplace?: string; module?: string };
type IosPolicy = { review_mode: boolean; copy: IosCopy };

const EMPTY_PACKAGE = { code: "", label: "", coins: "", bonus: "0", price: "", currency: "UZS", description: "", sort: "0" };

/**
 * Everything about the paid modules that is configuration rather than code:
 * what Ma'lumotlarni yig'ish costs, how long access lasts, whether the rule is
 * enforced at all, what coin packages exist, and whether a payment provider
 * is wired up.
 *
 * The enforcement switches are the important pair. They are off while no
 * provider exists, because turning them on with no way to buy access would
 * close the module to everyone — and the apps read this state rather than
 * assuming either answer.
 */
export function ModulesPage() {
  const [config, setConfig] = useState<ModuleConfig | null>(null);
  const [payments, setPayments] = useState<PaymentConfig>({ provider: null, configured: false });
  const [ios, setIos] = useState<IosPolicy>({ review_mode: false, copy: {} });
  const [iosReason, setIosReason] = useState("");
  const [packages, setPackages] = useState<CoinPackage[]>([]);
  const [draft, setDraft] = useState(EMPTY_PACKAGE);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [settingsResult, packagesResult] = await Promise.all([
      supabase.from("app_settings").select("key,value").in("key", ["modules.data_collection", "payments.config", "payments.ios_policy"]),
      supabase.from("coin_packages").select("*").order("sort_order").order("coins"),
    ]);
    const requestError = settingsResult.error ?? packagesResult.error;
    if (requestError) {
      setError(errorMessage(requestError));
    } else {
      const moduleRow = (settingsResult.data ?? []).find((row) => row.key === "modules.data_collection");
      const iosRow = (settingsResult.data ?? []).find((row) => row.key === "payments.ios_policy");
      if (iosRow) {
        const value = iosRow.value as unknown as IosPolicy;
        setIos({ review_mode: Boolean(value?.review_mode), copy: value?.copy ?? {} });
      }

      const paymentRow = (settingsResult.data ?? []).find((row) => row.key === "payments.config");
      if (moduleRow) setConfig(moduleRow.value as unknown as ModuleConfig);
      if (paymentRow) {
        const value = paymentRow.value as unknown as PaymentConfig;
        setPayments({ provider: value?.provider ?? null, configured: Boolean(value?.configured) });
      }
      setPackages(packagesResult.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  function patch(changes: Partial<ModuleConfig>) {
    setConfig((current) => (current ? { ...current, ...changes } : current));
  }

  async function saveModule() {
    if (!config) return;
    setSaving("module"); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("admin_update_app_setting", {
      p_key: "modules.data_collection",
      p_value: config as unknown as Json,
      p_reason: "Module configuration update",
    });
    if (saveError) setError(errorMessage(saveError));
    else setMessage("Modul sozlamalari saqlandi va audit jurnaliga yozildi.");
    setSaving(null);
  }

  async function saveIosPolicy(nextReviewMode: boolean) {
    setSaving("ios"); setError(null); setMessage(null);
    const { error: failure } = await supabase.rpc("admin_set_ios_payment_policy", {
      p_review_mode: nextReviewMode,
      p_copy: ios.copy as unknown as Json,
      p_reason: iosReason.trim(),
    });
    if (failure) setError(errorMessage(failure));
    else {
      setIos((current) => ({ ...current, review_mode: nextReviewMode }));
      setMessage(nextReviewMode
        ? "iOS Review Mode yoqildi. iOS ilovada tashqi to‘lovlar endi ko‘rinmaydi va server ularni rad etadi."
        : "iOS Review Mode o‘chirildi. iOS ilovada to‘lovlar yana ochiq.");
      setIosReason("");
    }
    setSaving(null);
  }

  async function savePayments() {
    setSaving("payments"); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("admin_update_app_setting", {
      p_key: "payments.config",
      p_value: { provider: payments.provider?.trim() || null, configured: payments.configured } as unknown as Json,
      p_reason: "Payment provider configuration update",
    });
    if (saveError) setError(errorMessage(saveError));
    else setMessage("To‘lov sozlamalari saqlandi.");
    setSaving(null);
  }

  async function savePackage(event: FormEvent) {
    event.preventDefault();
    setSaving("package"); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("admin_upsert_coin_package", {
      p_code: draft.code.trim().toLowerCase(),
      p_label: draft.label.trim(),
      p_coins: Number(draft.coins),
      p_price_amount: Number(draft.price),
      p_currency: draft.currency.trim().toUpperCase() || "UZS",
      p_bonus_coins: Number(draft.bonus || "0"),
      p_description: draft.description.trim(),
      p_sort_order: Number(draft.sort || "0"),
      p_is_active: true,
    });
    if (saveError) setError(errorMessage(saveError));
    else { setMessage(`“${draft.label}” paketi saqlandi.`); setDraft(EMPTY_PACKAGE); await load(); }
    setSaving(null);
  }

  async function togglePackage(item: CoinPackage) {
    setSaving(item.code);
    const { error: saveError } = await supabase.rpc("admin_upsert_coin_package", {
      p_code: item.code,
      p_label: item.label,
      p_coins: item.coins,
      p_price_amount: Number(item.price_amount),
      p_currency: item.currency,
      p_bonus_coins: item.bonus_coins,
      p_description: item.description,
      p_sort_order: item.sort_order,
      p_is_active: !item.is_active,
    });
    if (saveError) setError(errorMessage(saveError)); else await load();
    setSaving(null);
  }

  async function removePackage(item: CoinPackage) {
    setSaving(item.code);
    const { error: deleteError } = await supabase.rpc("admin_delete_coin_package", { p_code: item.code });
    if (deleteError) setError(errorMessage(deleteError)); else await load();
    setSaving(null);
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="MODULE CONTROL"
      title="Modullar va tangalar"
      description="Ma’lumotlarni yig‘ish moduli narxi, kirish muddati va majburiyligi, hamda tanga paketlari — barchasi koddan tashqarida, audit qilinadigan konfiguratsiyada."
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">DATA COLLECTION</p><h2>Ma’lumotlarni yig‘ish</h2></div></div>
      {loading || !config ? <TableSkeleton rows={4} /> : (
        <div className="finance-form">
          <label>Nomi<input value={config.label} onChange={(event) => patch({ label: event.target.value })} /></label>
          <label>Narx<input type="number" min="0" value={config.price_amount} onChange={(event) => patch({ price_amount: Number(event.target.value) })} /></label>
          <label>Valyuta<input value={config.currency} maxLength={3} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} /></label>
          <label>Muddat (oy)<input type="number" min="1" max="120" value={config.duration_months} onChange={(event) => patch({ duration_months: Number(event.target.value) })} /></label>
          <label>Javoblar saqlanishi (soat)<input type="number" min="1" max="720" value={config.response_retention_hours} onChange={(event) => patch({ response_retention_hours: Number(event.target.value) })} /></label>
          <label>Maksimal savollar<input type="number" min="1" max="200" value={config.max_questions} onChange={(event) => patch({ max_questions: Number(event.target.value) })} /></label>

          <label className="switch-row">
            <span>Modul yoqilgan</span>
            <span className="switch"><input type="checkbox" checked={config.enabled} onChange={(event) => patch({ enabled: event.target.checked })} /><span /></span>
          </label>
          <label className="switch-row">
            <span>Yaratuvchidan kirish talab qilinsin</span>
            <span className="switch"><input type="checkbox" checked={config.enforce_creator_access} onChange={(event) => patch({ enforce_creator_access: event.target.checked })} /><span /></span>
          </label>
          <label className="switch-row">
            <span>Javob beruvchidan kirish talab qilinsin</span>
            <span className="switch"><input type="checkbox" checked={config.enforce_respondent_access} onChange={(event) => patch({ enforce_respondent_access: event.target.checked })} /><span /></span>
          </label>

          <p className="finance-hint">
            {config.enforce_creator_access || config.enforce_respondent_access
              ? payments.configured
                ? "Kirish majburiy va to‘lov tizimi ulangan."
                : "Diqqat: kirish majburiy qilingan, lekin to‘lov tizimi ulanmagan. Foydalanuvchilar kirish huquqini faqat administrator orqali ola oladi."
              : "Kirish hozircha majburiy emas — modul barcha foydalanuvchilar uchun ochiq. To‘lov tizimi ulangach shu tugmalarni yoqing."}
          </p>

          <button className="primary-button" type="button" disabled={saving === "module"} onClick={() => void saveModule()}>
            <Save size={16} /> Modul sozlamalarini saqlash
          </button>
        </div>
      )}
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">PAYMENTS</p><h2>To‘lov provayderi</h2></div></div>
      <div className="finance-form">
        <label>Provayder nomi<input value={payments.provider ?? ""} placeholder="masalan: payme, click" onChange={(event) => setPayments((current) => ({ ...current, provider: event.target.value }))} /></label>
        <label className="switch-row">
          <span>To‘lov tizimi ulangan</span>
          <span className="switch"><input type="checkbox" checked={payments.configured} onChange={(event) => setPayments((current) => ({ ...current, configured: event.target.checked }))} /><span /></span>
        </label>
        <p className="finance-hint">
          Bu bayroq yoqilmaguncha ilova xaridni amalga oshirmaydi va foydalanuvchiga “to‘lov tizimi ulanmagan” holatini ko‘rsatadi. Uni faqat haqiqiy provayder ishga tushirilgach yoqing.
        </p>
        <button className="primary-button" type="button" disabled={saving === "payments"} onClick={() => void savePayments()}>
          <CreditCard size={16} /> To‘lov sozlamalarini saqlash
        </button>
      </div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">APP STORE</p><h2>iOS Review Mode</h2></div></div>
      <div className="finance-form">
        <label className="switch-row">
          <span>iOS ilovada tashqi to‘lovlar yopilgan</span>
          <span className="switch">
            <input
              type="checkbox"
              checked={ios.review_mode}
              disabled={saving === "ios"}
              onChange={(event) => void saveIosPolicy(event.target.checked)}
            />
            <span />
          </span>
        </label>

        <p className="finance-hint">
          Faqat iOS’ga ta’sir qiladi. Android va web hech qachon o‘zgarmaydi. Yoqilganda iOS
          ilovada tarif, J Coin, do‘kon va modul xaridi ko‘rinmaydi, narxlar yashiriladi va
          server iOS mijozdan kelgan to‘lov so‘rovini rad etadi. Ilovani qayta build qilish
          shart emas — o‘zgarish darhol kuchga kiradi.
        </p>

        <div className="warning-banner">
          <strong>Bu review paytidagi vaqtinchalik niqob emas.</strong> App Store Review
          Guideline 3.1.1 bo‘yicha ilova ichida ochiladigan kontent in-app purchase orqali
          sotilishi kerak, 2.3.1(a) esa “yashirin yoki uxlab yotgan” funksiyani taqiqlaydi.
          Review paytida qanday bo‘lsa, keyin ham shundayligicha qolishi kerak: keyin
          o‘chirilsa, bu ilovaning olib tashlanishiga va developer akkaunt bekor qilinishiga
          asos bo‘ladi. To‘g‘ri yechim — iOS uchun StoreKit in-app purchase qo‘shish.
        </div>

        <label>
          Sabab <span className="muted" style={{ fontWeight: 400 }}>(audit jurnaliga yoziladi)</span>
          <input
            value={iosReason}
            placeholder="Masalan: 1.4.0 App Store review uchun"
            onChange={(event) => setIosReason(event.target.value)}
          />
        </label>

        <p className="finance-hint">
          Ko‘rsatiladigan matnlar hech qanday boshqa to‘lov usulini nomlamaydi. Guideline
          3.1.1(a) AQSh storefront’idan tashqari hamma joyda in-app purchase’dan boshqa
          xaridga yo‘naltiruvchi matn va tugmalarni taqiqlaydi — “jaxongirman.uz saytida
          xarid qiling” kabi matn O‘zbekiston storefront’ida rad etilish sababi bo‘ladi.
          Bunday matn faqat StoreKit External Purchase Link entitlement bo‘lsa qo‘shilsin.
        </p>
      </div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">TANGA PAKETLARI</p><h2>Sotuvdagi paketlar</h2></div></div>

      {loading ? <TableSkeleton rows={3} /> : packages.length === 0 ? (
        <EmptyState title="Paket yo‘q" detail="Hozircha bironta tanga paketi e’lon qilinmagan. Ilovada foydalanuvchiga bo‘sh katalog ko‘rsatiladi." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Kod</th><th>Nomi</th><th>Tanga</th><th>Bonus</th><th>Narx</th><th>Faol</th><th /></tr></thead>
            <tbody>
              {packages.map((item) => (
                <tr key={item.id}>
                  <td className="mono">{item.code}</td>
                  <td><strong>{item.label}</strong>{item.description ? <small>{item.description}</small> : null}</td>
                  <td>{item.coins}</td>
                  <td>{item.bonus_coins}</td>
                  <td>{priceIn(item.price_amount, item.currency)}</td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={item.is_active} disabled={saving === item.code} onChange={() => void togglePackage(item)} />
                      <span />
                    </label>
                  </td>
                  <td>
                    <button className="icon-button" type="button" title="O‘chirish" disabled={saving === item.code} onClick={() => void removePackage(item)}>
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form className="finance-form" onSubmit={(event) => void savePackage(event)}>
        <label>Kod<input required value={draft.code} placeholder="starter" onChange={(event) => setDraft({ ...draft, code: event.target.value })} /></label>
        <label>Nomi<input required value={draft.label} placeholder="Starter" onChange={(event) => setDraft({ ...draft, label: event.target.value })} /></label>
        <label>Tanga<input required type="number" min="1" value={draft.coins} onChange={(event) => setDraft({ ...draft, coins: event.target.value })} /></label>
        <label>Bonus<input type="number" min="0" value={draft.bonus} onChange={(event) => setDraft({ ...draft, bonus: event.target.value })} /></label>
        <label>Narx<input required type="number" min="0" value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} /></label>
        <label>Valyuta<input value={draft.currency} maxLength={3} onChange={(event) => setDraft({ ...draft, currency: event.target.value })} /></label>
        <label>Tavsif<input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label>
        <label>Tartib<input type="number" value={draft.sort} onChange={(event) => setDraft({ ...draft, sort: event.target.value })} /></label>
        <button className="primary-button" type="submit" disabled={saving === "package"}><Plus size={16} /> Paketni saqlash</button>
      </form>
    </section>
  </div>;
}
