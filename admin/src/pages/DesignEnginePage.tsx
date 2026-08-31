import { Sparkles, Layers, AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";

/**
 * Which engine makes every deck from here on.
 *
 * Two switches and no other settings, because these two decide everything
 * else: whether a slide is composed for its own content or fitted into a
 * design somebody authored, and whether the authored designs are available at
 * all. A page of a dozen toggles would suggest they are independent, and they
 * are not.
 *
 * There is no preview of the consequence and no undo, so the page says plainly
 * what each state means and records who changed it. A deck already made is not
 * affected either way: it keeps the engine it was made with.
 */

type Engine = { generative: boolean; legacyRestricted: boolean };

export function DesignEnginePage() {
  // The defaults the product ships with, so the panel says what the backend
  // does in the moment before the settings arrive.
  const [engine, setEngine] = useState<Engine>({ generative: true, legacyRestricted: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [counts, setCounts] = useState<{ generative: number; legacy: number } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [settings, generative, legacy] = await Promise.all([
      supabase.from("app_settings").select("key,value").in("key", ["design.generative_enabled", "design.legacy_restricted"]),
      supabase.from("presentations").select("id", { count: "exact", head: true }).eq("design_engine", "generative_v1"),
      supabase.from("presentations").select("id", { count: "exact", head: true }).is("design_engine", null),
    ]);
    if (settings.error) {
      setError(errorMessage(settings.error));
      setLoading(false);
      return;
    }
    const byKey = new Map((settings.data ?? []).map((row) => [row.key, row.value]));
    /**
     * Read the way the generation pipeline reads them.
     *
     * `=== true` would show a missing row as "off" while every deck was being
     * built by the engine it says is off — a panel that reports the opposite of
     * what is happening is worse than no panel. Only a stored `false` is off,
     * here and in `design-engine.ts`, because they have to agree.
     */
    setEngine({
      generative: byKey.get("design.generative_enabled") !== false,
      legacyRestricted: byKey.get("design.legacy_restricted") !== false,
    });
    // How many decks each engine has actually made. A switch with a number
    // beside it is a decision; without one it is a guess.
    setCounts({ generative: generative.count ?? 0, legacy: legacy.count ?? 0 });
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function save(next: Engine) {
    setSaving(true);
    setError(null);
    setMessage(null);
    const { error: failure } = await supabase.rpc("admin_set_design_engine", {
      p_generative: next.generative,
      p_legacy_restricted: next.legacyRestricted,
      p_reason: next.generative ? "generativ dizayn yoqildi" : "generativ dizayn o‘chirildi",
    });
    setSaving(false);
    if (failure) {
      setError(errorMessage(failure));
      return;
    }
    setEngine(next);
    setMessage("Saqlandi. Keyingi taqdimotlar shu sozlama bilan quriladi.");
  }

  if (error && loading) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="page">
      <PageHeader
        eyebrow="Dizayn"
        title="Generativ dizayn"
        description="Taqdimotlar qaysi engine bilan quriladi. Tayyor taqdimotlarga ta’sir qilmaydi — ular o‘zi qurilgan engine bilan qoladi."
      />

      {error ? <ErrorState message={error} onRetry={load} /> : null}
      {message ? <p className="engine-note">{message}</p> : null}

      <div className="engine-grid">
        <button
          type="button"
          className={`engine-card${engine.generative ? " engine-card-on" : ""}`}
          disabled={saving || loading}
          onClick={() => void save({ ...engine, generative: !engine.generative })}
        >
          <Sparkles size={20} />
          <span className="engine-title">Generativ dizayn engine</span>
          <span className="engine-state">{engine.generative ? "Faol" : "O‘chirilgan"}</span>
          <span className="engine-detail">
            {engine.generative
              ? "Har bir slayd o‘z mazmuni uchun noldan quriladi."
              : "Slaydlar tayyor JSLAYD dizaynlariga joylashtiriladi."}
          </span>
          {counts ? <span className="engine-count">{counts.generative} ta taqdimot</span> : null}
        </button>

        <button
          type="button"
          className={`engine-card${engine.legacyRestricted ? " engine-card-on" : ""}`}
          disabled={saving || loading}
          onClick={() => void save({ ...engine, legacyRestricted: !engine.legacyRestricted })}
        >
          <Layers size={20} />
          <span className="engine-title">Eski JSLAYD va shablonlar</span>
          <span className="engine-state">{engine.legacyRestricted ? "Cheklangan" : "Ochiq"}</span>
          <span className="engine-detail">
            {engine.legacyRestricted
              ? "Oldindan biriktirilgan dizaynlar generatsiyada ishlatilmaydi."
              : "Oldindan biriktirilgan dizaynlar ishlatilishi mumkin."}
          </span>
          {counts ? <span className="engine-count">{counts.legacy} ta taqdimot</span> : null}
        </button>
      </div>

      {!engine.generative && engine.legacyRestricted ? (
        <p className="engine-warning">
          <AlertTriangle size={16} />
          Ikkalasi ham o‘chiq: taqdimotlar eski JSLAYD dizaynlari bilan quriladi.
        </p>
      ) : null}
    </div>
  );
}
