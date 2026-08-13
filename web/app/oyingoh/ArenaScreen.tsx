"use client";

import { GAME_TYPE_LABELS, type GameQuestionType } from "@jaxongirman/types";
import { Maximize, Minimize } from "lucide-react";
import QRCode from "qrcode";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { joinUrl } from "@/lib/public-url";
import { loadQrExperience, type QrExperience } from "@/lib/qr-experience";
import { gamePairUrl } from "@/lib/public-url";
import { supabase } from "@/lib/supabase";

import { QrVideoExperience } from "@/app/_qr/QrVideoExperience";

import { GameAvatar } from "./GameAvatar";

const ROTATE_MS = 30_000;

type Player = { id: string; nickname: string; avatar_id: number; team: string | null; total_score: number };
type Stats = { answers: number; correct: number; incorrect: number; choices: Record<string, number>; words: Record<string, number> };
type Option = { id: string; text: string };

type Snapshot = {
  /** True once a phone has claimed this screen. */
  paired: boolean;
  /** True once that phone has chosen which game to run. */
  game_selected: boolean;
  status: "lobby" | "countdown" | "question" | "question_result" | "leaderboard" | "finished" | "cancelled" | "expired";
  game_title: string;
  join_token: string;
  join_code: string;
  current_index: number;
  question_count: number;
  phase_deadline: string | null;
  question_started_at: string | null;
  team_mode: boolean;
  player_count: number;
  state_version: number;
  players: Player[];
  answered_count?: number;
  question?: {
    id: string;
    type: GameQuestionType;
    prompt: string;
    time_limit_seconds: number;
    media_path: string | null;
    config: { options?: Option[]; items?: Option[]; left?: Option[]; right?: Option[] };
  };
  reveal?: { config: Record<string, unknown>; explanation: string; stats: Stats };
  leaderboard?: {
    players: { id: string; nickname: string; avatar_id: number; total_score: number; rank: number }[];
    teams: { team: string; total_score: number; players: number }[];
  };
};

/** Answer identity is shape and letter first, colour second. */
const OPTION_STYLES = [
  { color: "#8B54E8", glyph: "▲", letter: "A" },
  { color: "#17B283", glyph: "●", letter: "B" },
  { color: "#E8A13A", glyph: "◆", letter: "C" },
  { color: "#D9455F", glyph: "■", letter: "D" },
  { color: "#12A5BC", glyph: "★", letter: "E" },
  { color: "#E8618C", glyph: "⬢", letter: "F" },
] as const;

function mediaUrl(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  return supabase.storage.from("game-assets").getPublicUrl(path).data.publicUrl;
}

