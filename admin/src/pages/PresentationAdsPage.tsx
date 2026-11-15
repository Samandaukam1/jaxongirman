import { ExternalLink, Save, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { EmptyState, ErrorState, PageHeader, TableSkeleton } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  AD_RATIO,
  AD_TYPES,
  DEFAULT_TIMING,
  MAX_ACTIVE_SLIDES,
  addPresentationAd,
  deletePresentationAd,
  listPresentationAds,
  loadBannerTiming,
  saveBannerTiming,
  savePresentationAd,
  timingProblem,
  type AdKind,
  type BannerTiming,
  type PresentationAd,
} from "@/lib/presentation-ads";
import { imageRatio } from "@/lib/site-icons";

const KINDS: { kind: AdKind; title: string; size: string; detail: string }[] = [
  {
    kind: "slide",
    title: "Reklama sahifalari",
    size: "16:9 · masalan 1920 × 1080",
    detail: `Tarifsiz foydalanuvchi taqdimotida har 5 sahifadan keyin bittadan sahifa qo‘yiladi (6-, 12-, 18-sahifa). Har bir reklama bir marta chiqadi. Bir vaqtda ko‘pi bilan ${MAX_ACTIVE_SLIDES} tasi faol bo‘ladi. Bu sahifalar yuklab olingan PDF va PPTX faylda ham bo‘ladi. Tarif sotib olinsa, ular yo‘qoladi.`,
  },
  {
    kind: "banner",
    title: "Bannerlar",
    size: "7:1 · masalan 1400 × 200",
    detail: "Taqdimot ekranining tepasidan tushib, bir necha soniya turadi. Tarifsiz foydalanuvchilarga va eng arzon tarifdagilarga chiqadi. Bir nechta banner bo‘lsa, navbat bilan chiqadi.",
  },
];

/**
 * Taqdimot reklamasi.
 *
 * The ads a deck carries when it is presented on jaxongirman.app/taqdimot and
 * when it is downloaded: full ad pages for owners with no plan, and a 7:1
 * banner for them and the cheapest plan. Which owner gets which is decided by
 * `presentation_ads_for`; this page only says what the ads are.
 */
export function PresentationAdsPage() {
  const [ads, setAds] = useState<PresentationAd[]>([]);
  const [timing, setTiming] = useState<BannerTiming>(DEFAULT_TIMING);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, times] = await Promise.all([listPresentationAds(), loadBannerTiming()]);
      setAds(list);
      setTiming(times);
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="TAQDIMOT"
        title="Taqdimot reklamasi"
        description="Taqdimot ekranida (jaxongirman.app/taqdimot) va yuklab olingan fayllarda chiqadigan reklamalar. Kimga qaysi biri chiqishini foydalanuvchining tarifi hal qiladi."
        action={
          <a className="secondary-button compact" href="https://jaxongirman.app/taqdimot" target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Taqdimot ekrani
          </a>
        }
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {KINDS.map((spec) => (
        <AdSection
          key={spec.kind}
          spec={spec}
          ads={ads.filter((ad) => ad.kind === spec.kind)}
          all={ads}
          loading={loading}
          onChanged={() => void load()}
        />
      ))}

      <TimingPanel timing={timing} loading={loading} onSaved={setTiming} />
    </div>
  );
}

