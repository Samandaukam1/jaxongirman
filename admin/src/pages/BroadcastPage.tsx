import { BellRing, Send, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * A message to everyone — a new version, a change worth knowing — or to
 * everyone using the app in one language.
 *
 * Each person gets an ordinary notification: it is in their in-app list and,
 * on a phone with push turned on, on their lock screen
 * (supabase/migrations/202611150019_push_notifications.sql). Every broadcast
 * is written to the audit log with who sent it and to how many people.
 */

const AUDIENCES = [
  { value: "", label: "Hammaga" },
  { value: "uz", label: "O‘zbek tilidagilarga" },
  { value: "ru", label: "Rus tilidagilarga" },
  { value: "en", label: "Ingliz tilidagilarga" },
  { value: "tr", label: "Turk tilidagilarga" },
] as const;

const LINKS = [
  { value: "/notifications", label: "Bildirishnomalar ro‘yxati" },
  { value: "/tarif", label: "Tariflar" },
  { value: "/oyingoh", label: "O‘yingoh" },
  { value: "/chat", label: "Chat" },
] as const;

type Sent = { id: string; created_at: string; target_id: string; after_data: { title?: string; body?: string; recipients?: number } | null };

export function BroadcastPage() {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [link, setLink] = useState<string>(LINKS[0].value);
  const [audience, setAudience] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<Sent[]>([]);

  const loadHistory = useCallback(async () => {
    const { data } = await supabase.from("admin_audit_logs")
      .select("id, created_at, target_id, after_data").eq("action", "broadcast").order("created_at", { ascending: false }).limit(10);
    setHistory((data ?? []) as Sent[]);
  }, []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  function newVersion() {
    setTitle("Jaxongirman yangilandi");
    setBody("Yangi imkoniyatlar qo‘shildi. Ilovani do‘kondan yangilab oling.");
    setLink("/notifications");
  }

  async function send() {
    if (!title.trim()) { setError("Sarlavhani yozing."); return; }
    const who = AUDIENCES.find((entry) => entry.value === audience)?.label.toLowerCase() ?? "hammaga";
    if (!window.confirm(`Xabar ${who} yuborilsinmi? Bu ortga qaytarilmaydi.`)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const { data, error: sendError } = await supabase.rpc("admin_broadcast" as never, {
        p_title: title.trim(), p_body: body.trim(), p_deep_link: link, p_language: audience || null,
      } as never);
      if (sendError) throw sendError;
      setResult(`${Number(data ?? 0).toLocaleString("uz-UZ")} kishiga yuborildi.`);
      setTitle("");
      setBody("");
      void loadHistory();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Bildirishnomalar"
        title="Hammaga xabar"
        description="Ilova ichidagi ro‘yxatga tushadi va push yoqilgan telefonlarga bildirishnoma bo‘lib boradi."
        action={<button type="button" className="secondary-button compact" onClick={newVersion}><Sparkles size={16} /> Yangi versiya shabloni</button>}
      />

      <section className="panel">
        <div className="form-grid">
          <label className="wide">Sarlavha<input value={title} maxLength={160} onChange={(event) => setTitle(event.target.value)} placeholder="Masalan: Jaxongirman yangilandi" /></label>
          <label className="wide">Matn<textarea value={body} maxLength={500} rows={3} onChange={(event) => setBody(event.target.value)} placeholder="Qisqa va aniq: nima o‘zgardi, nima qilish kerak" /></label>
          <label>Bosilganda ochiladi
            <select value={link} onChange={(event) => setLink(event.target.value)}>
              {LINKS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
          <label>Kimga
            <select value={audience} onChange={(event) => setAudience(event.target.value)}>
              {AUDIENCES.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
            </select>
          </label>
        </div>

        {/* How it lands on a lock screen. */}
        <div className="broadcast-preview" aria-label="Ko‘rinishi">
          <div className="broadcast-app"><BellRing size={14} /> JAXONGIRMAN · hozir</div>
          <strong>{title.trim() || "Sarlavha"}</strong>
          <p>{body.trim() || "Matn shu yerda ko‘rinadi."}</p>
        </div>

        {error ? <p className="form-error">{error}</p> : null}
        {result ? <p className="muted">{result}</p> : null}
        <div className="header-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => void send()}>
            <Send size={16} /> {busy ? "Yuborilmoqda…" : "Yuborish"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Oxirgi xabarlar</h2>
        {history.length === 0 ? <EmptyState title="Hali yuborilmagan" detail="Yuborilgan xabarlar shu yerda ko‘rinadi." /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Vaqt</th><th>Sarlavha</th><th>Kimga</th><th>Qabul qiluvchi</th></tr></thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.created_at).toLocaleString("uz-UZ")}</td>
                    <td>{entry.after_data?.title ?? ""}</td>
                    <td>{entry.target_id === "all" ? "Hammaga" : entry.target_id}</td>
                    <td>{(entry.after_data?.recipients ?? 0).toLocaleString("uz-UZ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
