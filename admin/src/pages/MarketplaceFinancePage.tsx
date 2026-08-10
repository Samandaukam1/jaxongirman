import type { Database } from "@jaxongirman/types";
import { BanknoteArrowUp, Percent, Save, Wallet } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, priceIn, stamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type PayoutRow = Database["public"]["Functions"]["admin_pending_payouts"]["Returns"][number];
type Settlement = Database["public"]["Tables"]["seller_settlements"]["Row"];

type PeriodTotals = {
  gmv: number; buyer_fees: number; seller_fees: number; buyer_collected: number;
  seller_payable: number; platform_gross: number; provider_costs: number;
  refunded: number; platform_net: number; sales_count: number; average_order_value: number;
};

type Finance = {
  today: PeriodTotals; week: PeriodTotals; month: PeriodTotals; all_time: PeriodTotals;
  daily: { day: string; gmv: number; platform_gross: number; sales_count: number }[];
  sandbox_purchases: number;
  pending_moderation: number;
  open_reports: number;
  unsettled_payable: number;
};

const PERIODS = [
  { key: "today", label: "Bugun" },
  { key: "week", label: "Hafta" },
  { key: "month", label: "Oy" },
  { key: "all_time", label: "Butun davr" },
] as const;

function som(value: number): string {
  return priceIn(value, "UZS");
}

/**
 * Marketplace finance.
 *
 * Every figure comes from `admin_marketplace_finance()`, which reads the
 * purchase ledger and counts each fee exactly once — platform gross is buyer
 * fees plus seller fees, and buyer collected is base plus buyer fee. Sandbox
 * purchases are excluded from all of it and reported separately, so a test
 * never looks like income.
 */
