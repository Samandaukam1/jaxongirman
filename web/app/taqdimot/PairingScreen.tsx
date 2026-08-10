"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";

import { supabase } from "@/lib/supabase";

/** The code lives 45 seconds; refresh a little before it dies. */
const ROTATE_MS = 30_000;

type Session = {
  id: string;
  status: "pairing" | "active" | "ended" | "expired";
  current_slide: number;
  slide_count: number;
  zoom: number;
};

/**
 * The projector's half of the remote.
 *
 * This browser is signed out and stays that way: it opens a session, shows a
 * rotating code, and then follows one database row. Everything that can change
 * the presentation happens on the paired phone, so nothing here needs — or
 * has — the authority to move a slide.
 */
export function PairingScreen() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rotating = useRef(false);
  // The server will only replace the code we can prove we are showing, so the
  // live one is kept here rather than being re-read from the row.
  const currentToken = useRef<string | null>(null);

  const drawToken = useCallback(async (token: string) => {
    currentToken.current = token;
    // The deep link is what the phone's camera resolves; our in-app scanner
    // reads the same string and pulls the token out of it.
    const value = `jaxongirman://pair/${token}`;
    setQr(await QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 520 }));
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const { data, error: openError } = await supabase.rpc("presentation_session_open");
      if (!active) return;
      if (openError) {
        // The visitor is shown something they can act on; the transport's own
        // wording ("Expected 3 parts in JWT") describes a misconfiguration on
        // our side and means nothing to the person standing at the projector.
        console.error("presentation_session_open failed", openError);
        setError("Sessiya ochilmadi. Sahifani yangilang — muammo takrorlansa, biroz kutib qayta urinib ko‘ring.");
        return;
      }
      const payload = data as unknown as { session_id: string; token: string };
      setSessionId(payload.session_id);
      await drawToken(payload.token);
    })();
    return () => { active = false; };
  }, [drawToken]);

  // Rotation stops the moment a phone claims the session: there is nothing left
  // to pair, and a live code would only be a loose end.
  useEffect(() => {
    if (!sessionId || session?.status === "active") return;
    const timer = setInterval(() => {
      if (rotating.current || !currentToken.current) return;
      rotating.current = true;
      void (async () => {
        try {
          const { data, error: rotateError } = await supabase.rpc("presentation_pairing_rotate", {
            p_session_id: sessionId,
            p_current_token: currentToken.current as string,
          });
          if (!rotateError && data) await drawToken((data as unknown as { token: string }).token);
        } finally {
          rotating.current = false;
        }
      })();
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [drawToken, session?.status, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    const channel = supabase
      .channel(`presentation-${sessionId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "presentation_sessions", filter: `id=eq.${sessionId}` },
        (payload) => setSession(payload.new as Session))
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [sessionId]);

  if (error) {
    return (
      <main className="notice-page">
        <div className="shell"><div className="notice-card">
          <h1>Sessiya ochilmadi</h1>
          <p>{error}</p>
          <div className="store-row"><a className="store-button ghost" href="/">Bosh sahifa</a></div>
        </div></div>
      </main>
    );
  }

  if (session?.status === "active") {
    return (
      <main className="stage">
        <div className="stage-inner" style={{ transform: `scale(${session.zoom})` }}>
          <p className="stage-eyebrow">JAXONGIRMAN</p>
          <p className="stage-slide">
            {session.slide_count > 0 ? `${session.current_slide + 1} / ${session.slide_count}` : "Taqdimot tanlanmoqda"}
          </p>
          <p className="stage-hint">Telefoningiz pult sifatida ulangan.</p>
        </div>
      </main>
    );
  }

  if (session?.status === "ended" || session?.status === "expired") {
    return (
      <main className="notice-page">
        <div className="shell"><div className="notice-card">
          <h1>Taqdimot yakunlandi</h1>
          <p>Sessiya yopildi. Yangi taqdimot uchun sahifani yangilang.</p>
          <div className="store-row">
            <button className="store-button" type="button" onClick={() => window.location.reload()}>
              Yangi sessiya
            </button>
          </div>
        </div></div>
      </main>
    );
  }

  return (
    <main className="pair-page">
      <div className="hero-orb one" aria-hidden />
      <div className="hero-orb two" aria-hidden />
      <div className="shell pair-shell">
        <div className="pair-copy">
          <p className="eyebrow">TAQDIMOT PULTI</p>
          <h1>Telefoningizni ulang</h1>
          <ol className="pair-steps">
            <li>Jaxongirman ilovasini oching</li>
            <li>&ldquo;Loyihalar&rdquo; sahifasida <strong>Taqdimot qilish</strong> tugmasini bosing</li>
            <li>Shu ekrandagi kodni skaner qiling</li>
          </ol>
          <p className="pair-note">
            Kod har 30 soniyada yangilanadi va faqat bir marta ishlaydi — ekranning surati bilan
            hech kim ulanolmaydi.
          </p>
        </div>

        <div className="pair-qr">
          {qr ? (
            // A data: URL from the QR encoder, not a remote asset — next/image
            // would only add a loader in front of bytes we already hold.
            <img src={qr} alt="Ulanish uchun QR kod" width={320} height={320} />
          ) : (
            <div className="pair-qr-skeleton" />
          )}
        </div>
      </div>
    </main>
  );
}
