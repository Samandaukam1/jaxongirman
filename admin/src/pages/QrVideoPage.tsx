import {
  REFERENCE,
  SURFACE_LABELS,
  drawQr,
  glowFilter,
  placeQr,
  type QrRect,
  type QrVideoSurface,
} from "@jaxongirman/qr-video";
import { Check, RotateCcw, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  listQrVideoExperiences,
  publicVideoUrl,
  saveQrVideoExperience,
  uploadQrVideo,
  type QrVideoRow,
} from "@/lib/qr-video";

/**
 * QR Video Experience.
 *
 * What an admin sets here is what a lecture hall sees: an intro that plays
 * once, a loop that takes over without a seam, and a live QR painted over both
 * at a spot chosen against the footage.
 *
 * The preview is the point of this page. It plays the real clips from the real
 * bucket and draws the real symbol through the same geometry the site uses, so
 * dragging the code half a percent left here means exactly that on a projector.
 * Nothing about the position can be checked by reading numbers, so nothing here
 * asks anyone to.
 */

const SURFACES: QrVideoSurface[] = ["taqdimot", "oyingoh"];

type Form = {
  isEnabled: boolean;
  introPath: string | null;
  loopPath: string | null;
  appearMs: number;
  x: number;
  y: number;
  size: number;
  gradientFrom: string;
  gradientVia: string;
  gradientTo: string;
  background: string;
  glow: number;
};

function toForm(row: QrVideoRow): Form {
  return {
    isEnabled: row.is_enabled,
    introPath: row.intro_path,
    loopPath: row.loop_path,
    appearMs: row.qr_appear_ms,
    x: Number(row.qr_x),
    y: Number(row.qr_y),
    size: Number(row.qr_size),
    gradientFrom: row.gradient_from,
    gradientVia: row.gradient_via,
    gradientTo: row.gradient_to,
    background: row.qr_background,
    glow: Number(row.glow),
  };
}

