import { Check, Flag, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Reports from the chat: someone told us about the person they were writing
 * with, or about one message of theirs. The app stores and the law both ask
 * that these are looked at and acted on — within a day.
 *
 * Each row: when, who reported whom, why, the person's own note, the words of
 * the reported message (if one was named), and how many reports that person
 * has had in all. Closing a report ("resolved" when acted on, "dismissed"
 * when there was nothing to it) is written to the audit log
 * (supabase/migrations/202611170001_chat_reply_react_pin.sql).
 */

type Person = { id: string | null; full_name: string | null; username: string | null };
type Report = {
  id: string;
  reason: string;
  note: string | null;
  excerpt: string | null;
  status: "open" | "resolved" | "dismissed";
  created_at: string;
  resolved_at: string | null;
  message_id: string | null;
  reporter: Person;
  reported: Person;
  reports_against: number;
};

const REASONS: Record<string, string> = {
  spam: "Spam yoki reklama",
  abuse: "Haqorat yoki tahdid",
  sexual: "Odobsiz kontent",
  violence: "Zo‘ravonlik",
  fraud: "Firibgarlik",
  other: "Boshqa sabab",
};

const FILTERS = [
  { value: "open", label: "Ochiq" },
  { value: "resolved", label: "Hal qilingan" },
  { value: "dismissed", label: "Rad etilgan" },
] as const;

function who(person: Person): string {
  return person.full_name?.trim() || (person.username ? `@${person.username}` : "—");
}

export function ChatReportsPage() {
  const [status, setStatus] = useState<string>("open");
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: loadError } = await supabase.rpc("admin_chat_reports" as never, { p_status: status, p_limit: 200 } as never);
    if (loadError) { setError(errorMessage(loadError)); setReports([]); return; }
    setReports((data ?? []) as unknown as Report[]);
  }, [status]);
  useEffect(() => { setReports(null); void load(); }, [load]);

  async function close(id: string, next: "resolved" | "dismissed" | "open") {
    setBusy(id);
    try {
      const { error: closeError } = await supabase.rpc("admin_chat_report_close" as never, { p_id: id, p_status: next } as never);
      if (closeError) throw closeError;
      await load();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Xavfsizlik"
        title="Chat shikoyatlari"
        description="Foydalanuvchilar suhbatdoshi yoki uning xabari ustidan yuborgan shikoyatlar. 24 soat ichida ko‘rib chiqing; kerak bo‘lsa, foydalanuvchini Foydalanuvchilar bo‘limida bloklang."
      />

      <section className="panel">
        <div className="header-actions" role="tablist">
          {FILTERS.map((entry) => (
            <button key={entry.value} type="button" role="tab" aria-selected={status === entry.value}
              className={status === entry.value ? "primary-button compact" : "secondary-button compact"}
              onClick={() => setStatus(entry.value)}>
              {entry.label}
            </button>
          ))}
        </div>

        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {reports === null ? <TableSkeleton rows={4} /> : reports.length === 0 ? (
          <EmptyState title="Shikoyat yo‘q" detail="Bu bo‘limda hozircha hech narsa yo‘q." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Vaqt</th><th>Kim</th><th>Kim ustidan</th><th>Sabab</th><th>Xabar / izoh</th><th /></tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>{new Date(report.created_at).toLocaleString("uz-UZ")}</td>
                    <td>{who(report.reporter)}</td>
                    <td>
                      {who(report.reported)}
                      {report.reports_against > 1 ? <div className="muted">Jami shikoyat: {report.reports_against}</div> : null}
                    </td>
                    <td><Flag size={14} /> {REASONS[report.reason] ?? report.reason}</td>
                    <td>
                      {report.excerpt ? <div>«{report.excerpt}»</div> : <div className="muted">Butun suhbat</div>}
                      {report.note ? <div className="muted">Izoh: {report.note}</div> : null}
                    </td>
                    <td>
                      <div className="header-actions">
                        {report.status === "open" ? (
                          <>
                            <button type="button" className="primary-button compact" disabled={busy === report.id} onClick={() => void close(report.id, "resolved")}>
                              <Check size={15} /> Hal qilindi
                            </button>
                            <button type="button" className="secondary-button compact" disabled={busy === report.id} onClick={() => void close(report.id, "dismissed")}>
                              <X size={15} /> Rad etish
                            </button>
                          </>
                        ) : (
                          <button type="button" className="secondary-button compact" disabled={busy === report.id} onClick={() => void close(report.id, "open")}>
                            <RotateCcw size={15} /> Qayta ochish
                          </button>
                        )}
                      </div>
                    </td>
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
