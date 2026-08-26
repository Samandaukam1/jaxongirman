import type { JslaydDocument, SlideData, SlotOutcome } from "@jaxongirman/jslayd";
import { Redo2, Sparkles, Undo2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { StudioCanvas } from "@/components/StudioCanvas";
import { StudioInspector } from "@/components/StudioInspector";
import { StudioLayers, type LayerFlags } from "@/components/StudioLayers";
import { errorMessage } from "@/lib/format";
import { anotherPhoto, withPhoto, writeSample, type SampleReport } from "@/lib/sampleSlide";
import {
  archetypeOf, beginGesture, canRedo, canUndo, commit, endGesture, preview,
  redo, startHistory, undo, type History,
} from "@/lib/studioEdit";

/**
 * The design, as something you can point at.
 *
 * The prompt above is the source of truth and stays that way: a drag edits the
 * compiled document, and what leaves this component is the document, which the
 * workbench writes back as source. Nothing here keeps a second copy of the
 * design that could disagree with the text — the round trip through
 * `decompile` and the compiler is the sync, not a mirror kept in step by hand.
 *
 * The sample is the other half of judging a design. Every blueprint in the
 * console has always been drawn on placeholder text, which is exactly the
 * content a layout cannot fail on: always short, always the same length in
 * every slot. Asking the writer for a real slide on a real topic is the only
 * way to see, before publishing, that the title box holds a title somebody
 * would actually write.
 */

const LANGUAGES = [
  { code: "uz", label: "O‘zbekcha" },
  { code: "ru", label: "Ruscha" },
  { code: "en", label: "Inglizcha" },
] as const;

export function StudioSection({
  document: compiled,
  designId,
  family,
  onChange,
}: {
  document: JslaydDocument;
  /** Null until the design has been saved; the writer needs a row to read. */
  designId: string | null;
  family: string | null;
  onChange: (next: JslaydDocument) => void;
}) {
  const [history, setHistory] = useState<History>(() => startHistory(compiled));
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [archetypeId, setArchetypeId] = useState<string>(compiled.archetypes[0]?.id ?? "");
  const [flags, setFlags] = useState<LayerFlags>({ locked: new Set(), hidden: new Set() });

  const [topic, setTopic] = useState("");
  const [language, setLanguage] = useState<string>("uz");
  const [sample, setSample] = useState<SampleReport | null>(null);
  const [writing, setWriting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** How far into the search results the current photograph is. */
  const [photoAt, setPhotoAt] = useState(0);

  /**
   * The compiled document replaces the studio's, unless the studio wrote it.
   *
   * Every visual edit goes out as source, comes back through the compiler, and
   * arrives here as a new document — so without this check the panel would
   * reset its own history on every drag. `mine` is what the last edit sent; an
   * arrival that is not it came from the prompt editor, and the prompt wins.
   */
  const mine = useRef<JslaydDocument | null>(null);
  useEffect(() => {
    if (mine.current === compiled) return;
    setHistory(startHistory(compiled));
  }, [compiled]);

  const design = history.present;
  const archetype = useMemo(() => archetypeOf(design, archetypeId), [design, archetypeId]);

  // A blueprint that was renamed or deleted in the prompt leaves the selection
  // pointing at nothing; falling to the first one keeps a slide on screen.
  useEffect(() => {
    if (!design.archetypes.some((entry) => entry.id === archetypeId)) {
      setArchetypeId(design.archetypes[0]?.id ?? "");
      setSelectedIds([]);
    }
  }, [archetypeId, design]);

  const publish = (next: JslaydDocument) => {
    mine.current = next;
    onChange(next);
  };

  const change = (next: JslaydDocument) => {
    setHistory((current) => commit(current, next));
    publish(next);
  };

  const step = (move: (current: History) => History) => {
    setHistory((current) => {
      const next = move(current);
      if (next.present !== current.present) publish(next.present);
      return next;
    });
  };

  async function writeIt() {
    if (!designId || !topic.trim()) return;
    setWriting(true);
    setProblem(null);
    try {
      const report = await writeSample({ designId, archetypeId, topic: topic.trim(), language });
      setSample(report);
      setPhotoAt(0);
      if (report.empty) setProblem("Bu blueprintda matn joyi yo‘q — namuna yozilmadi.");
    } catch (error) {
      setProblem(errorMessage(error));
      setSample(null);
    } finally {
      setWriting(false);
    }
  }

  /**
   * Another picture for the words already written.
   *
   * A search rather than a model call, so an administrator can look through
   * several photographs against the same design without paying to have the
   * slide rewritten each time — and without the words changing underneath,
   * which would make the comparison worthless.
   */
  async function reroll() {
    if (!sample?.imageQuery) return;
    setWriting(true);
    setProblem(null);
    try {
      const at = photoAt + 1;
      const photo = await anotherPhoto(sample.imageQuery, at);
      if (!photo) {
        setProblem("Bu so‘rov bo‘yicha boshqa surat topilmadi.");
        return;
      }
      setPhotoAt(at);
      setSample((current) => (current ? { ...current, photo } : current));
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setWriting(false);
    }
  }

  // The photograph belongs to the slide, not to the server: which slots take a
  // picture is the blueprint's business, and the blueprint is open here.
  const slide: SlideData | null = useMemo(() => {
    if (!sample?.slide || sample.archetypeId !== archetypeId) return null;
    return withPhoto(sample.slide, design, archetypeId, sample.photo?.url ?? null);
  }, [archetypeId, design, sample]);

  const tight = (sample?.outcomes ?? []).filter((outcome) => !outcome.fits);

  return (
    <section className="panel">
      <h3>5. Vizual studiya</h3>
      <p className="panel-hint">
        Elementni sudrab ko‘chiring yoki burchagidan cho‘zing — o‘zgarish yuqoridagi promptga qaytib yoziladi.
        Namunaviy slayd esa haqiqiy yozuvchi bilan yoziladi: agar matn shu yerda sig‘masa, foydalanuvchida ham sig‘maydi.
      </p>

      <div className="studio-bar">
        <select
          value={archetypeId}
          onChange={(event) => { setArchetypeId(event.target.value); setSelectedIds([]); }}
          aria-label="Blueprint"
        >
          {design.archetypes.map((entry) => (
            <option key={entry.id} value={entry.id}>{entry.id} · {entry.purpose}</option>
          ))}
        </select>

        <div className="studio-bar-actions">
          <button
            type="button"
            className="icon-button"
            title="Qaytarish"
            disabled={!canUndo(history)}
            onClick={() => step(undo)}
          >
            <Undo2 size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Qaytadan"
            disabled={!canRedo(history)}
            onClick={() => step(redo)}
          >
            <Redo2 size={16} />
          </button>
        </div>
      </div>

      <div className="studio-sample">
        <input
          value={topic}
          placeholder="Namuna uchun mavzu — masalan: Suv resurslarini tejash"
          maxLength={200}
          onChange={(event) => setTopic(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") void writeIt(); }}
        />
        <select value={language} onChange={(event) => setLanguage(event.target.value)} aria-label="Til">
          {LANGUAGES.map((entry) => <option key={entry.code} value={entry.code}>{entry.label}</option>)}
        </select>
        <button
          type="button"
          className="primary-button compact"
          disabled={writing || !designId || !topic.trim()}
          onClick={() => void writeIt()}
          title={designId ? undefined : "Avval qoralamani saqlang"}
        >
          <Sparkles size={15} strokeWidth={1.9} />
          {writing ? "Yozilmoqda…" : "Namunaviy slayd yaratish"}
        </button>
        {sample && !sample.empty ? (
          <button type="button" className="secondary-button compact" onClick={() => setSample(null)}>
            Namunani olib tashlash
          </button>
        ) : null}
      </div>

      {problem ? <p className="studio-layer-error">{problem}</p> : null}
      {tight.length ? <SlotProblems outcomes={tight} /> : null}
      {sample?.photo ? (
        <p className="studio-note">
          Surat: <a href={sample.photo.attribution.sourceUrl} target="_blank" rel="noreferrer">
            {sample.photo.attribution.creator}
          </a> · Unsplash
          {" · "}
          <button type="button" className="text-button" disabled={writing} onClick={() => void reroll()}>
            Boshqa surat
          </button>
        </p>
      ) : sample?.imageQuery ? (
        // The query was written but nothing came back. Said plainly, because the
        // usual cause is a missing key rather than a subject nobody photographs.
        <p className="studio-note">
          Rasm so‘rovi: “{sample.imageQuery}” — surat topilmadi.
        </p>
      ) : null}

      <div className="studio-shell">
        <div className="studio-pane">
          <StudioLayers
            document={design}
            archetype={archetype}
            selectedIds={selectedIds}
            flags={flags}
            onSelect={setSelectedIds}
            onChange={change}
            onFlags={setFlags}
          />
        </div>

        <StudioCanvas
          document={design}
          archetypeId={archetypeId}
          selectedIds={selectedIds}
          family={family}
          slide={slide}
          onSelect={setSelectedIds}
          onPreview={(next) => { setHistory((current) => preview(current, next)); }}
          onGestureStart={() => setHistory((current) => beginGesture(current))}
          onGestureEnd={() => {
            setHistory((current) => {
              const next = endGesture(current);
              if (next.present !== current.anchor) publish(next.present);
              return next;
            });
          }}
        />

        <div className="studio-pane">
          <StudioInspector
            document={design}
            archetype={archetype}
            selectedIds={selectedIds}
            fontFamilies={design.fonts.map((font) => font.name)}
            onChange={change}
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Which slots the writer could not fit, said in the design's own terms.
 *
 * This is the finding a sample exists to produce. One overflowing slot on one
 * topic is not a bug in the writing — it is a box that is too small for what it
 * is for, and the fix is a wider box or a smaller size, both of which are two
 * panels to the right of this message.
 */
function SlotProblems({ outcomes }: { outcomes: readonly SlotOutcome[] }) {
  return (
    <div className="studio-fit-report" role="status">
      <strong>{outcomes.length} ta joyga matn sig‘madi va qisqartirildi</strong>
      <ul>
        {outcomes.map((outcome) => (
          <li key={outcome.binding}>
            <code>{outcome.binding}</code>
            {outcome.trimmedFrom ? <span> — {outcome.trimmedFrom} belgidan qisqartirildi</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
