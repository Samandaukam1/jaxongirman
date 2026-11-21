import {
  RecordingPresets, requestRecordingPermissionsAsync, useAudioRecorder, type AudioRecorder, type RecordingOptions, type RecordingStatus,
} from "expo-audio";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import {
  Check, ChevronLeft, ChevronUp, CornerUpLeft, Flashlight, FlashlightOff, Lock, Mic, Paperclip, Pencil, SwitchCamera, Trash2, Video, X,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AppState, Platform, Pressable, Text, TextInput, View, useWindowDimensions, type TextStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOutDown, ZoomIn, ZoomOut, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withRepeat,
  withSequence, withTiming, Extrapolation, type SharedValue,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";

import { MINE } from "@/components/ChatBubbles";
import { SendGlyph } from "@/components/SendGlyph";
import { Glass, SQUIRCLE } from "@/components/ChatKit";
import { playbackMode, recordingMode } from "@/lib/audioMode";
import { hasRecording, newClientId, VIDEO_MAX_MS, VOICE_MAX_MS } from "@/lib/chat";
import { discardFile, keepInOutbox, localFileSize } from "@/lib/chatMedia";
import { mediaLength } from "@/lib/chatTime";
import { haptic } from "@/lib/haptics";
import { stopVoice } from "@/lib/voicePlayer";
import { easeLevel, meterLevel, rollLevels, waveformFrom } from "@/lib/voiceWave";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Shorter than this, a press was a slip, not a message. */
const MIN_MS = 700;
/** A video message shorter than this (actually recorded, not held) is a slip too. */
const MIN_VIDEO_MS = 500;
/**
 * How far a pinch zooms the camera. expo-camera's 0…1 maps differently per
 * platform: on iOS exponentially up to the lens's whole digital range (0.32 is
 * about 2–3×), on Android linearly as a share of the largest zoom.
 */
const MAX_ZOOM = Platform.OS === "ios" ? 0.32 : 0.6;
/** A video message is at most this many parts (the server keeps up to ten): the camera turns round at most nine times. */
const MAX_PARTS = 10;
/**
 * A part younger than this is given the rest of it before it is stopped: iOS starts recording on its own
 * time, and a stop that arrives first is lost while the take runs on to its limit.
 */
const PART_MIN_MS = 700;
/** How long a turn of the camera is waited for; then recording goes on regardless, and the part's watcher catches a camera still not up. */
const TURN_MS = 2500;
/** A part stopped and not reported back after this is given up (and its camera is no longer trusted to record). */
const STOP_MS = 6000;
/** A stop not answered after this is asked for once more: the first may have reached the camera before its take began. */
const RESTOP_MS = 1500;
/**
 * Parts that stopped on their own are followed by a new one this many times in a row; then the camera has
 * given out. A part the camera recorded until it was asked to stop starts the count again, so a lens that
 * is slow to start after each turn does not use up a message's patience.
 */
const MAX_RESTARTS = 3;
/** A camera not up this long after the hold became a recording has given out. */
const READY_MS = 5000;
/** How far left a finger slides to throw a recording away, and how far up to lock it. */
const CANCEL_X = 110;
const LOCK_Y = 90;
/** One line of the field — and the round buttons beside it — like a messenger's. */
const FIELD = 38;
/** A voice message: one channel at 64 kbit/s — clear speech, a quarter of the music preset's size. */
const VOICE_PRESET: RecordingOptions = { ...RecordingPresets.HIGH_QUALITY, numberOfChannels: 1, bitRate: 64_000 };
/**
 * Every voice take as it is prepared: a file of its own (without options iOS records every take of the screen
 * into one file, so earlier bubbles and retried sends played the newest voice), kept in Documents, which iOS
 * never purges while it waits to be sent.
 */
const VOICE_TAKE: RecordingOptions = { ...VOICE_PRESET, isMeteringEnabled: true, directory: "document" };
/** Smaller than this, a finished take holds no voice: a header, or nothing at all (a recorder that never started). */
const MIN_VOICE_BYTES = 2_048;
/**
 * The microphone is read this often during a voice take (about 13 times a second): the live wave and the glow,
 * the waveform the message carries, and whether the recorder is still recording at all.
 */
const METER_MS = 75;
/** Bars of the live wave: all of them once the take is locked, the newest few beside the clock while it is held. */
const LIVE_BARS = 28;
const HELD_BARS = 10;
/**
 * Players stilled for a take settle the audio session on their own time (iOS: a paused video note hands it to
 * playback a moment later, from its own queue). The microphone is set up only this long after they were stilled
 * — a recorder set up first lost its input, and the take recorded nothing while its clock ran on.
 */
const SETTLE_MS = 250;
/** Readings in a row with the recorder not recording, before the take is taken as stopped under it (a call, the system). */
const DEAD_READINGS = 5;
/** A video message: 480p at about 1.2 Mbit/s — a minute is under ten megabytes. */
const VIDEO_BITRATE = 1_200_000;

/**
 * One message being recorded, with its own parts — so a new message never takes or loses an old one's files.
 * `file`: a voice take's file, read when it was prepared — the recorder may be gone by the time it must go.
 */
type Recording = { kind: "voice" | "video"; started: number; parts: VideoPart[]; file?: string | null };
/** One part of a video message: recorded from one camera, until it was turned round or the message ended. */
export type VideoPart = { uri: string; ms: number };

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });
/** A promise that gives up after a while instead of hanging forever (a native recording that never reports back): `null` says it gave up. */
function settle<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([promise, wait(ms).then(() => null)]);
}

/**
 * One reading of the recorder during a voice take: the microphone's level (dBFS; null where the phone gives none),
 * whether it is really recording, and how much it has recorded (ms). On iOS the recorder itself is asked: its
 * status goes on saying "recording" after the system stopped it under the take. A reading that fails counts as
 * still recording — a take is never ended on a guess.
 */
function readRecorder(recorder: AudioRecorder): { db: number | null; recording: boolean; ms: number } {
  try {
    const status = recorder.getStatus();
    const db = typeof status.metering === "number" && Number.isFinite(status.metering) ? status.metering : null;
    if (Platform.OS === "ios") {
      const recording = recorder.isRecording;
      return { db, recording, ms: recording ? Math.max(0, recorder.currentTime * 1000) : 0 };
    }
    return { db, recording: status.isRecording, ms: Math.max(0, status.durationMillis) };
  } catch {
    return { db: null, recording: true, ms: 0 };
  }
}

/**
 * Where the voice-sending path stands, in a development build's log: a test phone shows the step it stops at.
 * Nothing in a release.
 */
function step(...what: unknown[]) {
  if (__DEV__) console.log("[voice send]", ...what);
}

/**
 * What the camera did, part by part, in a development build's log. Which of its failures a given phone
 * hits cannot be seen from here, and this is what tells them apart on a test device. Nothing in a release.
 */
function trace(...what: unknown[]) {
  if (__DEV__) console.log("[video note]", ...what);
}

/**
 * Writing a message, as Telegram does it — on glass over the wallpaper.
 *
 * Words go with the send button that takes the place of the microphone as
 * soon as there are any. With none, the button is a microphone or — one tap
 * — a camera: hold it to record; slide left to throw the recording away;
 * slide up to lock it and let go, finishing with a tap on send. While a voice
 * message records, a ring round the button breathes with the voice; a video
 * message shows the camera in the middle of the screen, in the app's rounded
 * square, its edge filling as the minute runs, with buttons to turn the
 * camera round and to light the face; two fingers zoom, a double tap turns the
 * camera round. Answering or correcting a message puts a bar above the field
 * that says which.
 *
 * The camera starts the moment a finger lands on the video button, so it is
 * ready by the time the hold becomes a recording; and it stays until its last
 * file is written, so a message is never lost to the camera closing too soon.
 * Turning the camera round mid-message ends one part and starts the next — the
 * clock runs on, and the parts go as one message that plays straight through.
 */
