/**
 * Video notes as a conversation plays them: the part of it that needs no phone, kept apart so it can be
 * tested — how long each part is and how far through a note is, which notes loop on screen and which come
 * to the phone before anyone taps them, and the deck that plays a note's parts one after another.
 *
 * A note is recorded in parts (a new one each time the camera is turned round) and plays as one: each part
 * from its start, with sound, the next one already loaded in a second player while this one plays, so a
 * turn of the camera is a cut, not a wait. A tap on a note already looping on screen plays that very player
 * — its frame is there and its file is open, so it simply goes on from the start with sound; nothing loads.
 */

/* ------------------------------------------------------------- data use */

/** Notes that loop silently at once, at most: the newest on screen. Each one is a decoder, and a file read. */
export const MAX_LOOPS = 3;
/** The newest video notes of a conversation come to the phone when it opens, as does each one that arrives while it is open. */
export const NEWEST_NOTES = 3;
/** The rest come once the list has come to rest within this many messages of them: a note is megabytes, a voice kilobytes. */
export const NOTE_REACH = 6;

/** One part of a note as a player finds it: its storage path, the file this phone recorded it into (the sender's own), how long it was recorded for. */
export type NoteFile = { path: string | null; local: string | null; ms: number };

/** What a list row needs to be told apart here: whether it is a video note, and whether it is still there. */
type Row = { kind: string; deleted_at?: string | null; pending?: unknown };

/**
 * How long each part lasts, in seconds: what its player measured once it was loaded, else what the recorder
 * measured, else an even share of what the whole note's length leaves for the parts not known yet.
 */
export function partLengths(recordedMs: readonly number[], measured: readonly (number | null)[], totalMs: number): number[] {
  const known = recordedMs.map((ms, at) => {
    const seconds = measured[at];
    if (typeof seconds === "number" && seconds > 0) return seconds;
    return ms > 0 ? ms / 1000 : null;
  });
  const unknown = known.filter((value) => value === null).length;
  const left = Math.max(0, totalMs / 1000 - known.reduce<number>((sum, value) => sum + (value ?? 0), 0));
  return known.map((value) => value ?? (unknown ? left / unknown : 0));
}

/** How far through the whole note, 0 to 1: the parts before this one in full, and this one so far (never past its own end). */
export function progressAt(lengths: readonly number[], at: number, seconds: number): number {
  const total = lengths.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) return 0;
  const before = lengths.slice(0, Math.max(0, at)).reduce((sum, value) => sum + value, 0);
  const own = lengths[at] ?? 0;
  const into = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return Math.min(1, (before + (own > 0 ? Math.min(into, own) : into)) / total);
}

/** The notes that loop silently: the video notes among those on screen, in the list's order (newest first), `max` at most. */
export function notesToLoop<T extends Row>(onScreen: readonly T[], keyOf: (row: T) => string, max = MAX_LOOPS): string[] {
  const keys: string[] = [];
  for (const row of onScreen) {
    if (keys.length >= max) break;
    if (row.kind === "video" && !row.deleted_at) keys.push(keyOf(row));
  }
  return keys;
}

/**
 * The video notes within `reach` messages of those on screen (`first`…`last`, indexes into `list`), the ones on
 * screen too — sent ones only: a note still on its way is this phone's own recording.
 */
export function notesNear<T extends Row>(list: readonly T[], first: number, last: number, reach = NOTE_REACH): T[] {
  const from = Math.max(0, Math.min(first, last) - reach);
  const to = Math.min(list.length - 1, Math.max(first, last) + reach);
  const found: T[] = [];
  for (let at = from; at <= to; at += 1) {
    const row = list[at];
    if (row && row.kind === "video" && !row.deleted_at && !row.pending) found.push(row);
  }
  return found;
}

/** Whether a set holds exactly these keys: then the screen has nothing new to draw. */
export function sameKeys(set: ReadonlySet<string>, keys: readonly string[]): boolean {
  return set.size === keys.length && keys.every((key) => set.has(key));
}

