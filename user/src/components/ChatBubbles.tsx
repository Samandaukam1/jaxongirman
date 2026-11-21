import * as FileSystem from "expo-file-system/legacy";
import * as MediaLibrary from "expo-media-library/legacy";
import * as Sharing from "expo-sharing";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import {
  AlertCircle, Check, CheckCheck, Clock3, CornerUpLeft, Download, FileText, Gamepad2, LibraryBig, MessageSquareText, Pause, Pin, Play, Presentation,
  RotateCcw, Share2, Volume2, X,
} from "lucide-react-native";
import {
  createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";
import {
  AccessibilityInfo, ActivityIndicator, AppState, FlatList, Image, Keyboard, Modal, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions,
  type AccessibilityActionEvent, type AccessibilityActionInfo, type GestureResponderEvent,
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation, Easing, Extrapolation, FadeIn, FadeInDown, ZoomIn, interpolate, runOnJS, useAnimatedProps, useAnimatedStyle, useSharedValue,
  withDelay, withRepeat, withSequence, withTiming, type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { SQUIRCLE } from "@/components/ChatKit";
import { cachedMediaUrl, emojiCount, mediaUrl, noteFiles, reactionChips, type ChatMessage, type ChatQuote } from "@/lib/chat";
import { ensureMedia, holdMedia, localMedia, openMedia, useChatMedia, useChatMediaSet } from "@/lib/chatMedia";
import { chatClock, mediaLength } from "@/lib/chatTime";
import { DOUBLE_TAP_MS, isDoubleTap, tapOf, type Tap } from "@/lib/doubleTap";
import { haptic } from "@/lib/haptics";
import { useReduceMotion } from "@/lib/motion";
import { useNotePlayer } from "@/lib/notePlayer";
import { restLoop, settleLoop } from "@/lib/videoNote";
import { toggleVoice, useVoice, voiceKey } from "@/lib/voicePlayer";
import { readWaveform, waveBars } from "@/lib/voiceWave";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * A message as a messenger draws it.
 *
 * One's own in the brand's violet, the other side's in white (deep violet in
 * the dark); a few minutes from one person sit together as a run, only the
 * last with the little tail. The time sits inside at the bottom right after
 * the words, with one tick for sent and two in mint once read. Above the
 * words: whom a passed-on message came from, and a quote of the message being
 * answered (a tap finds it). Below the bubble: the reactions.
 *
 * Pictures go without a frame, in the bubble's own corners — one, or an album
 * of up to ten in a mosaic. One to three emoji alone arrive as a big sticker.
 * A video message is the app's rounded square, playing silently on a loop
 * until tapped; then it grows, plays with sound, and keeps playing in a
 * corner if the conversation is scrolled away from it.
 *
 * A bubble slid to the left answers it; pressed and held, it is lifted into
 * the menu.
 */

/** The video message: the app's rounded square, small at rest and larger while it plays. */
export const NOTE_SIZE = 230;
export const NOTE_PLAYING = 296;
/** Kept for screens that still draw the square by its corner. */
export const VIDEO_NOTE_RADIUS = Math.round(NOTE_SIZE * SQUIRCLE);
/** One's own bubble: the brand violet, lit from the top left. */
export const MINE: [string, string] = ["#8E57EC", "#6A35C8"];
/** Read ticks on one's own bubble: mint, plain against the violet. */
const READ_TICK = "#9FFFE0";
const BIG = 18;
const SMALL = 6;
/** How far a bubble slides before letting go answers it. */
const REPLY_AT = 62;

/** The reactions at hand in the menu, then the rest behind its arrow. */
export const QUICK_REACTIONS = ["❤️", "👍", "🔥", "😂", "👏", "😮", "🙏"];
/** What a double tap puts on a message — the first in the menu, the red heart; the same again takes it back. */
export const DOUBLE_TAP_REACTION = QUICK_REACTIONS[0]!;
export const MORE_REACTIONS = [
  "😁", "🥰", "😍", "🤩", "😎", "🤔", "🤯", "😱", "😢", "😭", "🥲", "😡", "🤗", "🥳", "😴", "🙈",
  "👀", "💯", "⚡", "✨", "🌟", "🎉", "🎁", "🏆", "💪", "🤝", "👌", "✌️", "🙌", "🫶", "❤️‍🔥", "💔",
  "💜", "🤍", "📚", "✅", "❌", "🤷", "👎", "🍀",
];

export type BubbleFrame = { x: number; y: number; width: number; height: number };

/**
 * What every row of a conversation shares, given once by the screen. Only what changes seldom: a change here
 * draws every bubble on the phone again (and remakes its gestures), so what concerns one message — lifted into
 * the menu, flashing, chosen — reaches its bubble as a prop instead.
 */
export type ChatRowContextValue = {
  me: string;
  peerName: string;
  selecting: boolean;
  onRetry: (message: ChatMessage) => void;
  onShare: (message: ChatMessage) => void;
  onLongPress: (message: ChatMessage, frame: BubbleFrame) => void;
  onReply: (message: ChatMessage) => void;
  onToggle: (message: ChatMessage) => void;
  onJump: (messageId: string) => void;
  onReact: (message: ChatMessage, emoji: string) => void;
  /** Reactions can be put on here: not with someone one has blocked (the server refuses, so the heart would only flash). */
  canReact: boolean;
};
export const ChatRowContext = createContext<ChatRowContextValue | null>(null);

/**
 * The bubble's "react" action, for what a screen reader focuses inside it. On iOS a view that is an
 * accessibility element hides everything inside it from VoiceOver, so the bubble and its row are elements only
 * while choosing (or, the bubble, when it failed): the rest of the time VoiceOver reaches the words, the play
 * button, the note, the pictures, the quote — and offers "react" only on what it focuses, so each of them carries
 * it. Empty outside a bubble (the menu's copy, the profile) and on Android, where the bubble stays the one node.
 */
type BubbleActions = {
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};
const NO_ACTIONS: BubbleActions = {};
const BubbleActionsContext = createContext<BubbleActions>(NO_ACTIONS);

/** The one video message playing with sound, and whether it plays in the corner. */
/**
 * The conversation's video-note controls, for every voice and video bubble. Only what changes rarely is here (a
 * take starting or ending, the screen covered); what changes as the list scrolls and a note plays — which notes
 * loop, which one plays, where, on which player — is the stage (`NoteStageContext`), which re-renders only the
 * notes it is about. Here, it re-rendered every voice and video bubble at every scroll.
 */
export type VideoHubValue = {
  /** 0 to 1 through the playing message, every part by its own length. */
  progress: SharedValue<number>;
  /** Plays a message from its start, with sound. `loop`: the bubble's own player, already looping its first part — it is played as it is. */
  start: (message: ChatMessage, loop: VideoPlayer | null) => void;
  stop: () => void;
  /** A bubble's loop going away: if it is the player the message plays on, the message ends (and the player is left alone). */
  forget: (player: VideoPlayer) => void;
  /**
   * A voice or video message is being recorded: no video player is made, let go of, played or muted — on iOS any
   * of that takes the audio session from the microphone. The loops were paused when the finger landed.
   */
  recording: boolean;
  /**
   * Another screen covers the conversation (a profile, a deck): the loops are paused where they are, not let go
   * of, and go on when it is back. Unlike `recording`, taps and voices are left as they are.
   */
  covered: boolean;
};
export const VideoHubContext = createContext<VideoHubValue | null>(null);

/** What changes as the conversation scrolls and a note plays. */
export type NoteStage = {
  /** The key (`noteKey`) of the message playing, or of the one whose first file is still coming for a tap. */
  activeId: string | null;
  /** It plays on in the corner: its own bubble is scrolled away. */
  floating: boolean;
  /** The player of the part on screen: the bubble's own loop for the first part (lent), the screen's for the rest. */
  player: VideoPlayer | null;
  /** A part's file is still on its way: the first, or the next one at a turn of the camera. */
  waiting: boolean;
  /** The notes that loop silently, by key: the newest few on screen. */
  looping: ReadonlySet<string>;
};
export type NoteStageStore = { get: () => NoteStage; set: (next: NoteStage) => void; subscribe: (listener: () => void) => () => void };

const NO_STAGE: NoteStage = { activeId: null, floating: false, player: null, waiting: false, looping: new Set() };

/** The stage a screen keeps and its notes read: one object for the screen's life, told every change. */
export function createNoteStage(): NoteStageStore {
  let stage = NO_STAGE;
  const listeners = new Set<() => void>();
  return {
    get: () => stage,
    set: (next) => {
      stage = next;
      for (const listener of [...listeners]) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
export const NoteStageContext = createContext<NoteStageStore | null>(null);

const noStage = () => () => undefined;

/**
 * One note's part of the stage. Read as a short string of flags and, for the note playing, its player: both stay
 * the same value while nothing about this note changes, so a scroll that only starts another note's loop leaves
 * this bubble alone.
 */
function useNoteStage(key: string): { active: boolean; floating: boolean; waiting: boolean; looping: boolean; player: VideoPlayer | null } {
  const store = useContext(NoteStageContext);
  const subscribe = store?.subscribe ?? noStage;
  const flags = useSyncExternalStore(subscribe, () => stageFlags(store?.get() ?? NO_STAGE, key), () => "0000");
  const player = useSyncExternalStore(subscribe, () => {
    const stage = store?.get();
    return stage && stage.activeId === key ? stage.player : null;
  }, () => null);
  return { active: flags[0] === "1", floating: flags[1] === "1", waiting: flags[2] === "1", looping: flags[3] === "1", player };
}

function stageFlags(stage: NoteStage, key: string): string {
  const active = stage.activeId === key;
  return `${active ? 1 : 0}${active && stage.floating ? 1 : 0}${active && stage.waiting ? 1 : 0}${stage.looping.has(key) ? 1 : 0}`;
}

/** The key a note plays under: the same before and after the server confirms it (a voice's is the same). */
export const noteKey = voiceKey;

/** Waits before asking again for a link that could not be had: a moment of no connection is not a dead bubble. */
const SIGN_RETRY_MS = [1_000, 3_000, 9_000];

/**
 * A file's address: the local one while it uploads; the phone's own copy when it has one (a voice or video
 * note already fetched); else a short-lived signed link — asked for again a few times if the first ask fails,
 * rather than leaving a spinner that never ends.
 *
 * An address is only ever shown for the file it was found for. A quote whose picture was deleted for everyone
 * (its path gone) kept showing that picture, by its old link, until the screen was opened again; and a viewer
 * swiped to the next picture would, for a moment, save or share the one before.
 */
export function usePath(path: string | null | undefined, local?: string | null): string | null {
  const target = path ?? null;
  const [found, setFound] = useState<{ path: string | null; url: string | null }>(() => ({
    path: target, url: local ?? (target ? localMedia(target) ?? cachedMediaUrl(target) : null),
  }));
  useEffect(() => {
    if (local) { setFound({ path: target, url: local }); return; }
    if (!target) { setFound({ path: null, url: null }); return; }
    const here = localMedia(target);
    if (here) { setFound({ path: target, url: here }); return; }
    // A link still good is used at once; otherwise nothing, until one is signed — never the last file's.
    setFound({ path: target, url: cachedMediaUrl(target) });
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ask = (attempt: number) => {
      void mediaUrl(target).then((next) => {
        if (!alive) return;
        if (next) setFound({ path: target, url: next });
        else if (attempt < SIGN_RETRY_MS.length) timer = setTimeout(() => ask(attempt + 1), SIGN_RETRY_MS[attempt]);
      });
    };
    ask(0);
    return () => { alive = false; clearTimeout(timer); };
  }, [local, target]);
  if (local) return local;
  // Until the effect has caught up with a new file (or with none), nothing found for the old one is shown.
  return target && found.path === target ? found.url : null;
}

export function useMedia(message: ChatMessage): string | null {
  return usePath(message.media_path, message.localUri);
}

type Translate = ReturnType<typeof useTranslation<"chat">>["t"];

/** A message in one line: its words, or what kind of thing it is. */
export function quoteLabel(quote: Pick<ChatMessage, "kind" | "body" | "share"> & { items?: ChatQuote["items"] }, t: Translate): string {
  if (quote.kind === "text") return quote.body.replace(/\s+/g, " ");
  if (quote.kind === "share") return t("preview.share", { title: quote.share?.title ?? "" });
  if (quote.kind === "album") return quote.body || t("m.album", { count: quote.items?.length ?? 0 });
  if (quote.kind === "image") return quote.body || t("m.photo");
  return t(`preview.${quote.kind}`);
}

/* =================================================================== row */

/**
 * A bubble that is nothing but a picture, an album or a video message: a tap
 * target from edge to edge, which opens or plays on the first tap. There is
 * nowhere on it for a double tap (waiting for one would slow every opening),
 * so its reactions come from the menu, as in Telegram (and from the screen
 * reader's "react", which needs no tap).
 */
function allMedia(message: ChatMessage): boolean {
  if (message.kind === "video") return true;
  return (message.kind === "image" || message.kind === "album") && !message.body && !message.forward_from_name && !message.reply_to_id;
}

export const MessageBubble = memo(function MessageBubble({ message, mine, read, groupTop, groupEnd, fresh, lifted, highlighted, selected }: {
  message: ChatMessage;
  mine: boolean;
  /** The other side has read up to this message. */
  read: boolean;
  /** The first (oldest) of a run from one person. */
  groupTop: boolean;
  /** The last (newest) of a run: it carries the tail. */
  groupEnd: boolean;
  /** Arrived while the conversation was open: it rises into place. */
  fresh: boolean;
  /** Lifted into the menu: its place in the list stays empty meanwhile. */
  lifted: boolean;
  /** Just jumped to: it flashes. */
  highlighted: boolean;
  /** Chosen, while messages are being chosen. */
  selected: boolean;
}) {
  const row = useContext(ChatRowContext);
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const body = useRef<View>(null);
  const offset = useSharedValue(0);
  const armed = useSharedValue(0);
  const flash = useSharedValue(0);
  const selecting = Boolean(row?.selecting);
  const failed = message.pending === "failed";
  const reply = row?.onReply;
  const reduceMotion = useReduceMotion();
  /** The bubble's last tap, for a second one to complete. */
  const lastTap = useRef<Tap | null>(null);
  /** The keyboard's lowering after a lone tap, waiting out the moment a second tap could still come. */
  const lowerKeyboard = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Counts the hearts a double tap has put on, so each one pops anew; 0 while none is showing. */
  const [pop, setPop] = useState(0);
  const popDone = useCallback(() => setPop(0), []);
  // A reaction goes on a message that has arrived (not one still on its way, or failed), not while choosing, not with
  // someone blocked. The double tap also stays off a bubble that is all picture or video — a tap target from edge to
  // edge, which opens or plays on the first tap; there the screen reader's "react" still puts the heart on.
  const reactable = Boolean(row?.canReact) && !selecting && !message.pending;
  const canQuickReact = reactable && !allMedia(message);
  const quickIsMine = row ? message.reactions?.[row.me] === DOUBLE_TAP_REACTION : false;

  useEffect(() => {
    if (highlighted) flash.set(withSequence(withTiming(1, { duration: 90 }), withDelay(350, withTiming(0, { duration: 325 }))));
  }, [flash, highlighted]);

  // A lowering still waiting when the row goes (scrolled far off, the conversation left) is not wanted any more.
  useEffect(() => () => { if (lowerKeyboard.current) clearTimeout(lowerKeyboard.current); }, []);

  /** Lifts the bubble into the menu, measured where it is (with the keyboard lowered first if it is up). */
  const openMenu = useCallback(() => {
    if (!row || selecting || message.pending) return;
    haptic.medium();
    const lift = () => body.current?.measureInWindow((x, y, width, height) => row.onLongPress(message, { x, y, width, height }));
    if (Keyboard.isVisible()) { Keyboard.dismiss(); setTimeout(lift, 320); } else lift();
  }, [message, row, selecting]);

  // Slid left, a bubble offers to be answered; let go past the mark, it is. Held still, it lifts into the menu —
  // as a gesture of the whole bubble, which wins over the picture, video or quote inside it (they would open instead).
  // The callbacks run later on the UI thread and reach the JS side through runOnJS — never during render; the
  // compiler cannot see that (openMenu measures a ref when it is finally called), so its ref rule is off here.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const swipe = Gesture.Pan()
      .enabled(!selecting && !message.pending && Boolean(reply))
      .activeOffsetX([-14, 10_000])
      .failOffsetY([-14, 14])
      .onUpdate((event) => {
        const x = Math.min(0, event.translationX);
        offset.set(x > -REPLY_AT ? x : -REPLY_AT + (x + REPLY_AT) * 0.25);
        if (x <= -REPLY_AT && armed.get() === 0) { armed.set(1); runOnJS(haptic.light)(); }
        else if (x > -REPLY_AT && armed.get() === 1) armed.set(0);
      })
      .onEnd(() => { if (armed.get() === 1 && reply) runOnJS(reply)(message); })
      // Back into place without a bounce.
      .onFinalize(() => { offset.set(withTiming(0, { duration: 90, easing: Easing.out(Easing.cubic) })); armed.set(0); });
    const hold = Gesture.LongPress()
      .enabled(!selecting && !message.pending && Boolean(row))
      .minDuration(260)
      .maxDistance(12)
      .onStart(() => { runOnJS(openMenu)(); });
    return Gesture.Race(hold, swipe);
  }, [armed, message, offset, openMenu, reply, row, selecting]);
  /* eslint-enable react-hooks/refs */

  const slide = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));
  const replyIcon = useAnimatedStyle(() => {
    const progress = interpolate(-offset.value, [10, REPLY_AT], [0, 1], Extrapolation.CLAMP);
    return { opacity: progress, transform: [{ scale: 0.5 + progress * 0.5 + armed.value * 0.12 }] };
  });
  const flashStyle = useAnimatedStyle(() => ({ opacity: flash.value }));

  /** The quick reaction, put on or taken back: by a double tap, or by the screen reader's "react". */
  function quickReact() {
    if (!row || !reactable) return;
    if (quickIsMine) {
      haptic.select();
      setPop(0);
      AccessibilityInfo.announceForAccessibility(t("m.unreacted"));
    } else {
      haptic.light();
      // Motion only where it is welcome: the heart arriving under the bubble says it either way.
      if (!reduceMotion) setPop((count) => count + 1);
      AccessibilityInfo.announceForAccessibility(t("m.reacted", { emoji: DOUBLE_TAP_REACTION }));
    }
    row.onReact(message, DOUBLE_TAP_REACTION);
  }

  /** Calls off a lowering of the keyboard still waiting: a second tap came (or a newer tap starts its own wait). */
  function holdKeyboard() {
    if (lowerKeyboard.current) clearTimeout(lowerKeyboard.current);
    lowerKeyboard.current = null;
  }

  /**
   * A tap on the bubble. Choosing, it chooses; on a failed message it sends it
   * again. Otherwise a second tap soon after, close by, makes it a double tap:
   * the quick reaction. What is inside the bubble — play, a picture, a quote —
   * takes its own taps first and never reaches here.
   */
  function press(event: GestureResponderEvent) {
    // A message still on its way is not chosen: it cannot be forwarded, copied whole or taken back yet.
    if (selecting) { if (!message.pending) { haptic.select(); row?.onToggle(message); } return; }
    if (failed) { row?.onRetry(message); return; }
    if (!canQuickReact) return;
    const tap = tapOf(event);
    if (tap && isDoubleTap(lastTap.current, tap)) {
      lastTap.current = null;
      holdKeyboard();
      quickReact();
      return;
    }
    lastTap.current = tap;
    // The bubble now takes the tap the list used to, and the list lowered the keyboard on it: so does this, once
    // no second tap has come — a double tap with the keyboard up leaves the list still under the finger.
    if (Keyboard.isVisible()) {
      holdKeyboard();
      lowerKeyboard.current = setTimeout(() => { lowerKeyboard.current = null; Keyboard.dismiss(); }, DOUBLE_TAP_MS);
    }
  }

  const reactActions: AccessibilityActionInfo[] | undefined = reactable ? [{
    name: "react",
    label: quickIsMine ? t("m.quickUnreact", { emoji: DOUBLE_TAP_REACTION }) : t("m.quickReact", { emoji: DOUBLE_TAP_REACTION }),
  }] : undefined;
  const onReactAction = (event: AccessibilityActionEvent) => { if (event.nativeEvent.actionName === "react") quickReact(); };
  // VoiceOver (iOS) reaches only what is not inside another element: the row and the bubble are elements only
  // when a tap on them is what counts — choosing, and (the bubble) sending a failed message again. Activating an
  // element with no action of its own taps its middle, which on a voice is the waveform: the voice never played.
  const ios = Platform.OS === "ios";
  const retrying = failed && !selecting;
  const inner: BubbleActions = ios && reactActions ? { accessibilityActions: reactActions, onAccessibilityAction: onReactAction } : NO_ACTIONS;

  return (
    <Animated.View entering={fresh ? FadeInDown.duration(110).easing(Easing.out(Easing.cubic)) : undefined}>
      <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.flash, flashStyle]} />
      {/* In a browser the page still scrolls up and down from a finger on a message (only the sideways slide is the bubble's). */}
      <GestureDetector gesture={gesture} touchAction="pan-y">
        <Pressable onPress={selecting ? press : undefined} disabled={!selecting}
          accessible={!ios || selecting}
          accessibilityState={{ selected }}
          onAccessibilityTap={() => { if (selecting && !message.pending) { haptic.select(); row?.onToggle(message); } }}
          style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, groupEnd && styles.rowEnd, selected && styles.rowSelected]}>
          {selecting ? <SelectDot selected={selected} /> : null}
          <Animated.View style={[styles.column, mine ? styles.columnMine : styles.columnTheirs, slide]}>
            <Pressable
              onPress={press}
              disabled={!failed && !selecting && !canQuickReact}
              // Most taps here are half of a double tap and do nothing yet, so Android's click stays for choosing and resending.
              android_disableSound={!selecting && !failed}
              accessible={!ios || retrying}
              accessibilityHint={retrying ? t("failed") : undefined}
              onAccessibilityTap={retrying ? () => row?.onRetry(message) : undefined}
              // Here for Android, where the bubble stays the one node; on iOS what is inside carries it (`inner`).
              accessibilityActions={reactActions}
              onAccessibilityAction={onReactAction}
            >
              {/* While choosing, what is inside does not open or play: a tap chooses the message. */}
              <View ref={body} collapsable={false} pointerEvents={selecting ? "none" : "auto"} style={lifted ? styles.lifted : null}>
                <BubbleActionsContext.Provider value={inner}>
                  <BubbleBody message={message} mine={mine} read={read} groupTop={groupTop} groupEnd={groupEnd} />
                </BubbleActionsContext.Provider>
              </View>
              {pop ? <ReactionPop key={pop} emoji={DOUBLE_TAP_REACTION} onDone={popDone} /> : null}
            </Pressable>
            <Reactions message={message} mine={mine} />
            {failed ? <Text style={styles.failedText}>{t("failed")}</Text> : null}
          </Animated.View>
          <Animated.View pointerEvents="none" style={[styles.replyIcon, replyIcon]}>
            <CornerUpLeft color={colors.primary} size={18} strokeWidth={2.4} />
          </Animated.View>
        </Pressable>
      </GestureDetector>
    </Animated.View>
  );
});

