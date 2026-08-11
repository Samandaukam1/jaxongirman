import type { Json } from "@jaxongirman/types";
import { Apple, Check, RefreshCw, Smartphone } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage, stamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type Copy = { subscription?: string; jcoin?: string; marketplace?: string; module?: string };
type Policy = { review_mode: boolean; copy: Copy };
type AuditRow = { created_at: string; action: string; reason: string };

const CONTEXTS: { key: keyof Copy; label: string; where: string }[] = [
  { key: "subscription", label: "Tarif", where: "Tarif sotib olish taklif qilinadigan joyda" },
  { key: "jcoin", label: "J Coin", where: "Tanga paketlari ekranida" },
  { key: "marketplace", label: "Do‘kon", where: "Do‘kon, mahsulot sahifasi, sotish va daromadlar" },
  { key: "module", label: "Modul", where: "Ma’lumotlarni yig‘ish moduli kirish sahifasida" },
];

/**
 * The one switch that decides whether the iOS build offers a purchase.
 *
 * It has its own page rather than a panel among the module settings, because the
 * person reaching for it is doing an App Store submission and should not have to
 * hunt. Everything about the decision — what it changes, what the guidelines say,
 * and who last touched it — is on this screen.
 */
export function AppStorePage() {
  const [policy, setPolicy] = useState<Policy>({ review_mode: false, copy: {} });
  const [history, setHistory] = useState<AuditRow[]>([]);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [settingResult, auditResult] = await Promise.all([
      supabase.from("app_settings").select("value").eq("key", "payments.ios_policy").maybeSingle(),
      // The same table the audit page reads. Filtered server-side to the two
      // actions this switch writes, so the list is short and relevant.
      supabase.from("admin_audit_logs")
        .select("created_at, action, reason")
        .like("action", "payments.ios_review_mode%")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);
    if (settingResult.error) {
      setError(errorMessage(settingResult.error));
    } else {
      const value = settingResult.data?.value as unknown as Policy | null;
      setPolicy({ review_mode: Boolean(value?.review_mode), copy: value?.copy ?? {} });
    }
    // The audit list is a nicety: a failure here must not hide the switch.
    if (!auditResult.error) setHistory((auditResult.data ?? []) as AuditRow[]);
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(nextReviewMode: boolean, nextCopy?: Copy) {
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: failure } = await supabase.rpc("admin_set_ios_payment_policy", {
      p_review_mode: nextReviewMode,
      ...(nextCopy ? { p_copy: nextCopy as unknown as Json } : {}),
      p_reason: reason.trim(),
    });
    if (failure) {
      setError(errorMessage(failure));
    } else {
      setMessage(nextReviewMode
        ? "Yoqildi. iOS ilovada tarif, J Coin, do‘kon va modul xaridi endi ko‘rinmaydi va server iOS mijozdan kelgan to‘lovni rad etadi."
        : "O‘chirildi. iOS ilovada to‘lovlar yana ochiq — App Store qoidalariga e’tibor bering.");
      setReason("");
      await load();
    }
    setSaving(false);
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="APP STORE"
      title="iOS to‘lov siyosati"
      description="Bu yagona switch iOS ilovasida tashqi to‘lovlar ko‘rinishini boshqaradi. Android va web hech qachon o‘zgarmaydi."
      action={<button className="secondary-button compact" type="button" onClick={() => void load()}><RefreshCw size={15} /> Yangilash</button>}
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">SWITCH</p><h2>iOS Review Mode</h2></div>
      </div>

      <div className={`ios-state ${policy.review_mode ? "is-on" : "is-off"}`}>
        {policy.review_mode ? <Check size={22} /> : <Apple size={22} />}
        <div>
          <strong>{loading ? "Yuklanmoqda…" : policy.review_mode ? "YOQILGAN" : "O‘CHIRILGAN"}</strong>
          <span>
            {policy.review_mode
              ? "iOS ilovada tashqi to‘lovlar yopilgan. App Store tekshiruvi uchun to‘g‘ri holat."
              : "iOS ilovada tashqi to‘lovlar ochiq. App Store Guideline 3.1.1 bo‘yicha bu rad etilishga olib keladi."}
          </span>
        </div>
      </div>

      <div className="finance-form">
        <label>
          Sabab <span className="muted" style={{ fontWeight: 400 }}>(audit jurnaliga yoziladi)</span>
          <input
            value={reason}
            placeholder="Masalan: 1.4.0 App Store review uchun"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>

        <div className="ios-actions">
          <button
            className="primary-button"
            type="button"
            disabled={saving || loading || policy.review_mode}
            onClick={() => void save(true)}
          >
            <Smartphone size={16} /> Yoqish — iOS’da to‘lovlarni yopish
          </button>
          <button
            className="secondary-button danger"
            type="button"
            disabled={saving || loading || !policy.review_mode}
            onClick={() => void save(false)}
          >
            O‘chirish — iOS’da to‘lovlarni ochish
          </button>
        </div>

        <div className="warning-banner">
          <strong>Bu review paytidagi vaqtinchalik niqob emas.</strong>
          App Store Review Guideline 3.1.1 bo‘yicha ilova ichida ochiladigan kontent in-app
          purchase orqali sotilishi kerak. 2.3.1(a) esa “yashirin yoki uxlab yotgan” funksiyani
          taqiqlaydi: review paytida qanday bo‘lsa, keyin ham shundayligicha qolishi kerak.
          Tekshiruvdan o‘tgach o‘chirilsa, bu ilovaning olib tashlanishiga va 2.3.1(b) bo‘yicha
          developer akkaunt bekor qilinishiga asos bo‘ladi. iOS’da pul olishning yagona to‘g‘ri
          yo‘li — StoreKit in-app purchase qo‘shish.
        </div>
      </div>
    </section>

    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">MATNLAR</p><h2>Xarid o‘rnida ko‘rsatiladigan matn</h2></div>
      </div>
      <div className="finance-form">
        {CONTEXTS.map(({ key, label, where }) => (
          <label key={key}>
            {label} <span className="muted" style={{ fontWeight: 400 }}>({where})</span>
            <input
              value={policy.copy[key] ?? ""}
              onChange={(event) => setPolicy((current) => ({
                ...current,
                copy: { ...current.copy, [key]: event.target.value },
              }))}
            />
          </label>
        ))}
        <div className="warning-banner">
          <strong>Matnda boshqa to‘lov usulini nomlamang.</strong>
          Guideline 3.1.1(a) AQSh storefront’idan tashqari hamma joyda in-app purchase’dan
          boshqa xaridga yo‘naltiruvchi matn va tugmalarni taqiqlaydi. “jaxongirman.uz saytida
          xarid qiling” kabi matn O‘zbekiston storefront’ida rad etilish sababi bo‘ladi. Bunday
          matn faqat StoreKit External Purchase Link entitlement bo‘lsa qo‘shilsin.
        </div>
        <button
          className="primary-button"
          type="button"
          disabled={saving || loading}
          onClick={() => void save(policy.review_mode, policy.copy)}
        >
          <Check size={16} /> Matnlarni saqlash
        </button>
      </div>
    </section>

    {history.length > 0 && (
      <section className="panel flush">
        <div className="panel-heading">
          <div><p className="eyebrow">AUDIT</p><h2>Kim va qachon o‘zgartirgan</h2></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sana</th><th>Amal</th><th>Sabab</th></tr></thead>
            <tbody>
              {history.map((row, index) => (
                <tr key={`${row.created_at}-${index}`}>
                  <td>{stamp(row.created_at)}</td>
                  <td>{row.action.endsWith(".on") ? "Yoqildi" : "O‘chirildi"}</td>
                  <td className="reason-cell">{row.reason || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}
  </div>;
}