function AdSection({ spec, ads, all, loading, onChanged }: {
  spec: (typeof KINDS)[number];
  ads: PresentationAd[];
  all: PresentationAd[];
  loading: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const activeCount = ads.filter((ad) => ad.active).length;

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setWarning(null);
    // A picture of another shape is letterboxed on the screen; say so, but let
    // the admin decide.
    const ratio = await imageRatio(file);
    const wanted = AD_RATIO[spec.kind];
    if (ratio && Math.abs(ratio - wanted) / wanted > 0.06) {
      setWarning(`Rasm nisbati ${ratio.toFixed(2)}, kerakli nisbat ${wanted.toFixed(2)}. Ekranda chetlari bo‘sh qolishi yoki kesilishi mumkin.`);
    }
    setBusy(true);
    try {
      await addPresentationAd(spec.kind, file, all);
      onChanged();
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <section className="panel ads-section">
      <div className="ads-section-head">
        <div>
          <h2>{spec.title}</h2>
          <p className="muted">{spec.detail}</p>
          <p className="ads-size">
            {spec.size}
            {spec.kind === "slide" ? ` · faol: ${activeCount} / ${MAX_ACTIVE_SLIDES}` : ` · faol: ${activeCount}`}
          </p>
        </div>
        <div>
          <input ref={input} type="file" accept={AD_TYPES.join(",")} hidden onChange={(event) => void choose(event.target.files?.[0])} />
          <button type="button" className="secondary-button compact" disabled={busy} onClick={() => input.current?.click()}>
            <Upload size={16} /> {busy ? "Yuklanmoqda…" : "Rasm qo‘shish"}
          </button>
        </div>
      </div>
      {warning ? <p className="site-icon-warning">{warning}</p> : null}
      {problem ? <p className="field-problem">{problem}</p> : null}

      {loading && !ads.length ? <TableSkeleton rows={2} /> : ads.length ? (
        <div className={`ads-grid${spec.kind === "banner" ? " wide" : ""}`}>
          {ads.map((ad) => <AdCard key={ad.id} ad={ad} onChanged={onChanged} />)}
        </div>
      ) : (
        <EmptyState title="Hozircha yo‘q" detail="Rasm qo‘shilmaguncha bu turdagi reklama chiqmaydi." />
      )}
    </section>
  );
}

function AdCard({ ad, onChanged }: { ad: PresentationAd; onChanged: () => void }) {
  const [draft, setDraft] = useState(ad);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => { setDraft(ad); }, [ad]);
  const changed = useMemo(
    () => draft.active !== ad.active || draft.position !== ad.position || (draft.link ?? "") !== (ad.link ?? ""),
    [ad, draft],
  );

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    try {
      await work();
      onChanged();
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  function remove() {
    if (!window.confirm("Bu reklama o‘chirilsinmi? Rasm ham o‘chadi.")) return;
    void run(() => deletePresentationAd(ad));
  }

  return (
    <article className={`ads-card${draft.active ? "" : " is-off"}`}>
      <div className={`ads-frame${ad.kind === "banner" ? " banner" : ""}`}>
        <img src={ad.url} alt="Reklama" loading="lazy" />
      </div>
      <div className="form-grid">
        <label className="checkbox">
          <input type="checkbox" checked={draft.active} onChange={(event) => setDraft({ ...draft, active: event.target.checked })} />
          Faol
        </label>
        <label>
          Tartib
          <input type="number" min={0} max={99} value={draft.position} onChange={(event) => setDraft({ ...draft, position: Number(event.target.value) || 0 })} />
        </label>
        <label className="wide">
          Havola (ixtiyoriy)
          <input type="url" placeholder="https://" value={draft.link ?? ""} onChange={(event) => setDraft({ ...draft, link: event.target.value })} />
        </label>
      </div>
      {problem ? <p className="field-problem">{problem}</p> : null}
      <div className="ads-card-actions">
        <button type="button" className="secondary-button compact" disabled={busy || !changed} onClick={() => void run(() => savePresentationAd(draft))}>
          <Save size={15} /> Saqlash
        </button>
        <button type="button" className="secondary-button compact danger" disabled={busy} onClick={remove}>
          <Trash2 size={15} /> O‘chirish
        </button>
      </div>
    </article>
  );
}

function TimingPanel({ timing, loading, onSaved }: { timing: BannerTiming; loading: boolean; onSaved: (timing: BannerTiming) => void }) {
  const [draft, setDraft] = useState(timing);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => { setDraft(timing); }, [timing]);
  const problem = timingProblem(draft);

  const field = (key: keyof BannerTiming, label: string) => (
    <label>
      {label}
      <input
        type="number"
        min={1}
        value={draft[key]}
        onChange={(event) => setDraft({ ...draft, [key]: Math.round(Number(event.target.value)) || 0 })}
      />
    </label>
  );

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await saveBannerTiming(draft);
      onSaved(draft);
      setMessage({ ok: true, text: "Saqlandi. Yangi taqdimotlarda kuchga kiradi." });
    } catch (failure) {
      setMessage({ ok: false, text: errorMessage(failure) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel ads-section">
      <div className="ads-section-head">
        <div>
          <h2>Banner qachon chiqadi</h2>
          <p className="muted">Soniyalarda. Banner taqdimot boshlangandan keyin birinchi marta chiqadi, belgilangan vaqt turadi, so‘ng har safar shuncha vaqtdan keyin qaytadi. Ekranda reklama sahifasi turganda banner chiqmaydi.</p>
        </div>
      </div>
      <div className="form-grid">
        {field("banner_first_seconds", "Birinchi chiqishi")}
        {field("banner_every_seconds", "Har necha soniyada")}
        {field("banner_show_seconds", "Qancha turadi")}
      </div>
      {problem ? <p className="field-problem">{problem}</p> : null}
      {message ? <p className={message.ok ? "success-banner" : "field-problem"}>{message.text}</p> : null}
      <div className="ads-card-actions">
        <button type="button" className="secondary-button compact" disabled={loading || busy || Boolean(problem)} onClick={() => void save()}>
          <Save size={15} /> Saqlash
        </button>
      </div>
    </section>
  );
}
