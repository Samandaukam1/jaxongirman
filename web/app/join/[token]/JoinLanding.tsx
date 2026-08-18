"use client";

import { useEffect, useState } from "react";

import { supabase } from "@/lib/supabase";

const STORE_IOS = "https://apps.apple.com/app/jaxongirman/id0000000000";
const STORE_ANDROID = "https://play.google.com/store/apps/details?id=uz.jaxongirman.app";
const CONTINUATION_KEY = "jaxongirman:pending-join";

type Platform = "ios" | "android" | "other";

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "other";
  const agent = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(agent) || (agent.includes("Mac") && "ontouchend" in document)) return "ios";
  if (/Android/i.test(agent)) return "android";
  return "other";
}

/* --------------------------------------------------------------- glyphs -- */

/**
 * Drawn rather than typed.
 *
 * This page was a bullseye character and three lines of prose, which is what a
 * form looks like — and somebody arrives here having just pointed a camera at a
 * projector in a room full of people. Icons carry the three steps at a glance,
 * and inline SVG keeps them the page's own colour without a font to wait for.
 */
const Icon = {
  download: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3v11m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  play: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 4.5v15a1 1 0 0 0 1.53.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 6 4.5Z"
        stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  ),
  keypad: (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="3" width="18" height="18" rx="4" stroke="currentColor" strokeWidth="2" />
      <circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" />
      <circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" />
      <circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" />
      <circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" />
    </svg>
  ),
  apple: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.36 12.72c.02 2.6 2.28 3.47 2.3 3.48-.02.06-.36 1.24-1.19 2.46-.72 1.05-1.47 2.1-2.65 2.12-1.16.02-1.53-.69-2.86-.69-1.32 0-1.74.67-2.83.71-1.14.04-2-1.13-2.73-2.18-1.5-2.16-2.64-6.11-1.1-8.78.76-1.32 2.12-2.16 3.6-2.18 1.11-.02 2.17.75 2.85.75.68 0 1.96-.93 3.3-.79.56.02 2.14.23 3.15 1.71-.08.05-1.88 1.1-1.86 3.29M14.2 4.87c.6-.73 1.01-1.75.9-2.76-.87.03-1.92.58-2.55 1.31-.56.64-1.05 1.68-.92 2.67.97.07 1.96-.49 2.57-1.22" />
    </svg>
  ),
  android: (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.6 20.5V9.9a1.2 1.2 0 0 1 2.4 0v10.6a1.2 1.2 0 0 1-2.4 0m14.4 0V9.9a1.2 1.2 0 0 1 2.4 0v10.6a1.2 1.2 0 0 1-2.4 0M7.2 9.4h9.6v10.2a1.2 1.2 0 0 1-1.2 1.2h-.6v2a1.2 1.2 0 0 1-2.4 0v-2h-1.2v2a1.2 1.2 0 0 1-2.4 0v-2h-.6a1.2 1.2 0 0 1-1.2-1.2zM7.4 8.2a4.7 4.7 0 0 1 2.2-3.5l-.9-1.4a.3.3 0 0 1 .5-.3l.94 1.45a5.5 5.5 0 0 1 3.72 0l.94-1.45a.3.3 0 0 1 .5.3l-.9 1.4a4.7 4.7 0 0 1 2.2 3.5zm2.5-2.1a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2m4.2 0a.6.6 0 1 0 0-1.2.6.6 0 0 0 0 1.2" />
    </svg>
  ),
};

/**
 * The page a scanned join QR lands on when the app is not what opened it.
 *
 * The QR is a plain `https://` URL, so a phone with Jaxongirman installed never
 * reaches this component at all — the OS hands the URL to the app through the
 * Universal Link / App Link association. Everyone else gets this: the right
 * store button for their device, and the join code in large type as the fallback
 * that always works.
 *
 * The token is remembered in localStorage before the store link is followed.
 * Neither iOS nor Android guarantees that an install started from a web page
 * hands the original URL to the freshly installed app — so the code on screen
 * is the promise, and the stored token is the convenience: a person who returns
 * to this page in the same browser is taken straight back into the room.
 */
