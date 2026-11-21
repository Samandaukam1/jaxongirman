import * as Crypto from "expo-crypto";
import { Directory, DownloadTask, File, Paths, type DownloadProgress } from "expo-file-system";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";

import { cachedMediaUrl, chatMediaAlive, mediaUrl, mediaUrlUntil, signMediaUrls, videoParts, type ChatMessage } from "@/lib/chat";
import { env } from "@/lib/env";
import { supabase } from "@/lib/supabase";
import { localFileUrl } from "@/lib/upload";

/**
 * Chat media kept on the phone: voice messages and video notes (and anything
 * else under `chat-media/`), stored once, played from disk, as Telegram does.
 *
 * WHERE
 *   Paths.document/chat-media/<conversation>/<sender>/<file> — the file's own
 *   storage path, so a path names one file forever (uploads never overwrite:
 *   every upload gets a fresh name) and clearing a conversation is one folder.
 *   Documents, not the cache: iOS does not purge it, so a voice heard once
 *   plays again offline. Downloads land in Paths.cache/chat-media-tmp first
 *   and are moved into place only when whole (Android otherwise leaves half a
 *   file behind a failed download). A recorded voice waits for its upload in
 *   Paths.document/chat-outbox/<clientId>.m4a, outside the cache's budget.
 *
 * API (all safe to call on the web, where there is no file system: there the
 * "local" address is the existing short-lived signed link instead)
 *   localMedia(path)            → file:// uri if the file is on the phone, else null. Synchronous, memoised.
 *   ensureMedia(path, { priority: "now" | "idle", onProgress, owner })
 *                               → Promise of the local uri: downloads if needed. One download per path however
 *                                 often it is asked for; three "now" at a time whatever idle work runs, and while
 *                                 any "now" file is coming no idle download starts and those running hold still
 *                                 (paused, their bytes kept); retried after 1 s, 3 s and 9 s. Rejects when the
 *                                 file cannot be had (gone from the server, no connection after the retries).
 *                                 "idle" work skipped on purpose — under ~200 MB free, dropped, called off —
 *                                 rejects too, but leaves the file "remote", never "error".
 *   openMedia(path, local?)     → what to play right now: the cached file, else the phone's own recording
 *                                 (`local`, followed if it has been adopted since), else ensureMedia(path, "now").
 *   prefetchMedia(paths)        → queue "idle" downloads. prefetchMessages(messages, { notes }) does it for a page:
 *                                 every voice, then the parts of its newest `notes` video notes only (none unless
 *                                 asked: a note is megabytes). prefetchNotes(messages, owner) fetches the parts of
 *                                 the video notes given — the ones near where a screen's list rests — and calls
 *                                 off what the same screen queued for an earlier rest and is no longer near.
 *   withdrawMedia(owner, keep?) → a screen's notes fetched ahead and not begun yet, called off (it went away).
 *   adoptMedia(uri, path, { copy })
 *                               → after an upload: the sender's own file becomes the cached copy of `path`, so the
 *                                 sender never downloads it. MOVES the file unless `copy` (so keep the uri this
 *                                 returns, or resolve by path again). Call it before sendMessage: the realtime
 *                                 echo of one's own message would otherwise prefetch the file back. sentMedia(paths)
 *                                 once the message is on the server: until then no check against it drops the file.
 *   pruneConversation(id)       → a conversation's files checked against the server: any no message this person can
 *                                 still see names (taken back, cleared, hidden — here or elsewhere) leaves the phone.
 *                                 Every file here is checked so once a run, too.
 *   keepInOutbox(uri, clientId) → a recorded take moved to the outbox, named by its message.
 *   dropMedia(path), dropMessages(messages), dropConversation(id), dropAllMedia()
 *                               → delete from the phone (a message deleted, a chat cleared, signing out).
 *   discardFile(uri)            → delete one local file quietly (a discarded take, a failed message's outbox file).
 *   touchMedia(path)            → mark as just used (call it on play), for the least-recently-used eviction.
 *   holdMedia(path)             → () => void: never evict this file until the returned function is called
 *                                 (the file playing now).
 *   mediaStatus(path), watchMedia(path, onChange)
 *                               → the state below, and a subscription to its changes.
 *   useChatMedia(path, { local, priority = "idle", auto = true })
 *                               → { uri, state, progress, retry } for a bubble. state: "local" (uri is playable),
 *                                 "downloading" (progress 0–1), "error" (retry() asks again, at "now"), or
 *                                 "remote" (not on the phone and not asked for: auto was false). With `auto` it
 *                                 starts the download itself. `local` (the sender's own file before it has a
 *                                 path in the cache) counts as "local". A new object every render: never use it
 *                                 whole as an effect dependency.
 *   useChatMediaSet(files)      → { state, progress, retry } for several files as one (a video note's parts): "local"
 *                                 once every one is here, "error" if one could not be had, "downloading" while any
 *                                 is coming (progress over all of them), else "remote". Fetches nothing itself.
 *
 * VIDEO NOTES (videoNote.ts, notePlayer.ts): a bubble loops its first part only from the file here, and only
 * while it is on screen; a tap plays every part through openMedia ("now"), holding each part while the note
 * plays and touching it when it starts. The sender's parts are adopted — copied, for the camera's file may be
 * looping in the bubble — the moment the last one lands, before sendMessage. Idle fetching is limited: the
 * conversation's newest notes when it opens, each one arriving while it is open, and those near the screen.
 *
 * KEEPING AND LETTING GO
 *   An index (chat-media/index.json, written two seconds after the last change and when the app leaves the
 *   screen) remembers each file's size and when it was last used. Ten seconds after the first use in a run, and
 *   after every ten new files, the least recently used go until each kind is back under 90% of its budget:
 *   200 MB of voice, 400 MB of video, 100 MB of anything else. A held file and one downloading are never taken;
 *   the outbox is not in the index at all. The index is checked against the folder once a run, so a file the
 *   index never heard of (the app killed before it was written) is still counted, and one gone is forgotten.
 *   iOS backs Documents up to iCloud and expo-file-system cannot exclude a folder; the budget bounds that.
 */

export type MediaPriority = "now" | "idle";
export type ChatMediaState = "local" | "downloading" | "error" | "remote";
export type ChatMediaStatus = { uri: string | null; state: ChatMediaState; progress: number };
export type ChatMedia = ChatMediaStatus & { retry: () => void };
type MediaKind = "voice" | "video" | "other";

