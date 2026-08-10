import type { Database } from "@jaxongirman/types";
import { Coins, Cpu, Image, TextQuote } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { compactNumber, dateTime, errorMessage, money } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type UsageRow = Database["public"]["Tables"]["ai_usage"]["Row"];

export function UsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.from("ai_usage").select("*").order("created_at", { ascending: false }).limit(250);
    if (requestError) setError(errorMessage(requestError)); else setRows(data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ input: sum.input + row.input_tokens, output: sum.output + row.output_tokens, images: sum.images + row.generated_images, cost: sum.cost + row.provider_cost_usd }), { input: 0, output: 0, images: 0, cost: 0 }), [rows]);

  return <div className="page-stack">
    <PageHeader eyebrow="UNIT ECONOMICS" title="AI foydalanish va xarajat" description="Provider bo‘yicha tokenlar, rasmlar, kechikish va hisoblangan tannarx." action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>} />
    <section className="metric-grid four"><article className="metric-card"><div className="metric-icon"><TextQuote size={20} /></div><span>Input tokenlar</span><strong>{compactNumber.format(totals.input)}</strong><small>Oxirgi {rows.length} so‘rov</small></article><article className="metric-card"><div className="metric-icon"><Cpu size={20} /></div><span>Output tokenlar</span><strong>{compactNumber.format(totals.output)}</strong><small>Structured output</small></article><article className="metric-card"><div className="metric-icon"><Image size={20} /></div><span>Generatsiya qilingan rasm</span><strong>{totals.images}</strong><small>AI visual aktivlar</small></article><article className="metric-card"><div className="metric-icon"><Coins size={20} /></div><span>Provayder tannarxi</span><strong>{money.format(totals.cost)}</strong><small>Konfiguratsiya narxlari asosida</small></article></section>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <section className="panel flush">{loading ? <TableSkeleton rows={8} /> : rows.length === 0 ? <EmptyState detail="Real generatsiyalar boshlanganda provayder iste’moli shu yerda ko‘rinadi." /> : <div className="table-wrap"><table><thead><tr><th>Operatsiya</th><th>Provayder / model</th><th>Input</th><th>Output</th><th>Rasm</th><th>Latency</th><th>Xarajat</th><th>Vaqt</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.operation}</strong><small>{row.presentation_id?.slice(0, 8) ?? "global"}</small></td><td><strong>{row.provider}</strong><small>{row.model}</small></td><td>{compactNumber.format(row.input_tokens)}</td><td>{compactNumber.format(row.output_tokens)}</td><td>{row.generated_images}</td><td>{row.latency_ms ? `${row.latency_ms} ms` : "—"}</td><td>{money.format(row.provider_cost_usd)}</td><td>{dateTime.format(new Date(row.created_at))}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
