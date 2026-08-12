import { AI_INSTRUCTION, JSLAYD_VERSION, PROMPT_STANDARD, SAMPLE_PROMPT } from "@jaxongirman/jslayd";
import { BookOpen, Check, Copy } from "lucide-react";
import { useState } from "react";

import { Modal } from "@/components/AdminUI";

/**
 * The prompt standard card and its drawer (§5, §88).
 *
 * The whole point of this screen is that an admin copies the specification,
 * hands it to any AI, describes the design they want, and pastes back a prompt
 * this build can compile. So the copy buttons are the feature — the text they
 * copy is generated from the compiler's own vocabulary and cannot describe a
 * language this build does not implement.
 */
export function JslaydStandardCard() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <section className="panel jslayd-standard">
        <div className="jslayd-standard-copy">
          <span className="jslayd-standard-eyebrow">
            <BookOpen size={16} strokeWidth={1.9} /> JSLAYD {JSLAYD_VERSION}
          </span>
          <h2>JSLAYD Prompt standarti</h2>
          <p>
            Standartni nusxalang, uni istalgan sun’iy intellektga bering va dizayningizni tariflang. AI sizga shu
            standartga mos prompt qaytaradi — uni shu yerga qo‘yib, yangi dizayn yaratasiz. Ilovani yangilash shart emas.
          </p>
        </div>
        <button className="primary-button" type="button" onClick={() => setOpen(true)}>
          Standartni ochish
        </button>
      </section>

      {open ? (
        <Modal
          title="JSLAYD Design Prompt Specification 1.0"
          description="Sintaksis, ruxsat etilgan buyruqlar, chegaralar va namuna. Kompilyator shu ro‘yxatdan tashqarisini qabul qilmaydi."
          onClose={() => setOpen(false)}
        >
          <div className="jslayd-standard-actions">
            <CopyButton label="Nusxalash" copied="Standart nusxalandi" value={PROMPT_STANDARD} />
            <CopyButton label="Namuna promptni nusxalash" copied="Namuna nusxalandi" value={SAMPLE_PROMPT} />
            <CopyButton label="AI ko‘rsatmasini nusxalash" copied="Ko‘rsatma nusxalandi" value={AI_INSTRUCTION} />
          </div>
          <pre className="jslayd-standard-text">{PROMPT_STANDARD}</pre>
        </Modal>
      ) : null}
    </>
  );
}

function CopyButton({ label, copied, value }: { label: string; copied: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      className={done ? "primary-button compact" : "secondary-button compact"}
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(value);
        setDone(true);
        window.setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={15} strokeWidth={2.2} /> : <Copy size={15} strokeWidth={1.9} />}
      {done ? copied : label}
    </button>
  );
}