const NATIVE = Platform.OS !== "web";
const BUCKET = "chat-media";
const MB = 1024 * 1024;
/** Downloads at once of each kind: three someone is waiting on, however much idle work runs; three idle ones. */
const PARALLEL = 3;
/** How many files one check against the server names at most: the server reads no more. */
const ALIVE_BATCH = 500;
/** A conversation's files are checked against the server on its screen at most this often (each return to the app asks). */
const PRUNE_EVERY_MS = 60_000;
/** Free space is read again after this long: every bubble asks, and the answer changes slowly. */
const SPACE_READ_MS = 5_000;
/** Waits before the second, third and fourth try. */
const RETRY_MS = [1_000, 3_000, 9_000];
/** A download that has not moved for this long is given up (and tried again). */
const STALL_MS = 20_000;
/** With less free space than this, nothing is fetched that nobody asked for. */
const IDLE_FLOOR = 200 * MB;
const BUDGET: Record<MediaKind, number> = { voice: 200 * MB, video: 400 * MB, other: 100 * MB };
/** Eviction stops once a kind is this far under its budget, so it is not run again with the next file. */
const KEEP_SHARE = 0.9;
const SAVE_MS = 2_000;
const FIRST_TIDY_MS = 10_000;
const TIDY_EVERY = 10;
/** A take left in the outbox this long belongs to a send that can no longer be retried (its screen is gone). */
const OUTBOX_AGE_MS = 24 * 3_600_000;
/** A half-download this old belongs to no running download. */
const PART_AGE_MS = 10 * 60_000;
/**
 * A part the camera recorded this long ago belongs to no note still being sent or looping from it: a sent
 * note's bubble plays the camera's file only while its conversation stays open, and the cache has a copy.
 */
const CAMERA_AGE_MS = 3_600_000;
/** The only paths written to disk: `<conversation>/<sender>/<file>`, as the app uploads them. Anything else is streamed. */
const SAFE_PATH = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/i;

const root = () => new Directory(Paths.document, "chat-media");
const outbox = () => new Directory(Paths.document, "chat-outbox");
const scratch = () => new Directory(Paths.cache, "chat-media-tmp");
/** Where expo-audio records a voice take kept in Documents: ExpoAudio on iOS, Audio on Android. */
const takes = () => new Directory(Paths.document, Platform.OS === "ios" ? "ExpoAudio" : "Audio");
/** Where expo-camera writes a recorded part (and the test scanner's photos, which are left alone): Caches/Camera. */
const camera = () => new Directory(Paths.cache, "Camera");
const isVideoFile = (name: string) => /\.(mov|mp4)$/i.test(name);
const indexFile = () => new File(Paths.document, "chat-media", "index.json");
const fileOf = (path: string) => new File(Paths.document, "chat-media", ...path.split("/"));
const cacheable = (path: string) => SAFE_PATH.test(path) && !path.includes("..");

function kindOf(path: string): MediaKind {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  if (["m4a", "aac", "mp3", "wav", "caf", "ogg", "opus"].includes(extension)) return "voice";
  if (["mp4", "mov", "m4v", "webm"].includes(extension)) return "video";
  return "other";
}

/** A failure that says whether trying again could help. */
class MediaError extends Error {
  constructor(readonly reason: string, readonly final: boolean, readonly status?: number) {
    super(`chat media: ${reason}`);
  }
}

/**
 * The HTTP status a failed download reports in its message, if it got that far: a download task says
 * "…HTTP 404" (both phones), a plain download "…status 404" (iOS) or "…status: 404" (Android).
 */
function statusOf(failure: unknown): number | null {
  if (failure instanceof MediaError) return failure.status ?? null;
  const match = /(?:status:?|HTTP)\s*(\d{3})/i.exec(failure instanceof Error ? failure.message : String(failure));
  return match ? Number(match[1]) : null;
}

/** Not worth another try: the file is gone or refused, or the chat was cleared meanwhile. */
function fatal(failure: unknown): boolean {
  if (failure instanceof MediaError) return failure.final;
  return [400, 403, 404, 410].includes(statusOf(failure) ?? 0);
}

/* ------------------------------------------------------------------ state */

type Entry = { size: number; used: number };
type Job = {
  path: string;
  priority: MediaPriority;
  seq: number;
  progress: number;
  /** What the path's epoch was when the job began: a drop since then means the file must not land. */
  epoch: string;
  promise: Promise<string>;
  /** Cuts a wait between tries short, when someone now wants the file at once (or it was called off). */
  nudge: (() => void) | null;
  listeners: Set<(share: number) => void>;
  /** The kind of slot it holds while it downloads, as counted when it took one: a "now" never waits for idle work. */
  slot: MediaPriority | null;
  /** The screen that fetched it ahead for where its list rested (prefetchNotes): only that screen calls it off. */
  owner: string | null;
  /** Called off between two tries: it stops at its next step. */
  withdrawn: boolean;
  /** Its download under way, which holds still while a file someone is waiting on comes first. */
  transfer: Transfer | null;
};

/** A download under way: held still with its bytes kept, then let go on. */
type Transfer = { pause: () => void; resume: () => void };

/** Whether each path's file is on the phone, as far as this run knows: its uri, or null. */
const known = new Map<string, string | null>();
const jobs = new Map<string, Job>();
/** Paths whose last download failed, and whether for good. */
const failed = new Map<string, boolean>();
/** Files that must not be evicted, with how many holders. */
const held = new Map<string, number>();
/** Where an adopted file went: its old address still finds it. */
const moved = new Map<string, string>();
/** The cache's own files made from this phone's recordings (adoptMedia), and the path each is: the cache speaks for them. */
const adopted = new Map<string, string>();
/**
 * Files adopted this run whose message the server has not confirmed yet (adoptMedia comes before sendMessage):
 * the server knows no message naming them, and a check of what still lives must not take them for gone.
 */
const unsent = new Set<string>();
/** When each conversation's files were last checked against the server. */
const pruned = new Map<string, number>();
const index = new Map<string, Entry>();
const statuses = new Map<string, ChatMediaStatus>();
const localStatuses = new Map<string, ChatMediaStatus>();
const watchers = new Map<string, Set<() => void>>();
/** Bumped by a drop, so a download already running for what was dropped is thrown away instead of landing. */
let epoch = 0;
const conversationEpochs = new Map<string, number>();
const pathEpochs = new Map<string, number>();
let serial = 0;
let stores = 0;

