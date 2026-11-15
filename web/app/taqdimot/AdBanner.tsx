"use client";

import { useEffect, useState } from "react";

export type ScreenAd = { id: string; url: string; link: string | null };
export type BannerTiming = { first_seconds: number; every_seconds: number; show_seconds: number };

/**
 * A 7:1 banner that comes down from the top of the screen now and then.
 *
 * Shown to an owner with no plan and to the cheapest plan (the server decides
 * which, in `presentation_ads_for`). It comes down `first_seconds` into the talk,
 * stays `show_seconds`, then again every `every_seconds`, taking the banners in
 * turn. It waits while an ad page is on the screen, so two ads never stand on
 * top of each other, and a picture that does not load is simply skipped.
 */
export function AdBanner({ ads, timing, paused }: { ads: ScreenAd[]; timing: BannerTiming; paused: boolean }) {
  const [turn, setTurn] = useState(0);
  const [shown, setShown] = useState(false);
  const [ready, setReady] = useState<string | null>(null);
  const ad = ads.length ? ads[turn % ads.length] : null;

  // Loaded before it comes down, so it never slides in half drawn.
  useEffect(() => {
    if (!ad) return;
    let current = true;
    const picture = new window.Image();
    picture.onload = () => { if (current) setReady(ad.url); };
    picture.onerror = () => { if (current) setReady(null); };
    picture.src = ad.url;
    return () => { current = false; };
  }, [ad]);

  useEffect(() => {
    if (!ad || paused) {
      setShown(false);
      return;
    }
    const first = Math.max(timing.first_seconds, 1) * 1000;
    const every = Math.max(timing.every_seconds, timing.show_seconds + 5) * 1000;
    const stay = Math.max(timing.show_seconds, 3) * 1000;
    let hide: ReturnType<typeof setTimeout> | undefined;
    let repeat: ReturnType<typeof setInterval> | undefined;
    const come = () => {
      setShown(true);
      hide = setTimeout(() => {
        setShown(false);
        setTurn((value) => value + 1);
      }, stay);
    };
    const start = setTimeout(() => {
      come();
      repeat = setInterval(come, every);
    }, first);
    return () => {
      clearTimeout(start);
      if (repeat) clearInterval(repeat);
      if (hide) clearTimeout(hide);
    };
    // A new banner turn must not restart the clock: only what the talk shows does.
  }, [Boolean(ad), paused, timing.first_seconds, timing.every_seconds, timing.show_seconds]);

  if (!ad || ready !== ad.url) return null;
  const picture = <img src={ad.url} alt="Reklama" draggable={false} />;
  return (
    <div className={`presentation-banner${shown ? " is-shown" : ""}`} aria-hidden={!shown}>
      <div className="presentation-banner-frame">
        {ad.link ? (
          <a href={ad.link} target="_blank" rel="noopener noreferrer sponsored" tabIndex={shown ? 0 : -1}>{picture}</a>
        ) : picture}
      </div>
      <span className="presentation-banner-label">Reklama</span>
    </div>
  );
}
