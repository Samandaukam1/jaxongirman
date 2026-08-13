"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { drawQr, glowFilter, placeQr, type QrRect } from "@jaxongirman/qr-video";

import { type QrExperience } from "@/lib/qr-experience";

/**
 * The QR Video Experience.
 *
 * An intro plays once, a loop takes over and runs forever, and a live QR sits
 * over both at the spot the footage was shot around.
 *
 * The whole component exists to make one moment invisible: the hand-off from
 * the intro to the loop. Everything that normally shows there — a black frame
 * while the second video starts decoding, a poster image, a spinner, the box
 * resizing as one element is swapped for another — is designed out rather than
 * hidden:
 *
 *   * Both videos are mounted from the start, absolutely stacked in the same
 *     box, so no layout can change when one replaces the other.
 *   * Neither is ever unmounted, so React cannot reflow at the hand-off.
 *   * Playback does not begin until *both* videos report a decoded frame. The
 *     loop is therefore not merely "preloaded" in the network sense — its first
 *     frame is already rasterised and sitting under the intro at zero opacity.
 *   * The swap is an opacity flip with no transition, done in the same tick as
 *     `play()`. Because the loop's frame is already painted, there is no moment
 *     where nothing is on screen: the compositor has both frames in hand and
 *     simply reveals the lower one.
 *
 * The QR is drawn by the site from the token this screen's own session issued,
 * so every projector shows a code only that projector's phone can claim.
 */

type Props = {
  experience: QrExperience;
  /** The session URL the code carries. Until it exists, no code is drawn. */
  qrValue: string | null;
  /** Announced once both videos hold a frame and the intro has started. */
  onPlaying?: () => void;
  /**
   * Announced when the footage cannot be played at all, so the caller can fall
   * back to the pairing screen that has always worked.
   */
  onUnavailable?: (reason: string) => void;
  /**
   * The surface's own words, laid over the footage on the right.
   *
   * The site's header is hidden here — a menu bar sitting across the top of a
   * film is chrome pretending to be part of the picture — so the identity and
   * the links move to a rail down the left, and the instructions take the right.
   * That leaves the middle of the frame clear, which is where the code lives.
   */
  children?: ReactNode;
};

/**
 * How long to wait for two clips to become playable before giving up.
 *
 * Generous, because this is a projector on conference wifi loading tens of
 * megabytes — but finite, because the alternative to giving up is a black
 * rectangle in a lecture hall and nobody able to pair at all.
 */
const READY_TIMEOUT_MS = 20000;