function epochOf(path: string): string {
  const conversation = path.split("/")[0] ?? "";
  return `${epoch}:${conversationEpochs.get(conversation) ?? 0}:${pathEpochs.get(path) ?? 0}`;
}

/* --------------------------------------------------------------- reading */

/** The file's local address, if it is on the phone; memoised for the run (every write goes through here). */
export function localMedia(path: string | null | undefined): string | null {
  if (!path) return null;
  if (!NATIVE) return cachedMediaUrl(path);
  const hit = known.get(path);
  if (hit !== undefined) return hit;
  let uri: string | null = null;
  if (cacheable(path)) {
    try {
      const file = fileOf(path);
      if (file.exists && (file.size ?? 0) > 0) uri = file.uri;
    } catch {
      uri = null;
    }
  }
  known.set(path, uri);
  if (uri && !index.has(path)) index.set(path, { size: sizeOf(uri), used: Date.now() });
  return uri;
}

function sizeOf(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

const REMOTE: ChatMediaStatus = { uri: null, state: "remote", progress: 0 };

/** Where a file stands: on the phone, downloading, failed, or not asked for. The same object until it changes. */
export function mediaStatus(path: string): ChatMediaStatus {
  const cached = statuses.get(path);
  if (cached) return cached;
  const uri = localMedia(path);
  const job = jobs.get(path);
  const next: ChatMediaStatus = uri ? { uri, state: "local", progress: 1 }
    : job ? { uri: null, state: "downloading", progress: job.progress }
    : failed.has(path) ? { uri: null, state: "error", progress: 0 }
    : REMOTE;
  statuses.set(path, next);
  if (!NATIVE && uri) renewSoon(path);
  return next;
}

/* ------------------------------------------------------- web: links renewed */

/**
 * In a browser the "local" address is a signed link, kept for 55 minutes. A bubble watching it kept that status —
 * and its link — after it ran out: a note that looped again an hour later drew nothing, and a tap played a dead
 * link for good. So the link of every watched path is renewed a little before it runs out, all that are due in one
 * request, and the status goes from one good link to the next, never through "remote".
 */
const RENEW_AHEAD_MS = 2 * 60_000;
const renewals = new Map<string, ReturnType<typeof setTimeout>>();
const due = new Set<string>();
let renewing: ReturnType<typeof setTimeout> | null = null;

function renewSoon(path: string): void {
  if (renewals.has(path) || !watchers.has(path)) return;
  const until = mediaUrlUntil(path);
  if (!until) return;
  renewals.set(path, setTimeout(() => {
    renewals.delete(path);
    if (!watchers.has(path)) return;
    due.add(path);
    renewing ??= setTimeout(renewDue, 200);
  }, Math.max(1_000, until - Date.now() - RENEW_AHEAD_MS)));
}

function renewDue(): void {
  renewing = null;
  const paths = [...due];
  due.clear();
  signMediaUrls(paths, { renew: true }).then(() => { for (const path of paths) changed(path); }, () => undefined);
}

function stopRenewing(path: string): void {
  const timer = renewals.get(path);
  if (timer) clearTimeout(timer);
  renewals.delete(path);
  due.delete(path);
}

/** Calls `onChange` whenever the path's status changes; answers how to stop. */
export function watchMedia(path: string, onChange: () => void): () => void {
  let set = watchers.get(path);
  if (!set) watchers.set(path, (set = new Set()));
  set.add(onChange);
  // A link signed before anyone watched is renewed from now on (see renewSoon).
  if (!NATIVE) renewSoon(path);
  return () => {
    const current = watchers.get(path);
    if (!current) return;
    current.delete(onChange);
    if (!current.size) {
      watchers.delete(path);
      statuses.delete(path);
      stopRenewing(path);
    }
  };
}

function changed(path: string): void {
  statuses.delete(path);
  const set = watchers.get(path);
  if (set) for (const onChange of [...set]) onChange();
}

/* ------------------------------------------------------------- the queue */

/**
 * Jobs waiting for a slot. `stop` turns one away (it was called off while it waited): its promise must
 * settle, or whoever asks for the same file later would wait on it forever.
 */
const waiting: { job: Job; go: () => void; stop: (failure: MediaError) => void }[] = [];
/** Slots taken, by the kind each job was when it took its slot. */
const running: Record<MediaPriority, number> = { now: 0, idle: 0 };
/** The jobs holding a slot. */
const busy = new Set<Job>();

/** A file someone is waiting on is coming or waits for a slot: then idle work holds still. */
function wantedNow(): boolean {
  for (const job of busy) if (job.priority === "now") return true;
  return waiting.some((entry) => entry.job.priority === "now");
}

/** The longest-waiting job of one kind, by its place in `waiting`; -1 when there is none. */
function oldest(priority: MediaPriority): number {
  let best = -1;
  for (let at = 0; at < waiting.length; at += 1) {
    const job = waiting[at]!.job;
    if (job.priority === priority && (best < 0 || job.seq < waiting[best]!.job.seq)) best = at;
  }
  return best;
}

/**
 * Starts what may start. A file someone is waiting on (a tap) starts while fewer than three such run, however
 * many idle downloads are under way — it used to wait behind three notes fetched ahead, its ring at 0% for tens
 * of seconds on a slow line. Idle work starts only while nothing is wanted at once, so slots freed meanwhile
 * do not go straight back to it, and what idle work runs holds still until the wanted files are in (`steer`).
 */
function pump(): void {
  for (;;) {
    let at = running.now < PARALLEL ? oldest("now") : -1;
    if (at < 0 && running.idle < PARALLEL && !wantedNow()) at = oldest("idle");
    const entry = at >= 0 ? waiting.splice(at, 1)[0] : undefined;
    if (!entry) break;
    entry.job.slot = entry.job.priority;
    running[entry.job.slot] += 1;
    busy.add(entry.job);
    entry.go();
  }
  steer();
}

/**
 * Idle downloads hold still — paused, their bytes kept — while a file someone is waiting on comes, so it has
 * the line to itself; once none is wanted, they go on where they stopped. A job raised to "now" while it held
 * still goes on at once.
 */
function steer(): void {
  const hold = wantedNow();
  for (const job of busy) {
    if (!job.transfer) continue;
    if (hold && job.priority === "idle") job.transfer.pause();
    else job.transfer.resume();
  }
}

function acquire(job: Job): Promise<void> {
  return new Promise((go, stop) => {
    waiting.push({ job, go, stop });
    pump();
  });
}

/** A slot given back, of the kind it was taken as: a job raised to "now" meanwhile still frees an idle one. */
function release(job: Job): void {
  if (job.slot) running[job.slot] = Math.max(0, running[job.slot] - 1);
  job.slot = null;
  busy.delete(job);
  pump();
}

function rest(job: Job, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      if (job.nudge === done) job.nudge = null;
      resolve();
    };
    const timer = setTimeout(done, ms);
    job.nudge = done;
  });
}

