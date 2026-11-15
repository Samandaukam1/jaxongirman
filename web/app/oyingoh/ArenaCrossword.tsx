"use client";

import { crosswordCells, readCrossword, type Crossword } from "@jaxongirman/types";
import { useMemo } from "react";

import { GameAvatar } from "./GameAvatar";
import type { ArenaWords } from "./arena-words";

export type Racer = {
  player_id: string; nickname: string; avatar_id: number; team: string | null;
  solved: number; done: boolean; score: number;
};


/**
 * A crossword on the board while the room solves it: the grid with its
 * numbers, the race beside it, and the clues — then, when the time is up, the
 * same grid with every answer in it.
 *
 * Drawn as SVG so a projector shows crisp lines and letters at any size.
 */
export function ArenaCrossword({ config, answers, race, words }: {
  config: unknown;
  /** The full config, with answers, once the grid has closed. */
  answers: unknown | null;
  race: Racer[];
  words: ArenaWords;
}) {
  const crossword = useMemo<Crossword | null>(() => readCrossword(answers ?? config), [answers, config]);
  const cells = useMemo(() => (crossword ? [...crosswordCells(crossword).values()] : []), [crossword]);
  if (!crossword) return null;
  const total = crossword.words.length;
  const revealed = Boolean(answers);

  return (
    <div className="arena-xw">
      <div className="arena-xw-grid">
        <svg viewBox={`-0.05 -0.05 ${crossword.width + 0.1} ${crossword.height + 0.1}`} role="img" aria-label={words.types.crossword}>
          {cells.map((cell) => (
            <g key={`${cell.row},${cell.col}`} transform={`translate(${cell.col} ${cell.row})`}>
              <rect width="1" height="1" className={revealed ? "is-revealed" : undefined} />
              {cell.number !== null ? <text className="arena-xw-number" x="0.07" y="0.3">{cell.number}</text> : null}
              {revealed && cell.letter ? <text className="arena-xw-letter" x="0.5" y="0.76">{cell.letter}</text> : null}
            </g>
          ))}
        </svg>
      </div>

      <div className="arena-xw-side">
        <div className="arena-xw-race">
          <p className="arena-xw-heading">{words.crossword.race}</p>
          {race.slice(0, 6).map((racer, index) => (
            <div className={`arena-xw-racer${racer.done ? " is-done" : ""}`} key={racer.player_id}>
              <span className="arena-xw-rank">{index + 1}</span>
              <GameAvatar id={racer.avatar_id} size={34} />
              <span className="arena-xw-name">{racer.nickname}</span>
              <span className="arena-xw-solved">
                {words.crossword.solved(racer.solved, total)}{racer.done ? ` · ${words.crossword.done}` : ""}
              </span>
              <i className="arena-xw-bar" style={{ width: `${Math.round((racer.solved / Math.max(total, 1)) * 100)}%` }} aria-hidden />
            </div>
          ))}
        </div>

        <div className="arena-xw-clues">
          {(["across", "down"] as const).map((direction) => (
            <div key={direction}>
              <p className="arena-xw-heading">{direction === "across" ? words.crossword.across : words.crossword.down}</p>
              <ol>
                {crossword.words
                  .filter((word) => word.direction === direction)
                  .sort((a, b) => a.number - b.number)
                  .map((word) => (
                    <li key={word.id}>
                      <b>{word.number}</b>
                      <span>
                        {word.clue}
                        {revealed && word.answer ? <strong> — {word.answer}</strong> : null}
                      </span>
                    </li>
                  ))}
              </ol>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
