import type { Archetype, JslaydDocument } from "@jaxongirman/jslayd";
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical,
  AlignStartHorizontal, AlignStartVertical, MoveHorizontal, MoveVertical,
} from "lucide-react";
import { useMemo } from "react";

import {
  BINDINGS, COLOR_ROLES, CONDITIONS, GRADIENT_PRESETS, buildWritingBrief,
  type ColorValue,
} from "@jaxongirman/jslayd";

import {
  DEFAULT_BORDER, MAX_SHADOWS, addShadow, addStop, alignElements, cornersAreEven, distribute,
  elementOf, evenCorners,
  gradientFromPreset, gradientOf, patchBorder, patchShadow, removeShadow, removeStop,
  setBorder, setCorners, setFill, setGeometry, setImageRules, setOverlay, setStop,
  takesBorder, takesCorners, takesShadow, withElement,
} from "@/lib/studioEdit";

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
  selectedIds: readonly string[];
  fontFamilies: readonly string[];
  onChange: (next: JslaydDocument) => void;
};

/** The geometry fields the panel writes; a union rather than a value. */
/** A value from the role list, or a literal somebody pasted. */
const asColor = (value: string): ColorValue =>
  (value.startsWith("#") ? { hex: value } : { role: value as ColorValue extends { role: infer R } ? R : never });

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