/* --------------------------------------------------------------- players */

/** What the deck asks of a video player. expo-video's VideoPlayer has all of it; the tests give it a stand-in. */
export interface DeckPlayer {
  currentTime: number;
  muted: boolean;
  loop: boolean;
  timeUpdateEventInterval: number;
  readonly duration: number;
  /** expo-video's word on the player ("error" when its file cannot play); a stand-in may leave it out. */
  readonly status?: string;
  play(): void;
  pause(): void;
  replaceAsync(source: { uri: string } | null): Promise<void>;
}

/** Whether a player says its file cannot play — false for one already let go of (asking would throw). */
function broken(player: DeckPlayer): boolean {
  try {
    return player.status === "error";
  } catch {
    return false;
  }
}

/** A part being watched: from its start, with sound, once through, its time reported for the ring. */
export function playLoud(player: DeckPlayer): void {
  player.loop = false;
  player.timeUpdateEventInterval = 0.1;
  player.currentTime = 0;
  if (player.muted) player.muted = false;
  player.play();
}

/** A bubble's own player: what the deck asks of any, and how its sound sits with the phone's other sound (iOS). */
export interface LoopPlayer extends DeckPlayer {
  audioMixingMode: "auto" | "mixWithOthers" | "duckOthers" | "doNotMix";
}

/**
 * A bubble's new player: silent and looping, not started yet (its bubble decides when). Its sound is "auto":
 * expo-video starts every player at "doNotMix" on iOS, and any player starting — muted or not — then took the
 * phone's sound for itself, so opening a chat with notes on screen stopped the person's music with nothing
 * audible in its place. "auto" mixes while the player is muted and takes the sound only once a tap unmutes it.
 * Set here, once, as the player is made: never mid-take (no loop player is made while recording), and never
 * switched back and forth around a tap.
 */
export function settleLoop(player: LoopPlayer): void {
  player.audioMixingMode = "auto";
  player.muted = true;
  player.loop = true;
}

/**
 * A note at rest in its bubble: silent, round and round, from where it was. Each property is set only when it
 * differs — on iOS every `muted` written re-applies the audio session.
 */
export function restLoop(player: DeckPlayer): void {
  if (!player.muted) player.muted = true;
  if (!player.loop) player.loop = true;
  player.play();
}

/** A lent player handed back: still, at its start, quiet about its time — its bubble loops it again. */
function giveBack(player: DeckPlayer): void {
  player.pause();
  player.timeUpdateEventInterval = 0;
  player.currentTime = 0;
}

/** A call on a player that may already have been let go of (its bubble left the list): the error is nothing to act on. */
function quietly(act: () => void): void {
  try {
    act();
  } catch {
    // Released with its bubble.
  }
}

