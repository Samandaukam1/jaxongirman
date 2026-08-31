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

const Icon = {
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

type Candidate = {
  user_id: string;
  username: string | null;
  full_name: string | null;
  avatar_url: string | null;
  campaign_title: string;
  poster_path: string | null;
  ends_at: string;
  server_now: string;
};

/** Two letters, from whichever name the account actually has. */
function initialsOf(candidate: Candidate): string {
  const source = (candidate.full_name ?? candidate.username ?? "?").trim();
  const parts = source.split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : source.slice(0, 2)).toUpperCase();
}

/**
 * "18 kun 04 soat qoldi", counted from the server's clock rather than this one.
 *
 * The answer carries the moment it was read, so a laptop whose date is wrong
 * does not get its own deadline. Hours below a day, days above it — nobody
 * standing at a poster needs seconds.
 */
function remaining(candidate: Candidate): string {
  const skew = new Date(candidate.server_now).getTime() - Date.now();
  const left = new Date(candidate.ends_at).getTime() - (Date.now() + skew);
  if (!Number.isFinite(left) || left <= 0) return "Marafon yakunlangan";
  const days = Math.floor(left / 86_400_000);
  const hours = Math.floor((left % 86_400_000) / 3_600_000);
  return days > 0 ? `${days} kun ${hours} soat qoldi` : `${hours} soat qoldi`;
}

/**
 * The page a scanned candidate QR lands on when the app is not what opened it.
 *
 * It names the person before it asks for anything: somebody who just pointed a
 * camera at a friend's phone wants to see that friend's name, not a store
 * button and a promise. The deep link is offered first — a phone that has the
 * app but did not hand the URL over still gets there in one tap — and the
 * stores are the fallback beneath it.
 */
export function MarathonLanding({ campaignId, candidateId }: { campaignId: string; candidateId: string }) {
  const [platform, setPlatform] = useState<Platform>("other");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [state, setState] = useState<"loading" | "live" | "gone">("loading");

  useEffect(() => { setPlatform(detectPlatform()); }, []);

  useEffect(() => {
    void (async () => {
      const { data, error } = await supabase.rpc("marathon_candidate", {
        p_campaign_id: campaignId,
        p_user_id: candidateId,
      });
      if (error || !data) { setState("gone"); return; }
      setCandidate(data as unknown as Candidate);
      setState("live");
    })();
  }, [campaignId, candidateId]);

  const appLink = `jaxongirman://marathon/${campaignId}/${candidateId}`;

  return (
    <main className="join-page">
      <span className="join-glow one" aria-hidden />
      <span className="join-glow two" aria-hidden />

      <div className="join-shell">
        <div className="join-panel">
          <span className={`join-status${state === "live" ? " is-live" : ""}`}>
            <i aria-hidden />
            {state === "live" ? "Marafon davom etmoqda" : state === "loading" ? "Tekshirilmoqda" : "Yakunlangan"}
          </span>

          <p className="join-eyebrow">{candidate?.campaign_title?.toUpperCase() ?? "TALABALAR MARAFONI"}</p>

          {state === "gone" ? (
            <>
              <h1 className="join-title">Havola eskirgan</h1>
              <p className="join-lede">
                Bu marafon yakunlangan yoki havola boshqa amal qilmaydi. Ishtirokchidan
                yangi havola so&lsquo;rang.
              </p>
            </>
          ) : (
            <>
              <div className="marathon-person">
                {candidate?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a Supabase avatar URL, not a bundled asset
                  <img className="marathon-avatar" src={candidate.avatar_url} alt="" />
                ) : (
                  <span className="marathon-avatar is-initials">{candidate ? initialsOf(candidate) : "…"}</span>
                )}
                <h1 className="join-title">{candidate?.full_name ?? "Ishtirokchi"}</h1>
                {candidate?.username ? <p className="marathon-handle">@{candidate.username}</p> : null}
              </div>

              <p className="join-lede">
                Ovoz berish uchun Jaxongirman ilovasini oching — ovozingiz to&lsquo;g&lsquo;ridan-to&lsquo;g&lsquo;ri
                shu ishtirokchiga yoziladi.
              </p>

              {candidate ? <p className="marathon-clock">{remaining(candidate)}</p> : null}

              <a className="marathon-open" href={appLink}>Ilovada ochish</a>

              <div className="join-stores">
                {platform !== "android" ? (
                  <a className="join-store" href={STORE_IOS} rel="noopener">
                    {Icon.apple}
                    <span><small>Yuklab olish</small><strong>App Store</strong></span>
                  </a>
                ) : null}
                {platform !== "ios" ? (
                  <a className="join-store" href={STORE_ANDROID} rel="noopener">
                    {Icon.android}
                    <span><small>Yuklab olish</small><strong>Google Play</strong></span>
                  </a>
                ) : null}
              </div>

              <p className="join-note">
                Ilovani o&lsquo;rnatgach shu havolani qaytadan oching — ovoz berish sahifasi
                o&lsquo;zi ochiladi.
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
