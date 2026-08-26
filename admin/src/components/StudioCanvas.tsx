import type { JslaydDocument } from "@jaxongirman/jslayd";
import { ScaledSlide } from "@jaxongirman/slide-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { previewOf, toCanvas } from "@/lib/jslayd";
import {
  CANVAS, HANDLES, archetypeOf, elementOf, moveElement, resizeBox, snap,
  type Handle,
} from "@/lib/studioEdit";

/**
 * The canvas: the engine's own output, with handles on it.
 *
 * Two things had to be true at once, and getting both is what this component is
 * for. What an admin sees has to be the real render — the same pipeline a
 * customer's deck goes through, not a wireframe that flatters the design. And
 * every part of it has to be selectable, which a render normally cannot be,
 * because a rendered row has no idea which authoring element drew it.
 *
 * So the renderer now stamps `origin` on every row, and this draws the real
 * preview underneath a transparent layer of hit targets — one per authoring
 * element, at the authoring geometry. Clicking selects; dragging moves; the
 * eight handles resize. Nothing is drawn twice and nothing is approximated.
 *
 * Everything is in authoring units (1920 × 1080) and scaled once, at the top,
 * so a smaller window changes the scale and nothing else. The document never
 * learns what size the screen is.
 */

type Gesture =
  | { kind: "move"; id: string; startX: number; startY: number; box: Box }
  | { kind: "resize"; id: string; handle: Handle; startX: number; startY: number; box: Box }
  | null;

type Box = { x: number; y: number; width: number; height: number };

export function StudioCanvas({
  document: design,
  archetypeId,
  selectedId,
  width = 880,
  onSelect,
  onPreview,
  onGestureStart,
  onGestureEnd,
}: {
  document: JslaydDocument;
  archetypeId: string;
  selectedId: string | null;
  width?: number;
  onSelect: (id: string | null) => void;
  /** Every frame of a drag. Local state only — nothing is persisted here. */
  onPreview: (next: JslaydDocument) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>(null);

  const archetype = archetypeOf(design, archetypeId);
  const scale = width / CANVAS.width;

  /**
   * The real render, recomputed only when the design or the slide changes.
   *
   * Not on every pointer move: a drag is sixty of those a second, and
   * recompiling a slide for each one is how an editor starts to feel like a
   * form. The overlay moves with the pointer; the render catches up when the
   * gesture ends.
   */
  const rendered = useMemo(() => {
    try {
      return previewOf(design, null);
    } catch {
      return null;
    }
  }, [design]);

  const boxOf = useCallback((id: string): Box | null => {
    const element = elementOf(archetype, id);
    return element ? { ...element.geometry } : null;
  }, [archetype]);

  /* ------------------------------------------------------------- pointers */

  useEffect(() => {
    if (!gesture) return;

    const move = (event: PointerEvent) => {
      const dx = (event.clientX - gesture.startX) / scale;
      const dy = (event.clientY - gesture.startY) / scale;
      const next = gesture.kind === "move"
        ? { ...gesture.box, x: gesture.box.x + dx, y: gesture.box.y + dy }
        : resizeBox(gesture.box, gesture.handle, dx, dy);
      onPreview(moveElement(design, archetypeId, gesture.id, next));
    };

    const up = () => { setGesture(null); onGestureEnd(); };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [archetypeId, design, gesture, onGestureEnd, onPreview, scale]);

  /** Arrow keys nudge by one step of the ladder; shift by a bigger one. */
  useEffect(() => {
    if (!selectedId) return;
    const key = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 24 : 4;
      const delta = event.key === "ArrowLeft" ? [-step, 0]
        : event.key === "ArrowRight" ? [step, 0]
          : event.key === "ArrowUp" ? [0, -step]
            : event.key === "ArrowDown" ? [0, step] : null;
      if (!delta) return;
      const box = boxOf(selectedId);
      if (!box) return;
      event.preventDefault();
      onGestureStart();
      onPreview(moveElement(design, archetypeId, selectedId, {
        ...box, x: box.x + delta[0]!, y: box.y + delta[1]!,
      }));
      onGestureEnd();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [archetypeId, boxOf, design, onGestureEnd, onGestureStart, onPreview, selectedId]);

  if (!archetype) return <div className="studio-canvas-empty">Slayd tanlanmagan.</div>;

  const start = (event: React.PointerEvent, id: string, handle?: Handle) => {
    event.preventDefault();
    event.stopPropagation();
    const box = boxOf(id);
    if (!box) return;
    onSelect(id);
    onGestureStart();
    setGesture(handle
      ? { kind: "resize", id, handle, startX: event.clientX, startY: event.clientY, box }
      : { kind: "move", id, startX: event.clientX, startY: event.clientY, box });
  };

  const selected = elementOf(archetype, selectedId);

  return (
    <div
      className="studio-canvas"
      ref={surface}
      style={{ width, height: width * (CANVAS.height / CANVAS.width) }}
      onPointerDown={() => onSelect(null)}
    >
      {/* The engine's output. Never interactive: the layer above owns the pointer. */}
      <div className="studio-canvas-render" aria-hidden>
        {rendered ? <ScaledSlide width={width} {...toCanvas(rendered, archetypeId)} /> : null}
      </div>

      <div className="studio-canvas-hits">
        {archetype.elements.map((element) => {
          const box = element.geometry;
          const isSelected = element.id === selectedId;
          return (
            <button
              key={element.id}
              type="button"
              className={`studio-hit${isSelected ? " selected" : ""}`}
              aria-label={`${element.type} ${element.id}`}
              style={{
                left: box.x * scale,
                top: box.y * scale,
                width: box.width * scale,
                height: box.height * scale,
                transform: box.rotation ? `rotate(${box.rotation}deg)` : undefined,
              }}
              onPointerDown={(event) => start(event, element.id)}
            />
          );
        })}

        {/* Handles last, so they sit above every hit target including their own. */}
        {selected && (
          <div
            className="studio-handles"
            style={{
              left: selected.geometry.x * scale,
              top: selected.geometry.y * scale,
              width: selected.geometry.width * scale,
              height: selected.geometry.height * scale,
            }}
          >
            {HANDLES.map((handle) => (
              <span
                key={handle}
                role="button"
                tabIndex={-1}
                aria-label={handle}
                className={`studio-handle ${handle}`}
                onPointerDown={(event) => start(event, selected.id, handle)}
              />
            ))}
          </div>
        )}
      </div>

      {selected && (
        <p className="studio-readout">
          {selected.type} · {snap(selected.geometry.x)}, {snap(selected.geometry.y)} ·{" "}
          {snap(selected.geometry.width)} × {snap(selected.geometry.height)}
        </p>
      )}
    </div>
  );
}