export const ChatComposer = memo(function ChatComposer({
  onText, onAttach, onVoice, onVideo, notice, onTyping, editing, onEdit, onCancelEdit, initialText, replying, onCancelReply, onRecording,
  onTake, covered = false,
}: {
  onText: (text: string) => void;
  /** The paperclip: pictures, the camera, one's decks, games and works. */
  onAttach: () => void;
  /**
   * A voice message: its file (in the outbox, named by `clientId`), how long it is, the shape of the voice
   * (48 bars, 0–31; empty if the microphone's level never registered) and the client id the message goes
   * under — the same id named the file.
   */
  onVoice: (uri: string, durationMs: number, waveform: number[], clientId: string) => void;
  /** A video message: its parts in order (one, unless the camera was turned round), and how long it is in all. */
  onVideo: (parts: VideoPart[], durationMs: number) => void;
  /** A short line for the person: a missing permission, a slip. */
  notice: (message: string) => void;
  /** Words are being typed: the other side may be told. */
  onTyping?: () => void;
  /** The message being corrected, if one is. */
  editing?: { id: string; body: string } | null;
  onEdit?: (text: string) => void;
  onCancelEdit?: () => void;
  /** What the field starts with — the message under correction. */
  initialText?: string;
  /** The message being answered: whose, and a line of it. */
  replying?: { name: string; text: string } | null;
  onCancelReply?: () => void;
  /**
   * A finger is on the record button (on), or the take is over (off): every video player holds still where it
   * is — nothing that plays with sound stops for it. A quick tap that only switches voice and video is a touch
   * too, and must not end the voice someone is listening to.
   */
  onRecording?: (on: boolean) => void;
  /**
   * A take is really starting: what plays with sound — a voice, a note — stops. Answers whether something was
   * playing: iOS settles the phone's sound a moment after a stop, and a microphone opened inside it loses it.
   */
  onTake?: () => boolean;
  /** Another screen covers the conversation: a take still running ends there (what was recorded goes). */
  covered?: boolean;
}) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const { width: screenWidth } = useWindowDimensions();
  const [text, setText] = useState(initialText ?? "");
  const [inputWidth, setInputWidth] = useState(0);
  const [mode, setMode] = useState<"voice" | "video">("voice");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [facing, setFacing] = useState<"front" | "back">("front");
  const [light, setLight] = useState(false);
  const [zoom, setZoom] = useState(0);
  /** The torch is told only after the back camera is up — told before, it goes to the front camera, which has none. */
  const [torchReady, setTorchReady] = useState(true);
  /** The camera is running: from the finger landing on the video button until the last file is written. */
  const [cameraOn, setCameraOn] = useState(false);
  /** Changed to put a fresh camera in place of one that can no longer be trusted to record. */
  const [cameraKey, setCameraKey] = useState(0);
  const [top, setTop] = useState(0);
  /** What the recorder says when a take ends — on its own, under the take, or because it was stopped here. */
  const recorderEnded = useRef<(status: RecordingStatus) => void>(() => undefined);
  const recorder = useAudioRecorder({ ...VOICE_PRESET, isMeteringEnabled: true }, (status) => recorderEnded.current(status));
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();
  const wrap = useRef<View>(null);
  const input = useRef<TextInput>(null);
  const camera = useRef<CameraView | null>(null);
  /** The part being recorded now: resolves with its file, or with nothing. */
  const video = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const cameraReady = useRef(false);
  const partStarted = useRef(0);
  /**
   * The message whose camera is turning round: its next part waits for the turn. Held per message, so a
   * turn still winding down after its message ended never holds back the first part of the next one.
   */
  const switching = useRef<Recording | null>(null);
  /** Ends the wait for the camera to finish turning round: armed before the turn is asked for. */
  const turned = useRef<(() => void) | null>(null);
  /** Parts that stopped on their own since the camera last recorded until it was asked to stop. */
  const restarts = useRef(0);
  /** A stopped part never reported back: this camera may now ignore record() without a word, so the next part gets a fresh one. */
  const jammed = useRef(false);
  /** The camera gave out mid-message: finishing says so, rather than "too short". */
  const gaveOut = useRef(false);
  /** A part still being written to its file, and a message still being finished: the camera stays until both are done. */
  const ending = useRef<Promise<void> | null>(null);
  const finishing = useRef<Promise<void> | null>(null);
  /** Whether the screen has been told to keep every player still. */
  const hushed = useRef(false);
  const holding = useRef(false);
  const current = useRef<Recording | null>(null);
  const lockedRef = useRef(false);
  /** Bumped by every hold that starts a voice take: an older start still preparing the microphone stands down. */
  const voiceTurn = useRef(0);
  /** The voice take being started: the next hold waits for it to settle, so the microphone is never prepared twice. */
  const voiceStart = useRef<Promise<void> | null>(null);
  /** The microphone's level at every reading of a voice take: the waveform the message carries. */
  const levels = useRef<number[]>([]);
  /** How much of the voice take the recorder has really recorded, by its own clock (ms). */
  const recordedMs = useRef(0);
  /** When the players were last stilled for a take: the microphone waits for them to settle (SETTLE_MS). */
  const hushedAt = useRef(0);
  /** The screen's latest word for "recording", and the latest way to say a take was lost, for the moment the composer goes. */
  const told = useRef(onRecording);
  const say = useRef<() => void>(() => undefined);
  const media = Platform.OS !== "web";
  const note = Math.min(screenWidth * 0.72, 300);

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** Mirrors of "recording" and "locked" for the gesture, which runs off the JS thread. */
  const active = useSharedValue(0);
  const lockedNow = useSharedValue(0);
  const level = useSharedValue(0);
  /** The live wave: the latest readings, oldest first, and how far it still has to slide since the newest came in. */
  const wave = useSharedValue<number[]>(Array.from({ length: LIVE_BARS }, () => 0));
  const roll = useSharedValue(0);
  const blink = useSharedValue(1);
  const zoomStart = useSharedValue(0);
  const zoomNow = useSharedValue(0);
  const stageShown = useSharedValue(0);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(Date.now() - recording.started), 100);
    blink.set(withRepeat(withTiming(0.2, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => { clearInterval(timer); blink.set(1); };
  }, [blink, recording]);

  // Answering a message opens the keyboard, as in a messenger.
  const replyKey = replying ? `${replying.name}\u0000${replying.text}` : "";
  useEffect(() => {
    if (replyKey) input.current?.focus();
  }, [replyKey]);

  // While a voice records, the microphone is read on its own clock and nothing re-renders for it: its level moves
  // the live wave and the glow (shared values, eased on the UI thread), is kept for the waveform the message
  // carries, and the recorder's own clock says how much is really in the file. A recorder that stopped under the
  // take — a call, the system taking the microphone, the sound session changed — ends the take there with what it
  // has, instead of a clock running on over nothing that was then sent as silence, or not at all.
  useEffect(() => {
    if (recording?.kind !== "voice") return;
    const take = recording;
    levels.current = [];
    recordedMs.current = 0;
    let smooth = 0;
    let metered = false;
    let quiet = 0;
    let bars = Array.from({ length: LIVE_BARS }, () => 0);
    const timer = setInterval(() => {
      if (current.current !== take) return;
      const reading = readRecorder(recorder);
      levels.current.push(reading.db ?? -160);
      if (reading.db !== null) metered = true;
      // A phone that gives no level at all: a slow, calm breath rather than a dead flat line.
      smooth = easeLevel(smooth, metered ? meterLevel(reading.db) : 0.2 + 0.1 * Math.sin(Date.now() / 450));
      level.set(withTiming(smooth, { duration: METER_MS, easing: Easing.out(Easing.quad) }));
      bars = rollLevels(bars, smooth);
      wave.set(bars);
      roll.set(withSequence(withTiming(1, { duration: 0 }), withTiming(0, { duration: METER_MS, easing: Easing.linear })));
      if (reading.ms > recordedMs.current) recordedMs.current = reading.ms;
      quiet = reading.recording ? 0 : quiet + 1;
      if (quiet === DEAD_READINGS && AppState.currentState === "active") {
        if (__DEV__) console.log(`[voice send] the recorder stopped under the take at ${recordedMs.current} ms recorded`);
        handlers.current.lost(false);
      }
    }, METER_MS);
    return () => {
      clearInterval(timer);
      level.set(withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) }));
      wave.set(Array.from({ length: LIVE_BARS }, () => 0));
    };
  }, [level, recorder, recording, roll, wave]);

  // The app leaving the screen mid-take ends the take there: iOS pauses the microphone in the background and a
  // camera stops, and a take left running would come back as minutes of nothing. What was recorded goes.
  useEffect(() => {
    if (!recording) return;
    const subscription = AppState.addEventListener("change", (next) => {
      if (next === "background") handlers.current.lost(false);
    });
    return () => subscription.remove();
  }, [recording]);

  // The composer gone mid-take (the screen went into choosing messages or correcting one, or was left): a start
  // still preparing stands down, the take's files go — a voice is recorded into Documents, which iOS never
  // purges and backs up, and nothing would ever send or delete it — the speaker comes back, and the players
  // the take had stilled are let go. The recorder itself is let go of before this runs (its hook comes first),
  // so the voice's file is the one read when it was prepared.
  useEffect(() => {
    told.current = onRecording;
    say.current = () => notice(t("m.takeLost"));
  });
  useEffect(() => {
    const take = current;
    const still = hushed;
    const screen = told;
    const finger = holding;
    const lost = say;
    return () => {
      finger.current = false;
      const held = take.current;
      if (held) {
        if (held.kind === "voice") discardFile(held.file);
        for (const part of held.parts) discardFile(part.uri);
        void playbackMode();
        // Seen only where the screen stays (choosing, correcting): the take does not vanish without a word.
        lost.current();
      }
      if (still.current) screen.current?.(false);
    };
  }, []);

  function reset() {
    // Back into place on a short ease-out, never a bounce.
    dragX.set(withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) }));
    dragY.set(withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) }));
  }

  /** Where the field's top is on the screen: the video message is centred in the space above it. */
  function measure() {
    wrap.current?.measureInWindow((_x, y) => { if (y > 0) setTop(y); });
  }

  /**
   * Tells the screen to keep every video player still (on) or lets them go
   * again (off). A player that plays — even muted, even looping — takes the
   * phone's audio session for playback and the microphone loses it mid-take.
   * Still means paused where it is (the loops stay on screen, nothing reloads
   * after the take), and no player made or changed until the take is over.
   */
  function hush(on: boolean) {
    if (hushed.current === on) return;
    hushed.current = on;
    if (on) hushedAt.current = Date.now();
    onRecording?.(on);
  }

  /**
   * A finger landed on the record button: the silent loops are stilled now, so none is still settling the phone's
   * audio session when the hold becomes a take 200 ms later. What plays with sound — a voice, a note — goes on
   * until the hold really becomes a take (`onTake`): a quick tap that only switches voice and video is a touch
   * too, and used to stop, and rewind, the voice being listened to. On the video button the camera starts as
   * well, so it is ready when the hold becomes a recording.
   */
  function prime() {
    if (!media || current.current) return;
    if (mode === "voice") { hush(true); return; }
    if (finishing.current) return;
    if (cameraPermission?.granted && microphonePermission?.granted) {
      hush(true);
      measure();
      setCameraOn(true);
    }
  }

  /** The finger lifted without recording: the camera goes off again — unless a file is still being written. */
  function unprime() {
    if (current.current || video.current || ending.current || finishing.current) return;
    cameraReady.current = false;
    setCameraOn(false);
    hush(false);
  }

  /**
   * The hold became a voice take. Holds are taken one at a time: a second waits for the first to have started
   * or stood down, so the microphone is never prepared twice.
   */
  function startVoice(): Promise<void> {
    voiceTurn.current += 1;
    const turn = voiceTurn.current;
    const before = voiceStart.current;
    const starting = (async () => {
      if (before) await before;
      await openMicrophone(turn);
    })();
    voiceStart.current = starting;
    void starting.finally(() => { if (voiceStart.current === starting) voiceStart.current = null; });
    return starting;
  }

  /**
   * Starts a voice take — if, after every wait, it is still this hold and the finger is still on the button. A
   * take that began after the finger had lifted used to run on with nobody holding it and send itself at the
   * two-minute limit. Anything short of recording is undone: the half-made file goes, the speaker comes back,
   * the players go on; a refusal (a call, the microphone busy) is said.
   */
  async function openMicrophone(turn: number) {
    const wanted = () => holding.current && voiceTurn.current === turn;
    let moded = false;
    let prepared = false;
    let file: string | null = null;
    let began = false;
    try {
      // A video message still being written finishes first: its end hands the audio session back to playback,
      // which on iOS stops any recorder already running.
      if (finishing.current) await finishing.current;
      if (!wanted()) return;
      // What plays with sound stops now — a voice, a note: it would be recorded into this one.
      const wasPlaying = onTake?.() ?? stopVoice();
      hush(true);
      step("hold became a take; something was playing:", wasPlaying);
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) { step("microphone not allowed"); notice(t("micPermission")); return; }
      if (!wanted()) return;
      // Whatever was stilled settles the session first (SETTLE_MS from the stilling; a little longer after a sound
      // that was playing): a recorder set up inside that moment loses its input.
      const settling = Math.max(wasPlaying ? 150 : 0, SETTLE_MS - (Date.now() - hushedAt.current));
      if (settling > 0) await wait(settling);
      if (!wanted()) return;
      for (let attempt = 1; ; attempt += 1) {
        moded = true;
        await recordingMode();
        if (!wanted()) return;
        await recorder.prepareToRecordAsync(VOICE_TAKE);
        prepared = true;
        file = recorder.uri || null;
        if (!wanted()) return;
        recorder.record();
        // A recorder whose input was taken between its setting up and its start records nothing and says nothing
        // about it: asked (now, and once more a moment later), it says whether it runs. If not, it is set up once
        // more from the start; a second failure refuses the take, said, rather than a clock over silence.
        let running = readRecorder(recorder).recording;
        if (!running) {
          await wait(150);
          running = readRecorder(recorder).recording;
        }
        if (running) break;
        step(`the recorder did not start (try ${attempt})`, file);
        await recorder.stop().catch(() => undefined);
        prepared = false;
        discardFile(file);
        file = null;
        if (attempt >= 2) throw new Error("the recorder did not start");
        if (!wanted()) return;
      }
      began = true;
      step("recording into", file);
      begin("voice", file);
    } catch (failure) {
      step("could not start:", failure instanceof Error ? failure.message : failure);
      if (wanted()) notice(t("m.micBusy"));
    } finally {
      if (!began) {
        if (prepared) {
          await recorder.stop().catch(() => undefined);
          discardFile(file);
        }
        if (moded) await playbackMode();
        if (!current.current) hush(false);
      }
    }
  }

  async function startVideo() {
    // The last message's camera may still be writing its file: it finishes first.
    if (finishing.current) await finishing.current;
    const cameraAllowed = cameraPermission?.granted ? cameraPermission : await requestCamera();
    const microphoneAllowed = microphonePermission?.granted ? microphonePermission : await requestMicrophone();
    if (!cameraAllowed.granted || !microphoneAllowed.granted) { notice(t("cameraPermission")); unprime(); return; }
    if (!holding.current) { unprime(); return; }
    // What plays with sound stops now (the finger landing only stilled the silent loops). The notes on screen are
    // paused, not taken away, and on iOS a pause hands the audio session to playback a moment later: whatever was
    // stilled settles before the camera's turn (SETTLE_MS from the stilling, longer after a sound that played).
    const stopped = onTake?.() ?? false;
    hush(true);
    const settling = Math.max(stopped ? 150 : 0, SETTLE_MS - (Date.now() - hushedAt.current));
    if (settling > 0) await wait(settling);
    if (!holding.current) { unprime(); return; }
    // The camera records sound too: the audio session must allow it, whatever played last.
    await recordingMode().catch(() => undefined);
    // Let go while the session was being set: it goes back to playback (iOS), or the next voice played would
    // come over a hands-free Bluetooth line. No take began, so no recorder is stopped by it.
    if (!holding.current) {
      unprime();
      if (!current.current) await playbackMode();
      return;
    }
    measure();
    setCameraOn(true);
    restarts.current = 0;
    gaveOut.current = false;
    begin("video");
    if (cameraReady.current) startPart();
    else expectCamera();
  }

  function begin(kind: Recording["kind"], file: string | null = null) {
    const started: Recording = { kind, started: Date.now(), parts: [], file };
    current.current = started;
    lockedRef.current = false;
    active.set(1);
    lockedNow.set(0);
    setLocked(false);
    setElapsed(0);
    setRecording(started);
    hush(true);
    haptic.medium();
  }

  /**
   * Starts recording the next part of the message being recorded — the first, the one after the camera
   * turned round, or the one after a part stopped on its own. Each part is watched for its whole life: if
   * it ends while it is still the one recording, nobody stopped it, and the screen must not go on counting
   * a recording that is not happening.
   */
  function startPart() {
    const view = camera.current;
    const held = current.current;
    if (!view || held?.kind !== "video" || video.current || switching.current === held || ending.current) return;
    // Only on a camera that has said it is up: a fresh one starts the part itself when it is (onCameraReady).
    if (!cameraReady.current) return;
    if (jammed.current) {
      // The last part never reported back, and iOS silently ignores a record() while an earlier take is
      // unfinished — the clock would run over nothing. A fresh camera takes this one's place and starts the
      // part when it is up.
      jammed.current = false;
      cameraReady.current = false;
      setCameraKey((key) => key + 1);
      expectCamera();
      return;
    }
    // What is left of the minute, and a second more: the clock ends the message; the camera's own limit is only a backstop.
    const left = Math.max(1, Math.ceil((VIDEO_MAX_MS - (Date.now() - held.started)) / 1000) + 1);
    const startedAt = Date.now();
    partStarted.current = startedAt;
    const recorded = view.recordAsync({ maxDuration: left, ...(Platform.OS === "ios" ? { codec: "avc1" as const } : null) })
      .then((result) => (result?.uri ? { uri: result.uri } : undefined), (error: unknown) => {
        trace("record refused:", error instanceof Error ? error.message : error);
        return undefined;
      });
    video.current = recorded;
    void recorded.then((result) => {
      // endPart lets go of a part before it stops it: then the end was ours, and the file is kept there.
      if (video.current !== recorded) return;
      video.current = null;
      partEnded(held, result, Date.now() - startedAt);
    });
  }

  /**
   * A part ended while it was still the one recording: the camera closed under it, the phone took it, the
   * native side gave up — or it never really began (a camera still turning round reports a file all the
   * same, a missing or empty one). Its file is kept if it holds anything, and recording goes on in a new
   * part after a breath; after three such restarts in a row the camera is taken to have given out.
   */
  function partEnded(held: Recording, take: { uri: string } | undefined, ms: number) {
    const kept = take && hasRecording(take.uri) ? take : null;
    trace(`part ${held.parts.length + 1} stopped on its own after ${ms} ms:`, kept ? "kept" : take ? "empty file" : "no file");
    if (kept) held.parts.push({ uri: kept.uri, ms });
    // A file next to empty is no part of anything: it goes now (the camera never deletes what it wrote).
    else if (take) discardFile(take.uri);
    if (current.current !== held) return;
    // The minute is all but over: the clock sends the message in a moment.
    if (VIDEO_MAX_MS - (Date.now() - held.started) < 1000) return;
    if (held.parts.length >= MAX_PARTS || restarts.current >= MAX_RESTARTS) { cameraGaveOut(); return; }
    restarts.current += 1;
    setTimeout(() => { if (current.current === held) startPart(); }, 250 * restarts.current);
  }

  /**
   * Ends the part being recorded and keeps its file in its message, if the file holds anything. Until it is
   * written, the camera stays. A part in its first moments is given the rest of them before the stop.
   */
  function endPart(held: Recording): Promise<void> {
    if (ending.current) return ending.current;
    const recorded = video.current;
    if (!recorded) return Promise.resolve();
    // Let go first: from here the part's end is ours, and its watcher stands down.
    video.current = null;
    const startedAt = partStarted.current;
    // As long as the person recorded it — measured before any wait, so a slip is still too short.
    const ms = Date.now() - startedAt;
    const writing = (async () => {
      const early = PART_MIN_MS - (Date.now() - startedAt);
      if (early > 0) await wait(early);
      camera.current?.stopRecording();
      // A stop that reached the camera before its take had begun is lost, and the take would run on to its
      // limit: once the take has had time to begin, the stop is asked for again (to a take already ending, a
      // second stop does nothing). No new part starts on this camera until this one is settled.
      let result = await settle(recorded, RESTOP_MS);
      if (result === null) {
        camera.current?.stopRecording();
        result = await settle(recorded, STOP_MS - RESTOP_MS);
      }
      const kept = result && hasRecording(result.uri) ? result : null;
      trace(`part ${held.parts.length + 1} stopped after ${ms} ms:`, result === null ? "no answer" : kept ? "kept" : "empty file");
      if (result === null) {
        jammed.current = true;
        // Given up on, it may still write its file later (up to a minute of it): nothing will send that file.
        void recorded.then((late) => discardFile(late?.uri));
      } else if (!kept) discardFile(result?.uri);
      else if (kept) {
        held.parts.push({ uri: kept.uri, ms });
        // The camera recorded until it was told to stop: the stops on their own before this are forgiven.
        restarts.current = 0;
      }
    })();
    ending.current = writing;
    void writing.finally(() => { if (ending.current === writing) ending.current = null; });
    return writing;
  }

  /**
   * Waits until the camera has really turned round, or has had long enough. Armed before the turn is asked
   * for, so the word cannot slip past. iOS gives it as onAvailableLensesChanged, sent once the other lens is
   * committed to the session (onCameraReady comes once per camera, never again); Android as onCameraReady,
   * since it closes the camera and opens the other one with a new recorder.
   */
  function cameraTurned(): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        if (turned.current === done) turned.current = null;
        resolve();
      };
      timer = setTimeout(done, TURN_MS);
      turned.current = done;
    });
  }

  /** A camera that never comes up — no word that it is ready, no error — must not leave the clock running over nothing. */
  function expectCamera() {
    const held = current.current;
    setTimeout(() => {
      if (!held || current.current !== held || cameraReady.current) return;
      trace(`camera not up after ${READY_MS} ms`);
      cameraGaveOut();
    }, READY_MS);
  }

  /**
   * The camera gave out: it reported an error, never came up, or kept stopping. A message being recorded
   * goes as far as it got — finishing keeps every part that holds something — and the person is told why
   * it ended. With nothing being recorded, the camera is put away and the person told it did not start.
   */
  function cameraGaveOut() {
    // A turn being waited on will not come.
    turned.current?.();
    const held = current.current;
    if (held?.kind === "video") {
      gaveOut.current = true;
      void finish(true);
    } else if (!held && !finishing.current) {
      notice(t("m.cameraFailed"));
      unprime();
    }
  }

  function lock() {
    if (lockedRef.current) return;
    lockedRef.current = true;
    lockedNow.set(1);
    setLocked(true);
    reset();
    haptic.heavy();
  }

  async function finish(send: boolean) {
    const held = current.current;
    if (!held) return;
    current.current = null;
    lockedRef.current = false;
    active.set(0);
    lockedNow.set(0);
    const ms = Date.now() - held.started;
    setRecording(null);
    setLocked(false);
    setLight(false);
    reset();
    if (send) haptic.light(); else haptic.warning();
    const done = (async () => {
      try {
        if (held.kind === "voice") {
          // Read before anything else can start: the shape of the voice (none, if the microphone's level never
          // registered — the other phone then draws its fingerprint rather than a flat line), and its file.
          const shape = waveformFrom(levels.current);
          const wave = shape.some((bar) => bar > 0) ? shape : [];
          // The file read when the take was prepared (the recorder's own address is the same, unless it was let go of).
          const take = held.file ?? (recorder.uri || null);
          // The recorder's own clock, read while it still runs (iOS answers 0 once it has stopped): how much of the
          // voice is really in the file. A take whose recorder stopped under it is as long as what it recorded.
          const last = readRecorder(recorder);
          const recorded = Math.max(recordedMs.current, last.recording ? last.ms : 0);
          const length = recorded > 0 ? Math.min(recorded, ms + 250) : ms;
          // Android says a take captured nothing by leaving the file's address out of what stop() answers.
          const stopped = (await recorder.stop().catch(() => null)) as { url?: string | null } | null | undefined;
          await playbackMode();
          const bytes = localFileSize(take);
          const whole = Boolean(take) && stopped !== null && (Platform.OS !== "android" || Boolean(stopped?.url)) && bytes > MIN_VOICE_BYTES;
          step("released:", { send, heldMs: ms, recordedMs: recorded, bytes, stop: stopped === null ? "failed" : "ok", take });
          if (send && length >= MIN_MS && whole && take) {
            // Out of the recorder's folder into the outbox, named by the message it becomes: a retry sends this
            // voice and no other, and once uploaded the same file is the sender's copy of it.
            const clientId = newClientId();
            const kept = await keepInOutbox(take, clientId);
            step("kept for sending:", kept, `${localFileSize(kept)} bytes`);
            onVoice(kept, Math.min(length, VOICE_MAX_MS), wave, clientId);
          } else {
            discardFile(take);
            step("not sent:", !send ? "cancelled" : length < MIN_MS ? "too short" : "no voice in the file");
            if (send) notice(t(length < MIN_MS ? "tooShort" : "m.voiceFailed"));
          }
        } else {
          // A turn of the camera still being waited on is let go: nothing more is recorded in this message.
          turned.current?.();
          // A part from a turn of the camera may still be writing; then the last part.
          if (ending.current) await ending.current;
          await endPart(held);
          // Only now, with every file written, does the camera go off.
          cameraReady.current = false;
          jammed.current = false;
          setCameraOn(false);
          setZoom(0);
          zoomNow.set(0);
          await playbackMode();
          // A file that is missing or next to empty (a camera that stopped as it started) is no part of the message.
          const parts = held.parts.filter((part) => hasRecording(part.uri));
          const total = parts.reduce((sum, part) => sum + part.ms, 0);
          const sent = send && parts.length > 0 && total >= MIN_VIDEO_MS;
          if (sent) onVideo(parts, Math.min(total, VIDEO_MAX_MS));
          // What goes nowhere is deleted now: a cancelled or too-short note, and the empty parts left out (the
          // camera's files would stay in its cache, a face and a voice, until the phone cleared it). Every part is
          // final here: the take is let go of, and no watcher or restart can add one.
          for (const part of held.parts) if (!sent || !parts.includes(part)) discardFile(part.uri);
          // A camera that gave out says why the message ended early, or why nothing went.
          if (gaveOut.current) notice(t(sent ? "m.cameraStopped" : "m.cameraFailed"));
          else if (send && !sent) notice(t("tooShort"));
          gaveOut.current = false;
        }
      } catch (failure) {
        step("finishing failed:", failure instanceof Error ? failure.message : failure);
        notice(t("failed"));
      } finally {
        hush(false);
      }
    })();
    finishing.current = done;
    await done;
    if (finishing.current === done) finishing.current = null;
  }

  /**
   * The camera turned round. Mid-message, the part so far is ended and written first, then the camera is
   * asked to turn, and the next part starts only once the other lens is really up — never on a guess of how
   * long that takes, which on an older phone it did not.
   */
  async function flip() {
    const held = current.current;
    // Ten parts at most: the turn that would make an eleventh is refused.
    if (held?.kind === "video" && held.parts.length + 1 >= MAX_PARTS) { haptic.warning(); return; }
    // One turn at a time: a tap while this message's camera is turning is part of the same turn.
    if (held && switching.current === held) return;
    haptic.select();
    const next = facing === "front" ? "back" : "front";
    if (held?.kind !== "video") {
      // Nothing recording yet: only the picture turns, and the torch is told once the other lens is up.
      setZoom(0);
      zoomNow.set(0);
      setTorchReady(false);
      const turnedRound = cameraTurned();
      setFacing(next);
      void turnedRound.then(() => setTorchReady(true));
      return;
    }
    switching.current = held;
    /** This message's turn is over (a later message's turn is never touched). */
    const turnOver = () => { if (switching.current === held) switching.current = null; };
    // The part so far ends with its last frames written (one only just begun is given its first moments).
    await endPart(held);
    // Only now do the zoom and the torch go back, so neither jumps inside the part.
    setZoom(0);
    zoomNow.set(0);
    setTorchReady(false);
    const turnedRound = cameraTurned();
    const asked = Date.now();
    setFacing(next);
    // Finishing the message lets go of this wait: a camera put away mid-turn is not waited for.
    if (current.current === held) {
      await turnedRound;
      const took = Date.now() - asked;
      if (current.current === held) trace(`camera turned to the ${next} in ${took} ms${took >= TURN_MS ? " (no word from it; going on regardless)" : ""}`);
    }
    // The other lens is in; a breath more for its first frames. Then the torch and the microphone are its.
    if (current.current === held) await wait(Platform.OS === "ios" ? 150 : 300);
    setTorchReady(true);
    // The message ended while the camera turned: nothing more to record, and the sound is left as finishing set it.
    if (current.current !== held) { turnOver(); return; }
    await recordingMode().catch(() => undefined);
    turnOver();
    if (current.current === held) startPart();
  }

  // At the limit the message goes as it is: two minutes of voice, one of video.
  useEffect(() => {
    if (recording && elapsed >= (recording.kind === "voice" ? VOICE_MAX_MS : VIDEO_MAX_MS)) void finish(true);
  });

  /**
   * What the gesture asks of the JS side. Kept in a ref the latest render
   * fills, so the gesture itself is built once and is never replaced in the
   * middle of a hold by the timer's re-renders.
   */
  const handlers = useRef({
    hold: () => {}, cancel: () => {}, lock: () => {}, release: () => {}, tap: () => {}, prime: () => {}, flip: () => {},
    lost: (_error: boolean) => {},
  });
  useEffect(() => {
    // The recorder ending by itself mid-take (iOS stops it when the sound session is taken for playback; either
    // phone on an error): the take ends there. Its own stop, asked for here, comes after the take is let go of.
    recorderEnded.current = (status) => {
      if (current.current?.kind !== "voice" || !status.isFinished) return;
      step("the recorder ended under the take:", status.error ?? "no error");
      handlers.current.lost(status.hasError);
    };
    handlers.current = {
      hold: () => { holding.current = true; void (mode === "voice" ? startVoice() : startVideo()); },
      cancel: () => { void finish(false); },
      lock,
      release: () => {
        holding.current = false;
        if (current.current && !lockedRef.current) void finish(true);
        else { reset(); if (!current.current) unprime(); }
      },
      tap: () => {
        if (current.current) return;
        unprime();
        setMode((value) => (value === "voice" ? "video" : "voice"));
        haptic.select();
      },
      prime,
      flip: () => { void flip(); },
      // The take ended under the person — the recorder stopped, the app left the screen, another screen covered
      // the conversation: what was recorded goes, as on a release; a recorder that failed says so instead.
      lost: (error) => {
        if (!current.current) return;
        void finish(!error).then(() => { if (error) notice(t("m.voiceFailed")); });
      },
    };
  });

  // Covered by another screen mid-take (a locked take, and a tap on the header): the take ends there and goes. Its
  // players there know nothing of it — a voice played on the profile set the sound for playback and stopped the
  // recorder (iOS), and the take ran on with nobody to see it.
  useEffect(() => {
    if (covered && current.current) handlers.current.lost(false);
  }, [covered]);
  const call = useCallback((name: "hold" | "cancel" | "lock" | "release" | "tap" | "prime" | "flip") => handlers.current[name](), []);
  const applyZoom = useCallback((value: number) => setZoom(value), []);

  // Hold to record; slide left to cancel, up to lock; a quick tap switches microphone and camera; a finger
  // landing starts the camera early. The callbacks are worklets the gesture runs later on the UI thread;
  // they reach the JS side only through runOnJS.
  const gesture = useMemo(() => {
    const hold = Gesture.Pan()
      .activateAfterLongPress(200)
      .onBegin(() => { runOnJS(call)("prime"); })
      .onStart(() => { runOnJS(call)("hold"); })
      .onUpdate((event) => {
        if (active.get() === 0 || lockedNow.get() === 1) return;
        dragX.set(Math.min(0, event.translationX));
        dragY.set(Math.min(0, event.translationY));
        if (event.translationX < -CANCEL_X) {
          active.set(0);
          runOnJS(call)("cancel");
        } else if (event.translationY < -LOCK_Y) {
          lockedNow.set(1);
          runOnJS(call)("lock");
        }
      })
      .onFinalize(() => { runOnJS(call)("release"); });
    const tap = Gesture.Tap()
      .maxDuration(240)
      .onEnd((_event, success) => { if (success) runOnJS(call)("tap"); });
    return Gesture.Exclusive(hold, tap);
  }, [active, call, dragX, dragY, lockedNow]);

  // On the camera itself: two fingers zoom; a double tap turns it round.
  const cameraGesture = useMemo(() => Gesture.Simultaneous(
    Gesture.Pinch()
      .onBegin(() => { zoomStart.set(zoomNow.get()); })
      .onUpdate((event) => {
        const step = Platform.OS === "ios" ? Math.log2(Math.max(0.25, event.scale)) * 0.16 : (event.scale - 1) * 0.35;
        const next = Math.min(MAX_ZOOM, Math.max(0, zoomStart.get() + step));
        zoomNow.set(next);
        runOnJS(applyZoom)(Math.round(next * 100) / 100);
      }),
    Gesture.Tap().numberOfTaps(2).onEnd((_event, success) => { if (success) runOnJS(call)("flip"); }),
  ), [applyZoom, call, zoomNow, zoomStart]);

  // The stage is mounted from the first touch but shown only while a video records: its opacity, not a mount animation, says which.
  const recordingVideo = recording?.kind === "video";
  useEffect(() => {
    stageShown.set(withTiming(recordingVideo ? 1 : 0, { duration: 80 }));
  }, [recordingVideo, stageShown]);
  const stageStyle = useAnimatedStyle(() => ({ opacity: stageShown.value }));

  const bigStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: interpolate(dragX.value, [-CANCEL_X, 0], [-CANCEL_X * 0.75, 0], Extrapolation.CLAMP) },
      { translateY: interpolate(dragY.value, [-LOCK_Y, 0], [-LOCK_Y * 0.6, 0], Extrapolation.CLAMP) },
    ],
  }));
  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + level.value * 0.55 }],
    opacity: 0.18 + level.value * 0.22,
  }));
  // A softer, wider glow that only the voice lights: nothing at silence, a halo when the voice is loud.
  const glowStyle = useAnimatedStyle(() => ({
    transform: [{ scale: 0.8 + level.value * 0.45 }],
    opacity: level.value * 0.16,
  }));
  const bigPulse = useAnimatedStyle(() => ({ transform: [{ scale: 1 + level.value * 0.06 }] }));
  const hintStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value * 0.55 }],
    opacity: interpolate(dragX.value, [-CANCEL_X, 0], [0.15, 1], Extrapolation.CLAMP),
  }));
  const lockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(dragY.value, [-LOCK_Y, 0], [-26, 0], Extrapolation.CLAMP) }],
    opacity: interpolate(dragX.value, [-60, 0], [0, 1], Extrapolation.CLAMP),
  }));
  const dotStyle = useAnimatedStyle(() => ({ opacity: blink.value }));

  const typing = text.trim().length > 0;
  const RecordIcon = mode === "voice" ? Mic : Video;
  // In a browser there is no recording: the send button stays, waiting for words.
  const action: "edit" | "send" | "record" = editing ? "edit" : typing || !media ? "send" : "record";
  const noteProgress = recording?.kind === "video" ? Math.min(1, elapsed / VIDEO_MAX_MS) : 0;
  const corner = (note + 4) * SQUIRCLE;
  const perimeter = 4 * (note + 4) - 8 * corner + 2 * Math.PI * corner;
  // Light on the face from the front camera is the screen itself, turned white; from the back, the torch.
  const screenLight = light && facing === "front";

  function sendText() {
    const value = text.trim();
    if (!value) return;
    haptic.light();
    if (editing) onEdit?.(value);
    else onText(value);
    setText("");
  }

  return (
    <View ref={wrap} onLayout={measure} style={styles.wrap}>
      {/* The camera, in the middle of the screen, in the rounded square a video message is, its edge filling with the minute.
          It is mounted (unseen) from the moment a finger lands on the button, and stays until its last file is written. */}
      {cameraOn ? (
        <Animated.View pointerEvents={recordingVideo ? "box-none" : "none"}
          style={[styles.noteStage, { height: Math.max(top, note + 160) }, screenLight && styles.noteStageLit, stageStyle]}>
          <GestureDetector gesture={cameraGesture}>
            <View style={{ width: note + 12, height: note + 12, alignItems: "center", justifyContent: "center" }}>
              <View style={[styles.noteClip, { width: note, height: note, borderRadius: note * SQUIRCLE }]}>
                <CameraView
                  key={cameraKey}
                  ref={camera}
                  style={{ width: note, height: note }}
                  facing={facing}
                  mode="video"
                  zoom={zoom}
                  videoQuality="480p"
                  videoBitrate={VIDEO_BITRATE}
                  // A round note needs no stabilisation, and asking for it is what differs between the lenses: on
                  // iOS mostly the back one has it (a longer start, a cropped picture), on Android it is switched on
                  // for both without asking whether the camera supports it, which CameraX warns can fail.
                  videoStabilizationMode="off"
                  enableTorch={light && facing === "back" && torchReady}
                  onCameraReady={() => {
                    cameraReady.current = true;
                    // Android turns the camera round by closing it and opening the other one: this is its word that the turn is done.
                    if (Platform.OS === "android") turned.current?.();
                    // The message's first part, or its next on a fresh camera; a camera turning round starts its own.
                    if (current.current?.kind === "video" && !video.current && switching.current !== current.current) startPart();
                  }}
                  // iOS's word that the other lens is committed to the session (it never repeats onCameraReady).
                  onAvailableLensesChanged={() => { if (Platform.OS === "ios") turned.current?.(); }}
                  onMountError={(error) => {
                    if (__DEV__) console.warn("camera could not run", error.message);
                    cameraGaveOut();
                  }}
                />
              </View>
              <Svg width={note + 12} height={note + 12} style={styles.noteRing} pointerEvents="none">
                <Rect x={4} y={4} width={note + 4} height={note + 4} rx={corner} stroke={screenLight ? "rgba(60,30,120,0.18)" : "rgba(255,255,255,0.25)"} strokeWidth={4} fill="none" />
                <Rect x={4} y={4} width={note + 4} height={note + 4} rx={corner} stroke={MINE[0]} strokeWidth={5} fill="none"
                  strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={perimeter * (1 - noteProgress)} strokeLinecap="round" />
              </Svg>
            </View>
          </GestureDetector>
          <Text style={styles.noteTime}>{mediaLength(elapsed)} / {mediaLength(VIDEO_MAX_MS)}</Text>
          <View style={styles.noteTools}>
            <Pressable accessibilityRole="button" accessibilityLabel={t("m.flip")} onPress={() => void flip()} hitSlop={6}>
              <Glass round={26} style={styles.noteTool}><SwitchCamera color={colors.ink} size={22} strokeWidth={2} /></Glass>
            </Pressable>
            <Pressable accessibilityRole="button" accessibilityLabel={t("m.light")} onPress={() => { haptic.select(); setLight((value) => !value); }} hitSlop={6}>
              <Glass round={26} style={[styles.noteTool, light && { backgroundColor: "#FFD54A" }]}>
                {light ? <Flashlight color="#3A2A00" size={22} strokeWidth={2} /> : <FlashlightOff color={colors.ink} size={22} strokeWidth={2} />}
              </Glass>
            </Pressable>
          </View>
          <Text style={[styles.noteHint, screenLight && { color: "rgba(40,20,80,0.7)" }]}>{t("m.zoomHint")}</Text>
        </Animated.View>
      ) : null}

      {editing || replying ? (
        <Animated.View entering={FadeInDown.duration(90)} exiting={FadeOutDown.duration(70)} style={styles.barWrap}>
          <Glass round={18} style={styles.contextBar}>
            {editing ? <Pencil color={colors.primary} size={18} strokeWidth={2.2} /> : <CornerUpLeft color={colors.primary} size={18} strokeWidth={2.2} />}
            <View style={styles.contextCopy}>
              <Text style={styles.contextTitle} numberOfLines={1}>{editing ? t("editing") : replying?.name}</Text>
              <Text style={styles.contextText} numberOfLines={1}>{editing ? editing.body : replying?.text}</Text>
            </View>
            <Pressable accessibilityLabel={t("cancel")} hitSlop={10} onPress={editing ? onCancelEdit : onCancelReply}>
              <X color={colors.inkMuted} size={20} />
            </Pressable>
          </Glass>
        </Animated.View>
      ) : null}

      <View style={styles.bar}>
        {recording ? (
          <Glass round={FIELD / 2} style={styles.recordingRow}>
            <Animated.View entering={FadeIn.duration(75)} style={styles.recordingInside}>
              {locked ? (
                <Pressable accessibilityLabel={t("cancel")} onPress={() => void finish(false)} hitSlop={8} style={styles.trash}>
                  <Trash2 color={colors.danger} size={21} />
                </Pressable>
              ) : (
                <Animated.View style={[styles.dot, dotStyle]} />
              )}
              <Text style={styles.recordingText}>{mediaLength(elapsed)}</Text>
              {/* Held, the newest of the voice beside the clock; locked, the whole live wave where the hint was. */}
              {recording.kind === "voice" && !locked ? <LiveWave wave={wave} roll={roll} count={HELD_BARS} color={colors.primary} /> : null}
              {locked ? (
                <View style={styles.liveWave}>
                  {recording.kind === "voice" ? <LiveWave wave={wave} roll={roll} count={LIVE_BARS} color={colors.primary} /> : null}
                </View>
              ) : (
                <Animated.View style={[styles.slideHint, hintStyle]}>
                  <ChevronLeft color={colors.inkMuted} size={16} />
                  <Text style={styles.slideText} numberOfLines={1}>{t("slideCancel")}</Text>
                </Animated.View>
              )}
            </Animated.View>
          </Glass>
        ) : (
          <>
            <Pressable accessibilityLabel={t("attach")} onPress={() => { haptic.light(); onAttach(); }} hitSlop={6} disabled={Boolean(editing)}>
              <Glass round={FIELD / 2} style={styles.round}>
                <Paperclip color={editing ? colors.border : colors.inkMuted} size={20} strokeWidth={2.1} />
              </Glass>
            </Pressable>
            <Glass round={FIELD / 2} style={styles.field}>
              <TextInput
                ref={input}
                style={styles.input}
                value={text}
                onChangeText={(value) => { setText(value); if (value.trim()) onTyping?.(); }}
                placeholder={t("placeholder")}
                placeholderTextColor={colors.inkSoft}
                multiline
                keyboardAppearance={scheme === "dark" ? "dark" : "light"}
                // A browser's textarea starts two lines tall; here it starts at one and grows with the words.
                {...(Platform.OS === "web" ? { rows: webRows(text, inputWidth) } : null)}
                onLayout={Platform.OS === "web" ? (event) => setInputWidth(event.nativeEvent.layout.width) : undefined}
                maxLength={4000}
                autoFocus={Boolean(editing)}
              />
            </Glass>
          </>
        )}

        <View style={styles.actionSlot}>
          {recording && locked ? (
            <Animated.View key="locked-send" entering={ZoomIn.duration(80)}>
              <Pressable accessibilityLabel={t("send")} onPress={() => void finish(true)} style={styles.sendCircle}>
                <SendGlyph size={20} color="#FFFFFF" fold={MINE[1]} />
              </Pressable>
            </Animated.View>
          ) : action === "edit" || action === "send" ? (
            <Animated.View key={action} entering={ZoomIn.duration(80)} exiting={ZoomOut.duration(55)}>
              <Pressable accessibilityLabel={t("send")} onPress={sendText} disabled={!typing} style={[styles.sendCircle, !typing && { opacity: 0.45 }]}>
                {action === "edit" ? <Check color="#FFFFFF" size={20} strokeWidth={2.6} /> : <SendGlyph size={20} color="#FFFFFF" fold={MINE[1]} />}
              </Pressable>
            </Animated.View>
          ) : (
            <GestureDetector gesture={gesture}>
              <Animated.View key={`record-${mode}`} entering={ZoomIn.duration(80)} exiting={ZoomOut.duration(55)}
                accessibilityRole="button" accessibilityLabel={mode === "voice" ? t("holdVoice") : t("holdVideo")}>
                <Glass round={FIELD / 2} style={styles.round}>
                  <RecordIcon color={colors.inkMuted} size={22} strokeWidth={2} />
                </Glass>
              </Animated.View>
            </GestureDetector>
          )}

          {/* While held: the big button under the finger, the ring that breathes, and the lock above. */}
          {recording && !locked ? (
            <>
              <Animated.View pointerEvents="none" entering={FadeIn.duration(75)} style={[styles.lockPill, lockStyle]}>
                <Lock color={colors.inkMuted} size={17} strokeWidth={2.2} />
                <ChevronUp color={colors.inkSoft} size={16} />
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.bigWrap, bigStyle]}>
                <Animated.View style={[styles.glow, { backgroundColor: recording.kind === "voice" ? MINE[0] : colors.danger }, glowStyle]} />
                <Animated.View style={[styles.ring, { backgroundColor: recording.kind === "voice" ? MINE[0] : colors.danger }, ringStyle]} />
                <Animated.View style={bigPulse}>
                  <Animated.View entering={ZoomIn.duration(90)} style={[styles.big, { backgroundColor: recording.kind === "voice" ? MINE[0] : colors.danger }]}>
                    <RecordIcon color="#FFFFFF" size={30} strokeWidth={2.2} />
                  </Animated.View>
                </Animated.View>
              </Animated.View>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
});