function useCountdown(deadline: string | null): number {
  const [remaining, setRemaining] = useState(0);
  useEffect(() => {
    if (!deadline) { setRemaining(0); return; }
    const target = new Date(deadline).getTime();
    const tick = () => setRemaining(Math.max(0, Math.ceil((target - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [deadline]);
  return remaining;
}

/**
 * The projector.
 *
 * Two capabilities, both handed over exactly once and never stored in a
 * database column the browser can read: the pairing token in the first QR
 * (which the host's phone consumes to take the match over) and the screen
 * token, which authorises every read from here on. The join QR that the room
 * scans is a third, separate thing — public to everyone in the room by design,
 * unguessable to everyone outside it.
 *
 * Nothing on this screen can drive the match. The host's phone does that; this
 * follows the session row over realtime and re-reads its own snapshot.
 */
export function ArenaScreen({ handoff }: { handoff?: { sessionId: string; screenToken: string } }) {
  const [sessionId, setSessionId] = useState<string | null>(handoff?.sessionId ?? null);
  const [screenToken, setScreenToken] = useState<string | null>(handoff?.screenToken ?? null);
  const [pairQr, setPairQr] = useState<string | null>(null);
  const [pairToken, setPairToken] = useState<string | null>(null);
  const [experience, setExperience] = useState<QrExperience | null>(null);
  const [joinQr, setJoinQr] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [paired, setPaired] = useState(Boolean(handoff));
  const rotating = useRef(false);
  const currentToken = useRef<string | null>(null);
  const mounted = useRef(true);

  const drawPairToken = useCallback(async (token: string) => {
    currentToken.current = token;
    setPairToken(token);
    setPairQr(await QRCode.toDataURL(`jaxongirman://game-pair/${token}`, { errorCorrectionLevel: "M", margin: 1, width: 520 }));
  }, []);

  // Decoration, so it is loaded beside the session rather than in front of it:
  // a projector must reach a working pairing code even if this never answers.
  useEffect(() => {
    void loadQrExperience("oyingoh").then(setExperience);
  }, []);

  const openSession = useCallback(async () => {
    mounted.current = true;
    setSessionId(null);
    setScreenToken(null);
    setSnapshot(null);
    setJoinQr(null);
    setPairToken(null);
    setPaired(false);
    setError(null);
    currentToken.current = null;

    const { data, error: openError } = await supabase.rpc("game_screen_open");
    if (!mounted.current) return;
    if (openError) {
      console.error("game_screen_open failed", openError);
      setError("Sessiya ochilmadi. Sahifani yangilang.");
      return;
    }
    const payload = data as unknown as { session_id: string; token: string; screen_token: string };
    if (!payload.screen_token) {
      setError("Sessiya xavfsiz ochilmadi. Sahifani yangilab qayta urinib ko‘ring.");
      return;
    }
    setSessionId(payload.session_id);
    setScreenToken(payload.screen_token);
    await drawPairToken(payload.token);
  }, [drawPairToken]);

  useEffect(() => {
    if (handoff) return;
    void openSession();
    return () => { mounted.current = false; };
  }, [handoff, openSession]);

  const readSnapshot = useCallback(async () => {
    if (!sessionId || !screenToken) return;
    const { data, error: readError } = await supabase.rpc("game_screen_snapshot", {
      p_session_id: sessionId,
      p_screen_token: screenToken,
    });
    if (readError) {
      console.error("game_screen_snapshot failed", readError);
      return;
    }
    const next = data as unknown as Snapshot;
    setSnapshot(next);
    // `paired` is the gate, not the token: the join token exists from the moment
    // the session opens, so testing for it flipped the screen into an empty
    // lobby before anybody had scanned anything.
    if (next.paired) {
      setPaired(true);
      setJoinQr(await QRCode.toDataURL(joinUrl(next.join_token), { errorCorrectionLevel: "M", margin: 1, width: 560 }));
    }
  }, [screenToken, sessionId]);

  useEffect(() => { void readSnapshot(); }, [readSnapshot]);

  useEffect(() => {
    if (!sessionId) return;
    let subscribed = true;
    setConnected(false);
    const channel = supabase
      .channel(`game-session-${sessionId}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "game_sessions", filter: `id=eq.${sessionId}` },
        () => { void readSnapshot(); })
      .subscribe((status) => {
        if (subscribed) setConnected(status === "SUBSCRIBED");
      });
    return () => {
      subscribed = false;
      void supabase.removeChannel(channel);
    };
  }, [readSnapshot, sessionId]);

  // Rotate the pairing code until a phone claims the match — a photograph of
  // the projector stops working within a rotation.
  useEffect(() => {
    if (!sessionId || paired) return;
    const timer = setInterval(() => {
      if (rotating.current || !currentToken.current) return;
      rotating.current = true;
      void (async () => {
        try {
          const { data, error: rotateError } = await supabase.rpc("game_pairing_rotate", {
            p_session_id: sessionId,
            p_current_token: currentToken.current as string,
          });
          if (!rotateError && data) await drawPairToken((data as unknown as { token: string }).token);
        } finally {
          rotating.current = false;
        }
      })();
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [drawPairToken, paired, sessionId]);

  // A phase ending on the server clock is not an UPDATE, so one timed re-read
  // covers the deadline passing with nobody answering.
  useEffect(() => {
    if (!snapshot?.phase_deadline) return;
    const wait = new Date(snapshot.phase_deadline).getTime() - Date.now() + 700;
    if (wait <= 0) return;
    const timer = setTimeout(() => { void readSnapshot(); }, wait);
    return () => clearTimeout(timer);
  }, [readSnapshot, snapshot?.phase_deadline]);

  useEffect(() => {
    const timer = setInterval(() => { void readSnapshot(); }, 10_000);
    return () => clearInterval(timer);
  }, [readSnapshot]);

  useEffect(() => {
    const changed = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);

  // Preload the next question's picture so a slide change is not a blank frame.
  useEffect(() => {
    const url = mediaUrl(snapshot?.question?.media_path);
    if (!url) return;
    const image = new window.Image();
    image.src = url;
  }, [snapshot?.question?.media_path]);

  const remaining = useCountdown(snapshot?.phase_deadline ?? null);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (failure) {
      console.error("fullscreen request failed", failure);
    }
  }

  const spacedCode = useMemo(
    () => snapshot?.join_code?.replace(/(\d{3})(\d{3})/, "$1 $2") ?? "",
    [snapshot?.join_code],
  );

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

  // Waiting for the host's phone, with the cinematic screen an admin published
  // if there is one. It stands in for the card below and nothing else: the
  // match, the rotating token and the realtime subscription that notices the
  // phone are unchanged, so a surface that is switched off changes nothing.
  if (!paired && experience && pairToken) {
    return (
      <main className="qrx-page">
        <QrVideoExperience experience={experience} qrValue={gamePairUrl(pairToken)} />
      </main>
    );
  }

  // Waiting for the host's phone.
  if (!paired) {
    return (
      <main className="pair-page">
        <div className="hero-orb one" aria-hidden />
        <div className="hero-orb two" aria-hidden />
        <div className="shell pair-shell">
          <div className="pair-copy">
            <p className="eyebrow">O&lsquo;YINGOH</p>
            <h1>Telefoningizni ulang</h1>
            <ol className="pair-steps">
              <li>Jaxongirman ilovasini oching</li>
              <li>&ldquo;O&lsquo;yingoh&rdquo; bo&lsquo;limida <strong>Mezbon bo&lsquo;lish</strong> tugmasini bosing</li>
              <li>Shu ekrandagi kodni skaner qilib, o&lsquo;yinni tanlang</li>
            </ol>
            <p className="pair-note">Kod har 30 soniyada yangilanadi va faqat bir marta ishlaydi — ekranning surati bilan hech kim ulanolmaydi.</p>
          </div>
          <div className="pair-qr">
            {pairQr ? <img src={pairQr} alt="Ulanish uchun QR kod" width={320} height={320} /> : <div className="pair-qr-skeleton" />}
          </div>
        </div>
      </main>
    );
  }

  const question = snapshot?.question;
  const options = question?.config.options ?? [];
  const reveal = snapshot?.reveal;
  const correct = reveal?.config?.correct;

  return (
    <main className="arena">
      {!connected ? <div className="presentation-connection">Ulanish uzildi. Qayta ulanmoqda...</div> : null}
      <button className="presentation-fullscreen" type="button" onClick={() => void toggleFullscreen()}
        aria-label={fullscreen ? "To‘liq ekrandan chiqish" : "To‘liq ekran"}>
        {fullscreen ? <Minimize aria-hidden /> : <Maximize aria-hidden />}
      </button>

      {snapshot?.status === "lobby" && !snapshot.game_selected ? (
        <div className="arena-center">
          <p className="eyebrow">JAXONGIRMAN O&lsquo;YINGOH</p>
          <h1 className="arena-title">Telefon ulandi</h1>
          <p className="arena-join-hint">Boshlovchi o&lsquo;yinni tanlamoqda…</p>
        </div>
      ) : null}

      {snapshot?.status === "lobby" && snapshot.game_selected ? (
        <div className="arena-lobby">
          <div className="arena-lobby-main">
            <p className="eyebrow">JAXONGIRMAN O&lsquo;YINGOH</p>
            <h1 className="arena-title">{snapshot.game_title || "O‘yingoh"}</h1>
            {joinQr ? <img className="arena-qr" src={joinQr} alt="O‘yinga qo‘shilish uchun QR kod" width={300} height={300} /> : null}
            <p className="arena-code-label">Kod</p>
            <p className="arena-code">{spacedCode}</p>
            <p className="arena-join-hint">Telefoningiz orqali qo&lsquo;shiling</p>
          </div>
          <div className="arena-players">
            <p className="arena-players-count">{snapshot.player_count} ishtirokchi</p>
            <div className="arena-player-grid">
              {snapshot.players.map((player) => (
                <div className="arena-player" key={player.id}>
                  <GameAvatar id={player.avatar_id} size={64} />
                  <span>{player.nickname}</span>
                  {player.team ? <em>{player.team}</em> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {snapshot?.status === "countdown" ? (
        <div className="arena-center">
          <p className="arena-countdown">{remaining > 0 ? remaining : "BOSHLADIK!"}</p>
        </div>
      ) : null}

      {(snapshot?.status === "question" || snapshot?.status === "question_result") && question ? (
        <div className="arena-question">
          <div className="arena-question-head">
            <span className="arena-pill">{GAME_TYPE_LABELS[question.type]}</span>
            <span className="arena-pill">{snapshot.current_index + 1} / {snapshot.question_count}</span>
            {snapshot.status === "question" ? (
              <>
                <span className={`arena-timer${remaining <= 5 ? " urgent" : ""}`}>{remaining}</span>
                <span className="arena-pill">{snapshot.answered_count ?? 0} / {snapshot.player_count} javob</span>
              </>
            ) : null}
          </div>

          <h1 className="arena-prompt">{question.prompt}</h1>

          {question.media_path ? (
            <img className="arena-media" src={mediaUrl(question.media_path)} alt="" />
          ) : null}

          {question.type === "true_false" ? (
            <div className="arena-options two">
              <div className="arena-option" style={{ background: "#17B283" }}>
                <span className="arena-option-glyph">✓</span><span>ROST</span>
                {snapshot.status === "question_result" && correct === true ? <span className="arena-correct">✓</span> : null}
              </div>
              <div className="arena-option" style={{ background: "#D9455F" }}>
                <span className="arena-option-glyph">✕</span><span>YOLG‘ON</span>
                {snapshot.status === "question_result" && correct === false ? <span className="arena-correct">✓</span> : null}
              </div>
            </div>
          ) : options.length > 0 ? (
            <div className={`arena-options${options.length <= 2 ? " two" : ""}`}>
              {options.map((option, index) => {
                const style = OPTION_STYLES[index % OPTION_STYLES.length]!;
                const isCorrect = Array.isArray(correct) ? correct.includes(option.id) : correct === option.id;
                const count = reveal?.stats.choices?.[option.id] ?? 0;
                const share = reveal ? Math.round((count / Math.max(reveal.stats.answers, 1)) * 100) : 0;
                return (
                  <div key={option.id} className={`arena-option${snapshot.status === "question_result" && !isCorrect ? " faded" : ""}`}
                    style={{ background: style.color }}>
                    <span className="arena-option-glyph">{style.glyph}</span>
                    <span className="arena-option-letter">{style.letter}</span>
                    <span className="arena-option-text">{option.text}</span>
                    {snapshot.status === "question_result" ? (
                      <span className="arena-option-share">{share}% {isCorrect ? "✓" : ""}</span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : question.type === "word_cloud" && reveal ? (
            <WordCloud words={reveal.stats.words} />
          ) : snapshot.status === "question_result" ? (
            <RevealText question={question} config={reveal?.config ?? {}} />
          ) : (
            <p className="arena-await">Telefoningizda javob bering</p>
          )}

          {snapshot.status === "question_result" && reveal?.explanation ? (
            <p className="arena-explanation">{reveal.explanation}</p>
          ) : null}
          {snapshot.status === "question_result" && reveal ? (
            <p className="arena-stats">
              {reveal.stats.answers} javob
              {reveal.stats.correct + reveal.stats.incorrect > 0
                ? ` · ${Math.round((reveal.stats.correct / (reveal.stats.correct + reveal.stats.incorrect)) * 100)}% to‘g‘ri`
                : ""}
            </p>
          ) : null}
        </div>
      ) : null}

      {snapshot?.status === "leaderboard" && snapshot.leaderboard ? (
        <div className="arena-board">
          <h1 className="arena-title">Natijalar jadvali</h1>
          {/* In team mode the teams lead: the individual board is still shown
              below it, because a player wants to find their own name. */}
          {snapshot.team_mode && snapshot.leaderboard.teams.length > 0 ? (
            <div className="arena-teams">
              {snapshot.leaderboard.teams.map((team) => (
                <div className="arena-team" key={team.team}>
                  <span className="arena-team-name">{team.team}</span>
                  <span className="arena-team-meta">{team.players} ishtirokchi</span>
                  <span className="arena-team-score">{team.total_score.toLocaleString("uz-UZ")}</span>
                </div>
              ))}
            </div>
          ) : null}
          {snapshot.leaderboard.players.slice(0, 10).map((player) => (
            <div className="arena-board-row" key={player.id}>
              <span className="arena-board-rank">{player.rank}</span>
              <GameAvatar id={player.avatar_id} size={44} />
              <span className="arena-board-name">{player.nickname}</span>
              <span className="arena-board-score">{player.total_score.toLocaleString("uz-UZ")}</span>
            </div>
          ))}
        </div>
      ) : null}

      {snapshot?.status === "finished" && snapshot.leaderboard ? (
        <Finish players={snapshot.leaderboard.players} />
      ) : null}

      {snapshot?.status === "cancelled" || snapshot?.status === "expired" ? (
        <div className="arena-center">
          <h1 className="arena-title">O&lsquo;yin to&lsquo;xtatildi</h1>
          <button className="store-button" type="button" onClick={() => void openSession()}>Yangi o&lsquo;yin</button>
        </div>
      ) : null}
    </main>
  );
}

function WordCloud({ words }: { words: Record<string, number> }) {
  const entries = Object.entries(words ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 30);
  const peak = entries[0]?.[1] ?? 1;
  if (entries.length === 0) return <p className="arena-await">Hech kim javob yozmadi</p>;
  return (
    <div className="arena-cloud">
      {entries.map(([word, count]) => (
        <span key={word} style={{ fontSize: `clamp(20px, ${1.4 + (count / peak) * 4}vw, 96px)`, opacity: 0.55 + (count / peak) * 0.45 }}>
          {word}
        </span>
      ))}
    </div>
  );
}

function RevealText({ question, config }: {
  question: NonNullable<Snapshot["question"]>;
  config: Record<string, unknown>;
}) {
  if (question.type === "fill_blank") {
    const answers = Array.isArray(config.answers) ? config.answers as string[] : [];
    return <p className="arena-reveal">{answers[0] ?? "—"}</p>;
  }
  if (question.type === "ordering") {
    const items = question.config.items ?? [];
    const byId = new Map(items.map((item) => [item.id, item.text]));
    const order = Array.isArray(config.order) ? config.order as string[] : [];
    return (
      <ol className="arena-reveal-list">
        {order.map((id) => <li key={id}>{byId.get(id) ?? ""}</li>)}
      </ol>
    );
  }
  if (question.type === "matching") {
    const left = question.config.left ?? [];
    const right = question.config.right ?? [];
    const pairs = (config.pairs ?? {}) as Record<string, string>;
    return (
      <ul className="arena-reveal-list">
        {left.map((item) => (
          <li key={item.id}>{item.text} ↔ {right.find((row) => row.id === pairs[item.id])?.text ?? "—"}</li>
        ))}
      </ul>
    );
  }
  return <p className="arena-await">Javoblar yopildi</p>;
}

function Finish({ players }: { players: { id: string; nickname: string; avatar_id: number; total_score: number; rank: number }[] }) {
  const order = [players.find((p) => p.rank === 2), players.find((p) => p.rank === 1), players.find((p) => p.rank === 3)];
  const medals = ["🥈", "🥇", "🥉"];
  const heights = [180, 250, 140];
  return (
    <div className="arena-finish">
      <div className="arena-confetti" aria-hidden>
        {Array.from({ length: 60 }, (_, index) => (
          <span key={index} style={{
            left: `${(index * 37) % 100}%`,
            animationDelay: `${(index % 12) * 0.18}s`,
            background: OPTION_STYLES[index % OPTION_STYLES.length]!.color,
          }} />
        ))}
      </div>
      <h1 className="arena-title">G&lsquo;oliblar</h1>
      <div className="arena-podium">
        {order.map((player, index) => player ? (
          <div className="arena-podium-column" key={player.id}>
            <GameAvatar id={player.avatar_id} size={index === 1 ? 104 : 78} />
            <span className="arena-podium-name">{player.nickname}</span>
            <span className="arena-podium-score">{player.total_score.toLocaleString("uz-UZ")}</span>
            <div className="arena-podium-block" style={{ height: heights[index] }}>
              <span>{medals[index]}</span>
            </div>
          </div>
        ) : <div className="arena-podium-column" key={`empty-${index}`} />)}
      </div>
    </div>
  );
}