function SelectDot({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Animated.View entering={ZoomIn.duration(75)} style={[styles.selectDot, selected && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
      {selected ? <Animated.View entering={ZoomIn.duration(70)}><Check color="#FFFFFF" size={14} strokeWidth={3} /></Animated.View> : null}
    </Animated.View>
  );
}

/** The double tap's heart over the bubble: in, a beat, then up and away. */
const POP_IN_MS = 90;
const POP_HOLD_MS = 120;
const POP_OUT_MS = 110;

/**
 * The emoji a double tap has just put on a message, over the bubble for a
 * moment: it grows in, holds a beat, then rises a little and fades — eased,
 * never sprung. It never takes a touch, and a screen reader hears the
 * announcement instead of it.
 */
function ReactionPop({ emoji, onDone }: { emoji: string; onDone: () => void }) {
  const styles = useStyles();
  // 0 → 1 comes in, 1 → 2 goes away.
  const at = useSharedValue(0);
  useEffect(() => {
    at.set(withSequence(
      withTiming(1, { duration: POP_IN_MS, easing: Easing.out(Easing.cubic) }),
      withDelay(POP_HOLD_MS, withTiming(2, { duration: POP_OUT_MS, easing: Easing.out(Easing.quad) })),
    ));
    // Gone once it has faded, with a frame or two to spare; a timer cleared on unmount, so a heart taken back
    // early and put on again is never cut short by the one before it.
    const timer = setTimeout(onDone, POP_IN_MS + POP_HOLD_MS + POP_OUT_MS + 40);
    return () => clearTimeout(timer);
  }, [at, onDone]);
  const style = useAnimatedStyle(() => {
    const shown = Math.min(at.value, 1);
    const away = Math.max(0, at.value - 1);
    return { opacity: shown - away, transform: [{ translateY: -12 * away }, { scale: 0.6 + 0.4 * shown }] };
  });
  return (
    <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, styles.pop]}>
      <Animated.Text allowFontScaling={false} style={[styles.popEmoji, style]}>{emoji}</Animated.Text>
    </View>
  );
}

