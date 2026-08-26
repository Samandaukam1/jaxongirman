import type { JslaydDocument, SlideData } from "@jaxongirman/jslayd";
import { ScaledSlide } from "@jaxongirman/slide-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { previewOf, toCanvas } from "@/lib/jslayd";
import {
  CANVAS, HANDLES, archetypeOf, boundingBox, elementOf, moveElement, nudgeElements,
  resizeBox, snap, type Handle,
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
  | { kind: "move"; ids: readonly string[]; startX: number; startY: number; box: Box }
  | { kind: "resize"; id: string; handle: Handle; startX: number; startY: number; box: Box }
  | null;

type Box = { x: number; y: number; width: number; height: number };

export function StudioCanvas({
  document: design,
  archetypeId,
  selectedIds,
  width = 880,
  family = null,
  slide = null,
  onSelect,
  onPreview,
  onGestureStart,
  onGestureEnd,
}: {
  document: JslaydDocument;
  archetypeId: string;
  selectedIds: readonly string[];
  width?: number;
  /** The colour family to draw in; null is the design's own. */
  family?: string | null;
  /** Real content, when a sample has been written. Null draws placeholders. */
  slide?: SlideData | null;
  /** Shift or ⌘ held means add to the selection rather than replace it. */
  onSelect: (ids: readonly string[]) => void;
  /** Every frame of a drag. Local state only — nothing is persisted here. */
  onPreview: (next: JslaydDocument) => void;
  onGestureStart: () => void;
  onGestureEnd: () => void;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture>(null);
  /** The document as it was when the drag began; see `move` below. */
  const anchor = useRef<JslaydDocument | null>(null);

  const archetype = archetypeOf(design, archetypeId);
  const scale = width / CANVAS.width;

  /**
   * The real render, recomputed whenever the design changes — including on
   * every frame of a drag.
   *
   * That is deliberate rather than accidental. Resizing a text box and seeing
   * the words reflow *is* the question an author is asking: whether the title
   * still fits at this width. An overlay that moves while the artwork waits for
   * the gesture to end answers it one second too late, after the decision has
   * been made.
   *
   * What is capped is how often: pointer events outrun the display on a
   * trackpad, so `move` coalesces them onto animation frames and this runs once
   * per frame at most.
   */
  const rendered = useMemo(() => {
    try {
      return previewOf(design, family, archetypeId, slide);
    } catch {
      return null;
    }
  }, [design, family, archetypeId, slide]);

  const boxOf = useCallback((id: string): Box | null => {
    const element = elementOf(archetype, id);
    return element ? { ...element.geometry } : null;
  }, [archetype]);

  /* ------------------------------------------------------------- pointers */

  useEffect(() => {
    if (!gesture) return;

    let frame = 0;
    let pending: { x: number; y: number } | null = null;

    const apply = () => {
      frame = 0;
      const point = pending;
      pending = null;
      if (!point) return;

      const dx = (point.x - gesture.startX) / scale;
      const dy = (point.y - gesture.startY) / scale;

      if (gesture.kind === "resize") {
        onPreview(moveElement(design, archetypeId, gesture.id, resizeBox(gesture.box, gesture.handle, dx, dy)));
        return;
      }

      /**
       * Applied to the document the gesture started from, not to the last
       * frame. A drag that accumulates deltas frame by frame drifts, because
       * each frame's snap rounds again — and the element ends up a few units
       * from where the pointer is, further the longer the drag.
       */
      onPreview(nudgeElements(anchor.current ?? design, archetypeId, gesture.ids, dx, dy));
    };

    /**
     * One render per frame, not one per event.
     *
     * A trackpad reports more often than the screen refreshes, so without this
     * the slide is laid out several times for a single frame the viewer sees —
     * work nobody looks at, on the one code path that has to stay smooth.
     */
    const move = (event: PointerEvent) => {
      pending = { x: event.clientX, y: event.clientY };
      if (!frame) frame = window.requestAnimationFrame(apply);
    };

    const up = () => {
      if (frame) window.cancelAnimationFrame(frame);
      // The last movement still counts: releasing between frames must not drop
      // the final few pixels of a drag.
      apply();
      setGesture(null);
      anchor.current = null;
      onGestureEnd();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [archetypeId, design, gesture, onGestureEnd, onPreview, scale]);

  /** Arrow keys nudge by one step of the ladder; shift by a bigger one. */
  useEffect(() => {
    if (!selectedIds.length) return;
    const key = (event: KeyboardEvent) => {
      const step = event.shiftKey ? 24 : 4;
      const delta = event.key === "ArrowLeft" ? [-step, 0]
        : event.key === "ArrowRight" ? [step, 0]
          : event.key === "ArrowUp" ? [0, -step]
            : event.key === "ArrowDown" ? [0, step] : null;
      if (!delta) return;
      // A field in the inspector takes its own arrow keys; nudging the canvas
      // from under a caret is the kind of help nobody asked for.
      const active = window.document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) return;

      event.preventDefault();
      onGestureStart();
      onPreview(nudgeElements(design, archetypeId, selectedIds, delta[0]!, delta[1]!));
      onGestureEnd();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [archetypeId, design, onGestureEnd, onGestureStart, onPreview, selectedIds]);

  if (!archetype) return <div className="studio-canvas-empty">Slayd tanlanmagan.</div>;

  const start = (event: React.PointerEvent, id: string, handle?: Handle) => {
    event.preventDefault();
    event.stopPropagation();
    const box = boxOf(id);
    if (!box) return;

    if (handle) {
      onSelect([id]);
      onGestureStart();
      setGesture({ kind: "resize", id, handle, startX: event.clientX, startY: event.clientY, box });
      return;
    }

    /**
     * Pressing an element already in the selection keeps the selection.
     *
     * Otherwise dragging three aligned cards is impossible: the press to begin
     * the drag would collapse the selection to one, and only that one would
     * move. Adding to a selection is shift or ⌘, as everywhere else.
     */
    const adding = event.shiftKey || event.metaKey || event.ctrlKey;
    const next = adding
      ? (selectedIds.includes(id) ? selectedIds.filter((entry) => entry !== id) : [...selectedIds, id])
      : (selectedIds.includes(id) ? selectedIds : [id]);
    onSelect(next);
    if (!next.length) return;

    anchor.current = design;
    onGestureStart();
    setGesture({ kind: "move", ids: next, startX: event.clientX, startY: event.clientY, box });
  };

  const selected = selectedIds.length === 1 ? elementOf(archetype, selectedIds[0]!) : null;
  const group = selectedIds.length > 1 ? boundingBox(archetype, selectedIds) : null;

  return (
    <div
      className="studio-canvas"
      ref={surface}
      style={{ width, height: width * (CANVAS.height / CANVAS.width) }}
      onPointerDown={() => onSelect([])}
    >
      {/* The engine's output. Never interactive: the layer above owns the pointer. */}
      <div className="studio-canvas-render" aria-hidden>
        {rendered ? <ScaledSlide width={width} {...toCanvas(rendered, archetypeId)} /> : null}
      </div>

      <div className="studio-canvas-hits">
        {archetype.elements.map((element) => {
          const box = element.geometry;
          const isSelected = selectedIds.includes(element.id);
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

        {/**
          * A group shows its extent but no handles.
          *
          * Resizing several elements at once has more than one reasonable
          * meaning — scale them, or stretch the box they sit in — and guessing
          * one is worse than offering neither. Moving and aligning are
          * unambiguous, so those are what a group can do.
          */}
        {group && (
          <div
            className="studio-group-bounds"
            style={{
              left: group.x * scale, top: group.y * scale,
              width: group.width * scale, height: group.height * scale,
            }}
          />
        )}

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
      {group && (
        <p className="studio-readout">
          {selectedIds.length} ta element · {snap(group.width)} × {snap(group.height)}
        </p>
      )}
    </div>
  );
}
