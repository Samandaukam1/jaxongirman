import type { Database, Json } from "@jaxongirman/types";
import { Check, Eye, EyeOff, Flag, Search, X } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, Modal, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, priceIn, stamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type ProductRow = Database["public"]["Functions"]["admin_list_marketplace_products"]["Returns"][number];
type ReportRow = Database["public"]["Functions"]["admin_list_marketplace_reports"]["Returns"][number];
type ProductStatus = Database["public"]["Enums"]["marketplace_product_status"];

const TABS = [
  { key: "pending_review", label: "Tekshiruvda" },
  { key: "approved", label: "Sotuvda" },
  { key: "rejected", label: "Qaytarilgan" },
  { key: "all", label: "Barchasi" },
] as const;

const REASON_LABELS: Record<string, string> = {
  copyright: "Mualliflik huquqi",
  plagiarism: "Plagiat",
  inappropriate: "Nomaqbul kontent",
  fraud: "Aldov",
  other: "Boshqa",
};

/**
 * Marketplace moderation.
 *
 * A listing reaches buyers only after someone here approves it, and approval
 * covers the bytes that were approved — editing an approved product sends it
 * back to this queue automatically. Rejection requires a reason, because the
 * seller is told what it was.
 */
type RefundPolicy = { enabled: boolean; title: string; body: string; checkbox_label: string };

const EMPTY_POLICY: RefundPolicy = { enabled: true, title: "", body: "", checkbox_label: "" };

