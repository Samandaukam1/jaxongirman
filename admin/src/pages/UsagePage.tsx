import type { Database } from "@jaxongirman/types";
import { Coins, Cpu, Image, TextQuote } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { compactNumber, dateTime, errorMessage, money } from "@/lib/format";
import { supabase } from "@/lib/supabase";

type UsageRow = Database["public"]["Tables"]["ai_usage"]["Row"];

type Diagnosis = {
  gemini_configured: boolean;
  gemini_research_model: string;
  gemini_writing_model: string;
  gemini_writing_probe?: string;
  gemini_writing_reason?: string;
  verdict: string;
  /** `probe_<name>` and `probe_<name>_detail`, one pair per construct tried. */
  [key: string]: unknown;
};

/** What Gemini said about each shape, in the order they were asked. */
function probesOf(result: Diagnosis): { name: string; state: string; detail: string }[] {
  return Object.keys(result)
    .filter((key) => key.startsWith("probe_") && !key.endsWith("_detail"))
    .map((key) => ({
      name: key.replace("probe_", ""),
      state: String(result[key] ?? ""),
      detail: String(result[`${key}_detail`] ?? ""),
    }));
}

/**
 * Whether the text pipeline will work, asked before a customer's deck asks it.
 *
 * A generation used to fail at twenty-eight per cent with a billing sentence
 * from a vendor, and there was no way to tell from the outside whether the
 * writing model had been tried at all. This sends the model two words and
 * reports what came back. It never shows a key — the endpoint does not return
 * one, and there is nothing here that could print one if it did.
 */
function ProviderCheck() {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Diagnosis | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function run() {
    setBusy(true); setProblem(null); setResult(null);
    try {
      // A check that never answers is worse than one that fails: the button
      // sat on "Tekshirilmoqda…" for as long as somebody was willing to watch.
      const { data, error } = await Promise.race([
        supabase.functions.invoke("ai-diagnose", { body: {} }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Tekshiruv 60 soniyada javob bermadi.")), 60_000)),
      ]);
      if (error) throw error;
      setResult(data as Diagnosis);
    } catch (invokeError) {
      setProblem(errorMessage(invokeError));
    } finally {
      setBusy(false);
    }
  }

  const healthy = result?.gemini_configured && result.gemini_writing_probe === "ok";

  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Matn provayderi</h2>
          <p className="panel-hint">
            Taqdimot matni — tadqiqot, reja, mazmun va qayta yozish — faqat Gemini orqali yoziladi.
            Tekshiruv modelga ikki so‘zlik so‘rov yuboradi; kalitning o‘zi hech qachon ko‘rsatilmaydi.
          </p>
        </div>
        <button className="secondary-button compact" type="button" disabled={busy} onClick={() => void run()}>
          {busy ? "Tekshirilmoqda…" : "Provayderni tekshirish"}
        </button>
      </div>

      {problem ? <p className="field-problem">{problem}</p> : null}

      {result ? (
        <div className="payme-report">
          <div className={`provider-state ${healthy ? "is-ready" : "is-pending"}`}>
            <div>
              <strong>{result.verdict}</strong>
              <span>
                GEMINI_API_KEY: {result.gemini_configured ? "o‘rnatilgan" : "o‘rnatilmagan"}
                {result.gemini_writing_reason ? ` · sabab: ${result.gemini_writing_reason}` : ""}
              </span>
            </div>
          </div>
          <dl>
            <div><dt>Tadqiqot modeli</dt><dd><code>{result.gemini_research_model}</code></dd></div>
            <div><dt>Yozuv modeli</dt><dd><code>{result.gemini_writing_model}</code></dd></div>

          </dl>

          {/* One row per shape. A refusal here names the construct rather than
              the document, which is the whole reason they are asked apart. */}
          {probesOf(result).length > 0 ? (
            <ul>
              {probesOf(result).map((probe) => (
                <li key={probe.name} className={probe.state === "ok" ? "is-ok" : "is-bad"}>
                  <strong>{probe.name}</strong>
                  <span>{probe.state === "ok" ? "o‘tdi" : "RAD ETILDI"}</span>
                  {probe.detail ? <em>{probe.detail}</em> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

export function UsagePage() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    const { data, error: requestError } = await supabase.from("ai_usage").select("*").order("created_at", { ascending: false }).limit(250);
    if (requestError) setError(errorMessage(requestError)); else setRows(data ?? []);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  const totals = useMemo(() => rows.reduce((sum, row) => ({ input: sum.input + row.input_tokens, output: sum.output + row.output_tokens, images: sum.images + row.generated_images, cost: sum.cost + row.provider_cost_usd }), { input: 0, output: 0, images: 0, cost: 0 }), [rows]);

  return <div className="page-stack">
    <PageHeader eyebrow="UNIT ECONOMICS" title="AI foydalanish va xarajat" description="Provider bo‘yicha tokenlar, rasmlar, kechikish va hisoblangan tannarx." action={<button className="secondary-button compact" type="button" onClick={() => void load()}>Yangilash</button>} />
    <section className="metric-grid four"><article className="metric-card"><div className="metric-icon"><TextQuote size={20} /></div><span>Input tokenlar</span><strong>{compactNumber.format(totals.input)}</strong><small>Oxirgi {rows.length} so‘rov</small></article><article className="metric-card"><div className="metric-icon"><Cpu size={20} /></div><span>Output tokenlar</span><strong>{compactNumber.format(totals.output)}</strong><small>Structured output</small></article><article className="metric-card"><div className="metric-icon"><Image size={20} /></div><span>Generatsiya qilingan rasm</span><strong>{totals.images}</strong><small>AI visual aktivlar</small></article><article className="metric-card"><div className="metric-icon"><Coins size={20} /></div><span>Provayder tannarxi</span><strong>{money.format(totals.cost)}</strong><small>Konfiguratsiya narxlari asosida</small></article></section>
    <ProviderCheck />
    {error && <ErrorState message={error} onRetry={() => void load()} />}
    <section className="panel flush">{loading ? <TableSkeleton rows={8} /> : rows.length === 0 ? <EmptyState detail="Real generatsiyalar boshlanganda provayder iste’moli shu yerda ko‘rinadi." /> : <div className="table-wrap"><table><thead><tr><th>Operatsiya</th><th>Provayder / model</th><th>Input</th><th>Output</th><th>Rasm</th><th>Latency</th><th>Xarajat</th><th>Vaqt</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.operation}</strong><small>{row.presentation_id?.slice(0, 8) ?? "global"}</small></td><td><strong>{row.provider}</strong><small>{row.model}</small></td><td>{compactNumber.format(row.input_tokens)}</td><td>{compactNumber.format(row.output_tokens)}</td><td>{row.generated_images}</td><td>{row.latency_ms ? `${row.latency_ms} ms` : "—"}</td><td>{money.format(row.provider_cost_usd)}</td><td>{dateTime.format(new Date(row.created_at))}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
