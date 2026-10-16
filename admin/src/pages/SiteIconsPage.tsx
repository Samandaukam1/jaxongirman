import { ExternalLink, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  ACCEPTED_TYPES,
  SITE_ICONS,
  SITE_URL,
  imageRatio,
  listSiteIcons,
  resetSiteIcon,
  uploadSiteIcon,
  type SiteIconSlot,
  type SiteIconSpec,
  type UploadedIcon,
} from "@/lib/site-icons";

/**
 * Sayt ikonkalari.
 *
 * Every picture the website shows of itself — the logo in its header, the
 * favicon in a browser tab, the icons a phone saves to its home screen and the
 * picture a shared link carries — in one place, each with what it is for, the
 * size it is drawn at, and what it looks like now. Replacing one uploads it;
 * "Standart" removes the upload and the site's own picture comes back. The
 * site rereads the set every two minutes.
 */
export function SiteIconsPage() {
  const [icons, setIcons] = useState<Partial<Record<SiteIconSlot, UploadedIcon>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setIcons(await listSiteIcons());
      setError(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const logo = icons.logo?.url ?? SITE_ICONS[0]!.fallback;
  const favicon = icons.favicon?.url ?? SITE_ICONS[1]!.fallback;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="SAYT"
        title="Sayt ikonkalari"
        description="jaxongirman.app saytining logotipi, favicon va boshqa barcha belgilari. Yangi rasm saytda 2 daqiqa ichida ko‘rinadi."
        action={
          <a className="secondary-button" href={SITE_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={16} /> Saytni ochish
          </a>
        }
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {/* How the two most visible ones read together, before anything else. */}
      <section className="panel site-icons-preview">
        <div className="site-tab">
          <img src={favicon} alt="" />
          <span>Jaxongirman — taqdimot, ma’lumot yig‘ish…</span>
          <i>×</i>
        </div>
        <div className="site-bar">
          <img src={logo} alt="" />
          <b>Jaxongirman</b>
          <span>Imkoniyatlar</span><span>Dizaynlar</span><span>Tarif</span>
          <em>Taqdimot qilish →</em>
        </div>
      </section>

      <div className="site-icons-grid">
        {SITE_ICONS.map((spec) => (
          <IconSlot
            key={spec.slot}
            spec={spec}
            current={icons[spec.slot] ?? null}
            loading={loading}
            onChanged={() => void load()}
          />
        ))}
      </div>
    </div>
  );
}

function IconSlot({ spec, current, loading, onChanged }: {
  spec: SiteIconSpec;
  current: UploadedIcon | null;
  loading: boolean;
  onChanged: () => void;
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  async function choose(file: File | undefined) {
    if (!file) return;
    setProblem(null);
    setWarning(null);
    // A picture of the wrong shape is drawn squeezed or cropped; say so, but
    // let the admin decide — some logos are meant to sit in a square.
    const ratio = await imageRatio(file);
    if (ratio && Math.abs(ratio - spec.ratio) / spec.ratio > 0.08) {
      setWarning(`Rasm nisbati ${ratio.toFixed(2)}, tavsiya etilgani ${spec.ratio.toFixed(2)} — chetlari kesilishi mumkin.`);
    }
    setBusy(true);
    try {
      await uploadSiteIcon(spec.slot, file);
      onChanged();
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function reset() {
    if (!window.confirm(`“${spec.title}” standart rasmga qaytarilsinmi?`)) return;
    setProblem(null);
    setBusy(true);
    try {
      await resetSiteIcon(spec.slot);
      onChanged();
    } catch (failure) {
      setProblem(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const shown = current?.url ?? spec.fallback;
  return (
    <section className="panel site-icon">
      <div className={`site-icon-frame${spec.ratio > 1.2 ? " wide" : ""}`}>
        <img src={shown} alt={spec.title} />
      </div>
      <div className="site-icon-copy">
        <h2>{spec.title}</h2>
        <p>{spec.where}</p>
        <p className="site-icon-size">{spec.size}</p>
        <p className={`site-icon-state${current ? " custom" : ""}`}>
          {loading ? "Yuklanmoqda…" : current
            ? `Yuklangan · ${current.updatedAt ? new Date(current.updatedAt).toLocaleString("uz-UZ") : current.name}`
            : "Standart rasm"}
        </p>
        {warning ? <p className="site-icon-warning">{warning}</p> : null}
        {problem ? <p className="site-icon-error">{problem}</p> : null}
      </div>
      <div className="site-icon-actions">
        <input
          ref={input}
          type="file"
          accept={ACCEPTED_TYPES.join(",")}
          hidden
          onChange={(event) => void choose(event.target.files?.[0])}
        />
        <button type="button" className="primary-button" disabled={busy} onClick={() => input.current?.click()}>
          <Upload size={16} /> {busy ? "Yuklanmoqda…" : current ? "Almashtirish" : "Yuklash"}
        </button>
        {current ? (
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void reset()}>
            <RotateCcw size={16} /> Standart
          </button>
        ) : null}
      </div>
    </section>
  );
}