export function QrVideoPage() {
  const [rows, setRows] = useState<QrVideoRow[]>([]);
  const [surface, setSurface] = useState<QrVideoSurface>("taqdimot");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await listQrVideoExperiences());
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const row = rows.find((item) => item.surface === surface) ?? null;

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="QR VIDEO EXPERIENCE"
        title="QR Video Experience"
        description="Ekrandagi kirish videosi, cheksiz loop va ular ustidagi jonli QR kod — ilovani yangilamasdan boshqariladi."
      />

      <div className="toolbar">
        {SURFACES.map((value) => (
          <button
            key={value}
            type="button"
            className={value === surface ? "primary-button" : "secondary-button"}
            onClick={() => setSurface(value)}
          >
            {SURFACE_LABELS[value]}
          </button>
        ))}
      </div>

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {loading ? (
        <section className="panel"><p className="panel-hint">Yuklanmoqda…</p></section>
      ) : row ? (
        <SurfaceEditor key={row.surface} row={row} onSaved={(next) => {
          setRows((current) => current.map((item) => (item.surface === next.surface ? next : item)));
        }} />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ editor */

function SurfaceEditor({ row, onSaved }: { row: QrVideoRow; onSaved: (next: QrVideoRow) => void }) {
  const [form, setForm] = useState<Form>(() => toForm(row));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveQrVideoExperience({ surface: row.surface, ...form });
      onSaved(saved);
      setMessage(form.isEnabled
        ? "Saqlandi va yoqildi — ekranlar buni darhol oladi."
        : "Saqlandi. Yoqilmagani uchun ekranlarda odatdagi QR sahifasi qoladi.");
    } catch (requestError) {
      setError(errorMessage(requestError));
    } finally {
      setBusy(false);
    }
  }

  const canEnable = Boolean(form.introPath && form.loopPath);

  return (
    <>
      {error ? <ErrorState message={error} /> : null}
      {message ? <p className="jslayd-message">{message}</p> : null}

      <section className="panel">
        <h3>1. Videolar</h3>
        <p className="panel-hint">
          Intro bir marta o‘ynaydi, loop esa uning tugashi bilan uzilishsiz boshlanadi va cheksiz
          takrorlanadi. Ikkalasi bir xil o‘lchamda bo‘lsa, o‘tishda kadr ham qimirlamaydi.
        </p>
        <div className="qrv-uploads">
          <VideoSlot
            label="Intro video"
            hint="Bir marta o‘ynaydi"
            surface={row.surface}
            role="intro"
            path={form.introPath}
            onUploaded={(key) => set("introPath", key)}
          />
          <VideoSlot
            label="Loop video"
            hint="Cheksiz takrorlanadi"
            surface={row.surface}
            role="loop"
            path={form.loopPath}
            onUploaded={(key) => set("loopPath", key)}
          />
        </div>
      </section>

      <section className="panel">
        <h3>2. QR joylashuvi va ko‘rinishi</h3>
        <p className="panel-hint">
          Foizlar videoning o‘z kadriga nisbatan — brauzer oynasiga emas. Shuning uchun oyna shakli
          o‘zgarsa ham kod videodagi o‘sha joyda qoladi.
        </p>
        <div className="form-grid">
          <label>
            QR paydo bo‘lish vaqti (ms)
            <input type="number" min={0} step={10} value={form.appearMs}
              onChange={(event) => set("appearMs", Number(event.target.value))} />
          </label>
          <label>
            X (%)
            <input type="number" step={0.1} value={form.x}
              onChange={(event) => set("x", Number(event.target.value))} />
          </label>
          <label>
            Y (%)
            <input type="number" step={0.1} value={form.y}
              onChange={(event) => set("y", Number(event.target.value))} />
          </label>
          <label>
            Kenglik (%) — bo‘yi 1:1
            <input type="number" step={0.1} min={2} max={100} value={form.size}
              onChange={(event) => set("size", Number(event.target.value))} />
          </label>
          <ColorField label="Gradient 1" value={form.gradientFrom} onChange={(value) => set("gradientFrom", value)} />
          <ColorField label="Gradient 2" value={form.gradientVia} onChange={(value) => set("gradientVia", value)} />
          <ColorField label="Gradient 3" value={form.gradientTo} onChange={(value) => set("gradientTo", value)} />
          <ColorField label="Orqa fon" value={form.background} onChange={(value) => set("background", value)} />
          <label>
            Glow ({form.glow.toFixed(2)})
            <input type="range" min={0} max={1.5} step={0.05} value={form.glow}
              onChange={(event) => set("glow", Number(event.target.value))} />
          </label>
        </div>
        <button className="secondary-button" type="button" onClick={() => setForm((current) => ({
          ...current,
          appearMs: REFERENCE.appearMs,
          x: REFERENCE.x,
          y: REFERENCE.y,
          size: REFERENCE.size,
          gradientFrom: REFERENCE.gradientFrom,
          gradientVia: REFERENCE.gradientVia,
          gradientTo: REFERENCE.gradientTo,
          background: REFERENCE.background,
          glow: REFERENCE.glow,
        }))}>
          <RotateCcw size={16} strokeWidth={1.9} /> Reference qiymatlarga qaytarish
        </button>
      </section>

      <section className="panel">
        <h3>3. Ko‘rinish</h3>
        <p className="panel-hint">
          Haqiqiy videolar va haqiqiy QR — bu yerdagi kod ham skaner qilinadi. Ekrandagidan farqi
          bittagina: bu kod namuna havolaga bog‘langan, sessiyaga emas.
        </p>
        <Preview form={form} />
      </section>

      <section className="panel">
        <h3>4. Yoqish</h3>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={form.isEnabled}
            disabled={!canEnable}
            onChange={(event) => set("isEnabled", event.target.checked)}
          />
          Bu bo‘limda QR Video Experience ishlasin
        </label>
        {!canEnable ? (
          <p className="panel-hint">
            Yoqish uchun ikkala video ham yuklangan bo‘lishi kerak — aks holda ekran qorayib qolardi.
          </p>
        ) : null}
        <div className="header-actions">
          <button className="primary-button" type="button" disabled={busy} onClick={() => void save()}>
            <Check size={16} strokeWidth={2.1} /> {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
        </div>
      </section>
    </>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label>
      {label}
      <span className="qrv-color">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value.toUpperCase())} />
        <input
          value={value}
          onChange={(event) => onChange(event.target.value.toUpperCase())}
          spellCheck={false}
        />
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ upload */

/**
 * QuickTime plays in Safari and almost nowhere else.
 *
 * A projector is usually driven by Chrome, which will not decode a `.mov` — and
 * the experience waits for both clips before it starts, so an unplayable loop
 * means a black screen and nobody in the room able to pair. The site falls back
 * to the plain pairing card rather than showing that, but the admin should know
 * before a hall does.
 */
function formatWarning(name: string | null): string | null {
  if (!name) return null;
  return /\.mov$/i.test(name)
    ? "Bu .mov (QuickTime) fayl — uni faqat Safari ochadi. Chrome va Firefox ochmaydi, "
      + "shuning uchun proyektorda video o‘rniga odatdagi QR sahifasi chiqadi. MP4 (H.264) ga o‘girib qayta yuklang."
    : null;
}

function VideoSlot({ label, hint, surface, role, path, onUploaded }: {
  label: string;
  hint: string;
  surface: QrVideoSurface;
  role: "intro" | "loop";
  path: string | null;
  onUploaded: (key: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const url = publicVideoUrl(path);

  async function send(file: File) {
    setProblem(null);
    setProgress(0);
    try {
      const key = await uploadQrVideo({ surface, role, file, onProgress: setProgress });
      onUploaded(key);
    } catch (uploadError) {
      setProblem(errorMessage(uploadError));
    } finally {
      setProgress(null);
    }
  }

  return (
    <div className="qrv-slot">
      <div className="qrv-slot-head">
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>

      {url ? (
        // Muted and loopless: this is a check that the right file landed, not a
        // place to watch it.
        <video src={url} className="qrv-slot-video" muted playsInline controls preload="metadata" />
      ) : (
        <div className="qrv-slot-empty">Video yuklanmagan</div>
      )}

      <input
        ref={input}
        type="file"
        accept="video/mp4,video/webm,video/quicktime"
        hidden
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void send(file);
          event.target.value = "";
        }}
      />

      {progress === null ? (
        <button className="secondary-button" type="button" onClick={() => input.current?.click()}>
          <Upload size={16} strokeWidth={1.9} /> {path ? "Almashtirish" : "Yuklash"}
        </button>
      ) : (
        <div className="qrv-progress" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
          <span style={{ width: `${Math.round(progress * 100)}%` }} />
          <em>{Math.round(progress * 100)}%</em>
        </div>
      )}

      {problem ? <p className="qrv-problem">{problem}</p> : null}
      {formatWarning(path) ? <p className="qrv-warning">{formatWarning(path)}</p> : null}
      {path ? <code className="qrv-key">{path}</code> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- preview */

/**
 * A sample link, not a session.
 *
 * The console must never open a live pairing session just to draw a picture —
 * that would put an unclaimed screen into the room's list every time somebody
 * nudged a slider. The symbol is the same shape and the same size as a real
 * one, which is what the position needs to be judged against.
 */
const SAMPLE_URL = "https://jaxongirman.uz/pair/namuna-namuna-namuna-namuna-nam";

function Preview({ form }: { form: Form }) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [rect, setRect] = useState<QrRect | null>(null);
  const drawing = useMemo(() => drawQr(SAMPLE_URL), []);
  const introUrl = publicVideoUrl(form.introPath);

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const video = videoRef.current;
    if (!stage) return;
    // Before a clip exists there is still a position to judge, so the preview
    // falls back to the canonical 16:9 the footage is cut to.
    const frame = video && video.videoWidth
      ? { width: video.videoWidth, height: video.videoHeight }
      : { width: 1920, height: 1080 };
    setRect(placeQr(form, frame, { width: stage.clientWidth, height: stage.clientHeight }));
  }, [form]);

  useEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="qrv-preview" ref={stageRef}>
      {introUrl ? (
        <video
          ref={videoRef}
          src={introUrl}
          className="qrv-preview-video"
          muted
          playsInline
          loop
          autoPlay
          onLoadedMetadata={measure}
        />
      ) : (
        <div className="qrv-preview-empty">Intro video yuklansa, shu yerda ko‘rinadi</div>
      )}

      {rect ? (
        <div
          className="qrv-preview-code"
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.side}px`,
            height: `${rect.side}px`,
            filter: glowFilter(form.glow),
          }}
        >
          <svg viewBox={`0 0 ${drawing.extent} ${drawing.extent}`} width="100%" height="100%">
            <defs>
              <linearGradient id="qrv-preview-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={form.gradientFrom} />
                <stop offset="50%" stopColor={form.gradientVia} />
                <stop offset="100%" stopColor={form.gradientTo} />
              </linearGradient>
            </defs>
            <rect width={drawing.extent} height={drawing.extent} rx={drawing.extent * 0.06} fill={form.background} />
            <path d={drawing.path} fill="url(#qrv-preview-gradient)" shapeRendering="crispEdges" />
          </svg>
        </div>
      ) : null}
    </div>
  );
}