export function StudioInspector({ document: design, archetype, selectedIds, fontFamilies, onChange }: Props) {
  const element = useMemo(
    () => (selectedIds.length === 1 ? elementOf(archetype, selectedIds[0]!) : null),
    [archetype, selectedIds],
  );

  /**
   * How much each text box actually holds, measured rather than declared.
   *
   * The same arithmetic the writer is briefed with, so the number shown here is
   * the number a real slide is written against. Recomputed per slide rather
   * than per keystroke: it depends on the geometry and the type, both of which
   * change while an author is dragging.
   */
  const capacity = useMemo(() => {
    const slots = new Map<string, ReturnType<typeof buildWritingBrief>["slots"][number]>();
    if (!archetype) return slots;
    try {
      for (const slot of buildWritingBrief(design, archetype).slots) {
        if (!slots.has(slot.elementId)) slots.set(slot.elementId, slot);
      }
    } catch {
      // A design mid-edit is routinely unmeasurable; the panel says nothing
      // rather than showing a number it cannot stand behind.
    }
    return slots;
  }, [archetype, design]);

  if (!archetype) return <p className="studio-empty">Slayd tanlanmagan.</p>;

  /**
   * Several elements get the operations that mean something for several.
   *
   * Not a merged property sheet. Showing one X for three elements has to answer
   * what X means when they disagree, and every answer is a guess about what the
   * author meant — while align and distribute are exactly the operations a
   * multiple selection exists for, and they were already written and tested
   * with no way to reach them.
   */
  if (selectedIds.length > 1) {
    return <GroupTools design={design} archetypeId={archetype.id} ids={selectedIds} onChange={onChange} />;
  }
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

      {/**
        * What fills this box, and when it is drawn.
        *
        * The most consequential field on a text element and the one the panel
        * could not reach: a box bound to `subtitle` draws a subtitle, and a box
        * bound to nothing draws nothing at all. The measured capacity is shown
        * beside it because that is the number an author actually needs — the
        * box is 620 wide, but what decides whether a real title fits is that it
        * holds about twenty characters at this size.
        */}
      {element.type === "text" || element.type === "quote" || element.type === "number" || element.type === "badge" ? (() => {
        const source = (element as { source?: { bind?: string; literal?: string } }).source ?? {};
        const bound = typeof source.bind === "string";
        const budget = capacity.get(element.id);
        return (
          <section>
            <h4>Kontent</h4>
            <label className="studio-field">
              <span>Manba</span>
              <select
                value={bound ? source.bind : "__literal"}
                onChange={(event) => {
                  const value = event.target.value;
                  onChange(withElement(design, archetype.id, element.id, (current) => ({
                    ...current,
                    source: value === "__literal" ? { literal: source.literal ?? "" } : { bind: value },
                  } as typeof current)));
                }}
              >
                <option value="__literal">Doimiy matn</option>
                {BINDINGS.map((binding) => <option key={binding} value={binding}>{binding}</option>)}
              </select>
            </label>

            {bound ? (
              budget ? (
                <p className="studio-note">
                  Bu quti taxminan <strong>{budget.budget.maximumCharacters}</strong> belgi
                  ({budget.budget.maximumWords} so‘z) sig‘diradi — {budget.budget.estimatedLines} qatorda.
                  Namunaviy slayd shu chegaraga qarab yoziladi.
                </p>
              ) : null
            ) : (
              <Field
                label="Matn"
                value={source.literal ?? ""}
                onCommit={(raw) => onChange(withElement(design, archetype.id, element.id, (current) => ({
                  ...current, source: { literal: raw },
                } as typeof current)))}
              />
            )}

            <label className="studio-field">
              <span>Qachon chiziladi</span>
              <select
                value={String(element.when ?? "always")}
                onChange={(event) => onChange(withElement(design, archetype.id, element.id, (current) => ({
                  ...current, when: event.target.value as typeof current.when,
                })))}
              >
                {CONDITIONS.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
              </select>
            </label>
            {element.when && element.when !== "always" ? (
              <p className="studio-note">
                Slaydda bu ma’lumot bo‘lmasa, element umuman chizilmaydi.
              </p>
            ) : null}
          </section>
        );
      })() : null}

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
        <h4>To‘ldirish</h4>

        {(() => {
          const gradient = gradientOf(element);
          const background = (element as { background?: unknown }).background;
          const solid = !gradient && background && typeof background === "object"
            ? ("role" in background ? String((background as { role: string }).role)
              : String((background as { hex: string }).hex ?? ""))
            : "";

          return <>
            <div className="studio-tabs">
              <button type="button" className={!gradient ? "on" : undefined}
                onClick={() => onChange(setFill(design, archetype.id, element.id, { role: "surface" }))}>
                Rang
              </button>
              <button type="button" className={gradient ? "on" : undefined}
                onClick={() => onChange(setFill(design, archetype.id, element.id,
                  gradientFromPreset(GRADIENT_PRESETS[0]!)))}>
                Gradient
              </button>
              <button type="button" onClick={() => onChange(setFill(design, archetype.id, element.id, null))}>
                Yo‘q
              </button>
            </div>

            {!gradient && (
              <label className="studio-field">
                <span>Rang</span>
                {/* Roles are a closed set in the language, so they are chosen
                    rather than typed: a misspelt role is a design that will not
                    compile, found at save time instead of at the keystroke. */}
                <select
                  value={solid}
                  onChange={(event) => onChange(setFill(design, archetype.id, element.id,
                    asColor(event.target.value)))}
                >
                  {COLOR_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  {solid.startsWith("#") ? <option value={solid}>{solid}</option> : null}
                </select>
              </label>
            )}

            {gradient && <>
              <div className="studio-grid">
                <label className="studio-field">
                  <span>Turi</span>
                  <select value={gradient.type} onChange={(event) => onChange(setFill(design, archetype.id, element.id,
                    { ...gradient, type: event.target.value as "linear" | "radial" }))}>
                    <option value="linear">linear</option>
                    <option value="radial">radial</option>
                  </select>
                </label>
                <Field label="Burchak" suffix="°" value={gradient.angle} onCommit={(raw) => {
                  const value = Number(raw);
                  if (Number.isFinite(value)) {
                    onChange(setFill(design, archetype.id, element.id, { ...gradient, angle: value }));
                  }
                }} />
              </div>

              {/* Every stop names a role, so switching theme moves the gradient
                  with the rest of the slide instead of leaving it behind. */}
              {gradient.stops.map((stop, index) => (
                <div className="studio-stop" key={`${index}-${stop.offset}`}>
                  <select
                    value={"role" in stop.color ? stop.color.role : stop.color.hex}
                    onChange={(event) => onChange(setStop(design, archetype.id, element.id, index,
                      { color: asColor(event.target.value) }))}
                  >
                    {COLOR_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                  </select>
                  <input
                    className="studio-stop-offset"
                    defaultValue={stop.offset}
                    onBlur={(event) => {
                      const value = Number(event.target.value);
                      if (Number.isFinite(value)) {
                        onChange(setStop(design, archetype.id, element.id, index,
                          { offset: Math.min(100, Math.max(0, value)) }));
                      }
                    }}
                  />
                  <button
                    type="button"
                    disabled={gradient.stops.length <= 2}
                    title={gradient.stops.length <= 2 ? "Gradientda kamida ikkita to‘xtash bo‘ladi" : "O‘chirish"}
                    onClick={() => onChange(removeStop(design, archetype.id, element.id, index))}
                  >−</button>
                </div>
              ))}

              <div className="studio-tabs">
                <button type="button" onClick={() => onChange(addStop(design, archetype.id, element.id))}>
                  To‘xtash qo‘shish
                </button>
              </div>

              <label className="studio-field">
                <span>Tayyor gradientlar</span>
                <select
                  value=""
                  onChange={(event) => {
                    const preset = GRADIENT_PRESETS.find((entry) => entry.id === event.target.value);
                    if (preset) onChange(setFill(design, archetype.id, element.id, gradientFromPreset(preset)));
                  }}
                >
                  <option value="">— tanlash —</option>
                  {GRADIENT_PRESETS.map((preset) => (
                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                  ))}
                </select>
              </label>
            </>}
          </>;
        })()}
      </section>

      {takesBorder(element) || takesCorners(element) ? (
        <section>
          <h4>Chegara va burchak</h4>
          {takesBorder(element) ? (() => {
            const border = (element as { border?: typeof DEFAULT_BORDER | null }).border ?? null;
            return <>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={Boolean(border)}
                  onChange={(event) => onChange(setBorder(design, archetype.id, element.id,
                    event.target.checked ? DEFAULT_BORDER : null))}
                />
                Chegara
              </label>
              {border ? (
                <>
                  <div className="studio-grid">
                    <Field label="Qalinlik" value={border.width} suffix="px" onCommit={(raw) => {
                      const value = number(raw);
                      if (value !== null) onChange(patchBorder(design, archetype.id, element.id, { width: Math.max(0, value) }));
                    }} />
                    <label className="studio-field">
                      <span>Uslub</span>
                      <select
                        value={border.style}
                        onChange={(event) => onChange(patchBorder(design, archetype.id, element.id,
                          { style: event.target.value as typeof border.style }))}
                      >
                        <option value="solid">To‘liq</option>
                        <option value="dashed">Chiziqli</option>
                        <option value="dotted">Nuqtali</option>
                      </select>
                    </label>
                  </div>
                  <label className="studio-field">
                    <span>Rang</span>
                    <select
                      value={"role" in border.color ? border.color.role : border.color.hex}
                      onChange={(event) => onChange(patchBorder(design, archetype.id, element.id,
                        { color: asColor(event.target.value) }))}
                    >
                      {COLOR_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
                      {"hex" in border.color ? <option value={border.color.hex}>{border.color.hex}</option> : null}
                    </select>
                  </label>
                </>
              ) : null}
            </>;
          })() : null}

          {takesCorners(element) ? (() => {
            const corners = (element as { corners?: { topLeft: number; topRight: number; bottomRight: number; bottomLeft: number } | null }).corners ?? null;
            const even = cornersAreEven(corners);
            return <>
              {/**
                * One field while the four agree, four when they do not.
                *
                * Almost every design rounds all four the same, and asking for
                * four numbers to round a card is three keystrokes of tax on the
                * common case. A design that deliberately rounds one corner keeps
                * its own values — this never flattens them silently.
                */}
              {even ? (
                <Field label="Burchak radiusi" value={corners?.topLeft ?? 0} suffix="px" onCommit={(raw) => {
                  const value = number(raw);
                  if (value === null) return;
                  onChange(setCorners(design, archetype.id, element.id,
                    value > 0 ? evenCorners(Math.max(0, value)) : null));
                }} />
              ) : (
                <div className="studio-grid">
                  {(["topLeft", "topRight", "bottomLeft", "bottomRight"] as const).map((key) => (
                    <Field key={key} label={key} value={corners?.[key] ?? 0} suffix="px" onCommit={(raw) => {
                      const value = number(raw);
                      if (value === null || !corners) return;
                      onChange(setCorners(design, archetype.id, element.id, { ...corners, [key]: Math.max(0, value) }));
                    }} />
                  ))}
                </div>
              )}
              {!even ? (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => onChange(setCorners(design, archetype.id, element.id, evenCorners(corners?.topLeft ?? 0)))}
                >
                  Hammasini tenglashtirish
                </button>
              ) : null}
            </>;
          })() : null}
        </section>
      ) : null}

      {takesShadow(element) ? (() => {
        const shadows = (element as { shadows?: readonly { offsetX: number; offsetY: number; blur: number; spread: number; opacity: number }[] }).shadows ?? [];
        return (
          <section>
            <h4>Soya</h4>
            {shadows.length === 0 ? <p className="studio-note">Soyasiz.</p> : null}
            {shadows.map((shadow, at) => (
              <div key={at} className="studio-shadow">
                <div className="studio-grid">
                  <Field label="X" value={shadow.offsetX} onCommit={(raw) => {
                    const value = number(raw);
                    if (value !== null) onChange(patchShadow(design, archetype.id, element.id, at, { offsetX: value }));
                  }} />
                  <Field label="Y" value={shadow.offsetY} onCommit={(raw) => {
                    const value = number(raw);
                    if (value !== null) onChange(patchShadow(design, archetype.id, element.id, at, { offsetY: value }));
                  }} />
                  <Field label="Blur" value={shadow.blur} onCommit={(raw) => {
                    const value = number(raw);
                    if (value !== null) onChange(patchShadow(design, archetype.id, element.id, at, { blur: Math.max(0, value) }));
                  }} />
                  <Field label="Spread" value={shadow.spread} onCommit={(raw) => {
                    const value = number(raw);
                    if (value !== null) onChange(patchShadow(design, archetype.id, element.id, at, { spread: value }));
                  }} />
                </div>
                <div className="studio-shadow-foot">
                  <Field label="Opacity" value={shadow.opacity} onCommit={(raw) => {
                    const value = number(raw);
                    if (value !== null) {
                      onChange(patchShadow(design, archetype.id, element.id, at,
                        { opacity: Math.min(1, Math.max(0, value)) }));
                    }
                  }} />
                  <button type="button" onClick={() => onChange(removeShadow(design, archetype.id, element.id, at))}>
                    O‘chirish
                  </button>
                </div>
              </div>
            ))}
            {shadows.length < MAX_SHADOWS ? (
              <button
                type="button"
                className="text-button"
                onClick={() => onChange(addShadow(design, archetype.id, element.id))}
              >
                + Soya qo‘shish
              </button>
            ) : (
              // Said rather than shown as a dead button: three is a decision,
              // and past it nobody can see the difference on a projected slide.
              <p className="studio-note">Uchtadan ko‘p soya slaydda ko‘rinmaydi.</p>
            )}
          </section>
        );
      })() : null}

      {element.type === "image" || element.type === "frame" ? (() => {
        const image = element as unknown as {
          slot: string; fit: "cover" | "contain" | "fill"; focus: { x: number; y: number };
          orientation: string; required: boolean;
          overlay: ColorValue | null; overlayOpacity: number;
        };
        return (
          <section>
            <h4>Rasm qoidalari</h4>
            {/**
              * Rules, not a picture. What goes in this box is decided when a
              * deck is generated; what the design owns is the shape of the hole
              * and how a photograph should sit in it.
              */}
            <Field label="Slot" value={image.slot} onCommit={(raw) => {
              if (raw.trim()) onChange(setImageRules(design, archetype.id, element.id, { slot: raw.trim() }));
            }} />
            <div className="studio-grid">
              <label className="studio-field">
                <span>Joylashuv</span>
                <select
                  value={image.fit}
                  onChange={(event) => onChange(setImageRules(design, archetype.id, element.id,
                    { fit: event.target.value as typeof image.fit }))}
                >
                  <option value="cover">To‘ldirish</option>
                  <option value="contain">Sig‘dirish</option>
                  <option value="fill">Cho‘zish</option>
                </select>
              </label>
              <label className="studio-field">
                <span>Yo‘nalish</span>
                <select
                  value={image.orientation}
                  onChange={(event) => onChange(setImageRules(design, archetype.id, element.id,
                    { orientation: event.target.value as "landscape" | "portrait" | "square" | "any" }))}
                >
                  <option value="landscape">Gorizontal</option>
                  <option value="portrait">Vertikal</option>
                  <option value="square">Kvadrat</option>
                  <option value="any">Farqi yo‘q</option>
                </select>
              </label>
            </div>
            <div className="studio-grid">
              <Field label="Fokus X" value={image.focus?.x ?? 0.5} onCommit={(raw) => {
                const value = number(raw);
                if (value !== null) {
                  onChange(setImageRules(design, archetype.id, element.id,
                    { focus: { x: value, y: image.focus?.y ?? 0.5 } }));
                }
              }} />
              <Field label="Fokus Y" value={image.focus?.y ?? 0.5} onCommit={(raw) => {
                const value = number(raw);
                if (value !== null) {
                  onChange(setImageRules(design, archetype.id, element.id,
                    { focus: { x: image.focus?.x ?? 0.5, y: value } }));
                }
              }} />
            </div>
            {/**
              * The colour and its strength together.
              *
              * An opacity on its own is not a fainter tint — the language
              * writes it only beside an overlay, so a lone number would show a
              * change on the canvas and be gone the next time the design was
              * opened.
              */}
            <label className="studio-field">
              <span>Qoplama</span>
              <select
                value={image.overlay ? ("role" in image.overlay ? image.overlay.role : image.overlay.hex) : ""}
                onChange={(event) => onChange(setOverlay(design, archetype.id, element.id,
                  event.target.value ? asColor(event.target.value) : null))}
              >
                <option value="">Yo‘q</option>
                {COLOR_ROLES.map((role) => <option key={role} value={role}>{role}</option>)}
              </select>
            </label>
            {image.overlay ? (
              <Field label="Qoplama shaffofligi" value={image.overlayOpacity ?? 0.35} onCommit={(raw) => {
                const value = number(raw);
                if (value !== null) onChange(setOverlay(design, archetype.id, element.id, image.overlay, value));
              }} />
            ) : null}
            <label className="checkbox">
              <input
                type="checkbox"
                checked={image.required}
                onChange={(event) => onChange(setImageRules(design, archetype.id, element.id,
                  { required: event.target.checked }))}
              />
              Majburiy — rasm topilmasa slayd tanlanmaydi
            </label>
          </section>
        );
      })() : null}

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

/**
 * What can be done to several elements at once.
 *
 * Aligning to the selection's own bounding box rather than to the canvas: three
 * cards aligned left should meet the leftmost card, not the slide's edge, which
 * is where they would all end up if the canvas were the reference.
 */
function GroupTools({
  design, archetypeId, ids, onChange,
}: {
  design: JslaydDocument;
  archetypeId: string;
  ids: readonly string[];
  onChange: (next: JslaydDocument) => void;
}) {
  const alignments = [
    { key: "left", label: "Chapga", icon: AlignStartVertical },
    { key: "centerX", label: "Gorizontal markaz", icon: AlignCenterVertical },
    { key: "right", label: "O‘ngga", icon: AlignEndVertical },
    { key: "top", label: "Tepaga", icon: AlignStartHorizontal },
    { key: "middle", label: "Vertikal markaz", icon: AlignCenterHorizontal },
    { key: "bottom", label: "Pastga", icon: AlignEndHorizontal },
  ] as const;

  return (
    <div className="studio-inspector">
      <header>
        <strong>{ids.length} ta element</strong>
        <small>tanlandi</small>
      </header>

      <section>
        <h4>Tekislash</h4>
        <div className="studio-align">
          {alignments.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              title={label}
              aria-label={label}
              onClick={() => onChange(alignElements(design, archetypeId, ids, key))}
            >
              <Icon size={16} strokeWidth={1.8} />
            </button>
          ))}
        </div>
      </section>

      <section>
        <h4>Bir xil oraliq</h4>
        {/**
          * Three is the fewest that can be spaced: with two there is nothing
          * between the outermost pair to move, so the button would do nothing
          * and look broken rather than say why.
          */}
        {ids.length < 3 ? (
          <p className="studio-note">Kamida uchta element kerak.</p>
        ) : (
          <div className="studio-align">
            <button type="button" title="Gorizontal" onClick={() => onChange(distribute(design, archetypeId, ids, "x"))}>
              <MoveHorizontal size={16} strokeWidth={1.8} />
            </button>
            <button type="button" title="Vertikal" onClick={() => onChange(distribute(design, archetypeId, ids, "y"))}>
              <MoveVertical size={16} strokeWidth={1.8} />
            </button>
          </div>
        )}
      </section>

      <p className="studio-note">
        Sudrab ko‘chirish hammasini birga siljitadi. O‘lchamni o‘zgartirish uchun bitta elementni tanlang.
      </p>
    </div>
  );
}