export function QrVideoExperience({ experience, qrValue, onPlaying, onUnavailable, children }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const introRef = useRef<HTMLVideoElement | null>(null);
  const loopRef = useRef<HTMLVideoElement | null>(null);

  const [started, setStarted] = useState(false);
  const [videosReady, setVideosReady] = useState(false);
  const [looping, setLooping] = useState(false);
  const [rect, setRect] = useState<QrRect | null>(null);
  const [qrVisible, setQrVisible] = useState(false);

  /**
   * The code animates in exactly once. The loop restarting every few seconds
   * must not re-run it, and neither must a window resize or a React re-render,
   * so the fact that it has appeared lives in a ref rather than in state that
   * something else could reset.
   */
  const hasAppeared = useRef(false);
  const swapped = useRef(false);
  const announce = useRef(onPlaying);
  const giveUp = useRef(onUnavailable);
  useEffect(() => { announce.current = onPlaying; giveUp.current = onUnavailable; }, [onPlaying, onUnavailable]);

  const drawing = useMemo(() => (qrValue ? drawQr(qrValue) : null), [qrValue]);

  /* ------------------------------------------------------- readiness and start */

  useEffect(() => {
    const intro = introRef.current;
    const loop = loopRef.current;
    if (!intro || !loop) return;
    let cancelled = false;
    const timers: number[] = [];

    // HAVE_CURRENT_DATA: the element holds a decoded frame for its current
    // position. For the loop, still parked at 0, that is its opening frame —
    // which is the whole trick behind a hand-off with nothing in between.
    // A clip the browser cannot decode never fires `loadeddata`. Waiting for it
    // forever is what turns an unplayable file — a QuickTime `.mov` outside
    // Safari, most often — into a black screen nobody can pair from. So a
    // failure and a stall both have to be answers, not silence.
    const ready = (video: HTMLVideoElement, name: string) =>
      video.readyState >= 2
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
          const done = () => { detach(); resolve(); };
          const failed = () => {
            detach();
            const code = video.error?.code;
            reject(new Error(code === 4
              ? `${name}: bu formatni brauzer ocholmadi`
              : `${name}: video yuklanmadi (${code ?? "noma'lum"})`));
          };
          const detach = () => {
            video.removeEventListener("loadeddata", done);
            video.removeEventListener("error", failed);
          };
          video.addEventListener("loadeddata", done);
          video.addEventListener("error", failed);
        });

    const deadline = new Promise<never>((_resolve, reject) => {
      const timer = window.setTimeout(
        () => reject(new Error("videolar vaqtida yuklanmadi")),
        READY_TIMEOUT_MS,
      );
      timers.push(timer);
    });

    void (async () => {
      try {
        await Promise.race([Promise.all([ready(intro, "intro"), ready(loop, "loop")]), deadline]);
      } catch (problem) {
        if (cancelled) return;
        // The room gets the screen that has always worked, rather than a black
        // rectangle and no way to pair.
        giveUp.current?.(problem instanceof Error ? problem.message : "video ochilmadi");
        return;
      }
      if (cancelled) return;
      setVideosReady(true);
    })();

    return () => {
      cancelled = true;
      for (const timer of timers) window.clearTimeout(timer);
    };
  }, []);

  /**
   * Nothing plays until the code is drawn.
   *
   * The cue is a moment in the footage, and it only happens once. Starting the
   * intro while the session token is still in flight means 5.06 seconds can
   * pass with nothing to reveal — and then the code turns up whenever the
   * network got round to it, which is not what the design says. Holding the
   * first frame back by the fraction of a second the session takes costs
   * nobody anything and makes the cue exact.
   */
  useEffect(() => {
    const intro = introRef.current;
    if (!intro || !videosReady || !drawing || started) return;
    let cancelled = false;

    setStarted(true);
    void (async () => {
      try {
        await intro.play();
      } catch {
        // Muted inline playback is allowed everywhere that matters, but a
        // locked-down browser can still refuse. Rather than put a play button
        // over the footage, wait for the first touch of the page — on a
        // projector that is the click that opened it.
        const retry = () => { void intro.play(); window.removeEventListener("pointerdown", retry); };
        window.addEventListener("pointerdown", retry);
        return;
      }
      if (!cancelled) announce.current?.();
    })();

    return () => { cancelled = true; };
  }, [drawing, started, videosReady]);

  /* ------------------------------------------------- the hand-off, and the code */

  const swap = useCallback(() => {
    if (swapped.current) return;
    swapped.current = true;
    const loop = loopRef.current;
    if (!loop) return;
    // Reveal and start in the same tick. The frame under the intro is already
    // painted, so this is a reveal, not a load.
    setLooping(true);
    void loop.play();
  }, []);

  useEffect(() => {
    const intro = introRef.current;
    if (!intro || !started) return;

    const appearAt = experience.appearMs / 1000;

    const check = (seconds: number) => {
      if (!hasAppeared.current && seconds >= appearAt) {
        hasAppeared.current = true;
        setQrVisible(true);
      }
    };

    // `requestVideoFrameCallback` reports the media time of the frame actually
    // on screen, which is what "at 5.06 seconds" means. `timeupdate` fires
    // about four times a second and would put the code up to a quarter of a
    // second late, which is visible against a cue in the footage.
    type FrameVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (callback: (now: number, meta: { mediaTime: number }) => void) => number;
      cancelVideoFrameCallback?: (handle: number) => void;
    };
    const video = intro as FrameVideo;
    let handle = 0;
    let raf = 0;
    let stopped = false;

    if (typeof video.requestVideoFrameCallback === "function") {
      const onFrame = (_now: number, meta: { mediaTime: number }) => {
        if (stopped) return;
        check(meta.mediaTime);
        handle = video.requestVideoFrameCallback!(onFrame);
      };
      handle = video.requestVideoFrameCallback(onFrame);
    } else {
      const tick = () => {
        if (stopped) return;
        check(intro.currentTime);
        raf = window.requestAnimationFrame(tick);
      };
      raf = window.requestAnimationFrame(tick);
    }

    const onEnded = () => {
      // An appear time longer than the intro would otherwise mean the code
      // never arrives and nobody in the room can pair at all. The cue is the
      // intended moment, not a condition for the code existing.
      if (!hasAppeared.current) {
        hasAppeared.current = true;
        setQrVisible(true);
      }
      swap();
    };
    intro.addEventListener("ended", onEnded);
    // If the intro finished before this effect attached — a very short clip, a
    // slow first render — the event is already gone and only this catches it.
    if (intro.ended) onEnded();

    return () => {
      stopped = true;
      intro.removeEventListener("ended", onEnded);
      if (handle && video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(handle);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [experience.appearMs, started, swap]);

  /* ------------------------------------------------------------- placement */

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const source = looping ? loopRef.current : introRef.current;
    if (!stage || !source) return;
    setRect(placeQr(
      experience,
      { width: source.videoWidth, height: source.videoHeight },
      { width: stage.clientWidth, height: stage.clientHeight },
    ));
  }, [experience, looping]);

  useEffect(() => {
    measure();
    const stage = stageRef.current;
    if (!stage) return;
    const observer = new ResizeObserver(measure);
    observer.observe(stage);

    // A video reports no dimensions until its metadata arrives, and the code is
    // positioned against those dimensions. Measuring only on mount and on
    // resize therefore left the code with nowhere to be — so it was never
    // drawn at all, and a window resize was the only thing that could rescue
    // it. The cue at 5.06 seconds has to reveal something already in place.
    const intro = introRef.current;
    const loop = loopRef.current;
    intro?.addEventListener("loadedmetadata", measure);
    loop?.addEventListener("loadedmetadata", measure);
    return () => {
      observer.disconnect();
      intro?.removeEventListener("loadedmetadata", measure);
      loop?.removeEventListener("loadedmetadata", measure);
    };
  }, [measure]);

  const glow = glowFilter(experience.glow);

  return (
    <div className="qrx-stage" ref={stageRef} data-started={started ? "true" : "false"}>
      <video
        ref={introRef}
        className="qrx-video"
        src={experience.introUrl ?? undefined}
        muted
        playsInline
        preload="auto"
        // No `poster`: a poster is a still image the element shows before the
        // first frame, and swapping it out is exactly the flash this must not have.
        style={{ opacity: looping ? 0 : 1 }}
        aria-hidden
      />
      <video
        ref={loopRef}
        className="qrx-video"
        src={experience.loopUrl ?? undefined}
        muted
        playsInline
        preload="auto"
        loop
        style={{ opacity: looping ? 1 : 0 }}
        aria-hidden
      />

      <div className="qrx-chrome" aria-hidden={false}>
        <div className="qrx-rail qrx-panel">
          <a className="qrx-brand" href="/">
            <span className="qrx-brand-mark">J</span>
            <span>Jaxongirman</span>
          </a>
          <nav className="qrx-nav" aria-label="Asosiy navigatsiya">
            <a href="/#imkoniyatlar">Imkoniyatlar</a>
            <a href="/dokon">Do&lsquo;kon</a>
            <a href="/taqdimot">Taqdimot qilish</a>
          </nav>
        </div>

        {children ? <div className="qrx-copy qrx-panel">{children}</div> : null}
      </div>

      {drawing && rect ? (
        <div
          className={`qrx-code${qrVisible ? " is-in" : ""}`}
          style={{
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.side}px`,
            height: `${rect.side}px`,
            filter: glow,
          }}
        >
          <svg viewBox={`0 0 ${drawing.extent} ${drawing.extent}`} width="100%" height="100%" role="img"
            aria-label="Sessiyaga ulanish uchun QR kod">
            <defs>
              <linearGradient id="qrx-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor={experience.gradientFrom} />
                <stop offset="50%" stopColor={experience.gradientVia} />
                <stop offset="100%" stopColor={experience.gradientTo} />
              </linearGradient>
            </defs>
            <rect
              width={drawing.extent}
              height={drawing.extent}
              rx={drawing.extent * 0.06}
              fill={experience.background}
            />
            <path d={drawing.path} fill="url(#qrx-gradient)" shapeRendering="crispEdges" />
          </svg>
          <span className="qrx-sheen" aria-hidden />
        </div>
      ) : null}
    </div>
  );
}
