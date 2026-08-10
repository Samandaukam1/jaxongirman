import type { Database, Json } from "@jaxongirman/types";
import { Save } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type StyleRow = Database["public"]["Tables"]["style_configs"]["Row"];
type SettingRow = Database["public"]["Tables"]["app_settings"]["Row"];
const managedKeys = ["credits.initial_grant", "credits.packages", "credits.operation_costs", "generation.max_slide_count", "ai.provider_pricing"];

export function PricingPage() {
  const [styles, setStyles] = useState<StyleRow[]>([]);
  const [settings, setSettings] = useState<SettingRow[]>([]);
  const [draftSettings, setDraftSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const [stylesResult, settingsResult] = await Promise.all([
      supabase.from("style_configs").select("*").order("base_credits"),
      supabase.from("app_settings").select("*").in("key", managedKeys).order("key"),
    ]);
    const requestError = stylesResult.error ?? settingsResult.error;
    if (requestError) setError(errorMessage(requestError));
    else {
      setStyles(stylesResult.data ?? []); setSettings(settingsResult.data ?? []);
      setDraftSettings(Object.fromEntries((settingsResult.data ?? []).map((item) => [item.key, JSON.stringify(item.value, null, 2)])));
    }
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  function patchStyle(style: StyleRow["style"], field: keyof StyleRow, value: number | boolean) {
    setStyles((current) => current.map((item) => item.style === style ? { ...item, [field]: value } : item));
  }

  async function saveStyle(item: StyleRow) {
    setSavingKey(item.style); setError(null); setMessage(null);
    const { error: requestError } = await supabase.rpc("admin_update_style_config", { p_style: item.style, p_base_credits: item.base_credits, p_credits_per_slide: item.credits_per_slide, p_credits_per_image: item.credits_per_image, p_expected_image_ratio: item.expected_image_ratio, p_is_active: item.is_active, p_reason: "Admin pricing console update" });
    if (requestError) setError(errorMessage(requestError)); else setMessage(`${item.label} narxi saqlandi va audit jurnaliga yozildi.`);
    setSavingKey(null);
  }

  async function saveSetting(item: SettingRow) {
    setSavingKey(item.key); setError(null); setMessage(null);
    try {
      const value = JSON.parse(draftSettings[item.key] ?? "null") as Json;
      const { error: requestError } = await supabase.rpc("admin_update_app_setting", { p_key: item.key, p_value: value, p_reason: "Admin configuration console update" });
      if (requestError) setError(errorMessage(requestError)); else setMessage(`${item.key} konfiguratsiyasi saqlandi.`);
    } catch { setError("JSON qiymati noto‘g‘ri formatda."); }
    setSavingKey(null);
  }

  return <div className="page-stack">
    <PageHeader eyebrow="PRICING CONTROL" title="Kredit va narxlar" description="Uslub multiplikatorlari va operatsion narxlar koddan tashqarida, audit qilinadigan konfiguratsiyada." />
    {error && <ErrorState message={error} onRetry={() => void load()} />}{message && <div className="success-banner">{message}</div>}
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">STYLE MULTIPLIERS</p><h2>Prezentatsiya uslublari</h2></div></div>{loading ? <TableSkeleton rows={4} /> : <div className="table-wrap pricing-table"><table><thead><tr><th>Uslub</th><th>Asosiy</th><th>/ slayd</th><th>/ rasm</th><th>Rasm nisbati %</th><th>Faol</th><th /></tr></thead><tbody>{styles.map((item) => <tr key={item.style}><td><strong>{item.label}</strong><small>{item.description}</small></td><td><input type="number" min="0" value={item.base_credits} onChange={(event) => patchStyle(item.style, "base_credits", Number(event.target.value))} /></td><td><input type="number" min="0" step="0.01" value={item.credits_per_slide} onChange={(event) => patchStyle(item.style, "credits_per_slide", Number(event.target.value))} /></td><td><input type="number" min="0" step="0.01" value={item.credits_per_image} onChange={(event) => patchStyle(item.style, "credits_per_image", Number(event.target.value))} /></td><td><input type="number" min="0" max="100" value={item.expected_image_ratio} onChange={(event) => patchStyle(item.style, "expected_image_ratio", Number(event.target.value))} /></td><td><label className="switch"><input type="checkbox" checked={item.is_active} onChange={(event) => patchStyle(item.style, "is_active", event.target.checked)} /><span /></label></td><td><button className="icon-button" type="button" disabled={savingKey === item.style} title="Saqlash" onClick={() => void saveStyle(item)}><Save size={17} /></button></td></tr>)}</tbody></table></div>}</section>
    <section className="panel"><div className="panel-heading"><div><p className="eyebrow">RUNTIME CONFIGURATION</p><h2>Operatsion sozlamalar</h2></div></div>{loading ? <TableSkeleton rows={3} /> : <div className="settings-list">{settings.map((item) => <article key={item.key}><div><strong>{item.key}</strong><p>{item.description || "Server va kredit mexanizmi konfiguratsiyasi."}</p></div><textarea value={draftSettings[item.key] ?? ""} onChange={(event) => setDraftSettings((current) => ({ ...current, [item.key]: event.target.value }))} spellCheck={false} /><button className="secondary-button compact" type="button" disabled={savingKey === item.key} onClick={() => void saveSetting(item)}><Save size={15} /> Saqlash</button></article>)}</div>}</section>
  </div>;
}
