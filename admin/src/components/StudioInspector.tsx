import type { Archetype, JslaydDocument } from "@jaxongirman/jslayd";
import { useMemo } from "react";

import { elementOf, setGeometry, withElement } from "@/lib/studioEdit";

/**
 * The selected element's properties, and only the ones it has.
 *
 * An inspector that shows every field the language defines is a wall of
 * disabled inputs; one that shows a text element's line height beside an
 * image's crop is a lie about what the element is. So the sections are driven
 * by the element's own type, and a value that has never been set shows as
 * empty rather than as the default it would compile to — otherwise saving would
 * silently write out things nobody chose.
 *
 * Every field writes through the same operations the canvas uses. There is no
 * inspector-shaped copy of an element: the panel is another view of the
 * document, and typing 400 into X is the same edit as dragging to 400.
 */

type Props = {
  document: JslaydDocument;
  archetype: Archetype | null;
  selectedId: string | null;
  fontFamilies: readonly string[];
  onChange: (next: JslaydDocument) => void;
};

/** The geometry fields the panel writes; a union rather than a value. */
type GeometryField = "x" | "y" | "width" | "height" | "rotation" | "zIndex";

function Field({
  label, value, onCommit, suffix,
}: { label: string; value: number | string | undefined; onCommit: (next: string) => void; suffix?: string }) {
  return (
    <label className="studio-field">
      <span>{label}{suffix ? <em>{suffix}</em> : null}</span>
      <input
        defaultValue={value ?? ""}
        key={String(value)}
        onBlur={(event) => onCommit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") (event.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}

export function StudioInspector({ document: design, archetype, selectedId, fontFamilies, onChange }: Props) {
  const element = useMemo(() => elementOf(archetype, selectedId), [archetype, selectedId]);

  if (!archetype) return <p className="studio-empty">Slayd tanlanmagan.</p>;
  if (!element) return <p className="studio-empty">Elementni tanlang.</p>;

  const geometry = element.geometry;
  const text = (element as { text?: Record<string, unknown> }).text;

  const number = (raw: string): number | null => {
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  };

  const setBox = (field: GeometryField, raw: string) => {
    const value = number(raw);
    if (value === null) return;
    onChange(setGeometry(design, archetype.id, element.id, { [field]: value }));
  };

  const setText = (field: string, value: unknown) => {
    onChange(withElement(design, archetype.id, element.id, (current) => ({
      ...current,
      text: { ...(current as { text?: Record<string, unknown> }).text, [field]: value },
    } as typeof current)));
  };

  return (
    <div className="studio-inspector">
      <header>
        <strong>{element.id}</strong>
        <small>{element.type}</small>
      </header>

      <section>
        <h4>Joylashuv</h4>
        <div className="studio-grid">
          <Field label="X" value={geometry.x} onCommit={(raw) => setBox("x", raw)} />
          <Field label="Y" value={geometry.y} onCommit={(raw) => setBox("y", raw)} />
          <Field label="Kenglik" value={geometry.width} onCommit={(raw) => setBox("width", raw)} />
          <Field label="Balandlik" value={geometry.height} onCommit={(raw) => setBox("height", raw)} />
          <Field label="Burilish" suffix="°" value={geometry.rotation} onCommit={(raw) => setBox("rotation", raw)} />
          <Field label="Qatlam" value={geometry.zIndex} onCommit={(raw) => setBox("zIndex", raw)} />
        </div>
        <p className="studio-note">
          Qiymatlar 1920 × 1080 muallif kanvasida. Ekran o‘lchami hujjatga ta’sir qilmaydi.
        </p>
      </section>

      {text && (
        <section>
          <h4>Tipografika</h4>

          <label className="studio-field">
            <span>Shrift</span>
            <select
              value={String(text.font ?? "")}
              onChange={(event) => setText("font", event.target.value)}
            >
              {/* Only what this design declared. A picker offering two thousand
                  families here would let somebody name a font the document has
                  no face for, which the compiler would then refuse. */}
              <option value="">— tanlanmagan —</option>
              {fontFamilies.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          </label>

          <div className="studio-grid">
            <Field label="Kegl" value={text.fontSize as number} onCommit={(raw) => {
              const value = number(raw);
              if (value !== null) setText("fontSize", value);
            }} />
            <Field label="Qalinlik" value={text.fontWeight as number} onCommit={(raw) => {
              const value = number(raw);
              if (value !== null) setText("fontWeight", value);
            }} />
            <Field label="Qator oralig‘i" value={text.lineHeight as number} onCommit={(raw) => {
              const value = number(raw);
              if (value !== null) setText("lineHeight", value);
            }} />
            <Field label="Harf oralig‘i" value={text.letterSpacing as number} onCommit={(raw) => {
              const value = number(raw);
              if (value !== null) setText("letterSpacing", value);
            }} />
          </div>

          <label className="studio-field">
            <span>Tekislash</span>
            <select value={String(text.align ?? "left")} onChange={(event) => setText("align", event.target.value)}>
              {["left", "center", "right", "justify"].map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <label className="studio-field">
            <span>Rang</span>
            <input
              defaultValue={String(text.color ?? "")}
              key={String(text.color)}
              placeholder="text, accent yoki #RRGGBB"
              onBlur={(event) => setText("color", event.target.value.trim())}
            />
          </label>

          <div className="studio-grid">
            <Field label="Maks. qator" value={text.maxLines as number} onCommit={(raw) => {
              const value = number(raw);
              if (value !== null) setText("maxLines", value);
            }} />
            <Field label="Min. kegl" value={text.minFontSize as number} onCommit={(raw) => {
              const value = number(raw);
              if (value !== null) setText("minFontSize", value);
            }} />
          </div>
        </section>
      )}

      <section>
        <h4>Shaffoflik</h4>
        <Field label="Opacity" value={element.opacity} onCommit={(raw) => {
          const value = number(raw);
          if (value === null) return;
          onChange(withElement(design, archetype.id, element.id, (current) => ({
            ...current, opacity: Math.min(1, Math.max(0, value)),
          })));
        }} />
      </section>
    </div>
  );
}
