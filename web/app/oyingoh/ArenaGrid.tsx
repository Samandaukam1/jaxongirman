"use client";

import type { ArenaWords } from "./arena-words";

/** A team grid game as the board receives it (`game_grid_view`, board side). */
export type GridBoard = {
  teams: string[];
  scores: number[];
  turn: number;
  cells: { points: number; state: "closed" | "won" | "missed"; team: number | null }[];
  open: null | { cell: number; points: number; prompt: string; media_path: string | null; answer: string | null; revealed: boolean };
};

/** The teams' colours, the same as on the host's phone. */
const TEAM_COLORS = ["#8B54E8", "#17B283", "#E8A13A"];

/**
 * The team grid game on the board: the teams and their scores across the
 * top, whose turn it is lit; the numbered cells, each showing what it is
 * worth until it is played and then whose it became; the open question over
 * them; and the standings at the end.
 */
export function ArenaGrid({ status, title, grid, words }: {
  status: string;
  title: string;
  grid: GridBoard | null;
  words: ArenaWords;
}) {
  if (!grid || status === "lobby") {
    return (
      <div className="arena-center">
        <p className="eyebrow">{words.grid.eyebrow}</p>
        <h1 className="arena-title">{title || words.fallbackTitle}</h1>
        <p className="arena-join-hint">{words.grid.preparing}</p>
      </div>
    );
  }

  if (status === "finished") {
    const order = grid.teams.map((team, at) => ({ team, at, score: grid.scores[at] ?? 0 })).sort((a, b) => b.score - a.score);
    const draw = order.length > 1 && order[0]!.score === order[1]!.score;
    return (
      <div className="arena-grid-final">
        <p className="eyebrow">{words.grid.finished}</p>
        <h1 className="arena-title">{draw ? words.grid.draw : words.grid.winner(order[0]!.team)}</h1>
        <div className="arena-grid-standings">
          {order.map((entry, place) => (
            <div key={entry.at} className={`arena-grid-standing${place === 0 && !draw ? " is-first" : ""}`} style={{ ["--team" as string]: TEAM_COLORS[entry.at] }}>
              <span className="arena-grid-place">{place + 1}</span>
              <span className="arena-grid-name">{entry.team}</span>
              <span className="arena-grid-total">{entry.score.toLocaleString(words.locale)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const columns = 6;
  const open = grid.open;
  return (
    <div className="arena-grid">
      <div className="arena-grid-teams">
        {grid.teams.map((team, at) => (
          <div key={at} className={`arena-grid-team${grid.turn === at ? " is-turn" : ""}`} style={{ ["--team" as string]: TEAM_COLORS[at] }}>
            <span className="arena-grid-team-name">{team}</span>
            <span className="arena-grid-team-score">{(grid.scores[at] ?? 0).toLocaleString(words.locale)}</span>
          </div>
        ))}
      </div>
      <p className="arena-grid-turn" style={{ color: TEAM_COLORS[grid.turn] }}>{words.grid.turn(grid.teams[grid.turn] ?? "")}</p>

      <div className="arena-grid-cells" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {grid.cells.map((cell, at) => (
          <div
            key={at}
            className={`arena-grid-cell is-${cell.state}${open?.cell === at ? " is-open" : ""}`}
            style={cell.state === "won" ? { ["--team" as string]: TEAM_COLORS[cell.team ?? 0] } : undefined}
          >
            <span className="arena-grid-number">{at + 1}</span>
            {cell.state === "closed" ? <span className="arena-grid-points">{cell.points}</span> : null}
            {cell.state === "won" ? <span className="arena-grid-owner">{grid.teams[cell.team ?? 0]}</span> : null}
          </div>
        ))}
      </div>

      {open ? (
        <div className="arena-grid-open" role="dialog" aria-live="polite">
          <div className="arena-grid-card" style={{ ["--team" as string]: TEAM_COLORS[grid.turn] }}>
            <p className="arena-grid-card-head">
              <span>{open.cell + 1}</span>
              <span>{words.grid.points(open.points)}</span>
              <span>{grid.teams[grid.turn]}</span>
            </p>
            <h2 className="arena-grid-prompt">{open.prompt}</h2>
            {open.revealed && open.answer ? (
              <p className="arena-grid-answer"><span>{words.grid.answer}</span>{open.answer}</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