let spaceReadAt = 0;
let spaceLow = false;

/**
 * Under ~200 MB free (iOS counts no purgeable space in it, so this is common). Read again every few seconds
 * at most: every bubble that fetches ahead asks.
 */
function lowOnSpace(): boolean {
  const now = Date.now();
  if (now - spaceReadAt < SPACE_READ_MS) return spaceLow;
  spaceReadAt = now;
  try {
    const free = Paths.availableDiskSpace;
    spaceLow = typeof free === "number" && free > 0 && free < IDLE_FLOOR;
  } catch {
    spaceLow = false;
  }
  return spaceLow;
}

/**
 * Work left undone on purpose — the file dropped meanwhile, called off by its screen, or nobody's file with
 * the disk nearly full — is no failure: the file stays "remote", and no bubble shows a retry for it.
 */
function skipped(failure: unknown): boolean {
  return failure instanceof MediaError && (failure.reason === "dropped" || failure.reason === "withdrawn" || failure.reason === "low on space");
}

/**
 * The file on the phone, downloading it if need be. Asked twice, it is fetched once; asked "now" while it
 * waits as "idle", it moves to the front — and no screen's rest calls it off any more. `owner`: the screen
 * that fetches it ahead for where its list rests (prefetchNotes), which may call it off again.
 */
export function ensureMedia(
  path: string, options: { priority?: MediaPriority; onProgress?: (share: number) => void; owner?: string } = {},
): Promise<string> {
  const priority = options.priority ?? "now";
  const here = localMedia(path);
  if (here) return Promise.resolve(here);
  const pending = jobs.get(path);
  if (pending) {
    if (options.onProgress) pending.listeners.add(options.onProgress);
    if (priority === "now" && pending.priority === "idle") {
      pending.priority = "now";
      pending.owner = null;
      pending.nudge?.();
      pump();
    }
    return pending.promise;
  }
  // A path this phone will not write to disk (not one the app makes): played from a signed link instead.
  if (NATIVE && !cacheable(path)) return linkOf(path);
  // Nobody's file, with the disk nearly full: skipped before any job is made, so the file reads as "remote" as
  // it did (an "error" from earlier stays one) and every bubble that asks again skips as quietly.
  if (NATIVE && priority === "idle" && lowOnSpace()) return Promise.reject(new MediaError("low on space", true));
  tidySoon();
  const job: Job = {
    path, priority, seq: (serial += 1), progress: 0, epoch: epochOf(path), promise: Promise.resolve(""), nudge: null,
    listeners: new Set(options.onProgress ? [options.onProgress] : []),
    slot: null, owner: priority === "idle" ? options.owner ?? null : null, withdrawn: false, transfer: null,
  };
  jobs.set(path, job);
  failed.delete(path);
  const settle = () => { if (jobs.get(path) === job) jobs.delete(path); };
  job.promise = run(job).then(
    (uri) => {
      settle();
      changed(path);
      revive();
      return uri;
    },
    (failure: unknown) => {
      settle();
      if (!skipped(failure)) failed.set(path, fatal(failure));
      changed(path);
      throw failure;
    },
  );
  changed(path);
  return job.promise;
}

async function run(job: Job): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    if (job.withdrawn) throw new MediaError("withdrawn", true);
    // An idle job waiting between tries while the disk filled up.
    if (NATIVE && job.priority === "idle" && lowOnSpace()) throw new MediaError("low on space", true);
    // Turned away here if its screen calls it off while it waits.
    await acquire(job);
    try {
      return NATIVE ? await fetchFile(job) : await linkOf(job.path);
    } catch (failure) {
      if (fatal(failure) || attempt >= RETRY_MS.length) throw failure;
    } finally {
      release(job);
    }
    await rest(job, RETRY_MS[attempt] ?? 9_000);
    if (job.epoch !== epochOf(job.path)) throw new MediaError("dropped", true);
  }
}

async function linkOf(path: string): Promise<string> {
  const url = await mediaUrl(path);
  if (!url) throw new MediaError("no signed link", false);
  return url;
}

function progressed(job: Job, share: number): void {
  job.progress = share;
  for (const listener of job.listeners) listener(share);
  changed(job.path);
}

/** One try: downloaded beside the cache, then moved into place whole. */
async function fetchFile(job: Job): Promise<string> {
  // Dropped while it waited for its turn (the chat cleared, the account signed out): not fetched at all.
  if (job.epoch !== epochOf(job.path)) throw new MediaError("dropped", true);
  const folder = scratch();
  folder.create({ intermediates: true, idempotent: true });
  const part = new File(folder, `${Crypto.randomUUID()}.part`);
  const partUri = part.uri;
  let placed = false;
  try {
    const onProgress = (share: number) => progressed(job, share);
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    try {
      if (!token) throw new MediaError("signed out", false, 401);
      // The request storage-js's download() makes: the object endpoint, under the person's own session.
      await download(job, `${env.supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/${BUCKET}/${job.path}`, part, {
        Authorization: `Bearer ${token}`,
        apikey: env.supabaseAnonKey,
      }, onProgress);
    } catch (failure) {
      // A lost connection is tried again as it is; a refusal (an older storage server, a token on its way
      // out) has a second way in: a signed link, which carries its own permission.
      if (statusOf(failure) === null) throw failure;
      const link = await mediaUrl(job.path);
      if (!link) throw failure;
      await download(job, link, part, {}, onProgress);
    }
    if (job.epoch !== epochOf(job.path)) throw new MediaError("dropped", true);
    const size = part.size ?? 0;
    if (size <= 0) throw new MediaError("empty file", false);
    const target = fileOf(job.path);
    target.parentDirectory.create({ intermediates: true, idempotent: true });
    await part.move(target, { overwrite: true });
    placed = true;
    stored(job.path, target.uri, size);
    return target.uri;
  } finally {
    if (!placed) discardFile(partUri);
  }
}

