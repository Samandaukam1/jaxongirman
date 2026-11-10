"use client";

import { Star, Trophy } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

import type { ArenaWords } from "./arena-words";
import { GameAvatar } from "./GameAvatar";

export type PodiumPlayer = { id: string; nickname: string; avatar_id: number; total_score: number; rank: number };

/**
 * The end of a match on the big screen: the three best on a podium of glass,
 * everybody else beneath them, and what the room did together.
 *
 * Drawn as one 1920×1080 stage and scaled to the room it is shown in, so a
 * laptop and a projector show the same composition rather than a reflowed
 * one. The arena's own type and violet stay; the podium is glass, the places
 * are metal — gold, silver, bronze by position, so two players tied for first
 * both say "1" but only one of them stands in the middle.
 *
 * It arrives in an order: the heading, then the blocks rising third, second,
 * first, each player popping up on theirs, the crown last, then confetti and
 * the scores counting up. With reduced motion everything is simply there.
 */

const STAGE_W = 1920;
const STAGE_H = 1080;
const METALS = ["gold", "silver", "bronze"] as const;
/** Left to right on the podium: second, first, third. */
const SLOTS = [1, 0, 2] as const;
const CONFETTI = ["#8B54E8", "#B794F6", "#22D3EE", "#F2C14E", "#FFFFFF", "#D2894F", "#C9D1DD"];

export function Podium({ players, words, gameTitle, playerCount, questionCount }: {
  players: PodiumPlayer[];
  words: ArenaWords;
  gameTitle: string;
  playerCount: number;
  questionCount: number;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);

  // The stage keeps its proportions and fills the room it is given.
  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const measure = () => setFit(Math.min(element.clientWidth / STAGE_W, element.clientHeight / STAGE_H));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const ranked = [...players].sort((a, b) => a.rank - b.rank || b.total_score - a.total_score);
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3, 10);
  const scores = players.map((player) => player.total_score);
  const average = scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
  const best = scores.length ? Math.max(...scores) : 0;
  const format = (value: number) => value.toLocaleString(words.locale);

  return (
    <>
      <div className="podium-backdrop" aria-hidden>
        <span className="podium-orb a" /><span className="podium-orb b" /><span className="podium-orb c" />
        <span className="podium-grid" />
        {Array.from({ length: 26 }, (_, index) => (
          <i key={index} className="podium-star" style={{ left: `${(index * 53) % 100}%`, top: `${(index * 29) % 100}%`, animationDelay: `${(index % 9) * 0.4}s` }} />
        ))}
      </div>
      <div className="podium-confetti" aria-hidden>
        {Array.from({ length: 70 }, (_, index) => (
          <i key={index} style={{
            left: `${(index * 37) % 100}%`,
            background: CONFETTI[index % CONFETTI.length],
            animationDelay: `${1.6 + (index % 14) * 0.09}s`,
            animationDuration: `${3.2 + (index % 5) * 0.5}s`,
            "--turn": `${(index * 47) % 360}deg`,
          } as CSSProperties} />
        ))}
      </div>

      <div className="arena-finish" ref={box}>
        <div className="podium-stage" style={{ "--fit": fit, visibility: fit ? "visible" : "hidden" } as CSSProperties}>
          <span className="podium-pill podium-rise"><Trophy aria-hidden />{words.finished}</span>
          <h1 className="podium-title podium-rise">{words.winnersTitle[0]} <em>{words.winnersTitle[1]}</em></h1>
          <p className="podium-sub podium-rise">
            <b>{gameTitle}</b> · {words.players(playerCount)} · {words.questions(questionCount)}
          </p>

          <div className="podium-row">
            {SLOTS.map((position) => {
              const player = top[position];
              const metal = METALS[position];
              if (!player) return <div className={`podium-col ${metal}`} key={`empty-${position}`} />;
              const champion = position === 0;
              const size = champion ? 176 : 136;
              return (
                <div className={`podium-col ${metal}${champion ? " champion" : ""}`} key={player.id}>
                  <div className="podium-who">
                    {champion ? <><span className="podium-rays" aria-hidden /><Crown /></> : null}
                    <div className="podium-ring" style={{ "--size": `${size}px` } as CSSProperties}>
                      <span className="podium-ring-metal" aria-hidden />
                      <span className="podium-face"><GameAvatar id={player.avatar_id} size={size - 22} /></span>
                      <span className="podium-badge">{player.rank}</span>
                    </div>
                    <span className="podium-name">{player.nickname}</span>
                    <span className="podium-score">
                      <Star aria-hidden />
                      <CountUp value={player.total_score} delay={1500} format={format} />
                      <i>{words.points}</i>
                    </span>
                  </div>
                  <div className="podium-block">
                    <span className="podium-place">{player.rank}</span>
                    <span className="podium-sweep" aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="podium-stats">
            {[
              [words.stats.players, playerCount],
              [words.stats.questions, questionCount],
              [words.stats.average, average],
              [words.stats.top, best],
            ].map(([label, value]) => (
              <div className="podium-stat" key={label as string}>
                <span>{label}</span>
                <strong><CountUp value={value as number} delay={1800} format={format} /></strong>
              </div>
            ))}
          </div>

          {/* Everyone else, because a room of twenty has seventeen people who are
              not on the podium and would otherwise watch three names. */}
          {rest.length > 0 ? (
            <div className="podium-rest">
              {rest.map((player, index) => (
                <span className="podium-chip" key={player.id} style={{ animationDelay: `${2.4 + index * 0.07}s` }}>
                  <GameAvatar id={player.avatar_id} size={34} />
                  <b>{player.rank}</b>
                  {player.nickname}
                  <em>{format(player.total_score)}</em>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

/** A number that counts up from zero once its moment comes; still for reduced motion. */
function CountUp({ value, delay, format }: { value: number; delay: number; format: (value: number) => string }) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); return; }
    let frame = 0;
    const start = performance.now() + delay;
    const step = (now: number) => {
      const progress = Math.min(1, Math.max(0, (now - start) / 1200));
      setShown(Math.round(value * (1 - Math.pow(1 - progress, 3))));
      if (progress < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [delay, value]);
  return <b>{format(shown)}</b>;
}

function Crown() {
  return (
    <svg className="podium-crown" viewBox="0 0 64 48" aria-hidden focusable="false">
      <defs>
        <linearGradient id="podium-crown-gold" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#FFF3C4" /><stop offset=".55" stopColor="#F2C14E" /><stop offset="1" stopColor="#B27C14" />
        </linearGradient>
      </defs>
      <path d="M6 40 L3 12 L19 24 L32 6 L45 24 L61 12 L58 40 Z" fill="url(#podium-crown-gold)" stroke="#FFE7A0" strokeWidth="1.6" strokeLinejoin="round" />
      <rect x="6" y="39" width="52" height="7" rx="3" fill="url(#podium-crown-gold)" />
      <circle cx="32" cy="6" r="3.4" fill="#FFF7D6" /><circle cx="3" cy="12" r="2.8" fill="#FFF7D6" /><circle cx="61" cy="12" r="2.8" fill="#FFF7D6" />
    </svg>
  );
}
