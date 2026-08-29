import { CheckCircle2, ImageOff, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { EmptyState, ErrorState, PageHeader } from "@/components/AdminUI";
import { errorMessage } from "@/lib/format";
import {
  listVerified, resolveBest, resolveCandidates, verifyImage,
  type Candidate, type CandidateList, type ResolvedImage, type VerifiedRow,
} from "@/lib/imageResolver";

/**
 * Why a slide got the picture it got — and how to teach it a better one.
 *
 * The resolver refuses to guess at a person it cannot prove, which is right and
 * is also the thing an administrator will not understand from an empty frame.
 * So this shows the whole decision: what it thought the subject was, whether
 * anybody had confirmed a picture of it, which providers were asked, and the
 * reason it stopped. Nothing here searches on its own — it asks the same
 * function the generator asks, so what is shown is what a customer would get.
 *
 * The second half is the part that changes outcomes. A local figure no
 * encyclopaedia has heard of will never resolve on its own; somebody confirms
 * one picture by hand, and every deck after that takes it without asking.
 */

const ORIENTATIONS = ["landscape", "portrait", "square", "any"] as const;

const INTENT_LABEL: Record<string, string> = {
  exact_person: "Aniq shaxs",
  specific_place: "Joy",
  specific_building: "Bino",
  specific_product: "Mahsulot",
  organization: "Tashkilot",
  specific_event: "Tadbir",
  generic_concept: "Umumiy tushuncha",
};

const REASON_LABEL: Record<string, string> = {
  identity_unverified: "Shaxsni tasdiqlab bo‘lmadi — rasm qo‘yilmadi",
  identity_mismatch: "Boshqa odam chiqdi — rad etildi",
  no_provider_result: "Hech bir manbada topilmadi",
  duplicate: "Bu mavzu shu taqdimotda allaqachon ishlatilgan",
  broken_image: "Rasm ochilmadi",
  unsupported_format: "Format qo‘llab-quvvatlanmaydi",
  rights_rejected: "Litsenziya siyosatiga mos kelmadi",
};

export function ImageResolverPage() {
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [orientation, setOrientation] = useState<string>("landscape");

  const [result, setResult] = useState<ResolvedImage | null>(null);
  const [offered, setOffered] = useState<CandidateList | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [verified, setVerified] = useState<VerifiedRow[]>([]);

  const loadVerified = useCallback(async () => {
    try {
      setVerified(await listVerified());
    } catch (failure) {
      setError(errorMessage(failure));
    }
  }, []);

  useEffect(() => { void loadVerified(); }, [loadVerified]);

  async function run() {
    if (!query.trim()) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const input = { query: query.trim(), title: title.trim() || null, topic: topic.trim() || null, orientation };
      // Both at once: what the generator would use, and what a person could
      // confirm instead. The second is the only way to fix the first.
      const [best, list] = await Promise.all([resolveBest(input), resolveCandidates({ ...input, limit: 6 })]);
      setResult(best);
      setOffered(list);
    } catch (failure) {
      setError(errorMessage(failure));
      setResult(null);
      setOffered(null);
    } finally {
      setBusy(false);
    }
  }

  async function confirm(candidate: Candidate) {
    if (!offered) return;
    setBusy(true);
    setError(null);
    try {
      /**
       * The picture is confirmed by its address, not copied here.
       *
       * The generator downloads and stores what it uses; this records *which*
       * file is the right one. Storing a second copy from the console would
       * make two answers to one question.
       */
      await verifyImage({
        normalized: offered.normalized,
        displayName: offered.entity,
        entityType: offered.intent,
        storagePath: candidate.url,
        provider: candidate.provider,
        originalUrl: candidate.url,
        sourceUrl: candidate.attribution.sourceUrl,
        creator: candidate.attribution.creator,
        license: candidate.attribution.license,
        licenseUrl: candidate.attribution.licenseUrl,
      });
      setMessage(`“${offered.entity}” uchun rasm tasdiqlandi. Keyingi taqdimotlar qidirmaydi.`);
      await loadVerified();
      await run();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="RASMLAR"
        title="Image Resolver"
        description="Slayd qanday rasm olishini va nega shuni olganini ko‘rsatadi. Aniq shaxs tasdiqlanmasa — rasm qo‘yilmaydi."
      />

      {error ? <ErrorState title="Bajarilmadi" message={error} /> : null}
      {message ? <p className="jslayd-message">{message}</p> : null}

      <section className="panel">
        <h3>1. So‘rov</h3>
        <div className="form-grid">
          <label>
            Qidiruv
            <input
              value={query}
              placeholder="Yulduz Usmonova / modern business office"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => { if (event.key === "Enter") void run(); }}
            />
          </label>
          <label>Slayd sarlavhasi<input value={title} placeholder="Xalqaro konsert faoliyati" onChange={(event) => setTitle(event.target.value)} /></label>
          <label>Taqdimot mavzusi<input value={topic} placeholder="Yulduz Usmonova hayoti va ijodi" onChange={(event) => setTopic(event.target.value)} /></label>
          <label>
            Yo‘nalish
            <select value={orientation} onChange={(event) => setOrientation(event.target.value)}>
              {ORIENTATIONS.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="jslayd-actions">
          <button className="primary-button" type="button" disabled={busy || !query.trim()} onClick={() => void run()}>
            <Search size={16} strokeWidth={1.9} /> {busy ? "Qidirilmoqda…" : "Tekshirish"}
          </button>
        </div>
      </section>

      {result ? (
        <section className="panel">
          <h3>2. Qaror</h3>
          <ul className="jslayd-health">
            <li className="ok"><span>Tur</span><strong>{INTENT_LABEL[result.intent] ?? result.intent}</strong></li>
            <li className="ok"><span>Mavzu</span><strong>{result.entity}</strong></li>
            <li className={result.status === "no_image" ? "bad" : "ok"}>
              <span>Manba</span><strong>{result.provider ?? "—"}</strong>
            </li>
            <li className="ok"><span>Ishonch</span><strong>{Math.round(result.confidence * 100)}%</strong></li>
          </ul>

          {result.status === "no_image" ? (
            <div className="studio-fit-report" role="status">
              <strong><ImageOff size={15} strokeWidth={1.9} /> Rasm qo‘yilmadi</strong>
              <p className="studio-note">{REASON_LABEL[result.reason ?? ""] ?? result.reason}</p>
              {result.intent === "exact_person" ? (
                <p className="studio-note">
                  Bu ataylab: aniq shaxs uchun boshqa odamning rasmini qo‘yishdan ko‘ra rasmsiz qoldirish to‘g‘riroq.
                  Pastdan to‘g‘ri rasmni tanlab tasdiqlasangiz, keyingi taqdimotlar shuni oladi.
                </p>
              ) : null}
            </div>
          ) : (
            <div className="resolver-choice">
              {result.hit?.url ? <img alt={result.entity} src={result.hit.url} /> : null}
              <div>
                <strong>{result.hit?.attribution.title}</strong>
                <p className="studio-note">
                  {result.hit?.attribution.creator} · {result.hit?.attribution.license}
                  {result.status === "verified" ? " · qo‘lda tasdiqlangan" : ""}
                </p>
                {result.hit?.attribution.sourceUrl ? (
                  <a className="text-button" href={result.hit.attribution.sourceUrl} target="_blank" rel="noreferrer">Manba sahifasi</a>
                ) : null}
              </div>
            </div>
          )}

          {/* The whole path, so a surprising answer can be explained without
              running the search again by hand. */}
          <ol className="resolver-trace">
            {result.trace.map((step, at) => (
              <li key={at}><code>{step.step}</code>{step.detail ? <span>{step.detail}</span> : null}</li>
            ))}
          </ol>
        </section>
      ) : null}

      {offered ? (
        <section className="panel">
          <h3>3. Nomzodlar</h3>
          {offered.note ? <p className="panel-hint">{offered.note}</p> : null}
          {offered.candidates.length === 0 ? (
            <EmptyState title="Nomzod yo‘q" detail="Bu so‘rov bo‘yicha ishonchli rasm topilmadi." />
          ) : (
            <div className="resolver-candidates">
              {offered.candidates.map((candidate) => (
                <figure key={candidate.url}>
                  <img alt={candidate.attribution.title} src={candidate.url} loading="lazy" />
                  <figcaption>
                    <strong>{candidate.attribution.title}</strong>
                    <small>{candidate.provider} · {candidate.width}×{candidate.height}</small>
                    <small>{candidate.attribution.creator} · {candidate.attribution.license}</small>
                  </figcaption>
                  <button className="secondary-button compact" type="button" disabled={busy} onClick={() => void confirm(candidate)}>
                    <CheckCircle2 size={15} strokeWidth={1.9} /> Tasdiqlash
                  </button>
                </figure>
              ))}
            </div>
          )}
        </section>
      ) : null}

      <section className="panel">
        <h3>Tasdiqlangan rasmlar</h3>
        <p className="panel-hint">
          Bir marta tasdiqlansa, shu mavzu uchun tashqi qidiruv umuman bo‘lmaydi — bir xil rasm, har safar.
        </p>
        {verified.length === 0 ? (
          <EmptyState title="Hali bo‘sh" detail="Yuqorida qidirib, to‘g‘ri rasmni tasdiqlang." />
        ) : (
          <ul className="resolver-verified">
            {verified.map((row) => (
              <li key={row.id}>
                <ShieldCheck size={15} strokeWidth={1.9} />
                <div>
                  <strong>{row.display_name}</strong>
                  <small>{INTENT_LABEL[row.entity_type] ?? row.entity_type} · {row.provider}{row.creator ? ` · ${row.creator}` : ""}</small>
                </div>
                {row.source_url ? <a className="text-button" href={row.source_url} target="_blank" rel="noreferrer">Manba</a> : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
