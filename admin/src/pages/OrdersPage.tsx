import type { Database } from "@jaxongirman/types";
import { AlertTriangle, CheckCircle2, CreditCard, Search, ShieldCheck } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, PageHeader, StatusBadge, TableSkeleton } from "@/components/AdminUI";
import { errorMessage, stamp } from "@/lib/format";
import { supabase } from "@/lib/supabase";

// An admin is `authenticated` too, so the same column grant applies: the
// provider token is not readable from a browser by anyone.
type OrderRow = Omit<Database["public"]["Tables"]["orders"]["Row"], "provider_card_token" | "attempt_expires_at">;
type ReconciliationRow = Database["public"]["Functions"]["admin_order_reconciliation"]["Returns"][number];

const PURPOSE_LABELS: Record<string, string> = {
  subscription: "Tarif",
  jcoin: "J Coin",
  data_collection: "Ma’lumot yig‘ish",
  marketplace_presentation: "Taqdimot",
  marketplace_reference: "Referat",
  marketplace_independent_work: "Mustaqil ish",
  marketplace_game: "O‘yin",
  other_marketplace_product: "Boshqa material",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Kutilmoqda",
  awaiting_verification: "Tasdiqlanmoqda",
  processing: "Amalga oshirilmoqda",
  paid: "To‘langan",
  failed: "Amalga oshmadi",
  cancelled: "Bekor qilingan",
  refunded: "Qaytarilgan",
  expired: "Muddati tugagan",
};

const TABS = [
  { key: "all", label: "Barchasi" },
  { key: "paid", label: "To‘langan" },
  { key: "processing", label: "Jarayonda" },
  { key: "failed", label: "Amalga oshmagan" },
] as const;

function som(value: number): string {
  return `${value.toLocaleString("uz-UZ")} so‘m`;
}

/**
 * Orders and reconciliation.
 *
 * The reconciliation panel is above the list on purpose: an order whose fate the
 * provider knows and we do not is the only thing on this page that needs a
 * person today. It is read-only — an automatic "correction" to money is how a
 * reconciliation tool becomes the incident — so every row is a prompt to go and
 * check Payme, not a button that rewrites the books.
 *
 * The revenue figures separate turnover from what the platform actually keeps.
 * Calling GMV "daromad" would flatter the numbers by exactly the sellers' share.
 */
