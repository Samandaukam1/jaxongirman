import type { Database } from "@jaxongirman/types";
import { KeyRound, Lock, Play, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, priceIn, stamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type SurveyRow = Database["public"]["Functions"]["admin_list_surveys"]["Returns"][number];
type EntitlementRow = Database["public"]["Functions"]["admin_list_module_entitlements"]["Returns"][number];
type Overview = {
  surveys_total: number;
  surveys_open: number;
  surveys_closed: number;
  responses_live: number;
  responses_expiring_24h: number;
  entitlements_active: number;
  entitlements_expiring_30d: number;
  purged_last_7d: number;
  templates_total: number;
};

/**
 * Moderation for the data-collection module.
 *
 * Everything on this page is metadata: how many people answered, when the data
 * expires, who owns the survey. No control here opens a response, and the
 * database gives an admin no path to one either — `survey_responses` and
 * `survey_answers` have no admin clause in their RLS policies. Moderation means
 * closing an abusive survey, not reading what people wrote in it.
 */
export function SurveysPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [surveys, setSurveys] = useState<SurveyRow[]>([]);
  const [entitlements, setEntitlements] = useState<EntitlementRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [moderating, setModerating] = useState<SurveyRow | null>(null);
  const [reason, setReason] = useState("");
  const [grantOpen, setGrantOpen] = useState(false);
  const [grantEmail, setGrantEmail] = useState("");
  const [grantMonths, setGrantMonths] = useState("11");
  const [modalError, setModalError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [overviewResult, surveysResult, entitlementResult] = await Promise.all([
      supabase.rpc("admin_module_overview", { p_module_code: "data_collection" }),
      supabase.rpc("admin_list_surveys", { p_search: search || undefined, p_limit: 60, p_offset: 0 }),
      supabase.rpc("admin_list_module_entitlements", { p_module_code: "data_collection", p_search: search || undefined, p_limit: 60, p_offset: 0 }),
    ]);
    const requestError = overviewResult.error ?? surveysResult.error ?? entitlementResult.error;
    if (requestError) {
      setError(errorMessage(requestError));
    } else {
      setOverview(overviewResult.data as unknown as Overview);
      setSurveys(surveysResult.data ?? []);
      setEntitlements(entitlementResult.data ?? []);
    }
    setLoading(false);
  }, [search]);

  useEffect(() => { void load(); }, [load]);

  async function moderate(status: "open" | "closed") {
    if (!moderating) return;
    setBusy(moderating.id); setModalError(null);
    const { error: statusError } = await supabase.rpc("admin_set_survey_status", {
      p_form_id: moderating.id,
      p_status: status,
      p_reason: reason.trim(),
    });
    if (statusError) setModalError(errorMessage(statusError));
    else {
      setMessage(`“${moderating.title}” ${status === "closed" ? "yopildi" : "qayta ochildi"} va egasiga xabar yuborildi.`);
      setModerating(null); setReason("");
      await load();
    }
    setBusy(null);
  }

  async function grant(event: FormEvent) {
    event.preventDefault();
    setBusy("grant"); setModalError(null);
    const { error: grantError } = await supabase.rpc("admin_grant_module_access_by_email", {
      p_email: grantEmail.trim(),
      p_module_code: "data_collection",
      p_months: Number(grantMonths) || undefined,
      p_reason: "Admin console grant",
    });
    if (grantError) setModalError(errorMessage(grantError));
    else {
      setMessage(`${grantEmail.trim()} uchun modulga kirish ochildi.`);
      setGrantOpen(false); setGrantEmail("");
      await load();
    }
    setBusy(null);
  }

  async function revoke(row: EntitlementRow) {
    setBusy(row.id);
    const { error: revokeError } = await supabase.rpc("admin_revoke_module_access", {
      p_user_id: row.user_id,
      p_module_code: row.module_code,
      p_reason: "Admin console revoke",
    });
    if (revokeError) setError(errorMessage(revokeError)); else await load();
    setBusy(null);
  }

  return <div className="page-stack">
    <PageHeader
      eyebrow="DATA COLLECTION"
      title="So‘rovnomalar nazorati"
      description="Metama’lumot darajasidagi moderatsiya: so‘rovnoma egasi, javoblar soni va saqlanish muddati. Javob matnlari va yuklangan rasmlar administratorga ochilmaydi."
      action={<button className="secondary-button compact" type="button" onClick={() => { setGrantOpen(true); setModalError(null); }}><KeyRound size={16} /> Kirish berish</button>}
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    <div className="metric-grid">
      <article className="metric-card"><p className="eyebrow">SO‘ROVNOMALAR</p><strong>{overview?.surveys_total ?? "—"}</strong><span>{overview?.surveys_open ?? 0} ta faol</span></article>
      <article className="metric-card"><p className="eyebrow">JAVOBLAR (JORIY)</p><strong>{overview?.responses_live ?? "—"}</strong><span>{overview?.responses_expiring_24h ?? 0} tasi 24 soatda o‘chadi</span></article>
      <article className="metric-card"><p className="eyebrow">KIRISH HUQUQI</p><strong>{overview?.entitlements_active ?? "—"}</strong><span>{overview?.entitlements_expiring_30d ?? 0} tasi 30 kunda tugaydi</span></article>
      <article className="metric-card"><p className="eyebrow">O‘CHIRILGAN (7 KUN)</p><strong>{overview?.purged_last_7d ?? "—"}</strong><span>{overview?.templates_total ?? 0} ta shablon saqlangan</span></article>
    </div>

    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="So‘rovnoma nomi yoki egasining emaili" /></div>
      <button className="secondary-button compact" type="submit">Qidirish</button>
    </form>

    <section className="panel flush">
      <div className="panel-heading"><div><p className="eyebrow">SURVEYS</p><h2>So‘rovnomalar</h2></div></div>
      {loading ? <TableSkeleton rows={6} /> : surveys.length === 0 ? (
        <EmptyState detail="Hozircha bironta so‘rovnoma yaratilmagan." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>So‘rovnoma</th><th>Egasi</th><th>Holat</th><th>Javoblar</th><th>Joriy</th><th>Muddat</th><th /></tr></thead>
            <tbody>
              {surveys.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.title}</strong><small>{row.question_count} savol · {stamp(row.created_at)}</small></td>
                  <td>{row.owner_name || "—"}<small>{row.owner_email}</small></td>
                  <td><StatusBadge value={row.status} /></td>
                  <td>{row.submitted_count}{row.expected_participants ? ` / ${row.expected_participants}` : ""}<small>{row.participant_count} kishi ochgan</small></td>
                  {/* "Joriy" is what still exists: rows past their window are gone. */}
                  <td>{row.live_responses}<small>{row.retention_hours} soat saqlanadi</small></td>
                  <td>{stamp(row.deadline)}</td>
                  <td>
                    <button
                      className="icon-button"
                      type="button"
                      title={row.status === "open" ? "Yopish" : "Ochish"}
                      disabled={busy === row.id}
                      onClick={() => { setModerating(row); setReason(""); setModalError(null); }}
                    >
                      {row.status === "open" ? <Lock size={16} /> : <Play size={16} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>

    <section className="panel flush">
      <div className="panel-heading"><div><p className="eyebrow">ENTITLEMENTS</p><h2>Modulga kirish huquqi</h2></div></div>
      {loading ? <TableSkeleton rows={4} /> : entitlements.length === 0 ? (
        <EmptyState title="Kirish huquqi berilmagan" detail="Hozircha hech kimga Ma’lumotlarni yig‘ish moduliga pullik kirish berilmagan." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Foydalanuvchi</th><th>Holat</th><th>Boshlangan</th><th>Tugaydi</th><th>Summa</th><th>Manba</th><th /></tr></thead>
            <tbody>
              {entitlements.map((row) => (
                <tr key={row.id}>
                  <td>{row.full_name || "—"}<small>{row.email}</small></td>
                  <td><StatusBadge value={row.status} /></td>
                  <td>{stamp(row.starts_at)}</td>
                  <td>{stamp(row.expires_at)}</td>
                  <td>{priceIn(row.purchased_amount, row.currency)}</td>
                  <td className="capitalize">{row.source.replaceAll("_", " ")}</td>
                  <td>
                    {row.status === "active" ? (
                      <button className="icon-button" type="button" title="Bekor qilish" disabled={busy === row.id} onClick={() => void revoke(row)}>
                        <ShieldCheck size={16} />
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

    {moderating && (
      <Modal
        title={moderating.status === "open" ? "So‘rovnomani yopish" : "So‘rovnomani qayta ochish"}
        description={`“${moderating.title}” — egasi ${moderating.owner_email}. Bu amal audit jurnaliga yoziladi va egasiga xabarnoma yuboriladi.`}
        onClose={() => setModerating(null)}
      >
        <label>Sabab<input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Masalan: qoidalarga zid savollar" /></label>
        {modalError && <p className="cell-error">{modalError}</p>}
        <div className="row-actions">
          <button className="secondary-button" type="button" onClick={() => setModerating(null)}>Bekor qilish</button>
          <button
            className="primary-button"
            type="button"
            disabled={busy === moderating.id}
            onClick={() => void moderate(moderating.status === "open" ? "closed" : "open")}
          >
            {moderating.status === "open" ? "Yopish" : "Ochish"}
          </button>
        </div>
      </Modal>
    )}

    {grantOpen && (
      <Modal
        title="Modulga kirish berish"
        description="Email bo‘yicha Ma’lumotlarni yig‘ish moduliga kirish huquqi beriladi. Mavjud kirish muddati uzaytiriladi."
        onClose={() => setGrantOpen(false)}
      >
        <form className="finance-form" onSubmit={(event) => void grant(event)}>
          <label>Email<input required type="email" value={grantEmail} onChange={(event) => setGrantEmail(event.target.value)} placeholder="foydalanuvchi@example.com" /></label>
          <label>Muddat (oy)<input required type="number" min="1" max="120" value={grantMonths} onChange={(event) => setGrantMonths(event.target.value)} /></label>
          {modalError && <p className="cell-error">{modalError}</p>}
          <button className="primary-button" type="submit" disabled={busy === "grant"}><KeyRound size={16} /> Kirish berish</button>
        </form>
      </Modal>
    )}
  </div>;
}
