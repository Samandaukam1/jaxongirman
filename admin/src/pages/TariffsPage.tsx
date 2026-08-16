import {
  cardLines,
  detailSections,
  economicsOf,
  formatAmount,
  priceLine,
  type PlanFeature,
  type PlanFeatures,
} from "@jaxongirman/tariff-card";
import { AlertTriangle, Check, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  listPlans, loadOverview, planFromRow, savePlan,
  type Overview, type PlanRow, type SavePlanInput,
} from "@/lib/tariffs";

/**
 * The tariff builder.
 *
 * The preview on the right is not a mock of the card — it is the card, drawn
 * from the same `@jaxongirman/tariff-card` the app sells with. A preview that
 * drew its own version would be a guess, and the only way to see the truth
 * would be to publish and look.
 */

type Draft = SavePlanInput;

const BLANK: Draft = {
  id: null, code: "", name: "", subtitle: "", description: "", badge: "", ctaLabel: "",
  priceAmount: 36000, compareAtAmount: 0, currency: "UZS", periodDays: 30,
  estimatedCostAmount: 0, isActive: true, isFeatured: false, sortOrder: 0,
  features: {},
};

function toDraft(row: PlanRow): Draft {
  return {
    id: row.id, code: row.code, name: row.name, subtitle: row.subtitle,
    description: row.description, badge: row.badge, ctaLabel: row.cta_label,
    priceAmount: row.price_amount, compareAtAmount: row.compare_at_amount,
    currency: row.currency, periodDays: row.period_days,
    estimatedCostAmount: row.estimated_cost_amount, isActive: row.is_active,
    isFeatured: row.is_featured, sortOrder: row.sort_order,
    features: (row.features ?? {}) as PlanFeatures,
  };
}

/**
 * The capabilities an admin can shape, grouped as somebody pricing a plan
 * thinks about them rather than as the database stores them.
 */
const GROUPS: { title: string; items: { key: string; label: string; kind: "limit" | "toggle" | "cost"; unit?: string }[] }[] = [
  {
    title: "AI prezentatsiya",
    items: [
      { key: "presentation_weekly", label: "Haftalik limit", kind: "limit", unit: "ta / hafta" },
      { key: "presentation_max_slides", label: "Maksimal slayd", kind: "limit", unit: "slayd" },
    ],
  },
  {
    title: "Marafon",
    items: [{ key: "marathon_unlock", label: "Haftalik premium ochish", kind: "limit", unit: "ta / hafta" }],
  },
  {
    title: "Marketplace",
    items: [
      { key: "marketplace_access", label: "Kirish", kind: "toggle" },
      { key: "marketplace_buy", label: "Xarid qilish", kind: "toggle" },
      { key: "marketplace_sell", label: "Sotish", kind: "toggle" },
      { key: "marketplace_edit", label: "Tahrirlash", kind: "toggle" },
      { key: "marketplace_present", label: "Taqdimot qilish", kind: "toggle" },
      { key: "marketplace_download", label: "Yuklab olish", kind: "toggle" },
      { key: "marketplace_resale", label: "Qayta sotish", kind: "toggle" },
    ],
  },
  {
    title: "O‘yingoh",
    items: [
      { key: "game_free_daily", label: "Kunlik bepul o‘yin", kind: "limit", unit: "ta / kun" },
      { key: "game_cost_after_free", label: "Limitdan keyin", kind: "cost", unit: "J" },
    ],
  },
  {
    title: "PPTX",
    items: [{ key: "external_pptx_present", label: "Tashqi PPTX namoyishi", kind: "cost", unit: "J" }],
  },
];

