import type { Database } from "@jaxongirman/types";
import { Ban, Coins, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { dateTime, errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type UserRow = Database["public"]["Functions"]["admin_list_users"]["Returns"][number];
type UserAction = { kind: "credits" | "status"; user: UserRow };

export function UsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<UserAction | null>(null);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.rpc("admin_list_users", { p_search: search || undefined, p_limit: 100, p_offset: 0 });
    if (requestError) setError(errorMessage(requestError)); else setUsers(data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  function openAction(kind: UserAction["kind"], user: UserRow) {
    setAction({ kind, user }); setAmount(""); setReason(""); setActionError(null);
  }

  async function submitAction(event: FormEvent) {
    event.preventDefault();
    if (!action) return;
    setSaving(true); setActionError(null);
    if (!reason.trim()) { setActionError("Audit uchun sabab kiritilishi shart."); setSaving(false); return; }
    const result = action.kind === "credits"
      ? await supabase.rpc("admin_adjust_credits", { p_user_id: action.user.user_id, p_amount: Number.parseInt(amount, 10), p_reason: reason.trim(), p_idempotency_key: crypto.randomUUID() })
      : await supabase.rpc("admin_set_user_status", { p_user_id: action.user.user_id, p_status: action.user.status === "active" ? "blocked" : "active", p_reason: reason.trim() });
    if (result.error) setActionError(errorMessage(result.error));
    else { setAction(null); await load(); }
    setSaving(false);
  }

  return <div className="page-stack">
    <PageHeader eyebrow="ACCESS & BILLING" title="Foydalanuvchilar" description="Hisoblar, kredit balanslari va server tomonidan tekshiriladigan kirish holati." />
    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email yoki ism orqali qidirish" /></div><button className="secondary-button compact" type="submit">Qidirish</button></form>
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <section className="panel flush">
      {loading ? <TableSkeleton rows={7} /> : users.length === 0 ? <EmptyState detail="Qidiruvga mos foydalanuvchi topilmadi." /> : <div className="table-wrap"><table><thead><tr><th>Foydalanuvchi</th><th>Ro‘yxatdan o‘tgan</th><th>Kredit</th><th>Prezentatsiya</th><th>Status</th><th aria-label="Amallar" /></tr></thead><tbody>{users.map((user) => <tr key={user.user_id}><td><strong>{user.full_name || "Ism ko‘rsatilmagan"}</strong><small>{user.email}</small></td><td>{dateTime.format(new Date(user.created_at))}</td><td><strong>{user.credits}</strong>{user.reserved_credits > 0 && <small>{user.reserved_credits} band</small>}</td><td>{user.presentation_count}</td><td><StatusBadge value={user.status} /></td><td><div className="row-actions"><button className="icon-button" type="button" title="Kredit o‘zgartirish" onClick={() => openAction("credits", user)}><Coins size={17} /></button><button className="icon-button" type="button" title={user.status === "active" ? "Bloklash" : "Faollashtirish"} onClick={() => openAction("status", user)}>{user.status === "active" ? <Ban size={17} /> : <ShieldCheck size={17} />}</button></div></td></tr>)}</tbody></table></div>}
    </section>
    {action && <Modal title={action.kind === "credits" ? "Kredit balansini o‘zgartirish" : action.user.status === "active" ? "Foydalanuvchini bloklash" : "Foydalanuvchini faollashtirish"} description={`${action.user.full_name || action.user.email} · ${action.user.email}`} onClose={() => !saving && setAction(null)}><form onSubmit={(event) => void submitAction(event)}>{action.kind === "credits" && <label>Miqdor (+ qo‘shish, − ayirish)<input type="number" required min="-1000000" max="1000000" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="Masalan: 100 yoki -25" /></label>}<label>Audit sababi<textarea required maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Nima uchun bu amal bajarilmoqda?" /></label>{actionError && <div className="error-banner">{actionError}</div>}<button className="primary-button" disabled={saving || (action.kind === "credits" && (!amount || Number(amount) === 0))}>{saving ? "Saqlanmoqda…" : "Tasdiqlash"}</button></form></Modal>}
  </div>;
}