export function MarketplaceFinancePage() {
  const [finance, setFinance] = useState<Finance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [commission, setCommission] = useState({ buyer: "20", seller: "20" });
  const [period, setPeriod] = useState<(typeof PERIODS)[number]["key"]>("month");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [paying, setPaying] = useState<Settlement | null>(null);
  const [destination, setDestination] = useState("");
  const [reference, setReference] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [financeResult, payoutResult, settlementResult, commissionResult] = await Promise.all([
      supabase.rpc("admin_marketplace_finance"),
      supabase.rpc("admin_pending_payouts"),
      supabase.from("seller_settlements").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("commission_config").select("*").eq("scope", "marketplace").maybeSingle(),
    ]);
    const requestError = financeResult.error ?? payoutResult.error ?? settlementResult.error;
    if (requestError) {
      setError(errorMessage(requestError));
    } else {
      setFinance(financeResult.data as unknown as Finance);
      setPayouts(payoutResult.data ?? []);
      setSettlements(settlementResult.data ?? []);
      if (commissionResult.data) {
        setCommission({
          buyer: String(commissionResult.data.buyer_fee_rate),
          seller: String(commissionResult.data.seller_fee_rate),
        });
      }
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function saveCommission(event: FormEvent) {
    event.preventDefault();
    setBusy("commission"); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("admin_set_commission", {
      p_buyer_fee_rate: Number(commission.buyer),
      p_seller_fee_rate: Number(commission.seller),
      p_reason: "Admin console update",
    });
    if (saveError) setError(errorMessage(saveError));
    else setMessage("Komissiya yangilandi. Avvalgi sotuvlar o‘z stavkalari bilan qoladi.");
    setBusy(null);
  }

  async function createSettlement(row: PayoutRow) {
    setBusy(row.seller_id); setError(null);
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const { error: createError } = await supabase.rpc("admin_create_settlement", {
      p_seller_id: row.seller_id,
      p_period_start: start.toISOString().slice(0, 10),
      p_period_end: today.toISOString().slice(0, 10),
    });
    if (createError) setError(errorMessage(createError));
    else { setMessage(`${row.seller_email} uchun to‘lov ro‘yxati tayyorlandi.`); await load(); }
    setBusy(null);
  }

  async function markPaid(event: FormEvent) {
    event.preventDefault();
    if (!paying) return;
    setBusy(paying.id); setModalError(null);
    const { error: payError } = await supabase.rpc("admin_mark_settlement_paid", {
      p_settlement_id: paying.id,
      p_destination_note: destination.trim(),
      p_reference: reference.trim(),
    });
    if (payError) setModalError(errorMessage(payError));
    else {
      setMessage("To‘lov qayd etildi va sotuvchiga xabarnoma yuborildi.");
      setPaying(null); setDestination(""); setReference(""); await load();
    }
    setBusy(null);
  }

  const totals = finance?.[period];

  return <div className="page-stack">
    <PageHeader
      eyebrow="MARKETPLACE FINANCE"
      title="Do‘kon moliyasi"
      description="Barcha raqamlar xaridlar reyestridan olinadi. Sinov (sandbox) xaridlari hech qaysi moliyaviy ko‘rsatkichga qo‘shilmaydi."
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    <div className="toolbar">
      {PERIODS.map((item) => (
        <button
          key={item.key}
          className={period === item.key ? "primary-button compact" : "secondary-button compact"}
          type="button"
          onClick={() => setPeriod(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>

    {loading ? <TableSkeleton rows={4} /> : (
      <>
        <div className="metric-grid">
          <article className="metric-card"><p className="eyebrow">GMV</p><strong>{som(totals?.gmv ?? 0)}</strong><span>{totals?.sales_count ?? 0} ta sotuv</span></article>
          <article className="metric-card"><p className="eyebrow">XARIDORDAN OLINDI</p><strong>{som(totals?.buyer_collected ?? 0)}</strong><span>o‘rtacha {som(totals?.average_order_value ?? 0)}</span></article>
          <article className="metric-card"><p className="eyebrow">PLATFORMA (BRUTTO)</p><strong>{som(totals?.platform_gross ?? 0)}</strong><span>xaridor {som(totals?.buyer_fees ?? 0)} · sotuvchi {som(totals?.seller_fees ?? 0)}</span></article>
          <article className="metric-card"><p className="eyebrow">PLATFORMA (SOF)</p><strong>{som(totals?.platform_net ?? 0)}</strong><span>provayder {som(totals?.provider_costs ?? 0)} · qaytarilgan {som(totals?.refunded ?? 0)}</span></article>
        </div>

        <div className="metric-grid">
          <article className="metric-card"><p className="eyebrow">SOTUVCHILARGA QARZ</p><strong>{som(finance?.unsettled_payable ?? 0)}</strong><span>to‘lanmagan</span></article>
          <article className="metric-card"><p className="eyebrow">TEKSHIRUVDA</p><strong>{finance?.pending_moderation ?? 0}</strong><span>{finance?.open_reports ?? 0} shikoyat</span></article>
          {/* Shown, never counted: a developer's test purchase must be visible
              but must not touch a single revenue figure above. */}
          <article className="metric-card"><p className="eyebrow">SINOV XARIDLARI</p><strong>{finance?.sandbox_purchases ?? 0}</strong><span>hisobga olinmaydi</span></article>
        </div>

        {(finance?.daily.length ?? 0) > 0 && (
          <section className="panel">
            <div className="panel-heading"><div><p className="eyebrow">SO‘NGGI 30 KUN</p><h2>Kunlik GMV</h2></div></div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Kun</th><th>GMV</th><th>Platforma</th><th>Sotuv</th></tr></thead>
                <tbody>
                  {finance?.daily.map((day) => (
                    <tr key={day.day}>
                      <td>{day.day}</td>
                      <td>{som(day.gmv)}</td>
                      <td className="amount-positive">{som(day.platform_gross)}</td>
                      <td>{day.sales_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </>
    )}

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">COMMISSION</p><h2>Komissiyalar</h2></div></div>
      <form className="finance-form" onSubmit={(event) => void saveCommission(event)}>
        <label>Xaridor komissiyasi (%)<input required type="number" min="0" max="100" step="0.01" value={commission.buyer} onChange={(event) => setCommission({ ...commission, buyer: event.target.value })} /></label>
        <label>Sotuvchi komissiyasi (%)<input required type="number" min="0" max="100" step="0.01" value={commission.seller} onChange={(event) => setCommission({ ...commission, seller: event.target.value })} /></label>
        <button className="primary-button" type="submit" disabled={busy === "commission"}><Save size={16} /> Saqlash</button>
        <p className="finance-hint">
          <Percent size={13} /> O‘zgarish faqat yangi xaridlarga ta’sir qiladi. Har bir tugallangan sotuv o‘z stavkalarini
          ichida saqlaydi, shuning uchun eski hisobotlar qayta hisoblanmaydi.
        </p>
      </form>
    </section>

    <section className="panel flush">
      <div className="panel-heading"><div><p className="eyebrow">PAYOUTS</p><h2>To‘lov kutayotgan sotuvchilar</h2></div></div>
      {loading ? <TableSkeleton rows={3} /> : payouts.length === 0 ? (
        <EmptyState title="To‘lanmagan qarz yo‘q" detail="Hozircha hech bir sotuvchiga to‘lanmagan summa yo‘q." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sotuvchi</th><th>Aloqa</th><th>Sotuv</th><th>To‘lanadi</th><th /></tr></thead>
            <tbody>
              {payouts.map((row) => (
                <tr key={row.seller_id}>
                  <td>{row.seller_name || "—"}<small>{row.seller_email}</small></td>
                  <td>
                    {row.phone ?? <span className="muted">raqam qoldirilmagan</span>}
                    {row.telegram_username && <small>@{row.telegram_username}</small>}
                  </td>
                  <td>{row.sales_count}</td>
                  <td className="amount-positive">{som(Number(row.payable_amount))}</td>
                  <td>
                    <button className="secondary-button compact" type="button" disabled={busy === row.seller_id} onClick={() => void createSettlement(row)}>
                      <Wallet size={15} /> Ro‘yxat tayyorlash
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section className="panel flush">
      <div className="panel-heading"><div><p className="eyebrow">SETTLEMENTS</p><h2>To‘lov ro‘yxatlari</h2></div></div>
      {loading ? <TableSkeleton rows={3} /> : settlements.length === 0 ? (
        <EmptyState title="Ro‘yxat yo‘q" detail="Hali bironta to‘lov ro‘yxati tayyorlanmagan." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Davr</th><th>Sotuvlar</th><th>Komissiya</th><th>To‘lanadi</th><th>Holat</th><th>Qayerga</th><th /></tr></thead>
            <tbody>
              {settlements.map((row) => (
                <tr key={row.id}>
                  <td>{row.period_start} — {row.period_end}<small>{stamp(row.created_at)}</small></td>
                  <td>{som(row.gross_sales)}</td>
                  <td>−{som(row.seller_fees)}</td>
                  <td className="amount-positive">{som(row.payable_amount)}</td>
                  <td><StatusBadge value={row.status} /></td>
                  <td>{row.destination_note || "—"}{row.paid_at && <small>{stamp(row.paid_at)}</small>}</td>
                  <td>
                    {row.status === "pending" && (
                      <button
                        className="primary-button compact"
                        type="button"
                        disabled={busy === row.id}
                        onClick={() => { setPaying(row); setDestination(""); setReference(""); setModalError(null); }}
                      >
                        <BanknoteArrowUp size={15} /> Pulni o‘tkazdim
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    {paying && (
      <Modal
        title="To‘lovni qayd etish"
        description={`${som(paying.payable_amount)} to‘langani belgilanadi. Sotuvchiga xabarnoma yuboriladi va u Daromadlar bo‘limida ko‘rinadi.`}
        onClose={() => setPaying(null)}
      >
        <form className="finance-form" onSubmit={(event) => void markPaid(event)}>
          {/* Masked only. The column refuses a card-length digit run, so a full
              PAN cannot be pasted here even by accident. */}
          <label>Qayerga o‘tkazildi<input required value={destination} onChange={(event) => setDestination(event.target.value)} placeholder="•••• 2121, Humo" /></label>
          <label>Izoh<input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="To‘lov topshirig‘i raqami" /></label>
          {modalError && <p className="cell-error">{modalError}</p>}
          <button className="primary-button" type="submit" disabled={busy === paying.id}>Tasdiqlash</button>
        </form>
      </Modal>
    )}
  </div>;
}