/**
 * One download, given up when it stops moving: the request has no other timeout worth waiting for.
 *
 * It can hold still (`job.transfer`, steered by the queue): an idle one is paused while a file someone is
 * waiting on comes, its bytes kept, and goes on from where it stopped once that is in. A pause never counts
 * as a stall. Where the server gave nothing to go on from (iOS keeps resume data only when the server says
 * where a file ends), it starts again from its beginning.
 */
async function download(
  job: Job, url: string, file: File, headers: Record<string, string>, onProgress: (share: number) => void,
): Promise<void> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holding = false;
  let wake: (() => void) | null = null;
  const watch = () => {
    clearTimeout(timer);
    if (!holding) timer = setTimeout(() => controller.abort(), STALL_MS);
  };
  const options = {
    headers,
    signal: controller.signal,
    onProgress: ({ bytesWritten, totalBytes }: DownloadProgress) => {
      watch();
      if (totalBytes > 0) onProgress(Math.min(1, bytesWritten / totalBytes));
    },
  };
  let task = new DownloadTask(url, file, options);
  job.transfer = {
    pause: () => {
      if (holding) return;
      holding = true;
      clearTimeout(timer);
      try {
        task.pause();
      } catch {
        // Not under way this instant (not begun, or just finished): it holds still at its next step instead.
      }
    },
    resume: () => {
      if (!holding) return;
      holding = false;
      const go = wake;
      wake = null;
      go?.();
    },
  };
  // Begun while a file someone is waiting on is still coming: it holds still from the start.
  steer();
  try {
    let begun = false;
    for (;;) {
      if (holding) await new Promise<void>((resolve) => { wake = resolve; });
      watch();
      let done: File | null;
      if (!begun) {
        begun = true;
        done = await task.downloadAsync();
      } else {
        try {
          done = await task.resumeAsync();
        } catch (failure) {
          if (controller.signal.aborted) throw failure;
          // Nothing to go on from: the whole file again, into the same place.
          task = new DownloadTask(url, file, options);
          done = await task.downloadAsync();
        }
      }
      // A file: done. Nothing: it was paused, and goes on when it is let.
      if (done) return;
    }
  } finally {
    clearTimeout(timer);
    job.transfer = null;
  }
}

function stored(path: string, uri: string, size: number): void {
  known.set(path, uri);
  failed.delete(path);
  index.set(path, { size, used: Date.now() });
  saveSoon();
  stores += 1;
  if (stores % TIDY_EVERY === 0) void tidy();
}

/** Downloads that failed for want of a connection are tried again once something gets through, or the app is back. */
function revive(): void {
  for (const [path, final] of [...failed]) {
    if (final || !watchers.has(path)) continue;
    failed.delete(path);
    ensureMedia(path, { priority: "idle" }).catch(() => undefined);
  }
}

/* ------------------------------------------------------------ the callers */

/**
 * The phone's own recording standing for a message (`local`, followed where it was adopted since), or null. A
 * recording once adopted *is* the cache's file of its path: when that file is dropped (evicted, a play that failed,
 * a clear seen) the cache's word counts, and the path is fetched like anyone's — trusting the old address played
 * a deleted file at every tap, failing for good until the chat was opened again.
 */
function ownFile(local: string | null | undefined): string | null {
  if (!local) return null;
  const at = moved.get(local) ?? local;
  const path = NATIVE ? adopted.get(at) : undefined;
  // Still the cache's file while the cache has it — which is also what a bubble still sending plays (it has no path yet).
  return path === undefined || localMedia(path) === at ? at : null;
}

/**
 * What to play now: the cached file, else the phone's own recording (looked for on the disk — this is a tap,
 * not a render: a recording swept from under its message is not handed to a player), else the file fetched at once.
 */
export function openMedia(path: string | null | undefined, local?: string | null): Promise<string> {
  const cached = path ? localMedia(path) : null;
  if (cached) return Promise.resolve(cached);
  const own = ownFile(local);
  if (own && (!NATIVE || localFileSize(own) > 0)) return Promise.resolve(own);
  if (path) return ensureMedia(path, { priority: "now" });
  return Promise.reject(new MediaError(own ? "the recording is gone" : "nothing to open", true));
}

/**
 * Files nobody asked for yet, fetched in the background in the order given. `owner`: the screen fetching them
 * for where its list rests, which may call them off again (withdrawMedia).
 */
export function prefetchMedia(paths: readonly (string | null | undefined)[], owner?: string): void {
  const wanted = [...new Set(paths.filter((path): path is string => Boolean(path)))];
  if (!wanted.length) return;
  if (!NATIVE) {
    signMediaUrls(wanted).then(() => { for (const path of wanted) changed(path); }, () => undefined);
    return;
  }
  for (const path of wanted) {
    if (!cacheable(path) || localMedia(path)) continue;
    const job = jobs.get(path);
    if (job) {
      // Already coming. Asked for again without a screen (a page's voices, a conversation's newest notes):
      // no rest calls it off any more. Still near where the same screen rests: back in line in the order
      // asked now, so the newest rest's notes come in its own order.
      if (!owner) job.owner = null;
      else if (job.owner === owner) job.seq = (serial += 1);
      continue;
    }
    ensureMedia(path, { priority: "idle", owner }).catch(() => undefined);
  }
}

/**
 * A screen's notes fetched ahead and no longer wanted: those of `owner` not in `keep` and not begun yet are
 * called off (the screen's list rested elsewhere, or it went away). One already downloading finishes; one
 * asked for at once since (a tap, a retry, the profile's viewer) or for any other reason (a conversation's
 * newest notes, a voice) is not the screen's to call off.
 */
export function withdrawMedia(owner: string, keep: readonly string[] = []): void {
  if (!NATIVE) return;
  const near = new Set(keep);
  for (const job of [...jobs.values()]) {
    if (job.owner !== owner || job.priority !== "idle" || near.has(job.path)) continue;
    const at = waiting.findIndex((entry) => entry.job === job);
    if (at >= 0) {
      // Its promise settles (as nothing failed), so nobody waits on it.
      waiting.splice(at, 1)[0]?.stop(new MediaError("withdrawn", true));
    } else if (job.nudge) {
      // Between two tries: it wakes, finds itself called off, and stops.
      job.withdrawn = true;
      job.nudge();
    } else {
      continue;
    }
    // A tap from here on starts a fresh download rather than joining this one on its way out.
    jobs.delete(job.path);
    changed(job.path);
  }
}

