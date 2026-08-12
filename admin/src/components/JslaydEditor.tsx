import type { Diagnostic } from "@jaxongirman/jslayd";
import { useMemo, useRef, useState, type UIEvent } from "react";

/**
 * The prompt editor (§48).
 *
 * A textarea with a gutter behind it: line numbers, and a marker on any line a
 * diagnostic points at. Deliberately not a code-editor dependency — JSLAYD has
 * no nesting to fold and no symbols to complete, and what an author actually
 * needs is to find line 147 quickly.
 */
export function JslaydEditor({
  value,
  onChange,
  diagnostics,
  disabled,
}: {
  value: string;
  onChange: (next: string) => void;
  diagnostics: Diagnostic[];
  disabled?: boolean;
}) {
  const gutter = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const lines = useMemo(() => value.split("\n").length, [value]);
  const marks = useMemo(() => {
    const map = new Map<number, "error" | "warning" | "info">();
    for (const diagnostic of diagnostics) {
      if (diagnostic.line <= 0) continue;
      const existing = map.get(diagnostic.line);
      // An error on a line outranks a warning on the same line: the gutter has
      // one colour to spend and the blocking problem is the one to show.
      if (existing === "error") continue;
      if (existing === "warning" && diagnostic.severity === "info") continue;
      map.set(diagnostic.line, diagnostic.severity);
    }
    return map;
  }, [diagnostics]);

  function sync(event: UIEvent<HTMLTextAreaElement>) {
    if (gutter.current) gutter.current.scrollTop = event.currentTarget.scrollTop;
  }

  return (
    <div className={`jslayd-editor ${fullscreen ? "jslayd-editor-full" : ""}`}>
      <div className="jslayd-editor-bar">
        <span>{lines} qator</span>
        <div className="jslayd-editor-actions">
          <button type="button" className="secondary-button compact" onClick={() => void navigator.clipboard.writeText(value)}>
            Nusxalash
          </button>
          <button type="button" className="secondary-button compact" onClick={() => setFullscreen((open) => !open)}>
            {fullscreen ? "Kichraytirish" : "To‘liq ekran"}
          </button>
        </div>
      </div>
      <div className="jslayd-editor-body">
        <div className="jslayd-gutter" ref={gutter} aria-hidden>
          {Array.from({ length: lines }, (_, index) => {
            const line = index + 1;
            const mark = marks.get(line);
            return (
              <div key={line} className={mark ? `jslayd-line jslayd-line-${mark}` : "jslayd-line"}>
                {line}
              </div>
            );
          })}
        </div>
        <textarea
          className="jslayd-textarea"
          spellCheck={false}
          disabled={disabled}
          value={value}
          onScroll={sync}
          onChange={(event) => onChange(event.target.value)}
          placeholder="JSLAYD-DESIGN 1.0&#10;&#10;[DESIGN]&#10;name: ..."
        />
      </div>
    </div>
  );
}

/** The three-level diagnostic list the validate button fills (§49, §91). */
export function DiagnosticList({ diagnostics }: { diagnostics: Diagnostic[] }) {
  if (diagnostics.length === 0) return null;
  return (
    <ul className="jslayd-diagnostics">
      {diagnostics.map((diagnostic, index) => (
        <li key={index} className={`jslayd-diagnostic jslayd-diagnostic-${diagnostic.severity}`}>
          <span className="jslayd-diagnostic-level">{diagnostic.severity.toUpperCase()}</span>
          <div>
            <strong>
              {diagnostic.line > 0 ? `Qator ${diagnostic.line}` : "Hujjat"}
              {diagnostic.scope ? ` · ${diagnostic.scope}` : ""}
            </strong>
            <p>{diagnostic.message}</p>
            {diagnostic.hint ? <small>{diagnostic.hint}</small> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
