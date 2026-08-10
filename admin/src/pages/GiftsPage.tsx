import type { Database } from "@jaxongirman/types";
import { Check, Gift, Search, Sparkles } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { dateTime, errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type UserRow = Database["public"]["Functions"]["admin_list_users"]["Returns"][number];
type GiftResult = { applied: boolean; amount?: number; balance: number; message?: string };

const PRESETS = [50, 100, 250, 500];

export function GiftsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<UserRow | null>(null);
  const [amount, setAmount] = useState("100");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [done, setDone] = useState<{ user: UserRow; result: GiftResult } | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.rpc("admin_list_users", { p_search: search || undefined, p_limit: 60, p_offset: 0 });
    if (requestError) setError(errorMessage(requestError)); else setUsers(data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  function open(user: UserRow) {
    setTarget(user); setAmount("100"); setMessage(""); setModalError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const value = Number.parseInt(amount, 10);
    if (!Number.isFinite(value) || value <= 0) { setModalError("Tanga miqdori noldan katta bo‘lishi kerak."); return; }
    setSaving(true); setModalError(null);
    // One key per press, so a double click cannot gift twice.
    const { data, error: giftError } = await supabase.rpc("admin_gift_credits", {
      p_user_id: target.user_id,
      p_amount: value,
      p_message: message.trim(),
      p_idempotency_key: crypto.randomUUID(),
    });
    if (giftError) setModalError(errorMessage(giftError));
    else {
      setDone({ user: target, result: data as unknown as GiftResult });
      setTarget(null);
      await load();
    }
    setSaving(false);
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="SOVG‘ALAR"
      title="Tanga sovg‘a qilish"
      description="Foydalanuvchini toping va unga tanga sovg‘a qiling. Tangalar darhol balansiga qo‘shiladi va ilovada tabrik xabarnomasi paydo bo‘ladi."
    />

    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Email, ism yoki username orqali qidirish" /></div>
      <button className="secondary-button compact" type="submit">Qidirish</button>
    </form>

    {error && <ErrorState message={error} onRetry={() => void load()} />}

    <section className="panel flush">
      {loading ? <TableSkeleton rows={6} /> : users.length === 0 ? (
        <EmptyState detail="Qidiruvga mos foydalanuvchi topilmadi." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Foydalanuvchi</th><th>Hozirgi balans</th><th>Prezentatsiya</th><th>Ro‘yxatdan o‘tgan</th><th aria-label="Amal" /></tr></thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.user_id}>
                  <td><strong>{user.full_name || "Ism ko‘rsatilmagan"}</strong><small>{user.email}</small></td>
                  <td><strong>{user.credits}</strong> tanga</td>
                  <td>{user.presentation_count}</td>
                  <td>{dateTime.format(new Date(user.created_at))}</td>
                  <td className="row-actions">
                    <button className="secondary-button compact" type="button" onClick={() => open(user)}>
                      <Gift size={15} /> Sovg‘a qilish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    {target && (
      <Modal
        title="Tanga sovg‘a qilish"
        description={`${target.full_name || target.email} · hozirgi balans ${target.credits} tanga`}
        onClose={() => !saving && setTarget(null)}
      >
        <form onSubmit={(event) => void submit(event)}>
          <label>Tanga miqdori
            <input type="number" required min="1" max="1000000" value={amount} onChange={(event) => setAmount(event.target.value)} />
          </label>
          <div className="toolbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
            {PRESETS.map((preset) => (
              <button key={preset} className="secondary-button compact" type="button" onClick={() => setAmount(String(preset))}>
                +{preset}
              </button>
            ))}
          </div>
          <label>Tabrik matni <span className="muted" style={{ fontWeight: 400 }}>(ixtiyoriy)</span>
            <textarea maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Faolligingiz uchun rahmat! Mana sizga sovg‘a." />
          </label>
          {modalError && <div className="error-banner">{modalError}</div>}
          <button className="primary-button" disabled={saving}>{saving ? "Yuborilmoqda…" : "Sovg‘ani yuborish"}</button>
        </form>
      </Modal>
    )}

    {done && (
      <Modal
        title={done.result.applied ? "Sovg‘a yuborildi" : "Bu sovg‘a allaqachon berilgan"}
        description={`${done.user.full_name || done.user.email}`}
        onClose={() => setDone(null)}
      >
        <div className="success-banner" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {done.result.applied ? <Sparkles size={18} /> : <Check size={18} />}
          <span>
            {done.result.applied
              ? `${done.result.amount} tanga qo‘shildi. Yangi balans: ${done.result.balance} tanga. Foydalanuvchiga tabrik xabarnomasi yuborildi.`
              : `Balans o‘zgarmadi: ${done.result.balance} tanga.`}
          </span>
        </div>
        <button className="primary-button" type="button" onClick={() => setDone(null)}>Yopish</button>
      </Modal>
    )}
  </div>;
}