/**
 * A page of messages made ready before anyone taps: every voice (kilobytes, and nearly always heard), then the
 * parts of the newest `notes` video notes among them (newest first, as pages come). The other notes — megabytes
 * each, on whatever connection the phone is on — wait until the list rests near them, or a tap.
 */
export function prefetchMessages(messages: readonly ChatMessage[], options: { notes?: number } = {}): void {
  const voices: string[] = [];
  const notes: ChatMessage[] = [];
  const wanted = options.notes ?? 0;
  for (const message of messages) {
    if (message.deleted_at || message.pending) continue;
    if (message.kind === "voice" && message.media_path) voices.push(message.media_path);
    else if (message.kind === "video" && notes.length < wanted) notes.push(message);
  }
  prefetchMedia([...voices, ...partsOf(notes)]);
}

/**
 * Video notes about to be seen (near where a screen's list rests): every part, in the background, in the order
 * given. With `owner` (the screen) these are all its list is near now: what the same screen fetched ahead for
 * an earlier rest and is not among them is called off first — a slow read through a chat full of notes, or one
 * opened and left at once, no longer keeps fetching every place it ever rested.
 */
export function prefetchNotes(messages: readonly ChatMessage[], owner?: string): void {
  const paths = partsOf(messages.filter((message) => message.kind === "video" && !message.deleted_at && !message.pending));
  if (owner) withdrawMedia(owner, paths);
  prefetchMedia(paths, owner);
}

function partsOf(notes: readonly ChatMessage[]): string[] {
  return notes.flatMap((note) => videoParts(note).map((part) => part.path));
}

/** Every storage path a message names: its file and its parts or pictures. */
export function mediaOf(message: Pick<ChatMessage, "media_path" | "items">): string[] {
  const paths = new Set<string>();
  if (message.media_path) paths.add(message.media_path);
  for (const item of message.items ?? []) if (item.path) paths.add(item.path);
  return [...paths];
}

/**
 * The sender's own file, made the cached copy of what it was uploaded as. Moved (or copied, with `copy`), never
 * read: answers its new address, or null if it could not be kept (then it simply downloads when needed).
 */
export async function adoptMedia(uri: string | null | undefined, path: string | null | undefined, options: { copy?: boolean } = {}): Promise<string | null> {
  if (!NATIVE || !uri || !path || !cacheable(path)) return null;
  tidySoon();
  // No message names it on the server yet (sendMessage comes after): kept from the check against it until sentMedia.
  unsent.add(path);
  try {
    const source = new File(localFileUrl(uri));
    if (!source.exists) return null;
    const size = source.size ?? 0;
    const target = fileOf(path);
    target.parentDirectory.create({ intermediates: true, idempotent: true });
    if (options.copy) await source.copy(target, { overwrite: true });
    else await source.move(target, { overwrite: true });
    if (!options.copy) moved.set(uri, target.uri);
    adopted.set(target.uri, path);
    localStatuses.delete(uri);
    stored(path, target.uri, size);
    changed(path);
    return target.uri;
  } catch {
    return null;
  }
}

/** The message naming these adopted files is on the server: from now on they are checked like any other. */
export function sentMedia(paths: readonly (string | null | undefined)[]): void {
  for (const path of paths) if (path) unsent.delete(path);
}

/**
 * A conversation's own files checked against the server (`prune`): when its screen opens, and when the app
 * comes back to it — Realtime does not replay what happened while nobody listened, and a message taken back on
 * a page never loaded never reaches the screen at all. At most once a minute for a conversation.
 */
export function pruneConversation(conversationId: string | null | undefined): void {
  if (!NATIVE || !conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) return;
  const now = Date.now();
  if (now - (pruned.get(conversationId) ?? 0) < PRUNE_EVERY_MS) return;
  pruned.set(conversationId, now);
  void prune([...walk(conversationId).keys()]);
}

/**
 * Files here that no message this person can still see names — taken back, cleared (here, on another phone,
 * or by the other person for both), hidden on another phone — leave the phone. Files are dropped only on the
 * server's clear answer: no connection, or a server without the check yet, drops nothing. A file held, coming,
 * used since the question was asked, or not sent yet stays whatever the answer.
 */
async function prune(paths: readonly string[]): Promise<void> {
  const asked = Date.now();
  const keep = (path: string) => held.has(path) || jobs.has(path) || unsent.has(path) || (index.get(path)?.used ?? 0) >= asked;
  const candidates = paths.filter((path) => cacheable(path) && !keep(path));
  for (let at = 0; at < candidates.length; at += ALIVE_BATCH) {
    const batch = candidates.slice(at, at + ALIVE_BATCH);
    let alive: Set<string>;
    try {
      alive = new Set(await chatMediaAlive(batch));
    } catch {
      return;
    }
    for (const path of batch) if (!alive.has(path) && !keep(path)) dropMedia(path);
  }
}

/**
 * A recorded take moved where nothing purges it, named by the message it will be (`chat-outbox/<clientId>.m4a`),
 * until it is uploaded and adopted. Answers the new address, or the old one if it could not move.
 */
export async function keepInOutbox(uri: string, clientId: string): Promise<string> {
  if (!NATIVE || !/^[0-9a-f-]{36}$/i.test(clientId)) return uri;
  try {
    const source = new File(localFileUrl(uri));
    const folder = outbox();
    folder.create({ intermediates: true, idempotent: true });
    const target = new File(folder, `${clientId}${source.extension || ".m4a"}`);
    await source.move(target, { overwrite: true });
    return target.uri;
  } catch {
    return uri;
  }
}

/** How many bytes a local file holds: 0 when it is not there (or on the web). */
export function localFileSize(uri: string | null | undefined): number {
  if (!NATIVE || !uri) return 0;
  try {
    const file = new File(localFileUrl(uri));
    return file.exists ? file.size ?? 0 : 0;
  } catch {
    return 0;
  }
}

/** One local file deleted, quietly: it may already be gone. */
export function discardFile(uri: string | null | undefined): void {
  if (!NATIVE || !uri) return;
  try {
    const file = new File(localFileUrl(uri));
    if (file.exists) file.delete();
  } catch {
    // Already gone, or never there: nothing to keep.
  }
}

/** Just used: the last to be evicted. */
export function touchMedia(path: string | null | undefined): void {
  if (!NATIVE || !path) return;
  const entry = index.get(path);
  if (!entry) return;
  entry.used = Date.now();
  saveSoon();
}