/* ================================================================== body */

/**
 * The bubble itself, without the row around it: also drawn, lifted, in the
 * menu over the blurred conversation (`still` — nothing in it plays or opens).
 */
export function BubbleBody({ message, mine, read, groupTop, groupEnd, still }: {
  message: ChatMessage;
  mine: boolean;
  read: boolean;
  groupTop: boolean;
  groupEnd: boolean;
  still?: boolean;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const actions = useContext(BubbleActionsContext);
  const { width } = useWindowDimensions();
  const maxWidth = Math.min(width * 0.8, 440);
  const pictureWidth = Math.min(maxWidth, 292);
  const corners = mine
    ? { borderTopLeftRadius: BIG, borderBottomLeftRadius: BIG, borderTopRightRadius: groupTop ? BIG : SMALL, borderBottomRightRadius: groupEnd ? 4 : SMALL }
    : { borderTopRightRadius: BIG, borderBottomRightRadius: BIG, borderTopLeftRadius: groupTop ? BIG : SMALL, borderBottomLeftRadius: groupEnd ? 4 : SMALL };

  const sticker = message.kind === "text" && !message.reply_to_id && !message.forward_from_name ? emojiCount(message.body) : 0;
  if (sticker) return <Sticker message={message} mine={mine} read={read} count={sticker} />;
  if (message.kind === "video") return <VideoNoteMessage message={message} mine={mine} read={read} still={still} />;

  const pictures = message.kind === "image" || message.kind === "album";
  const forwarded = message.forward_from_name ? (
    <Text style={[styles.forwarded, mine && styles.textMineSoft, pictures && styles.insetText]} numberOfLines={1}>
      {t("m.forwardedFrom", { name: message.forward_from_name })}
    </Text>
  ) : null;
  const quote = message.reply_to_id ? <Quote message={message} mine={mine} still={still} inset={pictures} /> : null;

  // A picture alone goes without a bubble: the picture is the bubble.
  if (pictures && !message.body && !forwarded && !quote) {
    const pictureCorners = { ...corners, ...(mine ? { borderBottomRightRadius: groupEnd ? BIG : SMALL } : { borderBottomLeftRadius: groupEnd ? BIG : SMALL }) };
    return (
      <View style={[styles.pictureOnly, pictureCorners]}>
        <Pictures message={message} width={pictureWidth} still={still} />
        <Meta message={message} mine={mine} read={read} overlay />
      </View>
    );
  }

  const content: ReactNode = pictures ? <Pictures message={message} width={pictureWidth} still={still} inner />
    : message.kind === "voice" ? <VoiceMessage message={message} mine={mine} still={still} />
    : message.kind === "share" ? <ShareMessage message={message} mine={mine} still={still} />
    : null;

  const words = message.body;
  const text = words ? (
    <Text {...actions} style={[styles.text, mine && styles.textMine, pictures && styles.insetText, pictures && styles.captionGap]}>
      {words}
      {/* Room for the time at the end of the last line, as a messenger leaves it; one's own also leaves room for the ticks. */}
      <Text style={styles.spacer}>{`   ${message.pinned_at ? "   " : ""}${message.edited_at ? `${t("edited")} ` : ""}${chatClock(message.created_at)}${mine ? "      " : ""}`}</Text>
    </Text>
  ) : null;

  const inside = <>{forwarded}{quote}{content}{text}<Meta message={message} mine={mine} read={read} overlay={pictures && !words} /></>;
  const frame = [styles.bubble, corners, pictures && styles.picturePad, !mine && styles.bubbleTheirs];
  return (
    <View style={[styles.bubbleBox, { maxWidth: pictures ? pictureWidth + 6 : maxWidth }]}>
      {mine ? (
        <LinearGradient colors={MINE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={frame}>{inside}</LinearGradient>
      ) : (
        <View style={frame}>{inside}</View>
      )}
      {groupEnd ? <Tail mine={mine} color={mine ? MINE[1] : colors.surface} /> : null}
    </View>
  );
}

/** The little tail at the bottom corner of the last bubble in a run. */
function Tail({ mine, color }: { mine: boolean; color: string }) {
  return (
    <View pointerEvents="none" style={{ position: "absolute", bottom: 0, [mine ? "right" : "left"]: -7, width: 10, height: 16 }}>
      <Svg width={10} height={16}>
        <Path d={mine ? "M0 0 C0 8 3 13 10 16 L0 16 Z" : "M10 0 C10 8 7 13 0 16 L10 16 Z"} fill={color} />
      </Svg>
    </View>
  );
}

/** Time, "edited", the pin and the ticks: at the bubble's bottom right, over a picture on a dark pill, or under a sticker. */
function Meta({ message, mine, read, overlay, inline }: { message: ChatMessage; mine: boolean; read: boolean; overlay?: boolean; inline?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const light = overlay || inline;
  const tint = light ? "#FFFFFF" : mine ? "rgba(255,255,255,0.78)" : colors.inkSoft;
  const tick = message.pending === "sending" ? <Clock3 color={tint} size={12} strokeWidth={2.2} />
    : message.pending === "failed" ? <AlertCircle color={colors.danger} size={13} />
    : read ? <CheckCheck color={light || mine ? READ_TICK : colors.primary} size={16} strokeWidth={2.4} />
    : <Check color={tint} size={15} strokeWidth={2.4} />;
  return (
    <View style={[inline ? styles.metaInline : styles.meta, overlay && styles.metaOver]}>
      {message.pinned_at ? <Pin color={tint} size={11} strokeWidth={2.4} /> : null}
      {message.edited_at ? <Text style={[styles.time, { color: tint }]}>{t("edited")}</Text> : null}
      <Text style={[styles.time, { color: tint }]}>{chatClock(message.created_at)}</Text>
      {mine ? tick : null}
    </View>
  );
}

/* ========================================================== quote, sticker */

/** The answered message, quoted at the top of a reply: who, and a line of it (with a thumbnail for a picture). */
function Quote({ message, mine, still, inset }: { message: ChatMessage; mine: boolean; still?: boolean; inset?: boolean }) {
  const row = useContext(ChatRowContext);
  const actions = useContext(BubbleActionsContext);
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const quote = message.reply ?? null;
  const gone = !quote || Boolean(quote.deleted_at);
  const name = !quote ? "" : quote.sender_id === row?.me ? t("m.me") : row?.peerName ?? "";
  const label = !quote ? t("m.missing") : quote.deleted_at ? t("m.deletedMessage") : quoteLabel(quote, t);
  const thumbPath = gone ? null : quote?.kind === "image" ? quote.media_path : quote?.kind === "album" ? quote.items?.[0]?.path ?? null : null;
  const thumb = usePath(thumbPath);
  return (
    <Pressable
      {...actions}
      accessibilityRole="button"
      disabled={still || !row || !message.reply_to_id}
      onPress={() => { if (message.reply_to_id) { haptic.select(); row?.onJump(message.reply_to_id); } }}
      style={[styles.quote, { backgroundColor: mine ? "rgba(255,255,255,0.16)" : `${colors.primary}14` }, inset && styles.quoteInset]}
    >
      <View style={[styles.quoteBar, { backgroundColor: mine ? "#FFFFFF" : colors.primary }]} />
      {thumb ? <Image source={{ uri: thumb }} style={styles.quoteThumb} /> : null}
      <View style={styles.quoteCopy}>
        {name ? <Text style={[styles.quoteName, { color: mine ? "#FFFFFF" : colors.primary }]} numberOfLines={1}>{name}</Text> : null}
        <Text style={[styles.quoteText, mine ? styles.textMineSoft : null, gone && styles.quoteGone]} numberOfLines={1}>{label}</Text>
      </View>
    </Pressable>
  );
}

/** One to three emoji, alone: big, with no bubble — a sticker, with the time on a small pill under it. */
function Sticker({ message, mine, read, count }: { message: ChatMessage; mine: boolean; read: boolean; count: number }) {
  const styles = useStyles();
  const actions = useContext(BubbleActionsContext);
  const size = count === 1 ? 74 : count === 2 ? 60 : 50;
  return (
    <View style={[styles.sticker, { alignItems: mine ? "flex-end" : "flex-start" }]}>
      <Text {...actions} allowFontScaling={false} style={{ fontSize: size, lineHeight: Math.round(size * 1.22) }}>{message.body.replace(/\s+/g, "")}</Text>
      <Meta message={message} mine={mine} read={read} inline />
    </View>
  );
}

/* ================================================================ reactions */

/** The reactions under a bubble: each emoji with how many; one's own stands out. A tap adds one's own, or takes it back. */
function Reactions({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const row = useContext(ChatRowContext);
  const { colors } = useTheme();
  const styles = useStyles();
  const chips = reactionChips(message.reactions, row?.me ?? "");
  if (!chips.length) return null;
  return (
    <View style={[styles.reactions, mine ? styles.reactionsMine : null]}>
      {chips.map((chip) => (
        <Animated.View key={chip.emoji} entering={ZoomIn.duration(85)}>
          <Pressable
            accessibilityRole="button"
            disabled={!row || Boolean(row.selecting)}
            onPress={() => { haptic.select(); row?.onReact(message, chip.emoji); }}
            style={({ pressed }) => [styles.chip, chip.mine && { backgroundColor: colors.primary, borderColor: colors.primary }, pressed && { transform: [{ scale: 0.92 }] }]}
          >
            <Text style={styles.chipEmoji}>{chip.emoji}</Text>
            {chip.count > 1 ? <Text style={[styles.chipCount, chip.mine && { color: "#FFFFFF" }]}>{chip.count}</Text> : null}
          </Pressable>
        </Animated.View>
      ))}
    </View>
  );
}

/* ================================================================= pictures */

/** How an album of so many lays out: pictures per row, top to bottom. */
function albumRows(count: number): number[] {
  switch (count) {
    case 1: return [1];
    case 2: return [2];
    case 3: return [1, 2];
    case 4: return [2, 2];
    case 5: return [2, 3];
    case 6: return [3, 3];
    case 7: return [1, 3, 3];
    case 8: return [2, 3, 3];
    case 9: return [3, 3, 3];
    default: return [2, 2, 3, 3];
  }
}

/** One picture or an album, edge to edge in the bubble's corners; a tap opens them full screen. */
function Pictures({ message, width, still, inner }: { message: ChatMessage; width: number; still?: boolean; inner?: boolean }) {
  const styles = useStyles();
  const [open, setOpen] = useState<number | null>(null);
  const pictures: Picture[] = message.kind === "album"
    ? (message.localItems?.map((item) => ({ path: null, local: item.uri, width: item.width, height: item.height }))
      ?? (message.items ?? []).map((item) => ({ path: item.path, local: null, width: item.width ?? 4, height: item.height ?? 3 })))
    : [{ path: message.media_path, local: message.localUri ?? null, width: message.media.width ?? 4, height: message.media.height ?? 3 }];
  const shownWidth = inner ? width : width;
  const radiusInside = inner ? 13 : 0;

  let body: ReactNode;
  if (pictures.length <= 1) {
    const only = pictures[0]!;
    const height = Math.min(380, Math.max(150, (shownWidth * only.height) / Math.max(1, only.width)));
    body = <Cell picture={only} width={shownWidth} height={height} onPress={still ? undefined : () => setOpen(0)} />;
  } else {
    const rows = albumRows(pictures.length);
    // Where each row starts in the album.
    const starts = rows.map((_, rowAt) => rows.slice(0, rowAt).reduce((sum, count) => sum + count, 0));
    body = (
      <View style={{ gap: 2 }}>
        {rows.map((count, rowAt) => {
          const height = count === 1 ? shownWidth * 0.56 : count === 2 ? shownWidth * 0.44 : shownWidth * 0.31;
          const cellWidth = (shownWidth - (count - 1) * 2) / count;
          const first = starts[rowAt] ?? 0;
          const cells = pictures.slice(first, first + count);
          return (
            <View key={rowAt} style={{ flexDirection: "row", gap: 2 }}>
              {cells.map((picture, index) => (
                <Cell key={index} picture={picture} width={cellWidth} height={height} onPress={still ? undefined : () => setOpen(first + index)} />
              ))}
            </View>
          );
        })}
      </View>
    );
  }
  return (
    <View style={[styles.pictures, { width: shownWidth, borderRadius: radiusInside }]}>
      {body}
      {open !== null ? <PictureViewer pictures={pictures} start={open} message={message} onClose={() => setOpen(null)} /> : null}
    </View>
  );
}

function Cell({ picture, width, height, onPress }: { picture: Picture; width: number; height: number; onPress?: () => void }) {
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const actions = useContext(BubbleActionsContext);
  const url = usePath(picture.path, picture.local);
  // A picture already at hand is simply there; only one that arrives fades in.
  const [atHand] = useState(() => Boolean(picture.local || (picture.path && cachedMediaUrl(picture.path))));
  return (
    <Pressable {...actions} accessibilityRole="imagebutton" accessibilityLabel={t("m.photo")}
      onPress={onPress} disabled={!onPress} style={[styles.cell, { width, height }]}>
      {url ? <Animated.Image entering={atHand ? undefined : FadeIn.duration(110)} source={{ uri: url }} style={{ width, height }} resizeMode="cover" /> : <ActivityIndicator />}
    </Pressable>
  );
}

export type Picture = { path: string | null; local: string | null; width: number; height: number };

/** A picture on this phone, for saving or sharing: downloaded to the cache when it is a link. */
async function localCopy(url: string): Promise<string> {
  if (!/^https?:/i.test(url)) return url;
  const target = `${FileSystem.cacheDirectory ?? ""}chat-${Date.now()}.jpg`;
  return (await FileSystem.downloadAsync(url, target)).uri;
}

/**
 * Pictures full screen: swiped through, "3 / 7" and a cross at the top, and
 * along the bottom what can be done with the one on screen — save it to the
 * phone's photos, share it, see it in the conversation, answer it.
 */
export function PictureViewer({ pictures, start, message, onClose, onShowInChat, onReply }: {
  pictures: Picture[];
  start: number;
  /** The message the pictures came in: in a conversation, "show in chat" and "reply" act on it. */
  message?: ChatMessage;
  onClose: () => void;
  /** Elsewhere (the profile's media), how to get to the picture's message in its conversation — given which picture is on screen. */
  onShowInChat?: (index: number) => void;
  onReply?: (index: number) => void;
}) {
  const row = useContext(ChatRowContext);
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [at, setAt] = useState(start);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = pictures[at] ?? pictures[0];
  const url = usePath(current?.path ?? null, current?.local ?? null);
  const native = Platform.OS !== "web";

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  async function save() {
    if (!url || busy) return;
    setBusy(true);
    try {
      const permission = await MediaLibrary.requestPermissionsAsync(true);
      if (!permission.granted) { haptic.warning(); setToast(t("m.savePermission")); return; }
      await MediaLibrary.saveToLibraryAsync(await localCopy(url));
      haptic.success();
      setToast(t("m.saved"));
    } catch {
      haptic.error();
      setToast(t("m.saveFailed"));
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!url || busy) return;
    setBusy(true);
    try {
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(await localCopy(url), { mimeType: "image/jpeg", UTI: "public.jpeg" });
    } catch {
      // Closed or unavailable: nothing to say.
    } finally {
      setBusy(false);
    }
  }

  const showInChat = onShowInChat ? () => onShowInChat(at) : row && message && !message.pending ? () => row.onJump(message.id) : undefined;
  const reply = onReply ? () => onReply(at) : row && message && !message.pending ? () => row.onReply(message) : undefined;
  const actions = [
    native ? { key: "save", label: t("m.save"), icon: Download, onPress: () => void save() } : null,
    native ? { key: "share", label: t("m.shareImage"), icon: Share2, onPress: () => void share() } : null,
    showInChat ? { key: "chat", label: t("m.showInChat"), icon: MessageSquareText, onPress: () => { haptic.light(); onClose(); setTimeout(showInChat, 90); } } : null,
    reply ? { key: "reply", label: t("m.reply"), icon: CornerUpLeft, onPress: () => { haptic.light(); onClose(); setTimeout(reply, 90); } } : null,
  ].filter((action): action is NonNullable<typeof action> => action !== null);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.viewer}>
        <FlatList
          data={pictures}
          horizontal
          pagingEnabled
          initialScrollIndex={start}
          getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
          keyExtractor={(_, index) => String(index)}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(event) => setAt(Math.round(event.nativeEvent.contentOffset.x / width))}
          renderItem={({ item }) => <ViewerPage picture={item} width={width} height={height} onClose={onClose} />}
        />
        <View style={[styles.viewerTop, { top: insets.top + 8 }]}>
          {pictures.length > 1 ? <Text style={styles.viewerCount}>{at + 1} / {pictures.length}</Text> : <View />}
          <Pressable accessibilityRole="button" accessibilityLabel={t("cancel")} onPress={onClose} hitSlop={10} style={styles.viewerClose}>
            <X color="#FFFFFF" size={22} />
          </Pressable>
        </View>
        {actions.length ? (
          <View style={[styles.viewerBar, { paddingBottom: Math.max(insets.bottom, 12) + 4 }]}>
            {actions.map((action) => {
              const Icon = action.icon;
              return (
                <Pressable key={action.key} accessibilityRole="button" disabled={busy && (action.key === "save" || action.key === "share")}
                  onPress={action.onPress} style={({ pressed }) => [styles.viewerAction, pressed && { opacity: 0.6 }]}>
                  <Icon color="#FFFFFF" size={22} strokeWidth={2} />
                  <Text style={styles.viewerActionText} numberOfLines={1}>{action.label}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
        {toast ? (
          <Animated.View entering={FadeIn.duration(75)} pointerEvents="none" style={[styles.viewerToast, { bottom: Math.max(insets.bottom, 12) + 86 }]}>
            <Text style={styles.viewerToastText}>{toast}</Text>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

function ViewerPage({ picture, width, height, onClose }: { picture: Picture; width: number; height: number; onClose: () => void }) {
  const url = usePath(picture.path, picture.local);
  return (
    <Pressable onPress={onClose} style={{ width, height, alignItems: "center", justifyContent: "center" }}>
      {url ? <Image source={{ uri: url }} style={{ width, height: height * 0.78 }} resizeMode="contain" /> : <ActivityIndicator color="#fff" />}
    </Pressable>
  );
}

/* =================================================================== voice */

/**
 * A waveform that stays the same for a message, drawn from its key like a fingerprint: for voice messages sent
 * before the voice's own shape went with them.
 */
function bars(seed: string, count: number): number[] {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Array.from({ length: count }, (_, at) => {
    hash = Math.imul(hash ^ (at + 1), 16777619);
    const shape = 0.45 + 0.55 * Math.sin((at / count) * Math.PI);
    return Math.max(0.18, Math.min(1, (((hash >>> 0) % 1000) / 1000) * shape + 0.12));
  });
}

const WAVE_BARS = 32;
const WAVE_WIDTH = WAVE_BARS * 5 - 2;
/** The play button, and the ring round it while the voice's file is on its way. */
const KNOB = 42;
const RING = KNOB + 8;
const RING_R = RING / 2 - 2;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A voice message: play and the waveform.
 *
 * The file is on the phone before anyone taps — fetched when the message arrives or the conversation opens,
 * or the sender's own recording — so play is sound at once, through the one player the whole app shares:
 * starting another voice stops this one, and so does a recording (the button rests meanwhile). While the file
 * is still coming, a ring round the button fills with it; one that could not be had shows a retry, and a tap
 * asks again. While it plays, the bright part of the wave runs smoothly — eased between the player's reports,
 * not stepped — and the button breathes. The bars are the voice's own shape, measured as it was recorded
 * (older messages draw a steady fingerprint of their key instead).
 *
 * `still` (the copy lifted into the menu) neither plays nor fetches; with `prefetch` false (a long list) the
 * file is fetched on a tap only.
 */
export function VoiceMessage({ message, mine, still, prefetch = true }: { message: ChatMessage; mine: boolean; still?: boolean; prefetch?: boolean }) {
  const hub = useContext(VideoHubContext);
  const actions = useContext(BubbleActionsContext);
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const reduceMotion = useReduceMotion();
  const key = voiceKey(message);
  const path = message.media_path;
  const local = message.localUri ?? null;
  const file = useChatMedia(path, { local, auto: prefetch && !still });
  const voice = useVoice(still ? null : key);
  const resting = Boolean(hub?.recording);
  const shape = message.media.waveform;
  const wave = useMemo(() => {
    const measured = readWaveform(shape);
    return measured ? waveBars(measured, WAVE_BARS).map((value) => Math.max(0.12, value)) : bars(key, WAVE_BARS);
  }, [key, shape]);
  const progress = useSharedValue(0);
  const pulse = useSharedValue(0);
  const total = (voice.duration || (message.media.duration_ms ?? 0) / 1000) * 1000;
  const failed = voice.failed || file.state === "error";
  const coming = file.state === "downloading" && !voice.playing;
  const strong = mine ? "#FFFFFF" : colors.primary;
  const faint = mine ? "rgba(255,255,255,0.36)" : `${colors.primary}3D`;
  const glyph = mine ? MINE[1] : colors.onPrimary;

  useEffect(() => {
    const at = total > 0 ? Math.min(1, (voice.position * 1000) / total) : 0;
    // Eased to where the voice will be by the next report, so the wave moves on its own between reports.
    if (voice.playing) progress.set(withTiming(Math.min(1, at + 100 / Math.max(total, 1)), { duration: 110, easing: Easing.linear }));
    else progress.set(withTiming(at, { duration: 90 }));
  }, [progress, total, voice.playing, voice.position]);

  useEffect(() => {
    pulse.set(voice.playing ? withSequence(withTiming(1, { duration: 60 }), withTiming(0, { duration: 120, easing: Easing.out(Easing.quad) })) : withTiming(0, { duration: 60 }));
  }, [pulse, voice.playing]);

  const fill = useAnimatedStyle(() => ({ width: progress.value * WAVE_WIDTH }));
  const button = useAnimatedStyle(() => ({ transform: [{ scale: 1 + pulse.value * 0.12 }] }));

  function press() {
    if (still || resting) return;
    haptic.select();
    // One sound at a time: a video message playing with sound stops for the voice.
    if (!voice.playing) hub?.stop();
    // Played from the phone's copy (the sender's own recording until the cache has it); fetched first, at
    // once, when it is not here yet — or again, after a failure.
    void toggleVoice(key, () => openMedia(path, local), path);
  }

  return (
    <View style={styles.voice}>
      <View style={styles.voiceKnob}>
        {coming ? <VoiceRing progress={file.progress} color={strong} turning={!reduceMotion} /> : null}
        <Animated.View style={button}>
          <Pressable
            {...actions}
            accessibilityRole="button"
            accessibilityLabel={voice.playing ? t("m.pauseVoice") : failed ? t("m.voiceRetry") : t("m.playVoice")}
            accessibilityState={{ disabled: Boolean(still) || resting, busy: coming }}
            disabled={still || resting}
            onPress={press}
            style={[styles.voiceButton, { backgroundColor: mine ? "#FFFFFF" : colors.primary }, resting && styles.voiceResting]}
          >
            {voice.playing
              ? <Animated.View key="pause" entering={ZoomIn.duration(70)}><Pause color={glyph} size={18} fill={glyph} /></Animated.View>
              : failed
                ? <Animated.View key="retry" entering={ZoomIn.duration(70)}><RotateCcw color={glyph} size={18} strokeWidth={2.6} /></Animated.View>
                : <Animated.View key="play" entering={ZoomIn.duration(70)}><Play color={glyph} size={18} fill={glyph} style={{ marginLeft: 2 }} /></Animated.View>}
          </Pressable>
        </Animated.View>
      </View>
      <View style={{ gap: 4 }}>
        <View style={{ width: WAVE_WIDTH, height: 26 }}>
          <View style={styles.wave}>
            {wave.map((value, at) => <View key={at} style={[styles.bar, { height: 4 + value * 20, backgroundColor: faint }]} />)}
          </View>
          <Animated.View style={[styles.waveFill, fill]}>
            <View style={[styles.wave, { width: WAVE_WIDTH }]}>
              {wave.map((value, at) => <View key={at} style={[styles.bar, { height: 4 + value * 20, backgroundColor: strong }]} />)}
            </View>
          </Animated.View>
        </View>
        <Text style={[styles.voiceTime, { color: mine ? "rgba(255,255,255,0.82)" : colors.inkMuted }]}>
          {mediaLength(voice.playing || voice.position > 0 ? voice.position * 1000 : total)}
        </Text>
      </View>
    </View>
  );
}

/**
 * The ring round the play button while the voice's file is on its way: it fills as the file comes, and turns
 * slowly and evenly (not at all when motion is reduced), so a slow connection still looks like work going on.
 */
function VoiceRing({ progress, color, turning }: { progress: number; color: string; turning: boolean }) {
  const styles = useStyles();
  const length = 2 * Math.PI * RING_R;
  const shown = useSharedValue(Math.max(0.08, progress));
  const turn = useSharedValue(0);

  useEffect(() => {
    shown.set(withTiming(Math.max(0.08, progress), { duration: 80, easing: Easing.out(Easing.quad) }));
  }, [progress, shown]);

  useEffect(() => {
    if (!turning) return;
    turn.set(withRepeat(withTiming(1, { duration: 1600, easing: Easing.linear }), -1, false));
    return () => cancelAnimation(turn);
  }, [turn, turning]);

  const arc = useAnimatedProps(() => ({ strokeDashoffset: length * (1 - shown.value) }));
  // From the top, as a clock's hand starts.
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value * 360 - 90}deg` }] }));
  return (
    <Animated.View pointerEvents="none" style={[styles.voiceRing, spin]}>
      <Svg width={RING} height={RING}>
        <AnimatedCircle cx={RING / 2} cy={RING / 2} r={RING_R} stroke={color} strokeWidth={2.5} fill="none"
          strokeDasharray={`${length} ${length}`} strokeLinecap="round" animatedProps={arc} />
      </Svg>
    </Animated.View>
  );
}

/* ============================================================ video notes */

const AnimatedRect = Animated.createAnimatedComponent(Rect);

/**
 * The edge of a video message, filling: as it plays, in the brand's violet; while its file is on its way
 * (`loading`), the same violet, softer.
 */
function NoteRing({ size, progress, loading }: { size: number; progress: SharedValue<number>; loading?: boolean }) {
  const outer = size + 10;
  const corner = (size + 4) * SQUIRCLE;
  const perimeter = 4 * (size + 4) - 8 * corner + 2 * Math.PI * corner;
  const props = useAnimatedProps(() => ({ strokeDashoffset: perimeter * (1 - progress.value) }));
  return (
    <Svg width={outer} height={outer} style={{ position: "absolute", left: -5, top: -5 }} pointerEvents="none">
      <Rect x={3} y={3} width={size + 4} height={size + 4} rx={corner} stroke="rgba(255,255,255,0.22)" strokeWidth={3} fill="none" />
      <AnimatedRect x={3} y={3} width={size + 4} height={size + 4} rx={corner} stroke={MINE[0]} strokeOpacity={loading ? 0.6 : 1} strokeWidth={3.5}
        fill="none" strokeDasharray={`${perimeter} ${perimeter}`} strokeLinecap="round" animatedProps={props} />
    </Svg>
  );
}

/** A note's files on their way: its edge fills as they come — eased between reports, never stepped. */
function NoteLoadRing({ size, progress }: { size: number; progress: number }) {
  const shown = useSharedValue(Math.max(0.06, progress));
  useEffect(() => {
    shown.set(withTiming(Math.max(0.06, progress), { duration: 80, easing: Easing.out(Easing.quad) }));
  }, [progress, shown]);
  return <NoteRing size={size} progress={shown} loading />;
}

/**
 * A note with nothing of it drawn yet: a still square — with a play mark at rest, a retry where its file could
 * not be had, no mark while a tap's file is coming. Over a loop already drawn (`clear`), the mark alone.
 */
function NotePoster({ glyph, clear }: { glyph: "play" | "retry" | null; clear?: boolean }) {
  const styles = useStyles();
  return (
    <View pointerEvents="none" style={[styles.notePoster, clear && styles.notePosterClear]}>
      {glyph ? (
        <View style={styles.noteGlyph}>
          {glyph === "retry"
            ? <RotateCcw color="#FFFFFF" size={24} strokeWidth={2.4} />
            : <Play color="#FFFFFF" size={26} fill="#FFFFFF" style={{ marginLeft: 3 }} />}
        </View>
      ) : null}
    </View>
  );
}

/**
 * A loop that never says its first frame is drawn is taken as drawn after this long: the still square never
 * stays over a playing note. A browser's <video> may say so before anyone listens, so there it is taken as drawn at once.
 */
const DRAWN_FALLBACK_MS = Platform.OS === "web" ? 0 : 1500;

/** A note's last tap: on the touch's own clock when it has one, and on the wall clock. */
type NoteTap = { at: number | null; wall: number };

/**
 * Whether a tap comes so soon after the note's last one that it is the second of a double tap (or a finger
 * bouncing on the glass): then it changes nothing — what the first one started, or stopped, stands.
 */
function tooSoon(last: NoteTap | null, tap: Tap | null, now: number): boolean {
  if (!last) return false;
  const gap = tap && last.at !== null ? tap.at - last.at : now - last.wall;
  return gap >= 0 && gap < DOUBLE_TAP_MS;
}

/**
 * Which file a note's bubble loops, if any: its first part, from the phone, while `wanted` (among the few on
 * screen). A loop keeps the file it started with — the sender's camera file stays the one it plays when the
 * cache's copy arrives, since a new file would be a new player, and a flash. While `frozen` (a recording, or the
 * note playing) nothing changes: a player made mid-take takes the microphone on iOS, and the note playing may
 * be playing on this very loop.
 */
function useLoopFile(file: string | null, wanted: boolean, frozen: boolean): string | null {
  const [loop, setLoop] = useState<string | null>(() => (wanted && !frozen ? file : null));
  useEffect(() => {
    if (frozen) return;
    setLoop((current) => (wanted && file ? current ?? file : null));
  }, [file, frozen, wanted]);
  return loop;
}

/**
 * A note at rest: its first part from the phone's own file, silent, round and round. Its player is the one a
 * tap plays with sound — lent to the screen as it is, so nothing loads and the frame never goes dark. Through
 * a recording it is paused in place (it used to be let go of and made again around every take, which flashed
 * and read the file again); while its note plays on the screen's own players (a later part) it waits, paused.
 */
function NoteLoop({ uri, path, active, playing, shown, recording, onPlayer, onDrawn, forget }: {
  uri: string;
  /** The storage path it plays: kept from eviction while it loops. */
  path: string | null;
  /** Its note plays with sound. */
  active: boolean;
  /** The player of the part on screen while its note plays (this one, lent, for the first part). */
  playing: VideoPlayer | null;
  /** Drawn here — not while its note plays in the corner (a player is drawn in one place at a time). */
  shown: boolean;
  recording: boolean;
  onPlayer: (player: VideoPlayer | null) => void;
  /** Its first frame is on screen: the still square over it can go (null: it went, and a new loop starts covered). */
  onDrawn: (uri: string | null) => void;
  forget?: (player: VideoPlayer) => void;
}) {
  const player = useVideoPlayer(uri, settleLoop);
  const lent = playing === player;
  const front = useAppFront();
  // Still through a take, while its note plays, and while the app is away; round again on return — the phone
  // pauses every video in the background and starts none of them again, so every loop came back frozen.
  useEffect(() => {
    if (lent) return;
    if (recording || active || !front) player.pause();
    else restLoop(player);
  }, [active, front, lent, player, recording]);
  useEffect(() => holdMedia(path), [path]);
  useEffect(() => {
    onPlayer(player);
    return () => onPlayer(null);
  }, [onPlayer, player]);
  // Gone (out of the newest few on screen), its first frame goes with it: back, a fresh player starts under the
  // still square until it draws, not as a black one.
  useEffect(() => {
    const timer = setTimeout(() => onDrawn(uri), DRAWN_FALLBACK_MS);
    return () => {
      clearTimeout(timer);
      onDrawn(null);
    };
  }, [onDrawn, uri]);
  // Going (scrolled far off, deleted): the screen learns it before the player is let go of, and plays it no more.
  useLayoutEffect(() => () => forget?.(player), [forget, player]);
  if (!shown) return null;
  return (
    // playsInline: in a browser on an iPhone, a <video> without it never starts muted on its own, and a tap opened
    // the system's full-screen player. (A phone build ignores it.)
    <VideoView player={active ? playing ?? player : player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false}
      playsInline onFirstFrameRender={() => onDrawn(uri)} />
  );
}

/** Whether the app is on screen: not in the background, where the phone pauses every video and restarts none. */
function useAppFront(): boolean {
  const [front, setFront] = useState(() => AppState.currentState !== "background");
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (next) => setFront(next !== "background"));
    return () => subscription.remove();
  }, []);
  return front;
}

/**
 * A video message in the conversation, as Telegram has it. At rest it loops silently — while it is among the
 * newest few on screen, and only from its file on the phone (the newest notes and those near the screen are
 * fetched ahead; the sender's own never leave it). Otherwise it is a still square with its length, its edge
 * filling while its file comes, a retry if it could not be had. A tap plays it with sound from the start: the
 * looping player itself, at once; what is not on the phone yet is fetched first, at once, the edge filling.
 * It grows while it plays, its edge filling over every part, and plays on in the corner when scrolled away
 * from. A second tap inside a double tap's time changes nothing; a later one stops it.
 */
function VideoNoteMessage({ message, mine, read, still }: { message: ChatMessage; mine: boolean; read: boolean; still?: boolean }) {
  const hub = useContext(VideoHubContext);
  const actions = useContext(BubbleActionsContext);
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const files = noteFiles(message);
  const first = files[0] ?? null;
  // Fetched by the screen (ahead, for the notes worth it) or by a tap — never just for being in the list.
  const media = useChatMedia(first?.path, { local: first?.local, auto: false });
  const parts = useChatMediaSet(files);
  const key = noteKey(message);
  const stage = useNoteStage(key);
  const active = !still && stage.active;
  const here = active && !stage.floating;
  const recording = Boolean(hub?.recording);
  const waiting = active && stage.waiting;
  const shownPlayer = active ? stage.player : null;
  // The copy lifted into the menu loops as the bubble did.
  const loopUri = useLoopFile(media.state === "local" ? media.uri : null, Boolean(still) || stage.looping, recording || active);
  const loop = useRef<VideoPlayer | null>(null);
  const onLoopPlayer = useCallback((player: VideoPlayer | null) => { loop.current = player; }, []);
  // The file whose loop has its first frame on screen: until then the still square covers it, never a black one.
  const [drawn, setDrawn] = useState<string | null>(null);
  const onDrawn = useCallback((uri: string | null) => setDrawn(uri), []);
  const lastTap = useRef<NoteTap | null>(null);
  const size = useSharedValue(here ? NOTE_PLAYING : NOTE_SIZE);

  useEffect(() => {
    size.set(withTiming(here ? NOTE_PLAYING : NOTE_SIZE, { duration: 110, easing: Easing.out(Easing.cubic) }));
  }, [here, size]);

  const box = useAnimatedStyle(() => ({ width: size.value, height: size.value, borderRadius: size.value * SQUIRCLE }));

  function press(event: GestureResponderEvent) {
    // Nothing starts mid-recording: a player starting would take the microphone.
    if (!hub || still || hub.recording) return;
    const tap = tapOf(event);
    const now = Date.now();
    if (tooSoon(lastTap.current, tap, now)) return;
    lastTap.current = { at: tap?.at ?? null, wall: now };
    haptic.select();
    if (active) hub.stop();
    else hub.start(message, loopUri ? loop.current : null);
  }

  const failed = !active && parts.state === "error";
  const coming = parts.state === "downloading" && (!active || waiting);
  const covered = !loopUri || drawn !== loopUri;
  // A note whose sending failed takes no tap of its own: the tap goes to the bubble, which sends it again.
  const off = Boolean(still) || recording || message.pending === "failed";
  return (
    <Pressable
      {...actions}
      onPress={press}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={active ? t("m.stopNote") : failed ? t("m.voiceRetry") : t("m.playNote")}
      accessibilityState={{ disabled: off, busy: coming }}
    >
      <Animated.View style={[styles.note, box]}>
        {loopUri ? (
          // Under another screen the loop holds still too, as through a take — only the loop: taps and voices are untouched.
          <NoteLoop uri={loopUri} path={first?.path ?? null} active={active} playing={shownPlayer} shown={!active || here}
            recording={recording || Boolean(hub?.covered)} onPlayer={onLoopPlayer} onDrawn={onDrawn} forget={hub?.forget} />
        ) : here && shownPlayer ? (
          <VideoView player={shownPlayer} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} playsInline />
        ) : null}
        {active && !here ? (
          // Playing on in the corner.
          <View style={styles.noteAway}><Play color="#FFFFFF" size={30} fill="#FFFFFF" /></View>
        ) : !active && (failed || covered) ? (
          <NotePoster glyph={failed ? "retry" : "play"} clear={!covered} />
        ) : here && !shownPlayer && !loopUri ? (
          // Tapped, its first file still coming: the square waits, its edge filling.
          <NotePoster glyph={null} />
        ) : null}
      </Animated.View>
      {here && hub && !waiting ? <NoteRing size={NOTE_PLAYING} progress={hub.progress} /> : null}
      {coming ? <NoteLoadRing size={here ? NOTE_PLAYING : NOTE_SIZE} progress={parts.progress} /> : null}
      <View style={styles.noteLength}>
        {!active ? <Volume2 color="#fff" size={11} strokeWidth={2.4} /> : null}
        <Text style={styles.noteLengthText}>{mediaLength(message.media.duration_ms ?? 0)}</Text>
      </View>
      <Meta message={message} mine={mine} read={read} overlay />
    </Pressable>
  );
}

/**
 * A video message on its own — the profile's media, opened to be watched: every part not on the phone is
 * fetched at once, it loops silently from the file here, and a tap plays it once through with sound — the
 * loop itself for the first part, the next part loaded while one plays, the edge filling over the whole note
 * by each part's own length (not an even share each) — then it loops again.
 */
export function VideoNote({ message }: { message: ChatMessage }) {
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const files = noteFiles(message);
  const first = files[0] ?? null;
  const media = useChatMedia(first?.path, { local: first?.local, auto: false });
  const parts = useChatMediaSet(files);
  const notes = useNotePlayer();
  const active = notes.player !== null || notes.waiting;
  const loopUri = useLoopFile(media.state === "local" ? media.uri : null, true, active);
  const loop = useRef<VideoPlayer | null>(null);
  const onLoopPlayer = useCallback((player: VideoPlayer | null) => { loop.current = player; }, []);
  const [drawn, setDrawn] = useState<string | null>(null);
  const onDrawn = useCallback((uri: string | null) => setDrawn(uri), []);
  const lastTap = useRef<NoteTap | null>(null);
  const wanted = files.map((file) => (file.local ? "" : file.path ?? "")).join("\n");

  // Opened to be watched: every part not on the phone comes now.
  useEffect(() => {
    for (const path of wanted.split("\n")) if (path) ensureMedia(path, { priority: "now" }).catch(() => undefined);
  }, [wanted]);

  function press(event: GestureResponderEvent) {
    const tap = tapOf(event);
    const now = Date.now();
    if (tooSoon(lastTap.current, tap, now)) return;
    lastTap.current = { at: tap?.at ?? null, wall: now };
    haptic.select();
    if (active) notes.stop();
    else notes.play(files, message.media.duration_ms ?? 0, loopUri ? loop.current : null);
  }

  const failed = !active && parts.state === "error";
  const coming = parts.state === "downloading" && (!active || notes.waiting);
  const covered = !loopUri || drawn !== loopUri;
  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={active ? t("m.stopNote") : failed ? t("m.voiceRetry") : t("m.playNote")}
      accessibilityState={{ busy: coming }}
    >
      <View style={[styles.note, { width: NOTE_SIZE, height: NOTE_SIZE, borderRadius: NOTE_SIZE * SQUIRCLE }]}>
        {loopUri ? (
          <NoteLoop uri={loopUri} path={first?.path ?? null} active={active} playing={notes.player} shown recording={false}
            onPlayer={onLoopPlayer} onDrawn={onDrawn} forget={notes.forget} />
        ) : notes.player ? (
          <VideoView player={notes.player} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} playsInline />
        ) : null}
        {!active && (failed || covered) ? (
          <NotePoster glyph={failed ? "retry" : "play"} clear={!covered} />
        ) : active && !notes.player && !loopUri ? (
          <NotePoster glyph={null} />
        ) : null}
      </View>
      {active && !notes.waiting ? <NoteRing size={NOTE_SIZE} progress={notes.progress} /> : null}
      {coming ? <NoteLoadRing size={NOTE_SIZE} progress={parts.progress} /> : null}
      <View style={styles.noteLength}>
        {!active ? <Volume2 color="#fff" size={11} strokeWidth={2.4} /> : null}
        <Text style={styles.noteLengthText}>{mediaLength(message.media.duration_ms ?? 0)}</Text>
      </View>
    </Pressable>
  );
}

/* ================================================================== shares */

const SHARE_ICONS = { presentation: Presentation, game: Gamepad2, academic: FileText } as const;

function ShareMessage({ message, mine, still }: { message: ChatMessage; mine: boolean; still?: boolean }) {
  const row = useContext(ChatRowContext);
  const actions = useContext(BubbleActionsContext);
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const share = message.share;
  if (!share) return null;
  const Icon = SHARE_ICONS[share.kind] ?? FileText;
  return (
    <View style={styles.share}>
      {/* On iOS the card is one element for VoiceOver (kind, title, defence), carrying the bubble's "react"; its button stays apart. */}
      <View {...actions} accessible={Platform.OS === "ios"} style={styles.shareHead}>
        <View style={[styles.shareIcon, { backgroundColor: mine ? "rgba(255,255,255,0.2)" : colors.primarySoft }]}>
          <Icon color={mine ? "#FFFFFF" : colors.primary} size={22} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[styles.shareKind, mine && styles.textMineSoft]}>{t(`shareKinds.${share.kind}`)}</Text>
          <Text style={[styles.shareTitle, mine && styles.textMine]} numberOfLines={3}>{share.title}</Text>
          {share.kind === "presentation" ? <Text style={[styles.shareNote, mine && styles.textMineSoft]}>{t("withDefense")}</Text> : null}
        </View>
      </View>
      {mine ? null : (
        <Pressable accessibilityRole="button" disabled={still || !row} onPress={() => row?.onShare(message)}
          style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.85 }]}>
          <LibraryBig color={colors.onPrimary} size={16} />
          <Text style={styles.shareButtonText}>{t("addToLibrary")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: 10, paddingVertical: 1, maxWidth: "100%" },
  rowEnd: { paddingBottom: 6 },
  rowMine: { justifyContent: "flex-end", paddingRight: 12 },
  rowTheirs: { justifyContent: "flex-start", paddingLeft: 12 },
  rowSelected: { backgroundColor: `${colors.primary}14` },
  column: { maxWidth: "100%", flexShrink: 1 },
  columnMine: { alignItems: "flex-end", marginLeft: "auto" },
  columnTheirs: { alignItems: "flex-start" },
  lifted: { opacity: 0 },
  flash: { backgroundColor: `${colors.primary}26` },
  replyIcon: {
    position: "absolute", right: 14, width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface,
  },
  selectDot: {
    width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.borderStrong, marginRight: 8,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.surface,
  },
  pop: { alignItems: "center", justifyContent: "center" },
  popEmoji: { fontSize: 46, lineHeight: 56, textAlign: "center" },
  bubbleBox: { position: "relative" },
  bubble: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 7, gap: 4, overflow: "hidden" },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    shadowColor: "#2A0F55", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  picturePad: { paddingHorizontal: 3, paddingTop: 3, paddingBottom: 3 },
  pictureOnly: { overflow: "hidden", backgroundColor: colors.surfaceMuted },
  pictures: { overflow: "hidden" },
  cell: { overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  insetText: { paddingHorizontal: 9 },
  captionGap: { paddingTop: 4, paddingBottom: 3 },
  failedText: { ...typography.caption, color: colors.danger, marginTop: 2 },
  text: { fontFamily: "JaxongirmanSans_400Regular", fontSize: 16, lineHeight: 21, color: colors.ink },
  textMine: { color: "#FFFFFF" },
  textMineSoft: { color: "rgba(255,255,255,0.78)" },
  forwarded: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 12.5, color: colors.primary, paddingTop: 1 },
  spacer: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 11, color: "transparent" },
  meta: { position: "absolute", right: 10, bottom: 5, flexDirection: "row", alignItems: "center", gap: 3 },
  metaOver: { right: 10, bottom: 10, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.42)" },
  metaInline: {
    flexDirection: "row", alignItems: "center", gap: 3, marginTop: 2,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(20,10,40,0.38)",
  },
  time: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 11 },
  quote: { flexDirection: "row", alignItems: "center", gap: 8, minWidth: 150, borderRadius: 8, overflow: "hidden", paddingRight: 10, paddingVertical: 5 },
  quoteInset: { marginHorizontal: 3, marginTop: 3 },
  quoteBar: { width: 3, alignSelf: "stretch", borderRadius: 2 },
  quoteThumb: { width: 32, height: 32, borderRadius: 6 },
  quoteCopy: { flexShrink: 1, minWidth: 0 },
  quoteName: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 13 },
  quoteText: { fontFamily: "JaxongirmanSans_400Regular", fontSize: 13.5, color: colors.inkMuted },
  quoteGone: { fontStyle: "italic" },
  sticker: { paddingHorizontal: 2 },
  reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4, maxWidth: 280 },
  reactionsMine: { justifyContent: "flex-end" },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, height: 28, borderRadius: 14,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#2A0F55", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  chipEmoji: { fontSize: 15 },
  chipCount: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12.5, color: colors.primary },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.96)" },
  viewerTop: { position: "absolute", left: spacing.lg, right: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  viewerCount: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, color: "#FFFFFF" },
  viewerClose: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
  viewerBar: {
    position: "absolute", left: 0, right: 0, bottom: 0, flexDirection: "row", justifyContent: "space-around",
    paddingTop: 12, paddingHorizontal: spacing.md, backgroundColor: "rgba(0,0,0,0.55)",
  },
  viewerAction: { alignItems: "center", gap: 4, minWidth: 64, paddingVertical: 4 },
  viewerActionText: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 12, color: "#FFFFFF" },
  viewerToast: {
    position: "absolute", alignSelf: "center", paddingHorizontal: 16, paddingVertical: 9, borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  viewerToastText: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 13.5, color: "#1B1030" },
  voice: { flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 2, paddingBottom: 12, paddingRight: 4 },
  voiceKnob: { width: KNOB, height: KNOB, alignItems: "center", justifyContent: "center" },
  voiceRing: { position: "absolute", left: (KNOB - RING) / 2, top: (KNOB - RING) / 2, width: RING, height: RING },
  voiceButton: { width: KNOB, height: KNOB, borderRadius: KNOB / 2, alignItems: "center", justifyContent: "center" },
  voiceResting: { opacity: 0.55 },
  wave: { flexDirection: "row", alignItems: "center", gap: 2, height: 26 },
  waveFill: { position: "absolute", left: 0, top: 0, height: 26, overflow: "hidden" },
  bar: { width: 3, borderRadius: 1.5 },
  voiceTime: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 11.5 },
  note: { overflow: "hidden", borderCurve: "continuous", backgroundColor: "#000", alignItems: "center", justifyContent: "center" },
  noteAway: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(40,20,80,0.75)" },
  // A note not looping: the deep violet of the app's video tiles, a soft round mark in the middle.
  notePoster: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "#1E1236" },
  notePosterClear: { backgroundColor: "transparent" },
  noteGlyph: { width: 56, height: 56, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.36)" },
  noteLength: {
    position: "absolute", left: 10, bottom: 10, flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.42)",
  },
  noteLengthText: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 11, color: "#fff" },
  share: { width: 252, gap: spacing.sm, paddingVertical: 2, paddingBottom: 14 },
  shareHead: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start" },
  shareIcon: { width: 44, height: 44, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  shareKind: { ...typography.caption, color: colors.inkMuted },
  shareTitle: { ...typography.bodyMedium, color: colors.ink },
  shareNote: { ...typography.caption, color: colors.inkMuted },
  shareButton: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
    paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.primary,
  },
  shareButtonText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.onPrimary },
}));