function positive(read: () => number): number | null {
  try {
    const value = read();
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ deck */

/** What the screen draws: the player of the part on screen (null when nothing plays), and whether a part's file is still coming. */
export type DeckView<P> = { player: P | null; waiting: boolean };

/** What the deck needs from the app: a part's file on the phone, and that file kept there while the note plays. */
export type DeckNeeds = {
  /** The part's file on the phone — fetched at once if it is not there yet. Rejects when it cannot be had. */
  open: (file: NoteFile) => Promise<string>;
  /** Keeps a file from eviction (and marks it just used) until the answer is called. */
  hold: (path: string | null) => () => void;
  /** A part's file would not play: the app may throw away its copy, so the next tap fetches it again. */
  failed?: (file: NoteFile) => void;
};

export type DeckReports<P> = {
  view: (view: DeckView<P>) => void;
  /** 0 to 1 through the whole note; 0 again when it stops. */
  progress: (share: number) => void;
};

type Run<P> = {
  files: readonly NoteFile[];
  totalMs: number;
  /** The bubble's own player, already showing the first part: played as it is. */
  first: P | null;
  /** Its bubble let go of it (it left the list): it is not touched again. */
  firstGone: boolean;
  /** Each part's file on the phone, once known; the parts that could not be had. */
  uris: (string | null)[];
  missing: Set<number>;
  /** Each part's length in seconds, as its player measured it. */
  measured: (number | null)[];
  /** The part playing — or, not `started` yet, the one being waited for. */
  at: number;
  started: boolean;
  /** Parts loaded in their players, ready to go on. */
  ready: Set<number>;
  holds: (() => void)[];
};

/**
 * Plays one note at a time, part after part, on two players of its own (and, for the first part, on the
 * bubble's own player when one is lent). Each part goes into the player the part before it did not use, so the
 * next one loads while this one plays; a player is never loaded while it is on screen — it would go dark — so
 * the one just replaced waits until the screen has caught up (`onScreen`). A part whose file is still coming
 * leaves the last frame on screen and the deck `waiting`; one that cannot be had ends the note there.
 *
 * Player events reach it through `partEnded`, `timeUpdate` and `loaded`, from whoever listens to them. Every
 * answer that comes late — a file, a load — is checked against the note it was asked for, so nothing from a
 * note already stopped ever plays.
 */
export class NoteDeck<P extends DeckPlayer> {
  private readonly own: readonly [P, P];
  private readonly needs: DeckNeeds;
  private readonly reports: DeckReports<P>;
  private run: Run<P> | null = null;
  /** The player on screen, and the one it replaced until the screen has caught up: neither is loaded meanwhile. */
  private shown: P | null = null;
  private leaving: P | null = null;
  /** Which part of which note each of the deck's own players holds (or is loading), and a ticket per load. */
  private readonly holding = new Map<P, { run: Run<P>; part: number }>();
  private readonly tickets = new Map<P, number>();
  private published: DeckView<P> = { player: null, waiting: false };
  private ended: () => void = () => undefined;

  constructor(own: readonly [P, P], needs: DeckNeeds, reports: DeckReports<P>) {
    this.own = own;
    this.needs = needs;
    this.reports = reports;
  }

  /** What to do when a note has played to its end (or could not go on); answers how to stop being told. */
  connect(ended: () => void): () => void {
    this.ended = ended;
    return () => {
      if (this.ended === ended) this.ended = () => undefined;
    };
  }

  /**
   * Plays a note from its start, with sound. `first`: a player already showing the first part (a bubble's
   * loop) — it goes on from the start at once. Otherwise the deck waits for the first part's file.
   */
  play(files: readonly NoteFile[], totalMs: number, first: P | null = null): void {
    this.halt();
    if (!files.length) {
      // Nothing to play (a message that names no file): over before it began.
      this.publish(null, false);
      this.ended();
      return;
    }
    // A bubble's loop that cannot play its file is not lent: the first part loads into the deck's own player, where
    // a bad file is heard of (statusChange) and ends the note, instead of a ring that never moves.
    const lent = first && first !== this.own[0] && first !== this.own[1] && !broken(first) ? first : null;
    const run: Run<P> = {
      files, totalMs, first: lent, firstGone: false,
      uris: files.map(() => null), missing: new Set(), measured: files.map(() => null),
      at: 0, started: false, ready: new Set(), holds: files.map((file) => this.needs.hold(file.path)),
    };
    this.run = run;
    this.reports.progress(0);
    if (lent) {
      run.ready.add(0);
      run.measured[0] = positive(() => lent.duration);
      this.begin(run, 0);
    } else {
      this.publish(null, true);
    }
    files.forEach((file, part) => {
      if (part === 0 && lent) return;
      Promise.resolve()
        .then(() => this.needs.open(file))
        .then((uri) => this.opened(run, part, uri), () => this.lost(run, part));
    });
  }

  /** Stops the note playing, if one is: its files let go, the players paused, a lent one back at its start. */
  stop(): void {
    if (!this.halt()) return;
    this.publish(null, false);
    this.reports.progress(0);
  }

  /** A lent player is going away (its bubble left the list): if the note still needs it, the note ends; it is not touched again. */
  forget(player: P): void {
    if (this.leaving === player) this.leaving = null;
    const run = this.run;
    if (!run || run.first !== player) return;
    run.firstGone = true;
    if (run.at === 0) {
      this.finish();
      return;
    }
    // Its part is over and the next is still coming, its last frame still on screen: the player goes with its
    // bubble, so nothing may draw it any more — the screen (the corner, the bubble come back) waits on nothing.
    if (this.shown === player) {
      this.shown = null;
      if (!run.started) this.publish(null, true);
    }
  }

  /**
   * A player says its part cannot play (a file the phone cannot decode, a link gone dead): the note ends if that
   * part is the one due; one loaded for later is missing instead, and the note ends when it comes due. Without
   * this a bad part left the note "playing" for good, its ring still. A word from a source since replaced (the
   * player no longer in error) is let be.
   */
  failed(player: P): void {
    const run = this.run;
    if (!run || !broken(player)) return;
    const due = this.slotOf(run, run.at) === player;
    const held = this.holding.get(player);
    const part = due ? run.at : held && held.run === run ? held.part : null;
    if (part === null) return;
    const file = run.files[part];
    if (file) this.needs.failed?.(file);
    if (due && (run.started || part === 0 || !held)) {
      this.finish();
      return;
    }
    this.holding.delete(player);
    run.ready.delete(part);
    run.missing.add(part);
    if (part === run.at && !run.started) this.finish();
  }

  /** The screen now shows `player`: the one it replaced is free to take the next part. */
  onScreen(player: P | null): void {
    if (player !== this.shown) return;
    this.leaving = null;
    const run = this.run;
    if (!run) return;
    // In a browser a player plays only once it is drawn (its <video> is the screen's): the part due now is told
    // again. On a phone it plays already, and this changes nothing.
    if (player && run.started && this.slotOf(run, run.at) === player) quietly(() => player.play());
    this.feed(run);
  }

  /** A player reached the end of its part: the next goes on, or is waited for; after the last, the note is over. */
  partEnded(player: P): void {
    const run = this.run;
    if (!run || !run.started || this.slotOf(run, run.at) !== player) return;
    run.measured[run.at] = positive(() => player.duration) ?? run.measured[run.at] ?? null;
    // Android's player still means to play at its end (ExoPlayer keeps playWhenReady in STATE_ENDED): the next
    // file loaded into it would start at once, off screen and with sound, over the part after it. An ended
    // player keeps its last frame, so a wait for the next part looks the same.
    quietly(() => player.pause());
    const next = run.at + 1;
    if (next >= run.files.length || run.missing.has(next)) {
      this.finish();
      return;
    }
    run.at = next;
    run.started = false;
    if (run.ready.has(next)) {
      this.begin(run, next);
      return;
    }
    // Its file is still coming: the last frame stays on screen meanwhile.
    this.publish(this.shown, true);
    this.feed(run);
  }

  /** The time of the part playing: how far through the whole note. */
  timeUpdate(player: P, seconds: number): void {
    const run = this.run;
    if (!run || !run.started || this.slotOf(run, run.at) !== player) return;
    this.reports.progress(progressAt(this.lengths(run), run.at, seconds));
  }

  /** One of the deck's players has loaded its part: now its length is known, not guessed. */
  loaded(player: P, seconds: number): void {
    const held = this.holding.get(player);
    if (!held || held.run !== this.run || !(seconds > 0)) return;
    held.run.measured[held.part] = seconds;
  }

  /** Nothing plays: the deck's own players let go of their files, so neither holds a decoder while the chat is read. */
  unload(): void {
    if (this.run) return;
    for (const player of this.own) {
      if (!this.holding.has(player)) continue;
      this.holding.delete(player);
      this.tickets.set(player, (this.tickets.get(player) ?? 0) + 1);
      try {
        player.replaceAsync(null).catch(() => undefined);
      } catch {
        // Released with the screen.
      }
    }
  }

  /* ----------------------------------------------------------- the inside */

  /** Ends the note playing without a word; answers whether one was playing. */
  private halt(): boolean {
    const run = this.run;
    if (!run) return false;
    this.run = null;
    for (const letGo of run.holds) letGo();
    // Still, and quiet about their time: only the part playing reports it (ten times a second, for the ring).
    for (const player of this.own) quietly(() => { player.pause(); player.timeUpdateEventInterval = 0; });
    const lent = run.first;
    if (lent && !run.firstGone) quietly(() => giveBack(lent));
    this.shown = null;
    this.leaving = null;
    return true;
  }

  private finish(): void {
    this.stop();
    this.ended();
  }

  /** The player a part plays on: the lent one for the first part, else the deck's two in turn. */
  private slotOf(run: Run<P>, part: number): P {
    if (run.first && part === 0) return run.first;
    const turn = run.first ? part - 1 : part;
    return turn % 2 === 0 ? this.own[0] : this.own[1];
  }

  private lengths(run: Run<P>): number[] {
    return partLengths(run.files.map((file) => file.ms), run.measured, run.totalMs);
  }

  private publish(player: P | null, waiting: boolean): void {
    if (this.published.player === player && this.published.waiting === waiting) return;
    this.published = { player, waiting };
    this.reports.view(this.published);
  }

  private opened(run: Run<P>, part: number, uri: string): void {
    if (this.run !== run) return;
    run.uris[part] = uri;
    this.feed(run);
  }

  private lost(run: Run<P>, part: number): void {
    if (this.run !== run) return;
    run.missing.add(part);
    // The part waited for will not come: the note ends here (its bubble says the file could not be had).
    if (part === run.at && !run.started) this.finish();
  }

  /** A part from its start, with sound, on its player — which goes on screen; then the next part is loaded. */
  private begin(run: Run<P>, part: number): void {
    const player = this.slotOf(run, part);
    run.at = part;
    run.started = true;
    if (this.shown !== player) {
      this.leaving = this.shown;
      this.shown = player;
    }
    try {
      playLoud(player);
    } catch {
      // A lent player already let go of: the note cannot go on.
      this.finish();
      return;
    }
    // Its file already said it cannot play: no end will ever come from it.
    if (broken(player)) {
      const file = run.files[part];
      if (file) this.needs.failed?.(file);
      this.finish();
      return;
    }
    this.publish(player, false);
    this.feed(run);
  }

  /** The part waited for, then the one after it — each into its own player, never into one on screen. */
  private feed(run: Run<P>): void {
    if (this.run !== run) return;
    for (const part of [run.at, run.at + 1]) {
      if (part >= run.files.length || run.ready.has(part) || run.missing.has(part)) continue;
      if (part === run.at && run.started) continue;
      const uri = run.uris[part];
      const player = this.slotOf(run, part);
      if (!uri || player === run.first || player === this.shown || player === this.leaving) continue;
      const held = this.holding.get(player);
      if (held && held.run === run && held.part === part) continue;
      this.load(run, part, player, uri);
    }
  }

  private load(run: Run<P>, part: number, player: P, uri: string): void {
    const ticket = (this.tickets.get(player) ?? 0) + 1;
    this.tickets.set(player, ticket);
    this.holding.set(player, { run, part });
    // An answer for a load since replaced — another part, another note, a stop — is not this one's.
    const current = () => this.run === run && this.tickets.get(player) === ticket;
    // Still first: on Android a source replaced under a player that means to play starts playing at once
    // (replaceAsync prepares it with playWhenReady as it was), off screen and with sound. Nothing loaded here
    // plays until begin() says so. The pause is queued ahead of the new source; on iOS and the web it changes nothing.
    quietly(() => player.pause());
    let loading: Promise<void>;
    try {
      loading = player.replaceAsync({ uri });
    } catch {
      this.lost(run, part);
      return;
    }
    loading.then(() => {
      if (!current()) return;
      run.ready.add(part);
      if (part === run.at && !run.started) this.begin(run, part);
    }, () => {
      if (current()) this.lost(run, part);
    });
  }
}