export function JoinLanding({ token }: { token: string }) {
  const [platform, setPlatform] = useState<Platform>("other");
  const [code, setCode] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [state, setState] = useState<"loading" | "live" | "gone">("loading");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setPlatform(detectPlatform()); }, []);

  useEffect(() => {
    // Holding the token is the authorisation, and what comes back is only what
    // is already painted on the projector this reader is standing in front of:
    // the game's name and the join code. Nothing about the host, the roster or
    // the reward plan is reachable this way.
    void (async () => {
      const { data, error } = await supabase.rpc("game_join_info", { p_join_token: token });
      if (error || !data) { setState("gone"); return; }
      const info = data as unknown as { join_code: string; open: boolean; game_title: string };
      setCode(info.join_code);
      setTitle(info.game_title);
      setState(info.open ? "live" : "gone");
    })();
  }, [token]);

  function remember() {
    try {
      window.localStorage.setItem(CONTINUATION_KEY, JSON.stringify({ token, at: Date.now() }));
    } catch {
      // A browser with storage disabled still has the code on screen.
    }
  }

  async function copyCode() {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Copying is the convenience; the code is on screen either way.
    }
  }

  const steps = [
    { icon: Icon.download, title: "Ilovani o‘rnating", body: "Jaxongirman — App Store yoki Google Play" },
    { icon: Icon.play, title: "O‘yingoh bo‘limini oching", body: "Pastdagi menyudan" },
    { icon: Icon.keypad, title: "Kodni kiriting", body: "Yuqoridagi olti raqam" },
  ];

  return (
    <main className="join-page">
      {/* Two slow blooms behind the card. The room this is scanned in is lit
          and loud; a flat white page reads as an error message. */}
      <span className="join-glow one" aria-hidden />
      <span className="join-glow two" aria-hidden />

      <div className="join-shell">
        <div className="join-panel">
          <span className={`join-status${state === "live" ? " is-live" : ""}`}>
            <i aria-hidden />
            {state === "live" ? "O‘yin ochiq" : state === "loading" ? "Tekshirilmoqda" : "Yopilgan"}
          </span>

          <p className="join-eyebrow">JAXONGIRMAN O‘YINGOH</p>
          <h1 className="join-title">{title || "O‘yinga qo‘shilish"}</h1>

          {state === "gone" ? (
            <p className="join-lede">
              Bu o&lsquo;yin yakunlangan yoki havola eskirgan. Boshlovchidan yangi QR kod
              yoki kod so&lsquo;rang.
            </p>
          ) : (
            <>
              {code ? (
                <button className="join-code" type="button" onClick={() => void copyCode()}>
                  <span className="join-code-label">{copied ? "Nusxalandi" : "Qo‘shilish kodi"}</span>
                  <span className="join-code-digits">{code.replace(/(\d{3})(\d{3})/, "$1 $2")}</span>
                  <span className="join-code-hint">Nusxalash uchun bosing</span>
                </button>
              ) : (
                <div className="join-code is-loading" aria-hidden>
                  <span className="join-code-label">Qo‘shilish kodi</span>
                  <span className="join-code-digits">• • •&nbsp;&nbsp;• • •</span>
                </div>
              )}

              <ol className="join-steps">
                {steps.map((step, index) => (
                  <li key={step.title} style={{ animationDelay: `${index * 90}ms` }}>
                    <span className="join-step-icon">{step.icon}</span>
                    <span className="join-step-text">
                      <strong>{step.title}</strong>
                      <small>{step.body}</small>
                    </span>
                    <span className="join-step-number">{index + 1}</span>
                  </li>
                ))}
              </ol>

              <div className="join-stores">
                {platform !== "android" ? (
                  <a className="join-store" href={STORE_IOS} onClick={remember} rel="noopener">
                    {Icon.apple}
                    <span><small>Yuklab olish</small><strong>App Store</strong></span>
                  </a>
                ) : null}
                {platform !== "ios" ? (
                  <a className="join-store" href={STORE_ANDROID} onClick={remember} rel="noopener">
                    {Icon.android}
                    <span><small>Yuklab olish</small><strong>Google Play</strong></span>
                  </a>
                ) : null}
              </div>

              <p className="join-note">
                Ilova o&lsquo;rnatilgan bo&lsquo;lsa-da ochilmadimi? Kodni qo&lsquo;lda kiritish
                har doim ishlaydi.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
