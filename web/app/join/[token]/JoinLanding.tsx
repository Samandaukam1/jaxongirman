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

  return (
    <main className="notice-page">
      <div className="shell">
        <div className="notice-card join-card">
          <div className="glyph" style={{ margin: "0 auto" }}>◎</div>
          <h1>{title || "O‘yinga qo‘shilish"}</h1>

          {state === "gone" ? (
            <p>Bu o&lsquo;yin yakunlangan yoki havola eskirgan. Boshlovchidan yangi QR kod yoki kod so&lsquo;rang.</p>
          ) : (
            <>
              <p>
                O&lsquo;yinga qo&lsquo;shilish uchun Jaxongirman ilovasi kerak. Ilova o&lsquo;rnatilgan
                bo&lsquo;lsa, bu havola uni o&lsquo;zi ochadi.
              </p>

              {code ? (
                <>
                  <span className="join-code-box">{code.replace(/(\d{3})(\d{3})/, "$1 $2")}</span>
                  <ol className="join-steps">
                    <li>Jaxongirman ilovasini o&lsquo;rnatib, hisobingizga kiring</li>
                    <li><strong>O&lsquo;yingoh</strong> bo&lsquo;limini oching</li>
                    <li><strong>O&lsquo;yinga qo&lsquo;shilish</strong> → yuqoridagi kodni kiriting</li>
                  </ol>
                </>
              ) : state === "loading" ? (
                <p className="store-note">Kod yuklanmoqda…</p>
              ) : null}

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
                Ilova o&lsquo;rnatilgan bo&lsquo;lsa-da ochilmadimi? Ilovadagi <strong>O&lsquo;yingoh</strong> bo&lsquo;limidan
                kodni qo&lsquo;lda kiritish har doim ishlaydi.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