/** Keeps a file from eviction (the one playing) until the answer is called. */
export function holdMedia(path: string | null | undefined): () => void {
  if (!path) return () => undefined;
  held.set(path, (held.get(path) ?? 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (held.get(path) ?? 1) - 1;
    if (left > 0) held.set(path, left);
    else held.delete(path);
  };
}

/* --------------------------------------------------------------- letting go */

/** A file gone from the phone (its message deleted): a download of it under way is thrown away when it lands. */
export function dropMedia(path: string | null | undefined): void {
  if (!NATIVE || !path) return;
  pathEpochs.set(path, (pathEpochs.get(path) ?? 0) + 1);
  if (cacheable(path)) discardFile(fileOf(path).uri);
  known.set(path, null);
  failed.delete(path);
  if (index.delete(path)) saveSoon();
  changed(path);
}

/** Every file a set of messages named. */
export function dropMessages(messages: readonly Pick<ChatMessage, "media_path" | "items">[]): void {
  for (const message of messages) for (const path of mediaOf(message)) dropMedia(path);
}

/** A cleared conversation's files, all at once: its folder. */
export function dropConversation(conversationId: string | null | undefined): void {
  if (!NATIVE || !conversationId || !/^[0-9a-f-]{36}$/i.test(conversationId)) return;
  conversationEpochs.set(conversationId, (conversationEpochs.get(conversationId) ?? 0) + 1);
  try {
    const folder = new Directory(Paths.document, "chat-media", conversationId);
    if (folder.exists) folder.delete();
  } catch {
    // Gone already.
  }
  forget(`${conversationId}/`);
}

/** Everything chat kept on the phone — signing out, the account deleted: the next person here finds none of it. */
export function dropAllMedia(): void {
  if (!NATIVE) return;
  epoch += 1;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  // The voice takes and the camera's video parts too: nobody else's face or voice is left behind.
  for (const folder of [root, outbox, scratch, takes]) {
    try {
      const directory = folder();
      if (directory.exists) directory.delete();
    } catch {
      // Gone already.
    }
  }
  sweep(camera(), 0, isVideoFile);
  moved.clear();
  adopted.clear();
  localStatuses.clear();
  unsent.clear();
  pruned.clear();
  forget("");
}

function forget(prefix: string): void {
  for (const path of [...known.keys()]) if (path.startsWith(prefix)) known.delete(path);
  for (const path of [...index.keys()]) if (path.startsWith(prefix)) index.delete(path);
  for (const path of [...failed.keys()]) if (path.startsWith(prefix)) failed.delete(path);
  saveSoon();
  for (const path of [...watchers.keys()]) if (path.startsWith(prefix)) changed(path);
}

/* --------------------------------------------------- the index and eviction */

let saveTimer: ReturnType<typeof setTimeout> | null = null;
/**
 * The saved index has been read into this run's (reconcile). Until then the run knows only the files it has
 * looked at, and a save merges them into what was saved — written over it, every other file's last use was
 * lost, and "least recently used" became "oldest download first".
 */
let merged = false;

function saveSoon(): void {
  if (!NATIVE) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_MS);
}

function save(): void {
  saveTimer = null;
  try {
    const folder = root();
    if (!index.size && !folder.exists) return;
    const entries: Record<string, [number, number]> = {};
    if (!merged) {
      try {
        const file = indexFile();
        if (file.exists) Object.assign(entries, (JSON.parse(file.textSync()) as { entries?: Record<string, [number, number]> }).entries ?? {});
      } catch {
        // Unreadable or broken: replaced by what this run knows.
      }
    }
    for (const [path, entry] of index) entries[path] = [entry.size, entry.used];
    folder.create({ intermediates: true, idempotent: true });
    indexFile().write(JSON.stringify({ v: 1, entries }));
  } catch {
    // Written again with the next change; the folder is the truth anyway.
  }
}

let tidyTimer: ReturnType<typeof setTimeout> | null = null;
let reconciled: Promise<void> | null = null;

function tidySoon(): void {
  if (!NATIVE || tidyTimer || reconciled) return;
  tidyTimer = setTimeout(() => { void tidy(); }, FIRST_TIDY_MS);
}

async function tidy(): Promise<void> {
  try {
    await reconcile();
    evict();
  } catch {
    // Tried again after the next ten files.
  }
}

/** Once a run: the saved index checked against the folder, half-downloads and stale outbox takes cleared. */
function reconcile(): Promise<void> {
  reconciled ??= (async () => {
    let saved: Record<string, [number, number]> = {};
    try {
      const file = indexFile();
      if (file.exists) saved = (JSON.parse(await file.text()) as { entries?: Record<string, [number, number]> }).entries ?? {};
    } catch {
      saved = {};
    }
    const found = walk();
    for (const [path, disk] of found) {
      const used = Math.max(index.get(path)?.used ?? 0, saved[path]?.[1] ?? 0) || disk.modified;
      index.set(path, { size: disk.size, used });
    }
    for (const path of [...index.keys()]) if (!found.has(path)) index.delete(path);
    for (const [path, uri] of [...known]) {
      if (uri && !found.has(path)) {
        known.delete(path);
        changed(path);
      }
    }
    sweep(scratch(), PART_AGE_MS);
    sweep(outbox(), OUTBOX_AGE_MS);
    // Takes and parts no message took with it — the composer gone mid-take, a cancelled or failed note, the
    // app killed — and that nothing else ever deletes.
    sweep(takes(), OUTBOX_AGE_MS);
    sweep(camera(), CAMERA_AGE_MS, isVideoFile);
    // From here the index holds everything known, and save() writes it as it is.
    merged = true;
    saveSoon();
    // And every file kept here, checked against what this person can still see.
    void prune([...found.keys()]);
  })();
  return reconciled;
}

/** Every file in the folder — or in one conversation's — by its storage path. */
function walk(only?: string): Map<string, { size: number; modified: number }> {
  const found = new Map<string, { size: number; modified: number }>();
  try {
    const top = root();
    if (!top.exists) return found;
    for (const conversation of only ? [new Directory(top, only)] : top.list()) {
      if (!(conversation instanceof Directory) || !conversation.exists) continue;
      for (const sender of conversation.list()) {
        if (!(sender instanceof Directory)) continue;
        for (const file of sender.list()) {
          if (!(file instanceof File)) continue;
          const path = `${conversation.name}/${sender.name}/${file.name}`;
          if (cacheable(path)) found.set(path, { size: file.size ?? 0, modified: file.lastModified ?? 0 });
        }
      }
    }
  } catch {
    // What was found so far is still true.
  }
  return found;
}

