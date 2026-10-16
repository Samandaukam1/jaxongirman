import { Archive, Coins, Palette, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * The engine that designs every deck, and what it costs.
 *
 * There is nothing to switch here any more. Every presentation's design is
 * invented for it during generation by the Liquid Glass engine — palette,
 * typefaces, light and glass computed from the topic — and the template
 * catalogues it replaced are retired (see the archive at the bottom of the
 * menu). What an operator needs from this page is the evidence: how many decks
 * it has made and what each one actually cost, against the plan it is sold on.
 */

type Stats = {
  decks: number;
  last30: number;
  averageCostUsd: number | null;
  averageSlides: number | null;
  usdUzs: number | null;
  plan: { price: number; monthly: number | null } | null;
  legacy: number;
};

const formatSom = (value: number) => `${Math.round(value).toLocaleString("ru-RU").replace(/,/g, " ")} so‘m`;

export function DesignEnginePage() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const [all, recent, costs, rate, plan, legacy] = await Promise.all([
      supabase.from("presentations").select("id", { count: "exact", head: true }).eq("design_engine", "glass_v1"),
      supabase.from("presentations").select("id", { count: "exact", head: true }).eq("design_engine", "glass_v1").gte("created_at", since),
      supabase.from("presentations").select("generation_cost_usd, generated_slide_count").eq("design_engine", "glass_v1").eq("status", "ready").order("created_at", { ascending: false }).limit(200),
      supabase.from("app_settings").select("value").eq("key", "finance.usd_uzs_rate").maybeSingle(),
      supabase.from("subscription_plans").select("price_amount, features").eq("code", "premium_monthly").maybeSingle(),
      supabase.from("presentations").select("id", { count: "exact", head: true }).neq("design_engine", "glass_v1"),
    ]);
    const failure = all.error ?? recent.error ?? costs.error;
    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    const rows = costs.data ?? [];
    const priced = rows.filter((row) => Number(row.generation_cost_usd) > 0);
    const features = (plan.data?.features ?? {}) as { presentation_weekly?: { limit?: number; period?: string } };
    const weekly = features.presentation_weekly;
    setStats({
      decks: all.count ?? 0,
      last30: recent.count ?? 0,
      averageCostUsd: priced.length ? priced.reduce((sum, row) => sum + Number(row.generation_cost_usd), 0) / priced.length : null,
      averageSlides: rows.length ? rows.reduce((sum, row) => sum + (row.generated_slide_count ?? 0), 0) / rows.length : null,
      usdUzs: Number((rate.data?.value as { rate?: number } | null)?.rate ?? 0) || null,
      plan: plan.data ? {
        price: plan.data.price_amount,
        monthly: weekly?.limit ? (weekly.period === "month" ? weekly.limit : weekly.period === "day" ? weekly.limit * 30 : weekly.limit * 4) : null,
      } : null,
      legacy: legacy.count ?? 0,
    });
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;

  const costSom = stats?.averageCostUsd && stats.usdUzs ? stats.averageCostUsd * stats.usdUzs : null;
  const planCost = costSom && stats?.plan?.monthly ? costSom * stats.plan.monthly : null;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Dizayn"
        title="Liquid Glass dizayn engine"
        description="Har bir taqdimotning dizayni generatsiya paytida noldan yaratiladi: mavzuga mos ranglar palitrasi, shriftlar juftligi, yorug‘lik va shisha elementlar. Oldindan tayyorlangan shablon ishlatilmaydi."
      />

      <div className="engine-grid">
        <div className="engine-card engine-card-on">
          <Sparkles size={20} />
          <span className="engine-title">Liquid Glass engine</span>
          <span className="engine-state">Faol — barcha taqdimotlar</span>
          <span className="engine-detail">
            AI faqat matnni yozadi (reja + mazmun, 2 ta so‘rov). Dizayn hisoblab chiqiladi: OKLCH palitra, kontrast tekshiruvi, shrift metrikalari bilan o‘lchangan joylashuv. Har sahifa yaratilgach tekshiriladi — yozuvlar ustma-ust tushmaydi.
          </span>
          <span className="engine-count">{stats ? `${stats.decks} ta taqdimot · oxirgi 30 kunda ${stats.last30} ta` : "Yuklanmoqda…"}</span>
        </div>

        <div className="engine-card">
          <Coins size={20} />
          <span className="engine-title">Bir taqdimot tannarxi</span>
          <span className="engine-state">
            {stats?.averageCostUsd ? `$${stats.averageCostUsd.toFixed(4)}${costSom ? ` ≈ ${formatSom(costSom)}` : ""}` : "Hali ma’lumot yo‘q"}
          </span>
          <span className="engine-detail">
            {stats?.averageSlides ? `O‘rtacha ${stats.averageSlides.toFixed(1)} ta slayd. ` : ""}
            Rasmlar ochiq fotobanklardan olinadi va pul talab qilmaydi.
          </span>
          {stats?.plan ? (
            <span className="engine-count">
              Tarif: {formatSom(stats.plan.price)} / oy{stats.plan.monthly ? `, ${stats.plan.monthly} ta taqdimot` : ""}
              {planCost ? ` · AI xarajati ≈ ${formatSom(planCost)} (${Math.round((planCost / stats.plan.price) * 100)}%)` : ""}
            </span>
          ) : null}
        </div>

        <div className="engine-card">
          <Palette size={20} />
          <span className="engine-title">Dizayn qanday yaratiladi</span>
          <span className="engine-detail">
            Mavzudan rang toni, kayfiyat va tipografika yo‘nalishi olinadi → palitra va 2 ta premium shrift tanlanadi → har bir sahifa uchun alohida kompozitsiya, glow va shisha elementlar hisoblanadi. Bir xil mavzu ham har safar boshqacha ko‘rinadi.
          </span>
        </div>

        <div className="engine-card">
          <Archive size={20} />
          <span className="engine-title">Eski JSLAYD va shablonlar</span>
          <span className="engine-state">Arxivlangan</span>
          <span className="engine-detail">
            Generatsiyada ishlatilmaydi va foydalanuvchilarga ko‘rsatilmaydi. Menyuning eng pastidagi «Arxiv» bo‘limida faqat ko‘rish uchun qoldirilgan.
          </span>
          {stats ? <span className="engine-count">{stats.legacy} ta eski taqdimot</span> : null}
        </div>
      </div>
    </div>
  );
}