/** How many lines the web field shows for these words: one to five, by line breaks and wrapping. */
function webRows(text: string, width: number): number {
  const perLine = Math.max(12, Math.floor((width - 28) / 8.4));
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.min(5, Math.max(1, lines));
}

/** A live bar's width and the gap after it. */
const BAR_W = 3;
const BAR_GAP = 2;

/**
 * The live wave of a voice being recorded: the microphone's latest readings as bars, the newest on the right,
 * sliding left as each new one comes in (eased across one reading, so it flows rather than steps). It is driven by
 * shared values alone: nothing re-renders as the voice moves it. `count`: how many of the newest it shows.
 */
function LiveWave({ wave, roll, count, color }: { wave: SharedValue<number[]>; roll: SharedValue<number>; count: number; color: string }) {
  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: roll.value * (BAR_W + BAR_GAP) }] }));
  return (
    <View pointerEvents="none" style={{ width: count * (BAR_W + BAR_GAP), height: 26, overflow: "hidden", justifyContent: "center" }}>
      <Animated.View style={[{ flexDirection: "row", alignItems: "center", gap: BAR_GAP }, slide]}>
        {Array.from({ length: count }, (_, at) => <LiveBar key={at} at={LIVE_BARS - count + at} wave={wave} color={color} />)}
      </Animated.View>
    </View>
  );
}