export function OrdersPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [concerns, setConcerns] = useState<ReconciliationRow[]>([]);
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<{ configured: boolean; provider: string | null }>({ configured: false, provider: null });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    let ordersQuery = supabase
      .from("orders")
      // An admin is `authenticated` too, so the same column grant applies.
      .select("id, order_number, user_id, purpose, status, product_id, coin_package_id, reference_code, seller_id, currency, subtotal, buyer_fee, total_amount, seller_fee, seller_net, platform_revenue, buyer_fee_rate, seller_fee_rate, payme_receipt_id, payme_transaction_id, is_test, failure_code, failure_message, metadata, created_at, updated_at, paid_at, cancelled_at, expires_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (tab !== "all") ordersQuery = ordersQuery.eq("status", tab);
    if (search) ordersQuery = ordersQuery.ilike("order_number", `%${search}%`);

    const [ordersResult, concernResult, settingsResult] = await Promise.all([
      ordersQuery,
      supabase.rpc("admin_order_reconciliation"),
      supabase.from("app_settings").select("value").eq("key", "payments.config").maybeSingle(),
    ]);

    const failure = ordersResult.error ?? concernResult.error;
    if (failure) {
      setError(errorMessage(failure));
    } else {
      setOrders(ordersResult.data ?? []);
      setConcerns(concernResult.data ?? []);
      const value = settingsResult.data?.value as { configured?: boolean; provider?: string } | null;
      setProvider({ configured: Boolean(value?.configured), provider: value?.provider ?? null });
    }
    setLoading(false);
  }, [search, tab]);

  useEffect(() => { void load(); }, [load]);

  // Test orders moved real money but are not the business; they are excluded
  // from the totals and labelled in the table rather than hidden.
  const real = orders.filter((order) => !order.is_test);
  const paid = real.filter((order) => order.status === "paid");
  const gmv = paid.reduce((sum, order) => sum + order.total_amount, 0);
  const platform = paid.reduce((sum, order) => sum + order.platform_revenue, 0);
  const sellerPayable = paid.reduce((sum, order) => sum + (order.seller_id ? order.seller_net : 0), 0);

  return <div className="page-stack">
    <PageHeader
      eyebrow="MOLIYA"
      title="Buyurtmalar"
      description="Har bir xarid — tarif, J Coin, modul yoki do‘kon materiali — shu yerda bitta buyurtma raqami ostida ko‘rinadi."
      action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>}
    />

    {error && <ErrorState message={error} onRetry={() => void load()} />}

    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">PAYME SUBSCRIBE</p><h2>Provayder holati</h2></div>
      </div>
      <div className="finance-form">
        <div className={`provider-state ${provider.configured ? "is-ready" : "is-pending"}`}>
          {provider.configured
            ? <CheckCircle2 size={18} />
            : <AlertTriangle size={18} />}
          <div>
            <strong>{provider.configured ? "Ulangan" : "Ulanmagan"}</strong>
            <span>{provider.provider ? `Provayder: ${provider.provider}` : "Provayder tanlanmagan"}</span>
          </div>
        </div>
        <p className="finance-hint">
          <ShieldCheck size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Merchant kaliti server muhitida (<code>PAYME_SUBSCRIBE_KEY</code>) saqlanadi va bu panelga
          hech qachon uzatilmaydi. Bu yerda faqat ulanish holati ko‘rinadi — kalitning o‘zi emas.
        </p>

        <PaymeDiagnostics />
      </div>
    </section>

    {concerns.length > 0 && (
      <section className="panel flush">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">RECONCILIATION</p>
            <h2>Tekshirish kerak ({concerns.length})</h2>
          </div>
        </div>
        <div className="warning-banner" style={{ margin: "0 22px 14px" }}>
          <strong>Bu ro‘yxat faqat ko‘rsatadi, tuzatmaydi.</strong>
          Quyidagi buyurtmalar holatini faqat Payme biladi: pul o‘tgan bo‘lishi mumkin. Har birini
          Payme kabinetida tekshirib, keyin qo‘lda hal qiling. Avtomatik “tuzatish” — moliyaviy
          hodisaga aylanadigan narsa.
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Buyurtma</th><th>Tur</th><th>Holat</th><th>Summa</th><th>Payme cheki</th><th>Foydalanuvchi</th><th>Sana</th><th>Nima gap</th></tr></thead>
            <tbody>
              {concerns.map((row) => (
                <tr key={row.id}>
                  <td><strong>{row.order_number}</strong></td>
                  <td><small>{PURPOSE_LABELS[row.purpose] ?? row.purpose}</small></td>
                  <td><StatusBadge value={row.status} /></td>
                  <td>{som(row.total_amount)}</td>
                  <td><small>{row.payme_receipt_id ?? "—"}</small></td>
                  <td><small>{row.user_email ?? "—"}</small></td>
                  <td>{stamp(row.created_at)}</td>
                  <td className="reason-cell">{row.concern}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <section className="metric-grid four">
      <article className="metric-card">
        <div className="metric-icon"><CreditCard size={20} /></div>
        <span>Aylanma (GMV)</span>
        <strong>{loading ? "—" : som(gmv)}</strong>
        <small>To‘langan buyurtmalar summasi</small>
      </article>
      <article className="metric-card">
        <div className="metric-icon"><CheckCircle2 size={20} /></div>
        <span>Platforma daromadi</span>
        <strong>{loading ? "—" : som(platform)}</strong>
        <small>Xaridor + sotuvchi komissiyasi</small>
      </article>
      <article className="metric-card">
        <div className="metric-icon"><AlertTriangle size={20} /></div>
        <span>Sotuvchilarga qarz</span>
        <strong>{loading ? "—" : som(sellerPayable)}</strong>
        <small>Hisob-kitob qilinishi kerak</small>
      </article>
      <article className="metric-card">
        <div className="metric-icon"><CreditCard size={20} /></div>
        <span>To‘langan buyurtmalar</span>
        <strong>{loading ? "—" : paid.length.toLocaleString("uz-UZ")}</strong>
        <small>{real.length} buyurtmadan</small>
      </article>
    </section>

    <form className="toolbar" onSubmit={(event: FormEvent) => { event.preventDefault(); setSearch(query.trim()); }}>
      <div className="search-box">
        <Search size={18} />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buyurtma raqami, masalan JAX-2026-000001" />
      </div>
      <button className="secondary-button compact" type="submit">Qidirish</button>
    </form>

    <div className="toolbar">
      {TABS.map((option) => (
        <button
          key={option.key}
          className={`secondary-button compact ${tab === option.key ? "is-active" : ""}`}
          type="button"
          onClick={() => setTab(option.key)}
        >
          {option.label}
        </button>
      ))}
    </div>

    <section className="panel flush">
      <div className="panel-heading"><div><p className="eyebrow">ORDERS</p><h2>Ro‘yxat</h2></div></div>
      {loading ? <TableSkeleton /> : orders.length === 0 ? (
        <EmptyState title="Buyurtma topilmadi" detail="Tanlangan shartga mos buyurtma yo‘q." />
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Buyurtma</th><th>Tur</th><th>Holat</th>
                <th>Mahsulot</th><th>Xizmat haqi</th><th>Jami</th>
                <th>Sotuvchiga</th><th>Platformaga</th>
                <th>Payme cheki</th><th>Sana</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td>
                    <strong>{order.order_number}</strong>
                    {order.is_test ? <small>SINOV</small> : null}
                    {order.failure_message ? <small className="cell-error">{order.failure_message}</small> : null}
                  </td>
                  <td><small>{PURPOSE_LABELS[order.purpose] ?? order.purpose}</small></td>
                  <td>
                    <StatusBadge value={order.status} />
                    <small>{STATUS_LABELS[order.status] ?? order.status}</small>
                  </td>
                  <td>{som(order.subtotal)}</td>
                  <td>{order.buyer_fee > 0 ? `${som(order.buyer_fee)} (${order.buyer_fee_rate}%)` : "—"}</td>
                  <td><strong>{som(order.total_amount)}</strong></td>
                  <td>{order.seller_id ? som(order.seller_net) : "—"}</td>
                  <td>{som(order.platform_revenue)}</td>
                  <td><small>{order.payme_receipt_id ?? "—"}</small></td>
                  <td>{stamp(order.paid_at ?? order.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  </div>;
}

/**
 * Why Payme is refusing `receipts.pay`, answered without charging anybody.
 *
 * `receipts.create` works and `receipts.pay` comes back -32504, with the same
 * `X-Auth: <merchant_id>:<key>` on both. That is only puzzling until you notice
 * that Payme documents create as reachable from the checkout page — the
 * merchant id alone can be enough for it. If so, a create that works proves
 * nothing about the key, and every method that does check the key refuses us
 * exactly the way `receipts.pay` does.
 *
 * The server runs three probes and reports what Payme actually said to each.
 * Nothing here ever receives the key, the assembled header or a card token.
 */
function PaymeDiagnostics() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{
    endpoint: string;
    environment: string;
    merchant: string;
    keyLength: number;
    verdict: string;
    probes: { step: string; ok: boolean; providerCode?: number; providerMessage?: string; providerData?: unknown; note: string }[];
  } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("payme-diagnose", { body: {} });
      if (error) throw error;
      setResult(data as typeof result);
    } catch (invokeError) {
      setProblem(errorMessage(invokeError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="payme-diagnostics">
      <button className="secondary-button compact" type="button" disabled={busy} onClick={() => void run()}>
        {busy ? "Tekshirilmoqda…" : "receipts.pay huquqini tekshirish"}
      </button>
      <p className="finance-hint">
        Pul olinmaydi: uchta so‘rov yuboriladi — kalit bilan chek yaratish, kalitsiz chek yaratish va
        kalit talab qiladigan <code>receipts.check</code>. Javoblar Payme’ning o‘z kodlari bilan ko‘rsatiladi.
      </p>

      {problem ? <p className="qrv-problem">{problem}</p> : null}

      {result ? (
        <div className="payme-report">
          <p className="payme-verdict">{result.verdict}</p>
          <dl>
            <div><dt>Endpoint</dt><dd><code>{result.endpoint}</code></dd></div>
            <div><dt>Muhit</dt><dd>{result.environment}</dd></div>
            <div><dt>Merchant</dt><dd>{result.merchant}</dd></div>
            <div><dt>Kalit uzunligi</dt><dd>{result.keyLength}</dd></div>
          </dl>
          <ul>
            {result.probes.map((probe) => (
              <li key={probe.step} className={probe.ok ? "is-ok" : "is-bad"}>
                <strong>{probe.step}</strong>
                <span>{probe.ok ? "o‘tdi" : `xato ${probe.providerCode ?? "?"}`}</span>
                {probe.providerMessage ? <em>{probe.providerMessage}</em> : null}
                <small>{probe.note}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
