"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { QrVideoExperience } from "@/app/_qr/QrVideoExperience";
import { webLoginUrl } from "@/lib/public-url";
import { experienceFromRow, type QrExperience } from "@/lib/qr-experience";
import { supabase } from "@/lib/supabase";

type Request = { session_id: string; token: string; secret: string; expires_at: string };
type Collected = { status: "pending" | "approved" | "used" | "expired" | "unknown"; token_hash?: string };

const POLL_MS = 1500;

/**
 * Signing in with the phone.
 *
 * The page opens a request and shows its code — after the same film the
 * presenting screen plays, the hand bringing the code in. The phone reads it
 * from Profil → "Web ulash" and allows it; this page, which alone holds the
 * request's secret, then collects a one-time hash and exchanges it for a
 * session. A code lives three minutes and is replaced on its own when it
 * runs out, so a page left open always shows one that works.
 */
export function SignInScreen({ experienceRow }: { experienceRow: unknown | null }) {
  const [experience, setExperience] = useState<QrExperience | null>(() => experienceFromRow(experienceRow));
  const [request, setRequest] = useState<Request | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [state, setState] = useState<"waiting" | "signing-in">("waiting");
  const [error, setError] = useState<string | null>(null);
  const opening = useRef(false);

  const open = useCallback(async () => {
    if (opening.current) return;
    opening.current = true;
    try {
      const { data, error: openError } = await supabase.rpc("web_sign_in_open", { p_user_agent: navigator.userAgent });
      if (openError || !data) throw openError ?? new Error("no request");
      const next = data as unknown as Request;
      setRequest(next);
      setError(null);
      setQr(await QRCode.toDataURL(webLoginUrl(next.token), { errorCorrectionLevel: "M", margin: 1, width: 520 }));
    } catch (failure) {
      console.error("web_sign_in_open failed", failure);
      setError("Kirish kodi ochilmadi. Sahifani yangilang — muammo takrorlansa, biroz kutib qayta urinib ko‘ring.");
    } finally {
      opening.current = false;
    }
  }, []);

  // Already signed in here: straight to the account.
  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) window.location.replace("/hisob");
      else void open();
    });
  }, [open]);

  useEffect(() => {
    if (!request || state !== "waiting") return;
    let alive = true;
    const timer = setInterval(() => {
      void (async () => {
        const { data, error: collectError } = await supabase.rpc("web_sign_in_collect", {
          p_session_id: request.session_id,
          p_secret: request.secret,
        });
        if (!alive || collectError || !data) return;
        const answer = data as unknown as Collected;
        if (answer.status === "approved" && answer.token_hash) {
          setState("signing-in");
          const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: answer.token_hash, type: "email" });
          if (verifyError) {
            console.error("verifyOtp failed", verifyError);
            setError("Kirish yakunlanmadi. Yangi kodni skaner qilib qayta urinib ko‘ring.");
            setState("waiting");
            void open();
            return;
          }
          window.location.replace("/hisob");
        } else if (answer.status !== "pending") {
          void open();
        }
      })();
    }, POLL_MS);
    // A code past its time is replaced without waiting for the server to say so.
    const expiry = setTimeout(() => void open(), Math.max(1000, new Date(request.expires_at).getTime() - Date.now()));
    return () => { alive = false; clearInterval(timer); clearTimeout(expiry); };
  }, [open, request, state]);

  /**
   * The other two ways in, for somebody without the phone at hand: the same
   * Google and Apple accounts the app signs in with. They come back to the
   * account page, which reads the session from the address.
   */
  async function withProvider(provider: "google" | "apple") {
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: `${window.location.origin}/hisob` },
    });
    if (oauthError) setError("Kirish ochilmadi. Birozdan so‘ng qayta urinib ko‘ring.");
  }

  const alternatives = (
    <div className="signin-alt">
      <span className="signin-alt-label">yoki</span>
      <button type="button" className="signin-provider" onClick={() => void withProvider("google")}>
        <svg viewBox="0 0 24 24" aria-hidden width="18" height="18"><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.7Z"/><path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3a7.2 7.2 0 0 1-10.8-3.8h-4v3.1A12 12 0 0 0 12 24Z"/><path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1Z"/><path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1A7.2 7.2 0 0 1 12 4.8Z"/></svg>
        Google bilan kirish
      </button>
      <button type="button" className="signin-provider is-apple" onClick={() => void withProvider("apple")}>
        <svg viewBox="0 0 24 24" aria-hidden width="18" height="18"><path fill="currentColor" d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9a4.8 4.8 0 0 0-3.8-2c-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9a4.9 4.9 0 0 0-4.1 2.5c-1.8 3.1-.5 7.6 1.3 10.1.9 1.2 1.9 2.6 3.2 2.5 1.3 0 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5a11 11 0 0 0 1.4-2.9 4.5 4.5 0 0 1-2.8-3.8ZM13.9 5.2A4.5 4.5 0 0 0 15 1.9a4.6 4.6 0 0 0-3 1.5 4.3 4.3 0 0 0-1.1 3.2c1.1.1 2.3-.6 3-1.4Z"/></svg>
        Apple bilan kirish
      </button>
    </div>
  );

  const steps = (
    <ol>
      <li>Telefoningizda Jaxongirman ilovasini oching</li>
      <li><strong>Profil</strong> → <strong>Web ulash</strong> bo&lsquo;limiga kiring</li>
      <li>Ekrandagi kodni skaner qilib, kirishga ruxsat bering</li>
    </ol>
  );

  if (state === "signing-in") {
    return (
      <main className="signin-page">
        <div className="signin-progress"><span className="presentation-spinner" /><p>Hisobingiz ochilmoqda…</p></div>
      </main>
    );
  }

  if (experience) {
    return (
      <main className="qrx-page">
        <QrVideoExperience
          experience={experience}
          qrValue={request ? webLoginUrl(request.token) : null}
          onUnavailable={(reason) => {
            console.error("QR video experience unavailable", reason);
            setExperience(null);
          }}
        >
          <p className="eyebrow">HISOBGA KIRISH</p>
          <h1>Telefon bilan <em>kiring</em></h1>
          {steps}
          <p>{error ?? "Kod uch daqiqa ishlaydi va o‘zi yangilanadi. Parol kerak emas."}</p>
          {alternatives}
        </QrVideoExperience>
      </main>
    );
  }

  return (
    <main className="pair-page">
      <div className="hero-orb one" aria-hidden />
      <div className="hero-orb two" aria-hidden />
      <div className="shell pair-shell">
        <div className="pair-copy">
          <p className="eyebrow">HISOBGA KIRISH</p>
          <h1>Telefon bilan kiring</h1>
          <div className="pair-steps-list">{steps}</div>
          <p className="pair-note">{error ?? "Kod uch daqiqa ishlaydi va o‘zi yangilanadi. Parol kerak emas — telefoningiz kalit."}</p>
          {alternatives}
        </div>
        <div className="pair-qr">
          {qr ? <img src={qr} alt="Kirish uchun QR kod" width={320} height={320} /> : <div className="pair-qr-skeleton" />}
        </div>
      </div>
    </main>
  );
}
