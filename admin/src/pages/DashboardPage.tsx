import type { Database } from "@jaxongirman/types";
import { AlertTriangle, Check, Coins, Cpu, Images, Presentation, Sparkles, TrendingUp, Users, Wallet } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { compactNumber, dateTime, errorMessage, toNumber, usd, uzs } from "@/lib/format";
import { AppLink } from "@/lib/router";
import { supabase } from "@/lib/supabase";

type PresentationRow = Database["public"]["Functions"]["admin_list_presentations"]["Returns"][number];
type Metrics = { total_users: number; active_users: number; presentations_created: number; slides_generated: number; credits_spent: number; ai_cost_usd: number; failed_jobs: number; success_rate: number };
type Finance = {
  rate: { value: number; source: string; updated_at: string | null };
  ai: { total_usd: number; paid_usd: number; due_usd: number; settled_today: boolean };
};

const defaults: Metrics = { total_users: 0, active_users: 0, presentations_created: 0, slides_generated: 0, credits_spent: 0, ai_cost_usd: 0, failed_jobs: 0, success_rate: 0 };

export function DashboardPage() {
  const [metrics, setMetrics] = useState(defaults);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [recent, setRecent] = useState<PresentationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [settling, setSettling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [metricsResult, presentationsResult, financeResult] = await Promise.all([
      supabase.rpc("admin_dashboard_metrics"),
      supabase.rpc("admin_list_presentations", { p_limit: 6, p_offset: 0 }),
      supabase.rpc("admin_finance_overview"),
    ]);
    const requestError = metricsResult.error ?? presentationsResult.error ?? financeResult.error;
    if (requestError) setError(errorMessage(requestError));
    else {
      setMetrics({ ...defaults, ...(metricsResult.data as unknown as Partial<Metrics>) });
      setRecent(presentationsResult.data ?? []);
      setFinance(financeResult.data as unknown as Finance);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function settle() {
    setSettling(true);
    const { error: settleError } = await supabase.rpc("admin_settle_ai_cost", { p_note: "Boshqaruv panelidan to‘landi" });
    if (settleError) setError(errorMessage(settleError));
    else await load();
    setSettling(false);
  }

  const rate = toNumber(finance?.rate.value);
  const aiTotal = toNumber(metrics.ai_cost_usd);
  const due = toNumber(finance?.ai.due_usd);
  const settled = finance?.ai.settled_today === true || (finance !== null && due <= 0);

  const cards = [
    { label: "Jami foydalanuvchilar", value: compactNumber.format(metrics.total_users), note: `${compactNumber.format(metrics.active_users)} faol / 30 kun`, icon: Users },
    { label: "Prezentatsiyalar", value: compactNumber.format(metrics.presentations_created), note: `${compactNumber.format(metrics.slides_generated)} slayd`, icon: Presentation },
    { label: "Sarflangan kredit", value: compactNumber.format(metrics.credits_spent), note: "Muvaffaqiyatli ishlar", icon: Coins },
    { label: "AI provayder xarajati", value: usd(aiTotal), secondary: rate ? uzs(aiTotal, rate) : null, note: "Hisoblangan jami", icon: Cpu },
    { label: "Muvaffaqiyat darajasi", value: `${metrics.success_rate}%`, note: `${metrics.failed_jobs} muvaffaqiyatsiz`, icon: TrendingUp },
  ];

  return <div className="page-stack">
    <PageHeader eyebrow="REAL-TIME OPERATIONS" title="Tizim holati" description="Jaxongirman ishlab chiqarish tizimining asosiy ko‘rsatkichlari." action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>} />
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <section className="metric-grid">
      {cards.map(({ label, value, secondary, note, icon: Icon }) => (
        <article className="metric-card" key={label}>
          <div className="metric-icon"><Icon size={20} /></div>
          <span>{label}</span>
          <strong>{loading ? "—" : value}</strong>
          {secondary && !loading ? <p className="metric-secondary">{secondary}</p> : null}
          <small>{note}</small>
        </article>
      ))}

      {/* Today's bill. Amber while the provider is owed money, green once it is
          settled — the state lives in the ledger, not in the browser. */}
      <article className={`metric-card ${loading ? "" : settled ? "is-settled" : "is-due"}`}>
        <div className="metric-icon">{settled ? <Check size={20} /> : <Wallet size={20} />}</div>
        <span>Bugun to‘lash kerak</span>
        <strong>{loading ? "—" : usd(settled ? 0 : due)}</strong>
        {!loading && rate ? <p className="metric-secondary">{uzs(settled ? 0 : due, rate)}</p> : null}
        <small>{settled ? "AI provayder hisobi yopilgan" : "AI provayderga qarz"}</small>
        <button
          className={`settle-button ${settled || due <= 0 ? "is-idle" : ""}`}
          type="button"
          disabled={loading || settling || settled || due <= 0}
          onClick={() => void settle()}
        >
          {settled ? <><Check size={15} /> To‘landi</> : settling ? "Saqlanmoqda…" : "To‘landi deb belgilash"}
        </button>
      </article>
    </section>

    <section className="insight-strip">
      <div><Sparkles size={21} /><span><strong>{metrics.slides_generated ? (metrics.credits_spent / metrics.slides_generated).toFixed(2) : "0.00"}</strong> o‘rtacha kredit / slayd</span></div>
      <div><Images size={21} /><span><strong>{metrics.presentations_created ? (metrics.slides_generated / metrics.presentations_created).toFixed(1) : "0.0"}</strong> o‘rtacha slayd / prezentatsiya</span></div>
      <div><AlertTriangle size={21} /><span><strong>{metrics.failed_jobs}</strong> tekshirilishi kerak bo‘lgan ish</span></div>
    </section>

    <section className="panel">
      <div className="panel-heading"><div><p className="eyebrow">SO‘NGGI FAOLLIK</p><h2>Yangi prezentatsiyalar</h2></div><AppLink to="/presentations">Barchasini ko‘rish →</AppLink></div>
      {loading ? <TableSkeleton /> : recent.length === 0 ? <EmptyState detail="Yaratilgan prezentatsiyalar shu yerda paydo bo‘ladi." /> : <div className="table-wrap"><table><thead><tr><th>Nomi / egasi</th><th>Uslub</th><th>Slayd</th><th>Kredit</th><th>Status</th><th>Vaqt</th></tr></thead><tbody>{recent.map((item) => <tr key={item.presentation_id}><td><strong>{item.title}</strong><small>{item.owner_email}</small></td><td className="capitalize">{item.style}</td><td>{item.slide_count}</td><td>{item.credits_charged}</td><td><StatusBadge value={item.status} /></td><td>{dateTime.format(new Date(item.created_at))}</td></tr>)}</tbody></table></div>}
    </section>
  </div>;
}