export function MarketplacePage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("pending_review");
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [rejecting, setRejecting] = useState<ProductRow | null>(null);
  const [reason, setReason] = useState("");
  const [resolving, setResolving] = useState<ReportRow | null>(null);
  const [note, setNote] = useState("");
  const [modalError, setModalError] = useState<string | null>(null);
  const [policy, setPolicy] = useState<RefundPolicy>(EMPTY_POLICY);
  const [policySaving, setPolicySaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [productResult, reportResult, policyResult] = await Promise.all([
      supabase.rpc("admin_list_marketplace_products", {
        p_status: tab === "all" ? undefined : (tab as ProductStatus),
        p_search: search || undefined,
        p_limit: 100,
        p_offset: 0,
      }),
      supabase.rpc("admin_list_marketplace_reports", { p_limit: 100 }),
      supabase.from("app_settings").select("value").eq("key", "marketplace.refund_policy").maybeSingle(),
    ]);
    const requestError = productResult.error ?? reportResult.error;
    if (requestError) setError(errorMessage(requestError));
    else {
      setProducts(productResult.data ?? []); setReports(reportResult.data ?? []);
      setPolicy({ ...EMPTY_POLICY, ...((policyResult.data?.value ?? {}) as Partial<RefundPolicy>) });
    }
    setLoading(false);
  }, [search, tab]);

  useEffect(() => { void load(); }, [load]);

  /**
   * Saves the wording buyers must agree to.
   *
   * Kept as a form rather than a JSON box because this is the one setting on
   * the page a lawyer might edit, and asking somebody to mind their commas
   * inside braces is how a sentence ends up unparseable and the checkbox
   * disappears for everyone.
   */
  async function savePolicy() {
    setPolicySaving(true); setError(null); setMessage(null);
    const { error: saveError } = await supabase.rpc("admin_update_app_setting", {
      p_key: "marketplace.refund_policy",
      p_value: policy as unknown as Json,
      p_reason: "Marketplace refund policy updated",
    });
    if (saveError) setError(errorMessage(saveError));
    else setMessage("Qaytarish siyosati saqlandi — xaridorlar shu matnni ko‘radi.");
    setPolicySaving(false);
  }

  async function moderate(product: ProductRow, action: "approve" | "hide" | "restore") {
    setBusy(product.id); setError(null);
    const { error: moderateError } = await supabase.rpc("admin_moderate_product", {
      p_product_id: product.id, p_action: action, p_reason: "",
    });
    if (moderateError) setError(errorMessage(moderateError));
    else { setMessage(`“${product.title}” yangilandi va sotuvchiga xabar berildi.`); await load(); }
    setBusy(null);
  }

  async function reject(event: FormEvent) {
    event.preventDefault();
    if (!rejecting) return;
    if (reason.trim() === "") { setModalError("Qaytarish sababini yozing — u sotuvchiga ko‘rsatiladi."); return; }
    setBusy(rejecting.id); setModalError(null);
    const { error: rejectError } = await supabase.rpc("admin_moderate_product", {
      p_product_id: rejecting.id, p_action: "reject", p_reason: reason.trim(),
    });
    if (rejectError) setModalError(errorMessage(rejectError));
    else { setMessage(`“${rejecting.title}” qaytarildi.`); setRejecting(null); setReason(""); await load(); }
    setBusy(null);
  }

  async function resolve(status: "upheld" | "dismissed") {
    if (!resolving) return;
    setBusy(resolving.id); setModalError(null);
    const { error: resolveError } = await supabase.rpc("admin_resolve_report", {
      p_report_id: resolving.id, p_status: status, p_note: note.trim(),
    });
    if (resolveError) setModalError(errorMessage(resolveError));
    else {
      setMessage(status === "upheld" ? "Shikoyat qabul qilindi, mahsulot yashirildi." : "Shikoyat rad etildi.");
      setResolving(null); setNote(""); await load();
    }
    setBusy(null);
  }

  const openReports = reports.filter((report) => report.status === "open" || report.status === "reviewing");

  return <div className="page-stack">
    <PageHeader
      eyebrow="MARKETPLACE"
      title="Do‘kon moderatsiyasi"
      description="Sotuvga qo‘yilgan materiallar shu yerdan tasdiqlanadi. Tasdiqlangan mahsulot tahrirlansa, u avtomatik ravishda qayta tekshiruvga qaytadi."
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}
    {message && <div className="success-banner">{message}</div>}

    {openReports.length > 0 && (
    <section className="panel flush">
        <div className="panel-heading">
          <div><p className="eyebrow">REPORTS</p><h2>Shikoyatlar ({openReports.length})</h2></div>
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mahsulot</th><th>Sabab</th><th>Izoh</th><th>Kim</th><th>Sana</th><th /></tr></thead>
            <tbody>
              {openReports.map((report) => (
                <tr key={report.id}>
                  <td><strong>{report.product_title}</strong><small>{report.seller_email}</small></td>
                  <td><StatusBadge value={report.reason} /><small>{REASON_LABELS[report.reason] ?? report.reason}</small></td>
                  <td className="reason-cell">{report.detail || "—"}</td>
                  <td><small>{report.reporter_email}</small></td>
                  <td>{stamp(report.created_at)}</td>
                  <td>
                    <button
                      className="secondary-button compact"
                      type="button"
                      disabled={busy === report.id}
                      onClick={() => { setResolving(report); setNote(""); setModalError(null); }}
                    >
                      <Flag size={15} /> Ko‘rib chiqish
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <form className="toolbar" onSubmit={(event) => { event.preventDefault(); setSearch(query.trim()); }}>
      <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Mahsulot nomi yoki sotuvchi emaili" /></div>
      <button className="secondary-button compact" type="submit">Qidirish</button>
    </form>

    <div className="toolbar">
      {TABS.map((item) => (
        <button
          key={item.key}
          className={tab === item.key ? "primary-button compact" : "secondary-button compact"}
          type="button"
          onClick={() => setTab(item.key)}
        >
          {item.label}
        </button>
      ))}
    </div>

    {/* The rule buyers agree to before paying. The server refuses an order
        without that agreement, so this is the wording behind a real gate rather
        than a notice. */}
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">REFUND POLICY</p><h2>Qaytarish siyosati</h2></div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={policy.enabled}
            onChange={(event) => setPolicy({ ...policy, enabled: event.target.checked })}
          />
          <span>Xariddan oldin rozilik talab qilinsin</span>
        </label>
      </div>
      <div className="form-grid">
        <label>
          <span>Sarlavha</span>
          <input value={policy.title} onChange={(event) => setPolicy({ ...policy, title: event.target.value })} />
        </label>
        <label>
          <span>Rozilik matni (checkbox)</span>
          <input value={policy.checkbox_label} onChange={(event) => setPolicy({ ...policy, checkbox_label: event.target.value })} />
        </label>
        <label className="wide">
          <span>To‘liq matn</span>
          <textarea rows={5} value={policy.body} onChange={(event) => setPolicy({ ...policy, body: event.target.value })} />
        </label>
      </div>
      <button className="primary-button" type="button" disabled={policySaving} onClick={() => void savePolicy()}>
        {policySaving ? "Saqlanmoqda…" : "Saqlash"}
      </button>
    </section>

    <section className="panel flush">
      {loading ? <TableSkeleton rows={6} /> : products.length === 0 ? (
        <EmptyState
          title={tab === "pending_review" ? "Navbat bo‘sh" : "Mahsulot topilmadi"}
          detail={tab === "pending_review" ? "Tekshiruvni kutayotgan material yo‘q." : "Bu holatda mahsulot yo‘q."}
        />
      ) : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Mahsulot</th><th>Sotuvchi</th><th>Narx</th><th>Holat</th><th>Sotuv</th><th>Sana</th><th /></tr></thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className={product.open_reports > 0 ? "row-warning" : undefined}>
                  <td>
                    <strong>{product.title}</strong>
                    <small>
                      {product.material_type}
                      {!product.has_main_file && " · fayl biriktirilmagan"}
                      {product.open_reports > 0 && ` · ${product.open_reports} shikoyat`}
                    </small>
                  </td>
                  <td>{product.seller_name || "—"}<small>{product.seller_email}</small></td>
                  <td>{priceIn(product.base_price, product.currency)}</td>
                  <td>
                    <StatusBadge value={product.status} />
                    {product.rejection_reason && <small className="cell-error">{product.rejection_reason}</small>}
                  </td>
                  <td>{product.sales_count}{product.rating !== null && <small>★ {product.rating}</small>}</td>
                  <td>{stamp(product.created_at)}</td>
                  <td>
                    <div className="row-actions">
                      {product.status !== "approved" && (
                        <button
                          className="icon-button"
                          type="button"
                          title={product.has_main_file ? "Tasdiqlash" : "Fayl biriktirilmagan"}
                          disabled={busy === product.id || !product.has_main_file}
                          onClick={() => void moderate(product, product.status === "hidden" ? "restore" : "approve")}
                        >
                          <Check size={16} />
                        </button>
                      )}
                      {product.status === "approved" && (
                        <button
                          className="icon-button"
                          type="button"
                          title="Yashirish"
                          disabled={busy === product.id}
                          onClick={() => void moderate(product, "hide")}
                        >
                          <EyeOff size={16} />
                        </button>
                      )}
                      {product.status === "hidden" && (
                        <button
                          className="icon-button"
                          type="button"
                          title="Qaytarish"
                          disabled={busy === product.id}
                          onClick={() => void moderate(product, "restore")}
                        >
                          <Eye size={16} />
                        </button>
                      )}
                      {product.status !== "rejected" && (
                        <button
                          className="icon-button"
                          type="button"
                          title="Qaytarish (sabab bilan)"
                          disabled={busy === product.id}
                          onClick={() => { setRejecting(product); setReason(""); setModalError(null); }}
                        >
                          <X size={16} />
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

    {rejecting && (
      <Modal
        title="Mahsulotni qaytarish"
        description={`“${rejecting.title}” sotuvchiga qaytariladi. Sabab unga xabarnoma orqali ko‘rsatiladi.`}
        onClose={() => setRejecting(null)}
      >
        <form className="finance-form" onSubmit={(event) => void reject(event)}>
          <label>Sabab<input required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Masalan: fayl mazmuni nomga mos emas" /></label>
          {modalError && <p className="cell-error">{modalError}</p>}
          <button className="primary-button" type="submit" disabled={busy === rejecting.id}>Qaytarish</button>
        </form>
      </Modal>
    )}

    {resolving && (
      <Modal
        title="Shikoyatni ko‘rib chiqish"
        description={`“${resolving.product_title}” — ${REASON_LABELS[resolving.reason] ?? resolving.reason}. Qabul qilinsa mahsulot darhol yashiriladi.`}
        onClose={() => setResolving(null)}
      >
        <label>Izoh<input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Qaror sababi" /></label>
        {modalError && <p className="cell-error">{modalError}</p>}
        <div className="row-actions">
          <button className="secondary-button" type="button" disabled={busy === resolving.id} onClick={() => void resolve("dismissed")}>
            Rad etish
          </button>
          <button className="primary-button" type="button" disabled={busy === resolving.id} onClick={() => void resolve("upheld")}>
            Qabul qilish va yashirish
          </button>
        </div>
      </Modal>
    )}
  </div>;
}
