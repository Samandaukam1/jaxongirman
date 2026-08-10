import type { Database } from "@jaxongirman/types";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { dateTime, errorMessage, money } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type PresentationRow = Database["public"]["Functions"]["admin_list_presentations"]["Returns"][number];

export function PresentationsPage() {
  const [items, setItems] = useState<PresentationRow[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.rpc("admin_list_presentations", { p_limit: 100, p_offset: 0 });
    if (requestError) setError(errorMessage(requestError)); else setItems(data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => items.filter((item) => (status === "all" || item.status === status) && (!query.trim() || `${item.title} ${item.owner_email}`.toLowerCase().includes(query.toLowerCase()))), [items, query, status]);

  return <div className="page-stack">
    <PageHeader eyebrow="GENERATION CATALOG" title="Prezentatsiyalar" description="Barcha foydalanuvchilarning generatsiya holati, xarajati va xato diagnostikasi." action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>} />
    <div className="toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Nomi yoki egasi" /></div><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Barcha statuslar</option><option value="draft">Draft</option><option value="generating">Generating</option><option value="ready">Ready</option><option value="failed">Failed</option></select></div>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <section className="panel flush">{loading ? <TableSkeleton rows={8} /> : filtered.length === 0 ? <EmptyState detail="Tanlangan filtrlarga mos prezentatsiya yo‘q." /> : <div className="table-wrap"><table><thead><tr><th>Nomi / egasi</th><th>Uslub</th><th>Slayd</th><th>Kredit</th><th>AI xarajat</th><th>Status</th><th>Yaratilgan</th></tr></thead><tbody>{filtered.map((item) => <tr key={item.presentation_id} className={item.error_message ? "row-warning" : ""}><td><strong>{item.title}</strong><small>{item.owner_email}</small>{item.error_message && <span className="cell-error" title={item.error_message}>{item.error_message}</span>}</td><td className="capitalize">{item.style}</td><td>{item.slide_count}</td><td>{item.credits_charged}</td><td>{money.format(item.cost_usd)}</td><td><StatusBadge value={item.status} /></td><td>{dateTime.format(new Date(item.created_at))}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