/** Files older than `age` in a folder (those `only` lets through, if given), deleted. */
function sweep(folder: Directory, age: number, only?: (name: string) => boolean): void {
  try {
    if (!folder.exists) return;
    const before = Date.now() - age;
    for (const entry of folder.list()) {
      if (entry instanceof File && (!only || only(entry.name)) && (entry.lastModified ?? 0) < before) discardFile(entry.uri);
    }
  } catch {
    // Next run.
  }
}

/** Over budget, the least recently used go first, until each kind is back under 90% of its budget. */
function evict(): void {
  const groups: Record<MediaKind, [string, Entry][]> = { voice: [], video: [], other: [] };
  for (const pair of index) groups[kindOf(pair[0])].push(pair);
  let dropped = false;
  for (const kind of ["voice", "video", "other"] as const) {
    const list = groups[kind];
    let total = list.reduce((sum, [, entry]) => sum + entry.size, 0);
    if (total <= BUDGET[kind]) continue;
    list.sort((a, b) => a[1].used - b[1].used);
    for (const [path, entry] of list) {
      if (total <= BUDGET[kind] * KEEP_SHARE) break;
      if (held.has(path) || jobs.has(path)) continue;
      discardFile(fileOf(path).uri);
      index.delete(path);
      known.set(path, null);
      total -= entry.size;
      dropped = true;
      changed(path);
    }
  }
  if (dropped) saveSoon();
}

if (NATIVE) {
  AppState.addEventListener("change", (state) => {
    if (state === "active") revive();
    else if (saveTimer) {
      // Leaving the screen: the index is written now, while the app still runs.
      clearTimeout(saveTimer);
      save();
    }
  });
}

/* ------------------------------------------------------------------ React */

const NO_FILE: ChatMediaStatus = REMOTE;
const noWatch = () => () => undefined;

function localStatus(uri: string): ChatMediaStatus {
  let status = localStatuses.get(uri);
  if (!status) localStatuses.set(uri, (status = { uri: moved.get(uri) ?? uri, state: "local", progress: 1 }));
  return status;
}

function snapshotOf(path: string | null, local: string | null): ChatMediaStatus {
  const status = path ? mediaStatus(path) : null;
  if (status?.state === "local") return status;
  // A recording adopted and since dropped is no file of the phone's own any more: the path's standing counts.
  if (local && ownFile(local)) return localStatus(local);
  return status ?? NO_FILE;
}

/**
 * A chat file for a bubble: where it is, and whether it is coming. With `auto` (the default) a file not on the
 * phone is fetched at `priority` (default "idle"); `retry()` asks again at once. `local` is the sender's own
 * file before the cache has it — then nothing is fetched.
 */
export function useChatMedia(
  path: string | null | undefined,
  options: { local?: string | null; priority?: MediaPriority; auto?: boolean } = {},
): ChatMedia {
  const { local = null, priority = "idle", auto = true } = options;
  const target = path ?? null;
  const subscribe = useCallback((onChange: () => void) => (target ? watchMedia(target, onChange) : noWatch()), [target]);
  const status = useSyncExternalStore(subscribe, () => snapshotOf(target, local), () => snapshotOf(target, local));
  const fetching = auto && !ownFile(local) && target !== null;
  useEffect(() => {
    if (!fetching || !target) return;
    ensureMedia(target, { priority }).catch(() => undefined);
  }, [fetching, priority, target]);
  const retry = useCallback(() => {
    if (target) ensureMedia(target, { priority: "now" }).catch(() => undefined);
  }, [target]);
  return { ...status, retry };
}

/** The marks inside a set's key, between a file's two addresses and between files: neither can be in a path or a uri. */
const FIELD = "\u0001";
const RECORD = "\u0002";

function setFiles(key: string): { path: string | null; local: string | null }[] {
  if (!key) return [];
  return key.split(RECORD).map((record) => {
    const [path = "", local = ""] = record.split(FIELD);
    return { path: path || null, local: local || null };
  });
}

/** Several files' standing as one line, "<state>:<percent>": a string, so an unchanged standing is the same value. */
function setSnapshot(key: string): string {
  const files = setFiles(key);
  if (!files.length) return "remote:0";
  let here = 0;
  let coming = 0;
  let share = 0;
  let failedOne = false;
  for (const file of files) {
    const status = snapshotOf(file.path, file.local);
    if (status.state === "local") {
      here += 1;
      share += 1;
    } else if (status.state === "downloading") {
      coming += 1;
      share += status.progress;
    } else if (status.state === "error") {
      failedOne = true;
    }
  }
  const state: ChatMediaState = here === files.length ? "local" : failedOne ? "error" : coming ? "downloading" : "remote";
  return `${state}:${Math.round((share / files.length) * 100)}`;
}

export type ChatMediaSet = { state: ChatMediaState; progress: number; retry: () => void };

/**
 * Several chat files as one, for a bubble that needs them all — a video note's parts: "local" once every one is on
 * the phone (or is the sender's own recording), "error" when one could not be had, "downloading" while any is
 * coming (`progress` over all of them), else "remote". It fetches nothing itself; `retry()` asks at once for every
 * one not here.
 */
export function useChatMediaSet(files: readonly { path: string | null; local?: string | null }[]): ChatMediaSet {
  const key = files.map((file) => `${file.path ?? ""}${FIELD}${file.local ?? ""}`).join(RECORD);
  const subscribe = useCallback((onChange: () => void) => {
    const stops = setFiles(key).map((file) => (file.path ? watchMedia(file.path, onChange) : null));
    return () => {
      for (const stop of stops) stop?.();
    };
  }, [key]);
  const read = useCallback(() => setSnapshot(key), [key]);
  const line = useSyncExternalStore(subscribe, read, read);
  const retry = useCallback(() => {
    for (const file of setFiles(key)) {
      if (file.path && !ownFile(file.local) && !localMedia(file.path)) ensureMedia(file.path, { priority: "now" }).catch(() => undefined);
    }
  }, [key]);
  const [state = "remote", percent = "0"] = line.split(":");
  return { state: state as ChatMediaState, progress: Number(percent) / 100, retry };
}