export function TariffsPage() {
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [rows, stats] = await Promise.all([listPlans(), loadOverview()]);
      setPlans(rows);
      setOverview(stats);
    } catch (requestError) {
      setError(errorMessage(requestError));
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function commit() {
    if (!draft) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await savePlan(draft);
      setDraft(toDraft(saved));
      setMessage(`“${saved.name}” saqlandi.`);
      await load();
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="TARIFLAR"
        title="Tariflar"
        description="Narx, imkoniyatlar va limitlar — ilovani yangilamasdan boshqariladi."
        action={
          <button className="primary-button" type="button" onClick={() => setDraft({ ...BLANK })}>
            <Plus size={16} strokeWidth={2.1} /> Yangi tarif
          </button>
        }
      />

      {error ? <ErrorState title="Saqlanmadi" message={error} onRetry={() => void load()} /> : null}
      {message ? <p className="jslayd-message">{message}</p> : null}

      {overview ? <Analytics overview={overview} /> : null}

      <section className="panel flush">
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>Tarif</th><th>Narx</th><th>A‘zolar</th><th>MRR</th><th>Marja</th><th>Holat</th><th /></tr>
            </thead>
            <tbody>
              {plans.map((row) => {
                const stat = overview?.plans.find((p) => p.id === row.id);
                const money = economicsOf({ priceAmount: row.price_amount, estimatedCostAmount: row.estimated_cost_amount });
                return (
                  <tr key={row.id}>
                    <td><strong>{row.name}</strong><br /><small>{row.code}</small></td>
                    <td>{formatAmount(row.price_amount)} {row.currency}</td>
                    <td>{stat?.members ?? 0}</td>
                    <td>{formatAmount(stat?.mrr ?? 0)}</td>
                    <td className={money.lossy ? "margin-lossy" : undefined}>
                      {row.estimated_cost_amount > 0 ? `${money.marginPercent}%` : "—"}
                    </td>
                    <td>{row.is_active ? "Faol" : "O‘chiq"}</td>
                    <td>
                      <button className="secondary-button compact" type="button" onClick={() => setDraft(toDraft(row))}>
                        Tahrirlash
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {draft ? (
        <Builder
          draft={draft}
          busy={busy}
          onChange={setDraft}
          onSave={() => void commit()}
          onClose={() => { setDraft(null); setMessage(null); }}
        />
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- analytics */

function Analytics({ overview }: { overview: Overview }) {
  const mrr = overview.plans.reduce((sum, plan) => sum + Number(plan.mrr ?? 0), 0);
  return (
    <div className="metric-grid">
      <Metric label="A‘zolar" value={String(overview.totals.members ?? 0)} />
      <Metric label="MRR" value={`${formatAmount(mrr)} so‘m`} />
      <Metric label="Bu oy yangi" value={String(overview.totals.new_this_month ?? 0)} />
      <Metric label="Muddati tugagan" value={String(overview.totals.lapsed ?? 0)} />
      <Metric label="30 kunda sarflangan J" value={formatAmount(overview.jcoin_spent_30d ?? 0)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric-card"><span>{label}</span><strong>{value}</strong></div>;
}

/* ----------------------------------------------------------------- builder */

function Builder({ draft, busy, onChange, onSave, onClose }: {
  draft: Draft; busy: boolean;
  onChange: (next: Draft) => void; onSave: () => void; onClose: () => void;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });

  const setFeature = (key: string, patch: Partial<PlanFeature>) => {
    const current = (draft.features[key] ?? {}) as PlanFeature;
    onChange({ ...draft, features: { ...draft.features, [key]: { ...current, ...patch } } });
  };

  const plan = useMemo(() => planFromRow({
    code: draft.code, name: draft.name || "Nomsiz tarif", subtitle: draft.subtitle,
    description: draft.description, badge: draft.badge, cta_label: draft.ctaLabel,
    price_amount: draft.priceAmount, compare_at_amount: draft.compareAtAmount,
    currency: draft.currency, period_days: draft.periodDays, features: draft.features,
  }), [draft]);

  const money = economicsOf({ priceAmount: draft.priceAmount, estimatedCostAmount: draft.estimatedCostAmount });

  return (
    <section className="panel tariff-builder">
      <div className="tariff-editor">
        <h3>1. Asosiy</h3>
        <div className="form-grid">
          <label>Nomi<input value={draft.name} onChange={(e) => set("name", e.target.value)} /></label>
          <label>Kod<input value={draft.code} onChange={(e) => set("code", e.target.value)} placeholder="premium_monthly" /></label>
          <label>Subtitle<input value={draft.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></label>
          <label>Badge<input value={draft.badge} onChange={(e) => set("badge", e.target.value)} placeholder="ENG OMMABOP" /></label>
          <label>CTA<input value={draft.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} /></label>
          <label>Narx<input type="number" min={0} value={draft.priceAmount} onChange={(e) => set("priceAmount", Number(e.target.value))} /></label>
          <label>Eski narx<input type="number" min={0} value={draft.compareAtAmount} onChange={(e) => set("compareAtAmount", Number(e.target.value))} /></label>
          <label>Muddat (kun)<input type="number" min={1} value={draft.periodDays} onChange={(e) => set("periodDays", Number(e.target.value))} /></label>
          <label className="checkbox"><input type="checkbox" checked={draft.isActive} onChange={(e) => set("isActive", e.target.checked)} /> Faol</label>
          <label className="checkbox"><input type="checkbox" checked={draft.isFeatured} onChange={(e) => set("isFeatured", e.target.checked)} /> Featured</label>
        </div>

        <h3>2. Imkoniyatlar</h3>
        {GROUPS.map((group) => (
          <div key={group.title} className="tariff-group">
            <strong>{group.title}</strong>
            {group.items.map((item) => {
              const feature = (draft.features[item.key] ?? {}) as PlanFeature;
              return (
                <div key={item.key} className="tariff-feature">
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={Boolean(feature.enabled)}
                      onChange={(e) => setFeature(item.key, { enabled: e.target.checked })}
                    />
                    {item.label}
                  </label>
                  {feature.enabled && item.kind === "limit" ? (
                    <>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(feature.unlimited)}
                          onChange={(e) => setFeature(item.key, { unlimited: e.target.checked, limit: e.target.checked ? null : 1 })}
                        />
                        Cheksiz
                      </label>
                      {!feature.unlimited ? (
                        <span className="tariff-number">
                          <input
                            type="number" min={0}
                            value={feature.limit ?? 0}
                            onChange={(e) => setFeature(item.key, { limit: Number(e.target.value) })}
                          />
                          <em>{item.unit}</em>
                        </span>
                      ) : null}
                    </>
                  ) : null}
                  {feature.enabled && item.kind === "cost" ? (
                    <span className="tariff-number">
                      <input
                        type="number" min={0}
                        value={feature.cost ?? 0}
                        onChange={(e) => setFeature(item.key, { cost: Number(e.target.value) })}
                      />
                      <em>{item.unit}</em>
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}

        <h3>3. Birlik iqtisodiyoti</h3>
        <div className="form-grid">
          <label>
            Taxminiy tannarx (bir a‘zo)
            <input type="number" min={0} value={draft.estimatedCostAmount}
              onChange={(e) => set("estimatedCostAmount", Number(e.target.value))} />
          </label>
        </div>
        <dl className="tariff-economics">
          <div><dt>Narx</dt><dd>{formatAmount(money.price)}</dd></div>
          <div><dt>Tannarx</dt><dd>{formatAmount(money.estimatedCost)}</dd></div>
          <div><dt>Foyda</dt><dd>{formatAmount(money.grossProfit)}</dd></div>
          <div><dt>Marja</dt><dd>{money.marginPercent}%</dd></div>
        </dl>
        {money.lossy ? (
          <p className="tariff-warning">
            <AlertTriangle size={15} /> Bu konfiguratsiya zarar keltirishi mumkin — narx taxminiy tannarxdan past.
            Bu ogohlantirish, taqiq emas.
          </p>
        ) : null}

        <div className="header-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={onSave}>
            <Check size={16} strokeWidth={2.1} /> {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
          <button className="secondary-button" type="button" onClick={onClose}>Yopish</button>
        </div>
      </div>

      {/* The card the app ships, drawn from the draft as it is typed. */}
      <aside className="tariff-preview">
        <p className="eyebrow">LIVE PREVIEW</p>
        <div className="tariff-card">
          {plan.badge ? <span className="tariff-card-badge">{plan.badge}</span> : null}
          <h4>{plan.name}</h4>
          <div className="tariff-card-price">
            <strong>{priceLine(plan).amount}</strong>
            <span>{priceLine(plan).unit}</span>
          </div>
          {plan.subtitle ? <p className="tariff-card-subtitle">{plan.subtitle}</p> : null}
          <ul className="tariff-card-lines">
            {cardLines(plan).map((line) => (
              <li key={line.key}><Check size={14} strokeWidth={2.4} /> {line.label}</li>
            ))}
          </ul>
          <button className="tariff-card-cta" type="button" disabled>
            {plan.ctaLabel || `${priceLine(plan).amount} so‘mga boshlash`}
          </button>
        </div>

        <details className="tariff-detail">
          <summary>Barcha imkoniyatlar</summary>
          {detailSections(plan).map((section) => (
            <div key={section.key}>
              <strong>{section.title}</strong>
              <dl>
                {section.rows.map((row) => (
                  <div key={row.label} className={row.included ? undefined : "is-absent"}>
                    <dt>{row.label}</dt><dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </details>
      </aside>
    </section>
  );
}
