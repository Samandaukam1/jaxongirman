import type { Database } from "@jaxongirman/types";
import { ArrowDownLeft, ArrowUpRight, CalendarDays, RefreshCw, Server, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { dateOnly, errorMessage, toNumber, usd, uzs } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";

type Entry = Database["public"]["Functions"]["admin_list_finance_entries"]["Returns"][number];
type FinanceSource = Database["public"]["Enums"]["finance_source"];
type FinancePeriod = Database["public"]["Enums"]["finance_period"];
type IncomeSource = Extract<FinanceSource, "subscription" | "credit_sale" | "other">;
type Period = { start: string; income_usd: number; expense_usd: number; profit_usd: number };
type Overview = {
  rate: { value: number; source: string; updated_at: string | null };
  ai: { total_usd: number; paid_usd: number; due_usd: number; settled_today: boolean };
  week: Period;
  month: Period;
};

const SOURCE_LABELS: Record<string, string> = {
  ai_provider: "AI provayder",
  infrastructure: "Server va hosting",
  subscription: "Obuna",
  credit_sale: "Kredit sotuvi",
  other: "Boshqa",
};

export function FinancePage() {
  const { can } = useAuth();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [infraAmount, setInfraAmount] = useState("");
  const [infraPeriod, setInfraPeriod] = useState<Extract<FinancePeriod, "weekly" | "monthly">>("monthly");
  const [incomeAmount, setIncomeAmount] = useState("");
  const [incomeSource, setIncomeSource] = useState<IncomeSource>("subscription");

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [overviewResult, entriesResult] = await Promise.all([
      supabase.rpc("admin_finance_overview"),
      supabase.rpc("admin_list_finance_entries", { p_limit: 60, p_offset: 0 }),
    ]);
    const requestError = overviewResult.error ?? entriesResult.error;
    if (requestError) setError(errorMessage(requestError));
    else {
      setOverview(overviewResult.data as unknown as Overview);
      setEntries(entriesResult.data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function record(kind: Database["public"]["Enums"]["finance_kind"], source: FinanceSource, amount: string, period: FinancePeriod, note: string) {
    const value = Number(amount.replace(",", "."));
    if (!Number.isFinite(value) || value <= 0) { setError("Summani to‘g‘ri kiriting."); return; }
    setBusy(true);
    const { error: recordError } = await supabase.rpc("admin_record_finance_entry", {
      p_kind: kind, p_source: source, p_amount_usd: value, p_period: period, p_note: note,
    });
    if (recordError) setError(errorMessage(recordError));
    else { setError(null); await load(); }
    setBusy(false);
  }

  async function remove(id: string) {
    setBusy(true);
    const { error: deleteError } = await supabase.rpc("admin_delete_finance_entry", { p_id: id });
    if (deleteError) setError(errorMessage(deleteError));
    else await load();
    setBusy(false);
  }

  async function refreshRate() {
    setBusy(true);
    const { error: rateError } = await supabase.functions.invoke("refresh-usd-rate", { body: {} });
    if (rateError) setError(errorMessage(rateError));
    else await load();
    setBusy(false);
  }

  const rate = toNumber(overview?.rate.value);
  const week = overview?.week;
  const month = overview?.month;

  const cards = [
    { label: "Haftalik xarajat", value: week?.expense_usd, icon: TrendingDown, note: week ? `${dateOnly.format(new Date(week.start))} dan beri` : "" },
    { label: "Oylik xarajat", value: month?.expense_usd, icon: TrendingDown, note: month ? `${dateOnly.format(new Date(month.start))} dan beri` : "" },
    { label: "Haftalik foyda", value: week?.profit_usd, icon: TrendingUp, note: week ? `${usd(week.income_usd)} tushum` : "", signed: true },
    { label: "Oylik foyda", value: month?.profit_usd, icon: TrendingUp, note: month ? `${usd(month.income_usd)} tushum` : "", signed: true },
  ];

  function submitInfra(event: FormEvent) {
    event.preventDefault();
    void record("expense", "infrastructure", infraAmount, infraPeriod, `Server va hosting (${infraPeriod === "weekly" ? "haftalik" : "oylik"})`)
      .then(() => setInfraAmount(""));
  }

  function submitIncome(event: FormEvent) {
    event.preventDefault();
    void record("income", incomeSource, incomeAmount, "one_time", SOURCE_LABELS[incomeSource] ?? "Tushum")
      .then(() => setIncomeAmount(""));
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="MOLIYA"
      title="Kirim va chiqimlar"
      description="To‘langan AI hisoblari, server xarajatlari va sotuvdan tushgan mablag‘ — hafta va oy kesimida."
      action={<button className="secondary-button compact" type="button" disabled={busy} onClick={() => void load()}>Yangilash</button>}
    />
    {error && <ErrorState message={error} onRetry={() => void load()} />}

    <section className="metric-grid four">
      {cards.map(({ label, value, icon: Icon, note, signed }) => {
        const amount = toNumber(value);
        return <article className="metric-card" key={label}>
          <div className="metric-icon"><Icon size={20} /></div>
          <span>{label}</span>
          <strong className={signed ? (amount >= 0 ? "amount-positive" : "amount-negative") : undefined}>
            {loading ? "—" : usd(amount)}
          </strong>
          {!loading && rate ? <p className="metric-secondary">{uzs(amount, rate)}</p> : null}
          <small>{note}</small>
        </article>;
      })}
    </section>

    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">VALYUTA KURSI</p><h2>Dollar — so‘m</h2></div>
        <button className="secondary-button compact" type="button" disabled={busy} onClick={() => void refreshRate()}>
          <RefreshCw size={15} /> Markaziy bankdan yangilash
        </button>
      </div>
      <p className="rate-line">
        <strong>1 $ = {rate ? rate.toLocaleString("uz-UZ") : "—"} so‘m</strong>
        <span>Manba: {overview?.rate.source ?? "—"}</span>
        <span>{overview?.rate.updated_at ? `Yangilangan: ${dateOnly.format(new Date(overview.rate.updated_at))}` : "Hali yangilanmagan"}</span>
      </p>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">DOIMIY XARAJAT</p><h2>Server va hosting</h2></div></div>
      <form className="finance-form" onSubmit={submitInfra}>
        <label>Summa ($)
          <input inputMode="decimal" placeholder="120" value={infraAmount} onChange={(event) => setInfraAmount(event.target.value)} />
        </label>
        <label>Davri
          <select value={infraPeriod} onChange={(event) => setInfraPeriod(event.target.value as Extract<FinancePeriod, "weekly" | "monthly">)}>
            <option value="weekly">Haftalik</option>
            <option value="monthly">Oylik</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={busy || !infraAmount.trim()}><Server size={16} /> Xarajatga qo‘shish</button>
      </form>
      <p className="finance-hint">
        Kiritilgan summa xarajat sifatida yoziladi va foydadan ayriladi. Oylik summa haftalik kartada oyning kun soniga bo‘lib,
        haftalik summa oylik kartada ko‘paytirib ko‘rsatiladi — shuning uchun ikkala karta bir xil pulni izchil hisoblaydi.
      </p>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">TUSHUM</p><h2>Obuna va kredit sotuvi</h2></div></div>
      <form className="finance-form" onSubmit={submitIncome}>
        <label>Summa ($)
          <input inputMode="decimal" placeholder="49.90" value={incomeAmount} onChange={(event) => setIncomeAmount(event.target.value)} />
        </label>
        <label>Manba
          <select value={incomeSource} onChange={(event) => setIncomeSource(event.target.value as typeof incomeSource)}>
            <option value="subscription">Obuna</option>
            <option value="credit_sale">Kredit sotuvi</option>
            <option value="other">Boshqa</option>
          </select>
        </label>
        <button className="primary-button" type="submit" disabled={busy || !incomeAmount.trim()}><ArrowDownLeft size={16} /> Tushumga qo‘shish</button>
      </form>
      <p className="finance-hint">
        To‘lov tizimi hali ulanmagan, shuning uchun tushum qo‘lda kiritiladi. Kelajakda <code>credit_transactions</code> ga
        <code> purchase</code> yozuvlari kela boshlagach, ular shu jadvalga avtomatik qo‘shiladi.
      </p>
    </section>

    <section className="panel flush">
      <div className="panel-heading" style={{ padding: "24px 24px 0" }}>
        <div><p className="eyebrow">JURNAL</p><h2>Kirim-chiqimlar</h2></div>
      </div>
      {loading ? <TableSkeleton /> : entries.length === 0 ? (
        <EmptyState detail="To‘langan hisoblar va kiritilgan tushumlar shu yerda ko‘rinadi." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Sana</th><th>Turi</th><th>Manba</th><th>Davri</th><th>Summa</th><th>So‘mda</th><th>Izoh</th><th /></tr></thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td>{dateOnly.format(new Date(entry.occurred_on))}</td>
                  <td className={entry.kind === "income" ? "amount-positive" : "amount-negative"}>
                    {entry.kind === "income" ? <><ArrowDownLeft size={13} /> Kirim</> : <><ArrowUpRight size={13} /> Chiqim</>}
                  </td>
                  <td>{SOURCE_LABELS[entry.source] ?? entry.source}</td>
                  <td>{entry.period === "monthly" ? "Oylik" : entry.period === "weekly" ? "Haftalik" : "Bir martalik"}</td>
                  <td><strong>{usd(entry.amount_usd)}</strong></td>
                  <td>{rate ? uzs(entry.amount_usd, rate) : "—"}</td>
                  <td className="reason-cell">{entry.note || "—"}<small>{entry.created_by_email ?? ""}</small></td>
                  <td className="row-actions">
                    {can("settings.edit") ? (
                      <button className="icon-button" type="button" title="O‘chirish" disabled={busy} onClick={() => void remove(entry.id)}>
                        <Trash2 size={15} />
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

    <p className="finance-hint"><CalendarDays size={13} /> Hafta dushanbadan, oy esa oyning birinchi kunidan boshlab hisoblanadi.</p>
  </div>;
}
