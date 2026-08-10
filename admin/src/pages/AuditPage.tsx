import type { Database } from "@jaxongirman/types";
import { Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { dateTime, errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type AuditRow = Database["public"]["Tables"]["admin_audit_logs"]["Row"];

export function AuditPage() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.from("admin_audit_logs").select("*").order("created_at", { ascending: false }).limit(250);
    if (requestError) setError(errorMessage(requestError)); else setRows(data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const filtered = useMemo(() => rows.filter((row) => !query.trim() || `${row.action} ${row.target_type} ${row.target_id} ${row.reason ?? ""}`.toLowerCase().includes(query.toLowerCase())), [query, rows]);

  return <div className="page-stack">
    <PageHeader eyebrow="IMMUTABLE HISTORY" title="Audit jurnali" description="Administratorning kredit, status va narx o‘zgarishlari bo‘yicha iz qoldiruvchi jurnal." action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>} />
    <div className="toolbar"><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Amal, obyekt yoki sabab" /></div></div>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <section className="panel flush">{loading ? <TableSkeleton rows={8} /> : filtered.length === 0 ? <EmptyState detail="Audit amallari bajarilganda bu yerda ko‘rinadi." /> : <div className="table-wrap"><table><thead><tr><th>Amal</th><th>Obyekt</th><th>Administrator</th><th>Sabab</th><th>Vaqt</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id}><td><strong>{row.action}</strong><small>{row.id.slice(0, 8)}</small></td><td><strong>{row.target_type}</strong><small>{row.target_id}</small></td><td className="mono">{row.admin_id.slice(0, 8)}…</td><td className="reason-cell">{row.reason || "—"}</td><td>{dateTime.format(new Date(row.created_at))}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
