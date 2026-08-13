"use client";

import {
  RESET_PRESENTATION_VIEWPORT,
  SLIDE_MODEL_HEIGHT,
  SLIDE_MODEL_WIDTH,
  clampPresentationViewport,
  type PresentationScreenDeck,
  type PresentationViewport,
  type RenderableSlide,
  type RenderableSlideElement,
} from "@jaxongirman/types";
import { ChevronLeft, ChevronRight, Maximize, Minimize, RotateCw } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { experienceFromRow, type QrExperience } from "@/lib/qr-experience";
import { pairUrl } from "@/lib/public-url";
import { supabase } from "@/lib/supabase";

import { QrVideoExperience } from "@/app/_qr/QrVideoExperience";

import { ArenaScreen } from "@/app/oyingoh/ArenaScreen";

import { WebSlideCanvas } from "./SlideRenderer";

const ROTATE_MS = 30_000;
/** How long the "finished" notice stays up before the next code appears. */
const RECYCLE_MS = 4_000;

type Session = {
  id: string;
  status: "pairing" | "active" | "ended" | "expired";
  current_slide: number;
  slide_count: number;
  zoom: number;
  translate_x?: number;
  translate_y?: number;
  state_version?: number;
  deck_revision?: number;
};

type OpenedSession = {
  session_id: string;
  token: string;
  screen_token: string;
  realtime_token: string;
};

type ViewportMessage = {
  scale: number;
  translate_x: number;
  translate_y: number;
  slide: number;
};

function viewportOf(session: Session): PresentationViewport {
  return clampPresentationViewport({
    scale: session.zoom,
    translateX: session.translate_x ?? 0,
    translateY: session.translate_y ?? 0,
  });
}

function viewportMessage(value: unknown): ViewportMessage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const scale = Number(row.scale);
  const translateX = Number(row.translate_x);
  const translateY = Number(row.translate_y);
  const slide = Number(row.slide);
  if (![scale, translateX, translateY, slide].every(Number.isFinite)) return null;
  const safe = clampPresentationViewport({ scale, translateX, translateY });
  return { scale: safe.scale, translate_x: safe.translateX, translate_y: safe.translateY, slide };
}

function screenDeck(value: unknown): PresentationScreenDeck | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const nested = root.presentation && typeof root.presentation === "object" && !Array.isArray(root.presentation)
    ? root.presentation as Record<string, unknown>
    : null;
  const slides = root.slides;
  const elements = root.elements;
  if (!Array.isArray(slides) || !Array.isArray(elements)) return null;
  const title = typeof root.title === "string" ? root.title : typeof nested?.title === "string" ? nested.title : "Taqdimot";
  return {
    title,
    slides: slides as RenderableSlide[],
    elements: elements as RenderableSlideElement[],
  };
}

function imageUrls(deck: PresentationScreenDeck, slidePositions: number[]): string[] {
  const ids = new Set(deck.slides.filter((slide) => slidePositions.includes(slide.position)).map((slide) => slide.id));
  const urls: string[] = [];
  for (const element of deck.elements) {
    if (element.type !== "image" || !ids.has(element.slide_id) || !element.content || typeof element.content !== "object" || Array.isArray(element.content)) continue;
    const content = element.content as Record<string, unknown>;
    const uri = content.signedUrl ?? content.url ?? content.uri;
    if (typeof uri === "string") urls.push(uri);
  }
  return urls;
}

