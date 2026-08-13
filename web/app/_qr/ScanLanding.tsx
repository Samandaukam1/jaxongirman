"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const STORE_IOS = "https://apps.apple.com/app/jaxongirman/id0000000000";
const STORE_ANDROID = "https://play.google.com/store/apps/details?id=uz.jaxongirman.app";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const agent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(agent) || (agent.includes("Mac") && "ontouchend" in document)) return "ios";
  if (/Android/i.test(agent)) return "android";
  return "other";
}

export type ScanKind = "pair" | "game-pair";

const KINDS = {
  "pair": {
    rpc: "presentation_pair_info" as const,
    storageKey: "jaxongirman:pending-pair",
    glyph: "▷",
    heading: "Taqdimot pulti",
    lead: "Ekranni telefoningizdan boshqarish uchun Jaxongirman ilovasi kerak. Ilova o‘rnatilgan bo‘lsa, bu havola uni o‘zi ochadi.",
    gone: "Bu QR kod eskirgan yoki sessiya yakunlangan. Ekrandagi yangi kodni skaner qiling — kod har yarim daqiqada yangilanadi.",
    steps: ["Jaxongirman ilovasini o‘rnatib, hisobingizga kiring", "Taqdimot bo‘limini oching", "Ekrandagi QR kodni skaner qiling"],
  },
  "game-pair": {
    rpc: "game_pair_info" as const,
    storageKey: "jaxongirman:pending-game-pair",
    glyph: "◎",
    heading: "O‘yingoh boshqaruvi",
    lead: "Bellashuvni katta ekranda olib borish uchun Jaxongirman ilovasi kerak. Ilova o‘rnatilgan bo‘lsa, bu havola uni o‘zi ochadi.",
    gone: "Bu QR kod eskirgan yoki bellashuv yakunlangan. Ekrandagi yangi kodni skaner qiling.",
    steps: ["Jaxongirman ilovasini o‘rnatib, hisobingizga kiring", "O‘yingoh bo‘limini oching", "Ekrandagi QR kodni skaner qiling"],
  },
} satisfies Record<ScanKind, unknown> as Record<ScanKind, {
  rpc: "presentation_pair_info" | "game_pair_info";
  storageKey: string;
  glyph: string;
  heading: string;
  lead: string;
  gone: string;
  steps: string[];
}>;

/**
 * Where a scanned projector code lands when the app is not what opened it.
 *
 * The codes on the screens are `https://` URLs rather than the app's own
 * scheme, and that is the whole reason this page exists. A phone camera reads a
 * string and hands it to the browser; it has never heard of `jaxongirman://`
 * and offers nothing at all for it. With a real link, a phone that has the app
 * opens straight into it through the Universal Link / App Link association and
 * never renders this component — and a phone that does not gets something
 * honest rather than a dead end.
 *
 * Taking over a screen means holding the session, which means being signed in,
 * so this page does not pretend to pair. It checks that the code is still good,
 * sends people to the right store, and remembers the token: neither iOS nor
 * Android guarantees that a fresh install is handed the URL that caused it.
 */
export function ScanLanding({ token, kind }: { token: string; kind: ScanKind }) {
  const copy = KINDS[kind];
  const [platform, setPlatform] = useState<Platform>("other");
  const [state, setState] = useState<"loading" | "live" | "gone">("loading");

  useEffect(() => { setPlatform(detectPlatform()); }, []);

  useEffect(() => {
    // All this link is allowed to learn is whether the code is still good.
    // Nothing about the session, the presenter or the room is reachable here.
    void (async () => {
      const { data, error } = await supabase.rpc(copy.rpc, { p_token: token });
      if (error || !data) { setState("gone"); return; }
      setState((data as unknown as { live: boolean }).live ? "live" : "gone");
    })();
  }, [copy.rpc, token]);

  useEffect(() => {
    if (state !== "live") return;
    // If the app is installed but the association did not fire — a QR opened
    // inside another app's in-built browser, most often — this still reaches it.
    const timer = setTimeout(() => { window.location.href = `jaxongirman://${kind}/${token}`; }, 300);
    return () => clearTimeout(timer);
  }, [kind, state, token]);

  function remember() {
    try {
      window.localStorage.setItem(copy.storageKey, JSON.stringify({ token, at: Date.now() }));
    } catch {
      // A browser with storage disabled still has the screen to scan again.
    }
  }

  return (
    <main className="notice-page">
      <div className="shell">
        <div className="notice-card join-card">
          <div className="glyph" style={{ margin: "0 auto" }}>{copy.glyph}</div>
          <h1>{copy.heading}</h1>

          {state === "gone" ? (
            <p>{copy.gone}</p>
          ) : (
            <>
              <p>{copy.lead}</p>

              <ol className="join-steps">
                {copy.steps.map((step) => <li key={step}>{step}</li>)}
              </ol>

              <div className="store-row">
                {platform !== "android" ? (
                  <a className="store-button" href={STORE_IOS} onClick={remember} rel="noopener">
                    App Store&lsquo;dan yuklab olish
                  </a>
                ) : null}
                {platform !== "ios" ? (
                  <a className={`store-button${platform === "other" ? " ghost" : ""}`} href={STORE_ANDROID} onClick={remember} rel="noopener">
                    Google Play&lsquo;dan yuklab olish
                  </a>
                ) : null}
              </div>

              <p className="store-note">
                Kompyuterda ochdingizmi? Bu havola telefon uchun — ekrandagi kodni telefoningiz
                bilan skaner qiling.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