/** One bar of the live wave: the reading at its place, from a dot at silence to full height at a shout. */
function LiveBar({ at, wave, color }: { at: number; wave: SharedValue<number[]>; color: string }) {
  const style = useAnimatedStyle(() => ({ height: 3 + (wave.value[at] ?? 0) * 21 }));
  return <Animated.View style={[{ width: BAR_W, borderRadius: BAR_W / 2, backgroundColor: color }, style]} />;
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "relative" },
  bar: { flexDirection: "row", alignItems: "flex-end", gap: 6, paddingHorizontal: 8, paddingTop: 6, paddingBottom: 6 },
  round: { width: FIELD, height: FIELD, alignItems: "center", justifyContent: "center" },
  field: { flex: 1, minHeight: FIELD, justifyContent: "center" },
  input: {
    fontFamily: "JaxongirmanSans_400Regular", fontSize: 16, lineHeight: 20, color: colors.ink, maxHeight: 128, minHeight: FIELD,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9,
    // No browser focus ring round the field on the web: the caret says where one is typing.
    // ("none" is the web's word only, hence the cast; width alone loses to the browser's "auto" ring.)
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null),
  },
  actionSlot: { width: FIELD, height: FIELD, alignItems: "center", justifyContent: "center" },
  sendCircle: { width: FIELD, height: FIELD, borderRadius: FIELD / 2, alignItems: "center", justifyContent: "center", backgroundColor: MINE[1] },
  recordingRow: { flex: 1, minHeight: FIELD, justifyContent: "center" },
  recordingInside: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: FIELD, paddingLeft: spacing.md, overflow: "hidden" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  trash: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
  recordingText: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 16, color: colors.ink, fontVariant: ["tabular-nums"], minWidth: 44 },
  slideHint: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, paddingRight: 30 },
  slideText: { ...typography.caption, fontSize: 14, color: colors.inkMuted },
  liveWave: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, height: 30 },
  bigWrap: { position: "absolute", width: 96, height: 96, right: -29, bottom: -(48 - FIELD / 2), alignItems: "center", justifyContent: "center" },
  big: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center",
    shadowColor: "#2A0F55", shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  ring: { position: "absolute", width: 120, height: 120, borderRadius: 60 },
  glow: { position: "absolute", width: 156, height: 156, borderRadius: 78 },
  lockPill: {
    position: "absolute", right: -1, bottom: 82, width: 40, paddingVertical: 10, gap: 4, alignItems: "center", borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#2A0F55", shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  barWrap: { paddingHorizontal: 8, paddingTop: 4 },
  contextBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: 8 },
  contextCopy: { flex: 1, borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: spacing.sm },
  contextTitle: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary },
  contextText: { ...typography.caption, color: colors.inkMuted },
  noteStage: {
    position: "absolute", left: 0, right: 0, bottom: "100%", alignItems: "center", justifyContent: "center", gap: spacing.md, zIndex: 10,
    backgroundColor: "rgba(10,5,24,0.62)",
  },
  noteStageLit: { backgroundColor: "rgba(255,255,255,0.94)" },
  noteClip: { overflow: "hidden", borderCurve: "continuous", backgroundColor: "#000" },
  noteRing: { position: "absolute", left: 0, top: 0 },
  noteTime: {
    fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, color: "#fff", backgroundColor: "rgba(0,0,0,0.45)", fontVariant: ["tabular-nums"],
    paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, overflow: "hidden",
  },
  noteTools: { flexDirection: "row", gap: spacing.xl },
  noteHint: { ...typography.caption, color: "rgba(255,255,255,0.78)", textAlign: "center", paddingHorizontal: spacing.xl },
  noteTool: { width: 52, height: 52, alignItems: "center", justifyContent: "center" },
}));