export function PairingScreen({ experienceRow }: { experienceRow: unknown | null }) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [screenToken, setScreenToken] = useState<string | null>(null);
  const [realtimeToken, setRealtimeToken] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  // Decided on the server, so the first paint is already the film — not the
  // pairing card with the film arriving a moment later.
  const [experience, setExperience] = useState<QrExperience | null>(() => experienceFromRow(experienceRow));
  const [session, setSession] = useState<Session | null>(null);
  const [deck, setDeck] = useState<PresentationScreenDeck | null>(null);
  const [viewport, setViewport] = useState<PresentationViewport>({ ...RESET_PRESENTATION_VIEWPORT });
  const [fitScale, setFitScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [deckError, setDeckError] = useState<string | null>(null);
  const [deckLoading, setDeckLoading] = useState(false);
  const [databaseConnected, setDatabaseConnected] = useState(false);
  const [broadcastConnected, setBroadcastConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  /**
   * Set when the paired phone launches O‘yingoh. The new match's screen
   * capability arrives on the same private channel this screen already follows,
   * which is why the projector can authorise its own game reads without anybody
   * signing in on it.
   */
  const [handoff, setHandoff] = useState<{ sessionId: string; screenToken: string } | null>(null);
  const rotating = useRef(false);
  const currentToken = useRef<string | null>(null);
  const sessionRef = useRef<Session | null>(null);
  const mounted = useRef(true);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const connected = databaseConnected && (!realtimeToken || broadcastConnected);

  useEffect(() => { sessionRef.current = session; }, [session]);

  const drawToken = useCallback(async (next: string) => {
    currentToken.current = next;
    setToken(next);
    const value = `jaxongirman://pair/${next}`;
    setQr(await QRCode.toDataURL(value, { errorCorrectionLevel: "M", margin: 1, width: 520 }));
  }, []);

  /**
   * Opens a session and shows its code, from nothing.
   *
   * Used on load and again after a talk ends, so the projector recycles itself:
   * a session is finished and unclaimable once it is `ended`, and the next
   * presenter needs a fresh code rather than someone finding the keyboard.
   */
  const openSession = useCallback(async () => {
    mounted.current = true;
    setSessionId(null);
    setScreenToken(null);
    setRealtimeToken(null);
    setSession(null);
    setToken(null);
    setDeck(null);
    setDeckError(null);
    setError(null);
    setQr(null);
    setViewport({ ...RESET_PRESENTATION_VIEWPORT });
    sessionRef.current = null;
    currentToken.current = null;

    const { data, error: openError } = await supabase.rpc("presentation_session_open");
    if (!mounted.current) return;
    if (openError) {
      console.error("presentation_session_open failed", openError);
      setError("Sessiya ochilmadi. Sahifani yangilang — muammo takrorlansa, biroz kutib qayta urinib ko‘ring.");
      return;
    }
    const payload = data as unknown as OpenedSession;
    if (!payload.screen_token || !payload.realtime_token) {
      setError("Sessiya xavfsiz ochilmadi. Sahifani yangilab qayta urinib ko‘ring.");
      return;
    }
    setSessionId(payload.session_id);
    setScreenToken(payload.screen_token);
    setRealtimeToken(payload.realtime_token);
    await drawToken(payload.token);
  }, [drawToken]);

  useEffect(() => {
    void openSession();
    return () => { mounted.current = false; };
  }, [openSession]);

  // The phone ending the talk is what closes the screen too. The notice is held
  // long enough to read, then the projector goes back to a code so the next
  // person can simply walk up and scan it.
  useEffect(() => {
    if (session?.status !== "ended" && session?.status !== "expired") return;
    const timer = setTimeout(() => { void openSession(); }, RECYCLE_MS);
    return () => clearTimeout(timer);
  }, [openSession, session?.status]);

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
    let subscribed = true;
    setDatabaseConnected(false);
    const channel = supabase
      .channel(`presentation-session-${sessionId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "presentation_sessions", filter: `id=eq.${sessionId}` },
        (payload) => {
          const next = payload.new as Session;
          if (sessionRef.current?.deck_revision !== undefined
            && next.deck_revision !== sessionRef.current.deck_revision) {
            setDeck(null);
            setDeckError(null);
          }
          setSession(next);
          setViewport(viewportOf(next));
        })
      .subscribe((status) => {
        if (!subscribed) return;
        setDatabaseConnected(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") {
          if (screenToken) {
            void supabase.rpc("presentation_screen_snapshot", {
              p_session_id: sessionId,
              p_screen_token: screenToken,
            }).then(({ data, error: snapshotError }) => {
              if (snapshotError || !data) {
                if (snapshotError) console.error("presentation_screen_snapshot failed", snapshotError);
                return;
              }
              const next = data as unknown as Session;
              if (sessionRef.current?.deck_revision !== undefined
                && next.deck_revision !== sessionRef.current.deck_revision) {
                setDeck(null);
                setDeckError(null);
              }
              setSession(next);
              setViewport(viewportOf(next));
            });
          }
        }
      });
    return () => {
      subscribed = false;
      void supabase.removeChannel(channel);
    };
  }, [screenToken, sessionId]);

  useEffect(() => {
    if (!realtimeToken) return;
    let subscribed = true;
    setBroadcastConnected(false);
    const channel = supabase
      .channel(`presentation-viewport:${realtimeToken}`, { config: { broadcast: { self: false } } })
      .on("broadcast", { event: "viewport" }, ({ payload }) => {
        const message = viewportMessage(payload);
        if (!message || message.slide !== sessionRef.current?.current_slide) return;
        setViewport({ scale: message.scale, translateX: message.translate_x, translateY: message.translate_y });
      })
      .on("broadcast", { event: "oyingoh" }, ({ payload }) => {
        const message = payload as { session_id?: unknown; screen_token?: unknown } | null;
        if (typeof message?.session_id !== "string" || typeof message?.screen_token !== "string") return;
        setHandoff({ sessionId: message.session_id, screenToken: message.screen_token });
      })
      .subscribe((status) => {
        if (subscribed) setBroadcastConnected(status === "SUBSCRIBED");
      });
    return () => {
      subscribed = false;
      void supabase.removeChannel(channel);
    };
  }, [realtimeToken]);

  const loadDeck = useCallback(async () => {
    if (!sessionId || !screenToken) return;
    setDeckLoading(true);
    setDeckError(null);
    try {
      const { data, error: functionError } = await supabase.functions.invoke("presentation-screen-data", {
        body: { sessionId, screenToken },
      });
      if (functionError) throw functionError;
      const parsed = screenDeck(data);
      if (!parsed) throw new Error("Invalid presentation-screen-data response");
      setDeck(parsed);
    } catch (deckFailure) {
      console.error("presentation-screen-data failed", deckFailure);
      setDeck(null);
      setDeckError("Slayd yuklanmadi.");
    } finally {
      setDeckLoading(false);
    }
  }, [screenToken, sessionId]);

  useEffect(() => {
    if (session?.status !== "active" || session.slide_count < 1 || deck || deckLoading || deckError) return;
    void loadDeck();
  }, [deck, deckError, deckLoading, loadDeck, session?.slide_count, session?.status]);

  // Signed image URLs are short lived. Refresh them before the one-hour links
  // expire without refetching on ordinary slide changes.
  useEffect(() => {
    if (!deck) return;
    const timer = setTimeout(() => void loadDeck(), 50 * 60 * 1000);
    return () => clearTimeout(timer);
  }, [deck, loadDeck]);

  const currentSlide = useMemo(
    () => deck?.slides.find((slide) => slide.position === session?.current_slide) ?? null,
    [deck, session?.current_slide],
  );
  const currentElements = useMemo(
    () => currentSlide ? deck?.elements.filter((element) => element.slide_id === currentSlide.id) ?? [] : [],
    [currentSlide, deck],
  );

  useEffect(() => {
    if (!deck || !session) return;
    for (const url of imageUrls(deck, [session.current_slide - 1, session.current_slide, session.current_slide + 1])) {
      const image = new window.Image();
      image.src = url;
    }
  }, [deck, session]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const resize = () => setFitScale(Math.min(
      stage.clientWidth / SLIDE_MODEL_WIDTH,
      stage.clientHeight / SLIDE_MODEL_HEIGHT,
    ));
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [currentSlide]);

  const active = session?.status === "active";
  useEffect(() => {
    document.body.classList.toggle("presentation-live", active);
    return () => document.body.classList.remove("presentation-live");
  }, [active]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  const command = useCallback(async (name: "next" | "previous" | "goto", value?: number) => {
    if (!sessionId || !screenToken) return;
    const { data, error: commandError } = await supabase.rpc("presentation_screen_command", {
      p_session_id: sessionId,
      p_screen_token: screenToken,
      p_command: name,
      p_value: value,
    });
    if (commandError) {
      console.error("presentation_screen_command failed", commandError);
      setError("Slayd almashtirilmadi. Ulanish tiklangach qayta urinib ko‘ring.");
    } else if (data) {
      const next = data as unknown as Session;
      setError(null);
      setSession(next);
      setViewport(viewportOf(next));
    }
  }, [screenToken, sessionId]);

  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "ArrowRight") {
        event.preventDefault();
        void command("next");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void command("previous");
      } else if (event.key === "Escape" && document.fullscreenElement) {
        void document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [active, command]);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (fullscreenError) {
      console.error("fullscreen request failed", fullscreenError);
      setError("To‘liq ekran ochilmadi. Brauzer ruxsatini tekshirib qayta urinib ko‘ring.");
    }
  }

  // The talk is over and the room is playing: the same projector, a different
  // show. Rendered before every other branch so an expiring presentation
  // session cannot pull the match off the screen.
  if (handoff) {
    return <ArenaScreen handoff={handoff} />;
  }

  if (error && !active) {
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

  if (active) {
    return (
      <main className="presentation-stage">
        {!connected ? <div className="presentation-connection">Ulanish uzildi. Qayta ulanmoqda...</div> : null}
        {session.slide_count < 1 ? (
          <div className="presentation-waiting">
            <RotateCw aria-hidden />
            <h1>Taqdimot tanlanmoqda</h1>
            <p>Telefoningizdan ko‘rsatmoqchi bo‘lgan taqdimotni tanlang.</p>
          </div>
        ) : deckLoading ? (
          <div className="presentation-waiting"><span className="presentation-spinner" /><p>Slayd yuklanmoqda…</p></div>
        ) : deckError || !deck || !currentSlide ? (
          <div className="presentation-waiting">
            <h1>Slayd yuklanmadi</h1>
            <button className="store-button" type="button" onClick={() => void loadDeck()}>Qayta urinish</button>
          </div>
        ) : (
          <div className="presentation-slide-wrap" ref={stageRef}>
            <div className="presentation-fit" style={{ transform: `scale(${fitScale})` }}>
              <div className="presentation-translate" style={{ transform: `translate(${viewport.translateX}px, ${viewport.translateY}px)` }}>
                <div className="presentation-zoom" style={{ transform: `scale(${viewport.scale})` }}>
                  <WebSlideCanvas slide={currentSlide} elements={currentElements} />
                </div>
              </div>
            </div>
          </div>
        )}

        {session.slide_count > 0 ? (
          <div className="presentation-overlay">
            <button aria-label="Oldingi slayd" disabled={session.current_slide <= 0} onClick={() => void command("previous")} type="button"><ChevronLeft aria-hidden /></button>
            <span>{session.current_slide + 1} / {session.slide_count}</span>
            <button aria-label="Keyingi slayd" disabled={session.current_slide >= session.slide_count - 1} onClick={() => void command("next")} type="button"><ChevronRight aria-hidden /></button>
          </div>
        ) : null}
        <button className="presentation-fullscreen" aria-label={fullscreen ? "To‘liq ekrandan chiqish" : "To‘liq ekran"} onClick={() => void toggleFullscreen()} type="button">
          {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
        </button>
        {error ? <div className="presentation-command-error">{error}</div> : null}
      </main>
    );
  }

  if (session?.status === "ended" || session?.status === "expired") {
    return (
      <main className="notice-page">
        <div className="shell"><div className="notice-card">
          <h1>Taqdimot yakunlandi</h1>
          <p>Yangi QR kod tayyorlanmoqda — keyingi taqdimotchi uni skaner qilishi kifoya.</p>
          <div className="store-row"><button className="store-button" type="button" onClick={() => void openSession()}>Hoziroq yangi kod</button></div>
        </div></div>
      </main>
    );
  }

  // The cinematic pairing screen, when an admin has published one. It stands in
  // for the card below and nothing else: the session, the rotating token and
  // the realtime subscription that notices the phone are the same ones the
  // plain screen uses, so a surface that is switched off changes nothing.
  // The token arrives from an RPC a moment after the page does, and waiting for
  // it here meant rendering the old pairing card in the meantime — on the
  // server too, so the flash was baked into the first HTML. A published
  // experience takes the screen immediately and simply has no code to draw yet.
  if (experience) {
    return (
      <main className="qrx-page">
        <QrVideoExperience
          experience={experience}
          qrValue={token ? pairUrl(token) : null}
          onUnavailable={(reason) => {
            // Dropping the experience re-renders the pairing card below with the
            // same live session, so the room can still pair.
            console.error("QR video experience unavailable", reason);
            setExperience(null);
          }}
        >
          <p className="eyebrow">TAQDIMOT PULTI</p>
          <h1>Telefoningizni ulang</h1>
          <ol>
            <li>Jaxongirman ilovasini oching</li>
            <li>&ldquo;Loyihalar&rdquo; sahifasida <strong>Taqdimot qilish</strong> tugmasini bosing</li>
            <li>Ekrandagi kodni skaner qiling</li>
          </ol>
          <p>Kod har 30 soniyada yangilanadi va faqat bir marta ishlaydi.</p>
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
          <p className="eyebrow">TAQDIMOT PULTI</p>
          <h1>Telefoningizni ulang</h1>
          <ol className="pair-steps">
            <li>Jaxongirman ilovasini oching</li>
            <li>&ldquo;Loyihalar&rdquo; sahifasida <strong>Taqdimot qilish</strong> tugmasini bosing</li>
            <li>Shu ekrandagi kodni skaner qiling</li>
          </ol>
          <p className="pair-note">Kod har 30 soniyada yangilanadi va faqat bir marta ishlaydi — ekranning surati bilan hech kim ulanolmaydi.</p>
        </div>
        <div className="pair-qr">
          {qr ? (
            <img src={qr} alt="Ulanish uchun QR kod" width={320} height={320} />
          ) : <div className="pair-qr-skeleton" />}
        </div>
      </div>
    </main>
  );
}
