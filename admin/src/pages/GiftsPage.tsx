import type { Database } from "@jaxongirman/types";
import { Check, Gift, RotateCcw, Search, Sparkles } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { dateTime, errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type UserRow = Database["public"]["Functions"]["admin_list_users"]["Returns"][number];
type GiftResult = { applied: boolean; amount?: number; balance: number; message?: string };
type ReclaimResult = {
  applied: boolean;
  requested: number;
  taken: number;
  shortfall: number;
  balance: number;
  message?: string | null;
};

/**
 * Sending and taking back are one form with two directions.
 *
 * They ask for the same two things — how many coins and why — and the mistake
 * this page has to be safe against is the same mistake in both directions: a
 * digit too many, or the same press twice on a slow connection. One form, one
 * idempotency key per press, and the direction only decides the wording, the
 * ceiling and whether the note is optional.
 */
type Mode = "gift" | "reclaim";

const PRESETS = [50, 100, 250, 500];

export function GiftsPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [target, setTarget] = useState<UserRow | null>(null);
  const [mode, setMode] = useState<Mode>("gift");
  const [amount, setAmount] = useState("100");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [done, setDone] = useState<
    { user: UserRow; mode: "gift"; result: GiftResult } | { user: UserRow; mode: "reclaim"; result: ReclaimResult } | null
  >(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.rpc("admin_list_users", { p_search: search || undefined, p_limit: 60, p_offset: 0 });
    if (requestError) setError(errorMessage(requestError)); else setUsers(data ?? []);
    setLoading(false);
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  function open(user: UserRow, next: Mode) {
    setTarget(user);
    setMode(next);
    // Taking back opens on the whole balance, because the press that brings
    // somebody here is nearly always "undo what I just did".
    setAmount(next === "gift" ? "100" : String(user.credits));
    setMessage("");
    setModalError(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const value = Number.parseInt(amount, 10);
    if (!Number.isFinite(value) || value <= 0) { setModalError("Tanga miqdori noldan katta bo‘lishi kerak."); return; }
    const reason = message.trim();
    if (mode === "reclaim" && !reason) {
      setModalError("Sababni yozing — u foydalanuvchiga ko‘rinadi va yagona yozuv bo‘lib qoladi.");
      return;
    }
    setSaving(true); setModalError(null);

    // One key per press, so a double click cannot move the coins twice.
    const key = crypto.randomUUID();
    const answer = mode === "gift"
      ? await supabase.rpc("admin_gift_credits", {
        p_user_id: target.user_id, p_amount: value, p_message: reason, p_idempotency_key: key,
      })
      : await supabase.rpc("admin_reclaim_credits", {
        p_user_id: target.user_id, p_amount: value, p_reason: reason, p_idempotency_key: key,
      });

    if (answer.error) setModalError(errorMessage(answer.error));
    else {
      setDone(mode === "gift"
        ? { user: target, mode: "gift", result: answer.data as unknown as GiftResult }
        : { user: target, mode: "reclaim", result: answer.data as unknown as ReclaimResult });
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
                    <button className="secondary-button compact" type="button" onClick={() => open(user, "gift")}>
                      <Gift size={15} /> Sovg‘a qilish
                    </button>
                    {/* Always available, not only right after a gift: the press
                        that needs undoing is often noticed the next day. */}
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={user.credits <= 0}
                      title={user.credits <= 0 ? "Balans bo‘sh" : undefined}
                      onClick={() => open(user, "reclaim")}
                    >
                      <RotateCcw size={15} /> Qaytarib olish
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
        title={mode === "gift" ? "Tanga sovg‘a qilish" : "Tangalarni qaytarib olish"}
        description={`${target.full_name || target.email} · hozirgi balans ${target.credits} tanga`}
        onClose={() => !saving && setTarget(null)}
      >
        <form onSubmit={(event) => void submit(event)}>
          <label>Tanga miqdori
            <input
              type="number"
              required
              min="1"
              max={mode === "gift" ? 1000000 : Math.max(target.credits, 1)}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </label>
          <div className="toolbar" style={{ marginTop: 12, flexWrap: "wrap" }}>
            {mode === "reclaim" && (
              <button className="secondary-button compact" type="button" onClick={() => setAmount(String(target.credits))}>
                Hammasi ({target.credits})
              </button>
            )}
            {PRESETS.filter((preset) => mode === "gift" || preset <= target.credits).map((preset) => (
              <button key={preset} className="secondary-button compact" type="button" onClick={() => setAmount(String(preset))}>
                {mode === "gift" ? `+${preset}` : `−${preset}`}
              </button>
            ))}
          </div>

          {mode === "gift" ? (
            <label>Tabrik matni <span className="muted" style={{ fontWeight: 400 }}>(ixtiyoriy)</span>
              <textarea maxLength={500} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Faolligingiz uchun rahmat! Mana sizga sovg‘a." />
            </label>
          ) : (
            <label>Sabab
              <textarea
                required
                maxLength={500}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Xato miqdor yuborilgan edi — to‘g‘rilanmoqda."
              />
              <span className="muted" style={{ fontWeight: 400 }}>
                Foydalanuvchiga xabarnoma sifatida ko‘rinadi va tranzaksiya tarixida qoladi.
              </span>
            </label>
          )}

          {mode === "reclaim" && (
            <p className="muted" style={{ marginTop: 4 }}>
              Sarflab bo‘lingan tangalar qaytarilmaydi — balansda bori olinadi, qolgani ko‘rsatiladi.
            </p>
          )}

          {modalError && <div className="error-banner">{modalError}</div>}
          <button className="primary-button" disabled={saving}>
            {saving
              ? (mode === "gift" ? "Yuborilmoqda…" : "Olinmoqda…")
              : (mode === "gift" ? "Sovg‘ani yuborish" : "Tangalarni olish")}
          </button>
        </form>
      </Modal>
    )}

    {done && (
      <Modal
        title={done.mode === "gift"
          ? (done.result.applied ? "Sovg‘a yuborildi" : "Bu sovg‘a allaqachon berilgan")
          : (done.result.applied ? "Tangalar qaytarib olindi" : "Hech narsa olinmadi")}
        description={`${done.user.full_name || done.user.email}`}
        onClose={() => setDone(null)}
      >
        <div className="success-banner" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {done.result.applied ? <Sparkles size={18} /> : <Check size={18} />}
          <span>
            {done.mode === "gift"
              ? (done.result.applied
                ? `${done.result.amount} tanga qo‘shildi. Yangi balans: ${done.result.balance} tanga. Foydalanuvchiga tabrik xabarnomasi yuborildi.`
                : `Balans o‘zgarmadi: ${done.result.balance} tanga.`)
              : (done.result.applied
                // Both numbers, always: "took 320 of the 500 you asked for" is
                // the sentence that stops somebody pressing it a second time.
                ? `${done.result.taken} tanga olindi. Yangi balans: ${done.result.balance} tanga.`
                  + (done.result.shortfall > 0
                    ? ` So‘ralgan ${done.result.requested} tangadan ${done.result.shortfall} tasi allaqachon sarflangan edi.`
                    : " Foydalanuvchiga sabab bilan xabarnoma yuborildi.")
                : `Balans o‘zgarmadi: ${done.result.balance} tanga.`)}
          </span>
        </div>
        <button className="primary-button" type="button" onClick={() => setDone(null)}>Yopish</button>
      </Modal>
    )}
  </div>;
}
