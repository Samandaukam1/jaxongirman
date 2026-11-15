"use client";

import { Crown, HeartHandshake, Moon, ShieldCheck, Skull, Stethoscope, Sun, UserRound, VenetianMask, type LucideIcon } from "lucide-react";

import type { ArenaWords } from "./arena-words";
import { GameAvatar } from "./GameAvatar";

export type MafiaRoleKey = "don" | "mafia" | "sheriff" | "doctor" | "lover" | "maniac" | "civilian";

/** A Mafia game as the board receives it (`game_mafia_view`, screen side): no card until it is over. */
export type MafiaBoard = {
  game_no: number;
  roles: Record<MafiaRoleKey, number>;
  phase: "night" | "day";
  round: number;
  over: boolean;
  winner: "town" | "mafia" | "maniac" | null;
  players: {
    id: string; nickname: string; avatar_id: number; in_game: boolean; alive: boolean;
    out_reason: "night" | "vote" | "host" | null; out_round: number | null; role: MafiaRoleKey | null;
  }[];
};

/** The same glyph and colour per card as on the phones. */
const LOOK: Record<MafiaRoleKey, { icon: LucideIcon; color: string }> = {
  don: { icon: Crown, color: "#A3213F" },
  mafia: { icon: VenetianMask, color: "#B4233C" },
  sheriff: { icon: ShieldCheck, color: "#3159D0" },
  doctor: { icon: Stethoscope, color: "#13896A" },
  lover: { icon: HeartHandshake, color: "#B93478" },
  maniac: { icon: Skull, color: "#4A4F5C" },
  civilian: { icon: UserRound, color: "#6C34C9" },
};
const ORDER: MafiaRoleKey[] = ["don", "mafia", "sheriff", "doctor", "lover", "maniac", "civilian"];

/**
 * Mafia on the board: night or day, said large enough for the back row; the
 * table — who is still in and who is out, and how; the deck the host dealt.
 * No card is ever on this screen while a game is on. When it is over, the
 * winner and every card.
 */
export function ArenaMafia({ mafia, words }: { mafia: MafiaBoard; words: ArenaWords }) {
  const w = words.mafia;
  const dealt = mafia.players.filter((player) => player.in_game);
  const night = mafia.phase === "night";
  const PhaseIcon = night ? Moon : Sun;

  if (mafia.over) {
    const winnerLook = mafia.winner === "mafia" ? LOOK.mafia : mafia.winner === "maniac" ? LOOK.maniac : LOOK.civilian;
    return (
      <div className="arena-mafia is-over">
        <p className="eyebrow">{w.eyebrow}</p>
        <h1 className="arena-title arena-mafia-winner" style={{ ["--role" as string]: winnerLook.color }}>
          <Crown aria-hidden /> {w.winner[mafia.winner ?? "none"]}
        </h1>
        <div className="arena-mafia-table">
          {dealt.map((player) => {
            const look = player.role ? LOOK[player.role] : LOOK.civilian;
            const Icon = look.icon;
            return (
              <div key={player.id} className={`arena-mafia-seat is-revealed${player.alive ? "" : " is-out"}`} style={{ ["--role" as string]: look.color }}>
                <GameAvatar id={player.avatar_id} size={64} />
                <span className="arena-mafia-name">{player.nickname}</span>
                {player.role ? <span className="arena-mafia-role"><Icon aria-hidden />{w.roles[player.role]}</span> : null}
              </div>
            );
          })}
        </div>
        <p className="arena-join-hint">{w.next}</p>
      </div>
    );
  }

  return (
    <div className={`arena-mafia ${night ? "is-night" : "is-day"}`}>
      <div className="arena-mafia-head">
        <p className="eyebrow">{w.eyebrow}</p>
        <h1 className="arena-mafia-phase"><PhaseIcon aria-hidden />{night ? w.night(mafia.round) : w.day(mafia.round)}</h1>
        <p className="arena-mafia-hint">{night ? w.nightHint : w.dayHint}</p>
      </div>

      <div className="arena-mafia-table">
        {dealt.map((player) => (
          <div key={player.id} className={`arena-mafia-seat${player.alive ? "" : " is-out"}`}>
            <GameAvatar id={player.avatar_id} size={64} />
            <span className="arena-mafia-name">{player.nickname}</span>
            {!player.alive && player.out_reason ? (
              <span className="arena-mafia-out">
                {player.out_reason === "host" ? w.out.host : w.out[player.out_reason](player.out_round ?? 1)}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <div className="arena-mafia-foot">
        <span className="arena-pill">{w.alive(dealt.filter((player) => player.alive).length)}</span>
        <div className="arena-mafia-deck" aria-label={w.deck}>
          {ORDER.filter((role) => (mafia.roles[role] ?? 0) > 0).map((role) => {
            const Icon = LOOK[role].icon;
            const count = mafia.roles[role] ?? 0;
            return (
              <span key={role} className="arena-mafia-chip" style={{ ["--role" as string]: LOOK[role].color }}>
                <Icon aria-hidden />{w.roles[role]}{count > 1 ? ` ×${count}` : ""}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
}
