import * as Clipboard from "expo-clipboard";
import * as ImagePicker from "expo-image-picker";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useIsFocused, useLocalSearchParams, useRouter } from "expo-router";
import { VideoView, type VideoPlayer } from "expo-video";
import {
  ArrowDown, Ban, Bell, BellOff, ChevronLeft, CircleCheck, Copy, CornerUpLeft, EllipsisVertical, Eraser, Flag, Forward, Pencil, Pin, PinOff,
  ShieldCheck, Trash2, UserRound, X,
} from "lucide-react-native";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator, Alert, AppState, FlatList, Platform, Pressable, StyleSheet, Text, View, type ListRenderItemInfo, type NativeScrollEvent,
  type NativeSyntheticEvent, type ViewToken,
} from "react-native";
import { KeyboardAvoidingView, useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AttachSheet } from "@/components/ChatAttachSheet";
import {
  ChatRowContext, createNoteStage, MessageBubble, noteKey, NoteStageContext, quoteLabel, VideoHubContext, type BubbleFrame, type ChatRowContextValue,
  type VideoHubValue,
} from "@/components/ChatBubbles";
import { ChatComposer, type VideoPart } from "@/components/ChatComposer";
import { ForwardSheet } from "@/components/ChatForwardSheet";
import {
  ActionSheet, ChatWallpaper, CornerMenu, DayDivider, Glass, SquircleAvatar, SQUIRCLE, TypingDots, type CornerItem, type SheetAction,
} from "@/components/ChatKit";
import { MessageMenu, type MenuAction, type MenuTarget } from "@/components/ChatMessageMenu";
import { ErrorState } from "@/components/StateBlocks";
import {
  addToLibrary, blockUser, chatProfile, clearChat, conversationMembers, conversationPeer, deleteMessages, editable, editMessage,
  followConversation, forwardMessages, initialsOf, isBlockedFailure, isProtectedFailure, libraryHref, loadMessage, loadMessages, loadPinned,
  markRead, MAX_PICK, newClientId, noteFiles, peerName, peerStatus, pinMessage, protectHistory, reactTo, REPORT_REASONS, reportChat, saveContact,
  sendMessage, shrinkImage, unblockUser, uploadChatFile, uploadRecording, uploadVideoParts,
  type ChatMember, type ChatMessage, type ChatPeer, type ChatQuote, type ChatShare, type OutgoingPart, type ReportReason, type Shareable,
} from "@/lib/chat";
import {
  adoptMedia, discardFile, dropConversation, dropMessages, localMedia, prefetchMessages, prefetchNotes, pruneConversation, sentMedia,
  withdrawMedia,
} from "@/lib/chatMedia";
import { chatDay, lastSeen } from "@/lib/chatTime";
import { sendTyping, useTyping } from "@/lib/chatTyping";
import { asErrorMessage } from "@/lib/format";
import { REACTION_SETTLE_MS, withMine } from "@/lib/doubleTap";
import { haptic } from "@/lib/haptics";
import { useNotePlayer } from "@/lib/notePlayer";
import { clearOpenConversation, setOpenConversation } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { NEWEST_NOTES, notesNear, notesToLoop, sameKeys } from "@/lib/videoNote";
import { stopVoice, voiceKey } from "@/lib/voicePlayer";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** What a pending message needs to be sent again after a failure. */
type Outbox = {
  kind: ChatMessage["kind"];
  body: string;
  media: ChatMessage["media"];
  localUri?: string;
  mime?: string;
  extension?: string;
  /** Where the one file went once it landed: a retry after a failed send sends the message, not the file again. */
  mediaPath?: string;
  localItems?: { uri: string; width: number; height: number }[];
  /**
   * A video message: every part, in order (one, unless the camera was turned round); the first becomes the
   * message's file. Each part learns its path as it lands, so a retry uploads only what is still missing.
   */
  parts?: OutgoingPart[];
  share?: ChatShare;
  replyTo?: string | null;
  /** The quote of the answered message, as the reply bar showed it (it may not be among the loaded messages). */
  replyQuote?: ChatQuote | null;
};

type Sheet =
  | { kind: "block" }
  | { kind: "clear" }
  | { kind: "report"; messageId: string | null }
  | { kind: "delete"; ids: string[] };

/** Messages from one person this close together are one run. */
const GROUP_MS = 5 * 60_000;
/** The round buttons and the name's capsule at the top. */
const HEADER = 46;
const PIN_BAR = 50;
const VIEWABILITY = { itemVisiblePercentThreshold: 35 };
const NOTHING: ReadonlySet<string> = new Set();
/** The list has come to rest when it has not moved for this long: then the notes near it come to the phone (a fling past fetches none). */
const NEAR_SETTLE_MS = 600;
/** The rows a list draws — the newest first; `client_id` keeps a sent message's row when the server confirms it. */
const keyOf = (message: ChatMessage) => message.client_id ?? message.id;
/**
 * A message's time and its day on this phone, read from its date once: every row asks for its own and its
 * neighbours' to place the day between them and the runs, and a date read from text is not free.
 */
const stamps = new WeakMap<ChatMessage, { time: number; day: string }>();
function stampOf(message: ChatMessage): { time: number; day: string } {
  let stamp = stamps.get(message);
  if (!stamp) {
    const date = new Date(message.created_at);
    stamp = { time: date.getTime(), day: date.toDateString() };
    stamps.set(message, stamp);
  }
  return stamp;
}
const sameDay = (a: ChatMessage, b: ChatMessage) => stampOf(a).day === stampOf(b).day;
const together = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
  Boolean(a && b && a.sender_id === b.sender_id && sameDay(a, b) && Math.abs(stampOf(a).time - stampOf(b).time) < GROUP_MS);

/** A message, as a reply quotes it — when it is on this phone. */
function quoteFrom(list: ChatMessage[] | null, id: string): ChatQuote | null {
  const found = list?.find((message) => message.id === id);
  return found
    ? { id: found.id, sender_id: found.sender_id, kind: found.kind, body: found.body, media_path: found.media_path, share: found.share, deleted_at: found.deleted_at ?? null, items: found.items ?? null }
    : null;
}

/**
 * A video note's parts, once every one has landed: each file the camera recorded becomes the media cache's copy
 * of the path it went up as. Copied, not moved — the bubble may be looping the camera's file this moment, and a
 * looping player opens its file again at every turn (on Android), so a moved file would go dark mid-loop. The
 * camera's files are listed in `copies`, to go when the conversation does. Answers them in the order the message
 * names its parts.
 */
async function keepRecordedParts(parts: readonly OutgoingPart[], copies: string[]): Promise<string[]> {
  const sent = parts.filter((part): part is OutgoingPart & { path: string } => Boolean(part.path));
  // All at once: the message waits for these copies before it is sent.
  await Promise.all(sent.map(async (part) => {
    // Kept on an earlier try (the upload landed, the send failed): nothing to copy again.
    if (localMedia(part.path)) return;
    if (await adoptMedia(part.uri, part.path, { copy: true })) copies.push(part.uri);
  }));
  return sent.map((part) => part.uri);
}

/**
 * One conversation, as a messenger draws it.
 *
 * At the top, floating on glass over the wallpaper: back, the person's name
 * and whether they are here or typing, their picture in the app's rounded
 * square, and the menu that grows out of the corner. Under it, the pinned
 * message. Then the messages in runs with the day between them, and the field
 * to write in — which sits right on the keyboard when it is up.
 *
 * Messages arrive live; one's own appear at once and are confirmed by the
 * server (a failed one is tapped to send again); the other side's reading
 * turns one tick into two; a correction, a reaction, a pin or a message taken
 * back changes the bubble where it is. A bubble slid left is answered; held,
 * it lifts into the menu (reply, copy, edit, pin, forward, delete, select).
 * Several are chosen in select mode. A tap on a quote or the pin finds the
 * message, loading older ones if needed.
 */
export default function ConversationScreen() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const me = user?.id ?? "";
  // `focus` / `reply`: the profile's "show in chat" / "reply"; `at` makes the same picture asked for twice count twice.
  const { id, peer: peerParam, focus, reply: replyParam, at: askedAt } = useLocalSearchParams<{ id: string; peer?: string; focus?: string; reply?: string; at?: string }>();
  const [peer, setPeer] = useState<ChatPeer | null>(null);
  const [status, setStatus] = useState<{ online: boolean; last_seen_at: string | null } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [members, setMembers] = useState<ChatMember[]>([]);
  const [pinned, setPinned] = useState<ChatMessage[]>([]);
  const [pinAt, setPinAt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [older, setOlder] = useState<"idle" | "loading" | "done">("idle");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const [chatMenu, setChatMenu] = useState(false);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [forwardIds, setForwardIds] = useState<string[] | null>(null);
  const [attach, setAttach] = useState(false);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  /** The video note playing (or whose first file is still coming for a tap), by its key (`noteKey`). */
  const [note, setNote] = useState<string | null>(null);
  /** Something is recording: every video player holds still (a playing one would take the audio session from the microphone). */
  const [recording, setRecordingNow] = useState(false);
  const [noteFloating, setNoteFloating] = useState(false);
  /** The notes that loop silently: the newest few on screen. */
  const [looping, setLooping] = useState<ReadonlySet<string>>(NOTHING);
  // What was on screen when the conversation opened: only what arrives after rises into place.
  const [initial] = useState(() => new Set<string>());
  const outbox = useRef(new Map<string, Outbox>());
  const awayRef = useRef(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const messagesRef = useRef<ChatMessage[] | null>(null);
  const membersRef = useRef<ChatMember[]>([]);
  const olderRef = useRef<"idle" | "loading" | "done">("idle");
  const noteRef = useRef<string | null>(null);
  /** The keys of the messages on screen. */
  const visible = useRef(new Set<string>());
  /** The wait for the list to come to rest before the notes near it are fetched. */
  const nearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * This screen, as the one fetching notes ahead for where its list rests: what it queued for a rest it has
   * moved on from, or before it went away, is called off — not left to download on whatever line the phone has.
   */
  const [nearOwner] = useState(() => `near-${newClientId()}`);
  /** Whether this screen is the one on top: covered by another (a profile, a deck), its notes neither sound nor loop. */
  const onTop = useIsFocused();
  /**
   * The camera's own files of notes sent from here, copied into the media cache when they landed: the bubble
   * may still be looping them, so they go only when the conversation does.
   */
  const recordedCopies = useRef<string[]>([]);
  /** Messages being sent now, by client id: each goes up once at a time. */
  const sending = useRef(new Set<string>());
  /** The screen is still there: a send finishing after it went cleans up after itself. */
  const alive = useRef(true);
  /**
   * Per message, while a reaction on it is being saved: how many changes were
   * asked for (only the newest one's answer is shown), what the server last
   * confirmed (where a failure goes back to), the request still out, which
   * the next one waits for, and one's own reaction as last asked or heard
   * (`mine`). Meanwhile, and for a few seconds after the newest answer
   * (`settle`), Realtime's echoes change everyone's reactions but one's own: an
   * echo of an earlier step, arriving after the last answer, brought back for a
   * moment what was just taken off.
   */
  const reacting = useRef(new Map<string, {
    asked: number; confirmed: Record<string, string>; last: Promise<unknown>; mine: string | null; settle?: ReturnType<typeof setTimeout>;
  }>());
  const typingIn = useTyping(id ? [id] : [], me || null);
  const typing = Boolean(id && typingIn.has(id));
  const keyboard = useReanimatedKeyboardAnimation();
  const dark = scheme === "dark";

  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { membersRef.current = members; }, [members]);
  useEffect(() => { olderRef.current = older; }, [older]);

  const readAt = members.find((member) => member.user_id !== me)?.last_read_at ?? null;
  const iProtect = Boolean(members.find((member) => member.user_id === me)?.protect_history);
  const theyProtect = Boolean(members.find((member) => member.user_id !== me)?.protect_history);

  const loadPeer = useCallback(async () => {
    if (!id || !me) return;
    const next = typeof peerParam === "string" && peerParam ? await chatProfile(peerParam) : await conversationPeer(id, me);
    setPeer(next);
    if (next) setStatus({ online: Boolean(next.online), last_seen_at: next.last_seen_at ?? null });
  }, [id, me, peerParam]);

  // While this conversation is on screen (focused, not merely mounted under another), its own pushes stay quiet.
  useFocusEffect(useCallback(() => {
    if (!id) return undefined;
    setOpenConversation(id);
    return () => clearOpenConversation(id);
  }, [id]));

  // Leaving the conversation, or covering it with another screen, stops a voice message playing in it: the app
  // has one voice player, and nothing on the other screen would stop it.
  useFocusEffect(useCallback(() => () => { stopVoice(); }, []));

  // What the conversation keeps on the phone, checked against the server: when it opens, and whenever the app
  // comes back to it (Realtime does not replay what was taken back or cleared while nobody listened).
  useEffect(() => {
    if (!id) return;
    pruneConversation(id);
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") pruneConversation(id); });
    return () => subscription.remove();
  }, [id]);

  /** A reply that came in over Realtime has no quote with it: found on the phone, or asked for. */
  const fillQuote = useCallback(async (messageId: string, replyId: string) => {
    if (quoteFrom(messagesRef.current, replyId)) return;
    const quote = await loadMessage(replyId);
    if (quote) setMessages((current) => current?.map((message) => (message.id === messageId ? { ...message, reply: quote } : message)) ?? current);
  }, []);

  useEffect(() => {
    if (!id || !me) return;
    let alive = true;
    void (async () => {
      try {
        const [first, rows, pins] = await Promise.all([
          loadMessages(id), conversationMembers(id), loadPinned(id).catch(() => [] as ChatMessage[]),
        ]);
        if (!alive) return;
        for (const message of first) initial.add(message.id);
        setMessages(first);
        // Voices come to the phone before anyone taps them, and the newest video notes (the rest as the list nears them).
        prefetchMessages(first, { notes: NEWEST_NOTES });
        setMembers(rows);
        setPinned(pins);
        setOlder(first.length < 40 ? "done" : "idle");
        void markRead(id);
      } catch (failure) {
        if (alive) setError(asErrorMessage(failure));
      }
    })();
    const channel = followConversation(id, {
      onMessage: (incoming) => {
        setMessages((current) => {
          if (!current) return current;
          if (current.some((message) => message.id === incoming.id)) return current;
          const quoted = { ...incoming, reply: incoming.reply_to_id ? quoteFrom(current, incoming.reply_to_id) : null };
          // One's own, coming back: it replaces the bubble already on screen.
          const at = incoming.client_id ? current.findIndex((message) => message.client_id === incoming.client_id && message.pending) : -1;
          if (at >= 0) {
            return current.map((message, index) => (index === at
              ? { ...quoted, reply: message.reply ?? quoted.reply, localUri: message.localUri, localItems: message.localItems, localParts: message.localParts }
              : message));
          }
          return [quoted, ...current];
        });
        // On the phone before anyone taps (a note arriving now is the newest) — all but one's own from here, whose
        // files are the ones it recorded.
        if (!(incoming.client_id && outbox.current.has(incoming.client_id))) prefetchMessages([incoming], { notes: NEWEST_NOTES });
        if (incoming.reply_to_id) void fillQuote(incoming.id, incoming.reply_to_id);
        if (incoming.sender_id !== me) {
          haptic.select();
          void markRead(id);
          if (awayRef.current) setUnseen((count) => count + 1);
        }
      },
      onChange: (changed) => {
        // Replies quoting this message show the change (or that it is gone) at once.
        const requote = (message: ChatMessage): ChatMessage => (message.reply_to_id === changed.id
          ? { ...message, reply: changed.deleted_at
              ? { ...(message.reply ?? { id: changed.id, sender_id: changed.sender_id, kind: changed.kind, share: null }), body: "", media_path: null, items: null, share: null, deleted_at: changed.deleted_at }
              : { id: changed.id, sender_id: changed.sender_id, kind: changed.kind, body: changed.body, media_path: changed.media_path, share: changed.share, deleted_at: null, items: changed.items ?? null } }
          : message);
        if (changed.deleted_at) {
          // Taken back: the row comes without its files' names, so they are found on the phone — its voice stops
          // if it is the one playing, and its files leave the phone.
          const gone = messagesRef.current?.find((message) => message.id === changed.id);
          if (gone) {
            stopVoice(voiceKey(gone));
            dropMessages([gone]);
          }
          setMessages((current) => current?.filter((message) => message.id !== changed.id).map(requote) ?? current);
          setPinned((current) => current.filter((message) => message.id !== changed.id));
          return;
        }
        // One's own reaction on it still being saved: the reactions on screen stay until the newest answer puts them right.
        const flight = reacting.current.get(changed.id);
        const reactions = flight ? withMine(changed.reactions ?? {}, me, flight.mine) : changed.reactions;
        setMessages((current) => current?.map((message) => (message.id === changed.id
          ? { ...message, ...changed, reply: message.reply, localUri: message.localUri, localItems: message.localItems, localParts: message.localParts,
              reactions }
          : requote(message))) ?? current);
        setPinned((current) => {
          const rest = current.filter((message) => message.id !== changed.id);
          return changed.pinned_at ? [changed, ...rest].sort((a, b) => (b.pinned_at ?? "").localeCompare(a.pinned_at ?? "")) : rest;
        });
      },
      onMember: (row) => {
        const before = membersRef.current.find((member) => member.user_id === row.user_id);
        // Cleared — here, on another phone, or by the other person for both: what is now hidden goes.
        if (row.user_id === me && row.cleared_at && row.cleared_at !== before?.cleared_at) {
          const cleared = row.cleared_at;
          // And its files leave the phone (anything newer that stays is fetched again when it is played) — only
          // on a clear seen happen, never on the first word of a row not loaded yet.
          if (before) {
            stopVoice();
            dropMessages((messagesRef.current ?? []).filter((message) => message.created_at <= cleared));
            dropConversation(id);
          }
          setMessages((current) => current?.filter((message) => message.created_at > cleared) ?? current);
          setPinned([]);
        }
        setMembers((current) => (current.some((member) => member.user_id === row.user_id)
          ? current.map((member) => (member.user_id === row.user_id ? { ...member, ...row } : member))
          : [...current, row]));
      },
    });
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, [fillQuote, id, initial, me]);

  useEffect(() => {
    void loadPeer().catch(() => undefined);
  }, [loadPeer]);

  // Whether they are here: asked again every 20 seconds while the conversation is open.
  const peerId = peer?.id;
  const blocked = Boolean(peer?.blocked);
  useEffect(() => {
    if (!peerId || blocked) return;
    const ask = () => void peerStatus(peerId).then(setStatus).catch(() => undefined);
    const timer = setInterval(ask, 20_000);
    return () => clearInterval(timer);
  }, [blocked, peerId]);

  /**
   * The page before the oldest message loaded. Read through refs, so the list is given one function for good
   * (a new one every render drew every row again); marked as loading at once, so a second call before the
   * next render asks for nothing.
   */
  const loadOlder = useCallback(async () => {
    const loadedNow = messagesRef.current;
    if (!id || !loadedNow?.length || olderRef.current !== "idle") return;
    olderRef.current = "loading";
    setOlder("loading");
    try {
      const page = await loadMessages(id, loadedNow[loadedNow.length - 1]!.created_at);
      for (const message of page) initial.add(message.id);
      setMessages((current) => {
        const have = new Set((current ?? []).map((message) => message.id));
        return [...(current ?? []), ...page.filter((message) => !have.has(message.id))];
      });
      prefetchMessages(page);
      setOlder(page.length < 40 ? "done" : "idle");
    } catch {
      setOlder("idle");
    }
  }, [id, initial]);

  /** Puts a message on screen at once, then sends it; uploads its files first when it has them. */
  const send = useCallback(async (clientId: string, item: Outbox) => {
    if (!id || !me) return;
    // One send of a message at a time: a second tap on a failed bubble before it redrew as "sending" uploaded the
    // same voice twice, under two names.
    if (sending.current.has(clientId)) return;
    sending.current.add(clientId);
    const voice = item.kind === "voice";
    const began = Date.now();
    const trace = (...what: unknown[]) => { if (__DEV__ && voice) console.log(`[voice send] ${clientId.slice(0, 8)} +${Date.now() - began} ms`, ...what); };
    trace("sending", { file: item.localUri, uploaded: item.mediaPath ?? null, media: { ...item.media, waveform: item.media.waveform?.length } });
    outbox.current.set(clientId, item);
    const shown: ChatMessage = {
      id: `local-${clientId}`, conversation_id: id, sender_id: me, kind: item.kind, body: item.body, media_path: null,
      media: item.media, share: item.share ?? null, client_id: clientId, created_at: new Date().toISOString(), pending: "sending",
      localUri: item.localUri, localItems: item.localItems, reactions: {},
      localParts: item.parts && item.parts.length > 1 ? item.parts.map((part) => part.uri) : undefined,
      reply_to_id: item.replyTo ?? null, reply: item.replyTo ? quoteFrom(messagesRef.current, item.replyTo) ?? item.replyQuote ?? null : null,
    };
    setMessages((current) => [shown, ...(current ?? []).filter((message) => message.client_id !== clientId)]);
    list.current?.scrollToOffset({ offset: 0, animated: true });
    try {
      // A video message: its parts streamed from disk; the first is the message's file and, when there are
      // several, all of them its items. Each part is written into the outbox the moment it lands, so a retry
      // after a failure uploads only the parts still missing — never one twice.
      const partPaths = item.kind === "video" && item.parts?.length
        ? await uploadVideoParts(id, me, item.parts, (at, path) => {
            const entry = outbox.current.get(clientId);
            if (entry?.parts) outbox.current.set(clientId, { ...entry, parts: entry.parts.map((part, index) => (index === at ? { ...part, path } : part)) });
          })
        : null;
      // Every part landed: the camera's files become the phone's own copies of what they went up as — before the
      // message is sent, so its echo finds nothing to fetch and the sender never downloads their own note.
      const recorded = partPaths ? await keepRecordedParts(outbox.current.get(clientId)?.parts ?? [], recordedCopies.current) : null;
      // The conversation was left while these went up: no bubble loops the camera's files any more, and the cleanup
      // that deletes them has already run — they go now (the cache has its copies).
      if (recorded && !alive.current) for (const uri of recordedCopies.current.splice(0)) discardFile(uri);
      // One file (a picture, a voice) is uploaded once and remembered, so a retry after a failed send sends the
      // message, not the file again under a new name. A voice the phone recorded becomes, the moment it lands,
      // the phone's own copy of what it was uploaded as — moved into the media cache, never downloaded back.
      let localUri = item.localUri;
      let mediaPath = partPaths ? partPaths[0]!.path : item.mediaPath ?? null;
      if (!mediaPath && item.localUri && item.mime && item.extension) {
        // A voice goes up the way video notes do — streamed from disk by the phone's own upload task, the file
        // looked at first; a picture as before.
        mediaPath = voice
          ? await uploadRecording(id, me, item.localUri, item.mime, item.extension)
          : await uploadChatFile(id, me, item.localUri, item.mime, item.extension);
        trace("uploaded as", mediaPath);
        if (voice) localUri = (await adoptMedia(item.localUri, mediaPath)) ?? item.localUri;
        if (voice) trace("kept as the cache's copy:", localUri);
        const entry = outbox.current.get(clientId);
        if (entry) outbox.current.set(clientId, { ...entry, mediaPath, localUri });
      }
      const items = partPaths
        ? (partPaths.length > 1 ? partPaths : null)
        : item.localItems
          ? await Promise.all(item.localItems.map(async (picture) => ({
              path: await uploadChatFile(id, me, picture.uri, "image/jpeg", "jpg"), width: picture.width, height: picture.height,
            })))
          : null;
      const saved = await sendMessage({
        conversationId: id, kind: item.kind, body: item.body, mediaPath, media: item.media, clientId, items,
        replyTo: item.replyTo ?? null, share: item.share ? { kind: item.share.kind, id: item.share.id } : null,
      });
      trace("sent:", saved.id);
      // The server names these files now: from here they are checked against it like any other kept file.
      sentMedia([mediaPath, ...(partPaths ?? []).map((part) => part.path)]);
      outbox.current.delete(clientId);
      // The confirmed row keeps the bubble's place and does not rise a second time.
      initial.add(saved.id);
      // A note keeps the camera's files it plays from, in the order the message now names its parts.
      setMessages((current) => (current ?? [])
        .map((message) => (message.client_id === clientId && message.pending
          ? {
              ...saved, reply: message.reply, localUri: recorded?.[0] ?? localUri, localItems: item.localItems,
              localParts: recorded ? (recorded.length > 1 ? recorded : undefined) : message.localParts,
            }
          : message))
        .filter((message, index, all) => all.findIndex((other) => other.id === message.id) === index));
    } catch (failure) {
      trace("failed:", failure instanceof Error ? failure.message : failure);
      // The screen went while this was being sent: nothing can send it again, and nobody cleans up after it but here.
      if (!alive.current) {
        const left = outbox.current.get(clientId) ?? item;
        for (const part of left.parts ?? []) discardFile(part.uri);
        if (left.kind === "voice" && !left.mediaPath) discardFile(left.localUri);
        outbox.current.delete(clientId);
      }
      haptic.error();
      if (isBlockedFailure(failure)) setNotice(t("block.cantSend"));
      setMessages((current) => (current ?? []).map((message) => (message.client_id === clientId && message.pending ? { ...message, pending: "failed" } : message)));
    } finally {
      sending.current.delete(clientId);
    }
  }, [id, initial, me, t]);

  const retry = useCallback((message: ChatMessage) => {
    const item = message.client_id ? outbox.current.get(message.client_id) : null;
    if (item && message.client_id) void send(message.client_id, item);
  }, [send]);

  /** The message being answered, taken for one send: its id, and its quote as the bar showed it. */
  const takeReply = useCallback((): { replyTo: string | null; replyQuote: ChatQuote | null } => {
    const target = replyTo;
    setReplyTo(null);
    if (!target || target.pending) return { replyTo: null, replyQuote: null };
    return {
      replyTo: target.id,
      replyQuote: { id: target.id, sender_id: target.sender_id, kind: target.kind, body: target.body, media_path: target.media_path, share: target.share, deleted_at: target.deleted_at ?? null, items: target.items ?? null },
    };
  }, [replyTo]);

  async function pickPictures() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], allowsMultipleSelection: true, selectionLimit: MAX_PICK, orderedSelection: true, quality: 1,
    });
    if (result.canceled || !result.assets.length) return;
    try {
      const pictures = await Promise.all(result.assets.slice(0, MAX_PICK).map((asset) => shrinkImage(asset.uri, asset.width, asset.height)));
      const reply = takeReply();
      haptic.light();
      if (pictures.length === 1) {
        const only = pictures[0]!;
        void send(newClientId(), { kind: "image", body: "", localUri: only.uri, mime: "image/jpeg", extension: "jpg", media: { width: only.width, height: only.height }, ...reply });
      } else {
        void send(newClientId(), { kind: "album", body: "", media: {}, localItems: pictures, ...reply });
      }
    } catch {
      setNotice(t("failed"));
    }
  }

  async function takePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) { setNotice(t("cameraPermission")); return; }
    const result = await ImagePicker.launchCameraAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    try {
      const small = await shrinkImage(asset.uri, asset.width, asset.height);
      haptic.light();
      void send(newClientId(), { kind: "image", body: "", localUri: small.uri, mime: "image/jpeg", extension: "jpg", media: { width: small.width, height: small.height }, ...takeReply() });
    } catch {
      setNotice(t("failed"));
    }
  }

  function sendShares(items: Shareable[]) {
    // Only the first carries the quote.
    let reply: ReturnType<typeof takeReply> = takeReply();
    for (const item of items) {
      void send(newClientId(), { kind: "share", body: "", media: {}, share: { kind: item.kind, id: item.id, title: item.title }, ...reply });
      reply = { replyTo: null, replyQuote: null };
    }
  }

  const saveEdit = useCallback(async (text: string) => {
    const target = editing;
    setEditing(null);
    if (!target || text === target.body) return;
    const before = target.body;
    setMessages((current) => current?.map((message) => (message.id === target.id ? { ...message, body: text, edited_at: new Date().toISOString() } : message)) ?? current);
    try {
      await editMessage(target.id, text);
    } catch (failure) {
      setMessages((current) => current?.map((message) => (message.id === target.id ? { ...message, body: before, edited_at: target.edited_at } : message)) ?? current);
      setNotice(isBlockedFailure(failure) ? t("block.cantSend") : asErrorMessage(failure));
    }
  }, [editing, t]);

  const addShared = useCallback(async (message: ChatMessage) => {
    try {
      const added = await addToLibrary(message.id);
      haptic.success();
      Alert.alert(t("added"), message.share?.title ?? "", [
        { text: t("profile.close"), style: "cancel" },
        { text: t("open"), onPress: () => router.push(libraryHref(added.kind, added.id) as never) },
      ]);
    } catch (failure) {
      Alert.alert(t("addToLibrary"), asErrorMessage(failure));
    }
  }, [router, t]);

  /**
   * One reaction each: shown at once, put right by what the server answers.
   *
   * Two double taps in a row (the heart on, then off again) must end with it
   * off, whichever answer comes back first. So the requests for one message go
   * one after another, in the order they were made, and only the newest one's
   * answer is shown — or, if it fails, what the server last confirmed. Taking a
   * reaction back names no emoji: the server then clears whatever is there, so
   * a copy here that is a moment out of date can never put it back on instead.
   */
  const react = useCallback(async (message: ChatMessage, emoji: string) => {
    if (message.pending || !me) return;
    const before = message.reactions ?? {};
    const takeBack = before[me] === emoji;
    const next = { ...before };
    if (takeBack) delete next[me];
    else next[me] = emoji;
    const put = (reactions: Record<string, string>) =>
      setMessages((current) => current?.map((other) => (other.id === message.id ? { ...other, reactions } : other)) ?? current);
    const flight = reacting.current.get(message.id) ?? { asked: 0, confirmed: before, last: Promise.resolve(), mine: before[me] ?? null };
    reacting.current.set(message.id, flight);
    if (flight.settle) clearTimeout(flight.settle);
    flight.settle = undefined;
    const turn = ++flight.asked;
    const request = flight.last.catch(() => undefined).then(() => reactTo(message.id, takeBack ? null : emoji));
    flight.last = request;
    flight.mine = takeBack ? null : emoji;
    put(next);
    try {
      const answer = await request;
      flight.confirmed = answer;
      if (flight.asked === turn) {
        flight.mine = answer[me] ?? null;
        put(answer);
      }
    } catch (failure) {
      if (flight.asked === turn) {
        flight.mine = flight.confirmed[me] ?? null;
        put(flight.confirmed);
        setNotice(isBlockedFailure(failure) ? t("block.cantSend") : asErrorMessage(failure));
      }
    } finally {
      // Held a little longer than the answer: Realtime's echo of an earlier step may still be on its way.
      if (flight.asked === turn) {
        flight.settle = setTimeout(() => {
          if (reacting.current.get(message.id) === flight && flight.asked === turn) reacting.current.delete(message.id);
        }, REACTION_SETTLE_MS);
      }
    }
  }, [me, t]);
  // The screen going: no hold on anyone's reactions is waited out any more.
  useEffect(() => {
    const flights = reacting.current;
    return () => {
      for (const flight of flights.values()) if (flight.settle) clearTimeout(flight.settle);
      flights.clear();
    };
  }, []);

  async function setPin(message: ChatMessage, on: boolean) {
    try {
      const saved = await pinMessage(message.id, on);
      haptic.soft();
      setNotice(t(on ? "m.pinnedDone" : "m.unpinnedDone"));
      setMessages((current) => current?.map((other) => (other.id === saved.id ? { ...other, pinned_at: saved.pinned_at } : other)) ?? current);
      setPinned((current) => {
        const rest = current.filter((other) => other.id !== saved.id);
        return on ? [saved, ...rest] : rest;
      });
      setPinAt(0);
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  async function reload() {
    if (!id) return;
    try {
      const first = await loadMessages(id);
      for (const message of first) initial.add(message.id);
      setMessages(first);
      prefetchMessages(first, { notes: NEWEST_NOTES });
      setOlder(first.length < 40 ? "done" : "idle");
    } catch {
      // The list stays as it was.
    }
  }

  async function removeMessages(ids: string[], forEveryone: boolean) {
    const onServer = ids.filter((messageId) => !messageId.startsWith("local-"));
    // Deleted here, gone from the phone too: a voice of theirs stops if it plays, and their files go (should the
    // server refuse, they come back with the list, and are fetched again when played).
    const going = (messagesRef.current ?? []).filter((message) => ids.includes(message.id));
    for (const message of going) stopVoice(voiceKey(message));
    dropMessages(going);
    setMessages((current) => current?.filter((message) => !ids.includes(message.id)) ?? current);
    setPinned((current) => current.filter((message) => !ids.includes(message.id)));
    setSelected(null);
    haptic.success();
    if (!onServer.length) return;
    try {
      await deleteMessages(onServer, forEveryone);
      setNotice(t("m.deleted"));
    } catch (failure) {
      setNotice(asErrorMessage(failure));
      void reload();
    }
  }

  async function clear(forEveryone: boolean) {
    if (!id) return;
    try {
      await clearChat(id, forEveryone);
      const now = new Date().toISOString();
      // The conversation's files leave the phone with it — its folder, and any passed on from elsewhere.
      stopVoice();
      dropMessages(messagesRef.current ?? []);
      dropConversation(id);
      setMessages([]);
      setPinned([]);
      setOlder("done");
      setMembers((current) => current.map((member) => (member.user_id === me || forEveryone ? { ...member, cleared_at: now } : member)));
      haptic.success();
      setNotice(t("m.cleared"));
    } catch (failure) {
      setNotice(isProtectedFailure(failure) ? t("m.clearProtected") : asErrorMessage(failure));
    }
  }

  async function toggleProtect() {
    if (!id) return;
    const next = !iProtect;
    try {
      await protectHistory(id, next);
      setMembers((current) => current.map((member) => (member.user_id === me ? { ...member, protect_history: next } : member)));
      haptic.success();
      setNotice(t(next ? "m.protectOn" : "m.protectOff"));
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  async function submitReport(reason: ReportReason, messageId: string | null) {
    if (!id) return;
    try {
      await reportChat(id, reason, messageId);
      haptic.success();
      setNotice(t("m.reported"));
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  async function forward(conversationIds: string[]) {
    const ids = (forwardIds ?? []).filter((messageId) => !messageId.startsWith("local-"));
    setForwardIds(null);
    setSelected(null);
    if (!ids.length) return;
    try {
      await forwardMessages(ids, conversationIds);
      haptic.success();
      setNotice(t("m.forwarded"));
    } catch (failure) {
      setNotice(isBlockedFailure(failure) ? t("block.cantSend") : asErrorMessage(failure));
    }
  }

  function copyText(value: string) {
    void Clipboard.setStringAsync(value).then(() => { haptic.success(); setNotice(t("m.copied")); });
  }

  async function setBlocked(on: boolean) {
    if (!peer) return;
    try {
      if (on) await blockUser(peer.id);
      else await unblockUser(peer.id);
      if (on) haptic.warning(); else haptic.success();
      setEditing(null);
      setReplyTo(null);
      await loadPeer();
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  async function setMuted(muted: boolean) {
    if (!peer || !me) return;
    try {
      await saveContact(me, peer.id, { muted });
      await loadPeer();
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = event.nativeEvent.contentOffset.y > 320;
    if (next !== awayRef.current) {
      awayRef.current = next;
      setAway(next);
      if (!next) setUnseen(0);
    }
  }, []);

  /** The message last jumped to: the scroll retry looks it up again by id. */
  const jumpTarget = useRef<string | null>(null);

  /** Scrolls to a message wherever it is in the list now. */
  const scrollToMessage = useCallback((messageId: string) => {
    const at = (messagesRef.current ?? []).findIndex((message) => message.id === messageId);
    if (at >= 0) list.current?.scrollToIndex({ index: at, viewPosition: 0.5, animated: true });
  }, []);

  /**
   * Finds a message — loading older pages for it if need be — brings it to the
   * middle, and makes it flash. Older pages are added to the list as it is
   * when they arrive, so nothing that arrived meanwhile is lost.
   */
  const jumpTo = useCallback(async (messageId: string) => {
    if (!id) return;
    jumpTarget.current = messageId;
    const start = messagesRef.current ?? [];
    // The row older pages are fetched from: if it is gone meanwhile (cleared, reloaded), the pages are not added.
    const anchor = start[start.length - 1]?.id;
    let known = start;
    let found = known.some((message) => message.id === messageId);
    const extra: ChatMessage[] = [];
    let pages = 0;
    while (!found && pages < 6 && known.length && olderRef.current !== "done") {
      const page = await loadMessages(id, known[known.length - 1]!.created_at);
      pages += 1;
      for (const message of page) initial.add(message.id);
      const seen = new Set(known.map((message) => message.id));
      const fresh = page.filter((message) => !seen.has(message.id));
      extra.push(...fresh);
      known = [...known, ...fresh];
      if (page.length < 40) { olderRef.current = "done"; setOlder("done"); }
      found = known.some((message) => message.id === messageId);
    }
    if (extra.length) {
      setMessages((latest) => {
        if (!latest || (anchor && !latest.some((message) => message.id === anchor))) return latest;
        const have = new Set(latest.map((message) => message.id));
        return [...latest, ...extra.filter((message) => !have.has(message.id))];
      });
      prefetchMessages(extra);
    }
    if (!found) { setNotice(t("m.missing")); return; }
    setTimeout(() => scrollToMessage(messageId), pages ? 160 : 0);
    setHighlightId(messageId);
    setTimeout(() => setHighlightId((value) => (value === messageId ? null : value)), 1800);
  }, [id, initial, scrollToMessage, t]);

  // Opened to show one message (the profile's "show in chat"): found once the conversation has loaded.
  const focused = useRef<string | null>(null);
  const loaded = messages !== null;
  useEffect(() => {
    const key = focus ? `${focus}|${askedAt ?? ""}` : null;
    if (!loaded || !focus || !key || focused.current === key) return;
    focused.current = key;
    const timer = setTimeout(() => void jumpTo(focus), 350);
    return () => clearTimeout(timer);
  }, [askedAt, focus, jumpTo, loaded]);

  // Opened to answer one message (the profile's "reply"): the bar appears once that message is found.
  const answered = useRef<string | null>(null);
  useEffect(() => {
    const key = replyParam ? `${replyParam}|${askedAt ?? ""}` : null;
    if (!loaded || !replyParam || !key || answered.current === key) return;
    answered.current = key;
    const found = messagesRef.current?.find((message) => message.id === replyParam);
    if (found) { setEditing(null); setReplyTo(found); return; }
    void loadMessage(replyParam).then((message) => { if (message && !message.deleted_at) { setEditing(null); setReplyTo(message); } });
  }, [askedAt, loaded, replyParam]);

  const startReply = useCallback((message: ChatMessage) => {
    if (blocked || message.pending) return;
    setEditing(null);
    setReplyTo(message);
  }, [blocked]);

  const toggleSelect = useCallback((message: ChatMessage) => {
    setSelected((current) => {
      if (!current) return current;
      const next = new Set(current);
      if (next.has(message.id)) next.delete(message.id);
      else next.add(message.id);
      return next.size ? next : null;
    });
  }, []);

  const onLongPress = useCallback((message: ChatMessage, frame: BubbleFrame) => {
    const all = messagesRef.current ?? [];
    const index = all.findIndex((other) => other.id === message.id);
    const peerRead = membersRef.current.find((member) => member.user_id !== me)?.last_read_at ?? null;
    setMenu({
      message, frame, mine: message.sender_id === me,
      read: Boolean(peerRead && message.created_at <= peerRead),
      groupTop: !together(message, all[index + 1]), groupEnd: !together(message, all[index - 1]),
    });
  }, [me]);

  /* ---------------------------------------------------- the playing video */

  /** The note is over, or could not go on: nothing plays any more. */
  const clearNote = useCallback(() => {
    noteRef.current = null;
    setNote(null);
    setNoteFloating(false);
  }, []);
  const {
    player: notePlayer, waiting: noteWaiting, progress: noteProgress, play: playNote, stop: stopNotePlayer, forget: forgetNotePlayer,
    redraw: redrawNote,
  } = useNotePlayer({ still: recording, onEnd: clearNote });
  // In a browser, the note moving between its bubble and the corner is a new <video>, which starts paused: the part
  // playing is told to play again once it is drawn there (after the commit). A phone plays on regardless.
  useEffect(() => {
    if (Platform.OS === "web") redrawNote();
  }, [noteFloating, redrawNote]);
  const stopNote = useCallback(() => {
    stopNotePlayer();
    clearNote();
  }, [clearNote, stopNotePlayer]);
  // Covered by another screen (the profile, a deck), the conversation stays mounted underneath: the note playing
  // with sound stops, as the voice does above — the profile's own voices and notes know nothing of it, and two
  // sounds played at once. Declared here, after stopNote: it is a const, not there yet at the top. stopNote is
  // stable, so this runs on blur and when the screen goes, nowhere else.
  useFocusEffect(useCallback(() => () => { stopNote(); }, [stopNote]));
  /**
   * A tap on a note: it plays with sound from the start — the bubble's own loop as it is when it has one (its
   * frame on screen, its file open: nothing loads), else from its files on the phone, fetched at once if need be.
   */
  const startNote = useCallback((message: ChatMessage, loop: VideoPlayer | null) => {
    if (recording) return;
    const key = noteKey(message);
    noteRef.current = key;
    setNote(key);
    setNoteFloating(false);
    playNote(noteFiles(message), message.media.duration_ms ?? 0, loop);
  }, [playNote, recording]);

  // The note playing is gone from the conversation (taken back, deleted, cleared away): it stops with it.
  useEffect(() => {
    if (note && messages && !messages.some((message) => noteKey(message) === note)) stopNote();
  }, [messages, note, stopNote]);

  /**
   * What is on screen. The playing note moves to the corner when its own bubble is not there; the newest few
   * notes there loop silently; and once the list comes to rest, the notes near it come to the phone — not every
   * note of every page loaded, megabytes each, on whatever connection the phone is on.
   */
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<ChatMessage>[] }) => {
    const onScreen = viewableItems.map((token) => token.item);
    visible.current = new Set(onScreen.map(noteKey));
    const playing = noteRef.current;
    if (playing) setNoteFloating(!visible.current.has(playing));
    const loops = notesToLoop(onScreen, noteKey);
    setLooping((current) => (sameKeys(current, loops) ? current : new Set(loops)));
    if (nearTimer.current) clearTimeout(nearTimer.current);
    nearTimer.current = null;
    const indexes = viewableItems.flatMap((token) => (typeof token.index === "number" ? [token.index] : []));
    if (!indexes.length) return;
    const first = Math.min(...indexes);
    const last = Math.max(...indexes);
    nearTimer.current = setTimeout(() => {
      nearTimer.current = null;
      // What it fetched ahead for a rest it has left is called off: the notes near this one come first.
      prefetchNotes(notesNear(messagesRef.current ?? [], first, last), nearOwner);
    }, NEAR_SETTLE_MS);
  }, [nearOwner]);
  // The screen going: no rest comes any more, and the notes it queued and nobody began are called off (one
  // already downloading finishes).
  useEffect(() => () => {
    if (nearTimer.current) clearTimeout(nearTimer.current);
    withdrawMedia(nearOwner);
  }, [nearOwner]);

  // The camera's files of notes sent from here go with the conversation: the cache has its own copies by now. So do
  // the recordings of messages that failed and can no longer be sent again (the outbox lives with this screen): a
  // note's parts, and a voice that never went up — one that did is the cache's own copy by now, and stays.
  useEffect(() => {
    const copies = recordedCopies.current;
    const here = alive;
    const box = outbox.current;
    const inFlight = sending.current;
    here.current = true;
    return () => {
      here.current = false;
      for (const uri of copies.splice(0)) discardFile(uri);
      for (const [clientId, item] of box) {
        // One still going up reads its file: it cleans up after itself when it ends (send()'s `alive` check).
        if (inFlight.has(clientId)) continue;
        for (const part of item.parts ?? []) discardFile(part.uri);
        if (item.kind === "voice" && !item.mediaPath) discardFile(item.localUri);
      }
      box.clear();
    };
  }, []);

  const hub = useMemo<VideoHubValue>(() => ({
    progress: noteProgress, start: startNote, stop: stopNote, forget: forgetNotePlayer, recording, covered: !onTop,
  }), [forgetNotePlayer, noteProgress, onTop, recording, startNote, stopNote]);
  // What changes as the list scrolls and a note plays goes on the stage, which only the notes it is about read: in
  // the hub, every voice and video bubble re-rendered whenever a loop started or stopped. Told before paint.
  const [stage] = useState(createNoteStage);
  useLayoutEffect(() => {
    stage.set({ activeId: note, floating: noteFloating, player: notePlayer, waiting: noteWaiting, looping });
  }, [looping, note, noteFloating, notePlayer, noteWaiting, stage]);

  /* ------------------------------------------------------------ the rows */

  const name = peer ? peerName(peer) : "";

  /* ------------------------------------------------------ the composer's word */

  // Every prop the composer gets keeps its identity across renders of the screen (the composer is memoised): it
  // re-renders for what it shows, not for every message, scroll or reading that re-renders the conversation.
  const composerEditing = useMemo(() => (editing ? { id: editing.id, body: editing.body } : null), [editing]);
  const composerReplying = useMemo(
    () => (replyTo ? { name: replyTo.sender_id === me ? t("m.me") : name, text: quoteLabel(replyTo, t) } : null),
    [me, name, replyTo, t],
  );
  const onComposerEdit = useCallback((text: string) => { void saveEdit(text); }, [saveEdit]);
  const onCancelEdit = useCallback(() => setEditing(null), []);
  const onCancelReply = useCallback(() => setReplyTo(null), []);
  const onComposerTyping = useCallback(() => { if (id && me) sendTyping(id, me); }, [id, me]);
  const onComposerText = useCallback((text: string) => {
    void send(newClientId(), { kind: "text", body: text, media: {}, ...takeReply() });
  }, [send, takeReply]);
  const onComposerAttach = useCallback(() => setAttach(true), []);
  const onComposerVoice = useCallback((uri: string, ms: number, waveform: number[], clientId: string) => {
    void send(clientId, {
      kind: "voice", body: "", localUri: uri, mime: "audio/mp4", extension: "m4a",
      media: { duration_ms: ms, ...(waveform.length ? { waveform } : null) }, ...takeReply(),
    });
  }, [send, takeReply]);
  const onComposerVideo = useCallback((recorded: VideoPart[], ms: number) => {
    const parts = recorded.map((part) => {
      const mov = part.uri.toLowerCase().endsWith(".mov");
      return { uri: part.uri, ms: part.ms, mime: mov ? "video/quicktime" : "video/mp4", extension: mov ? "mov" : "mp4" };
    });
    const first = parts[0];
    if (!first) return;
    // Even one part goes as a part: it is streamed like the rest, and remembered once it has landed.
    void send(newClientId(), {
      kind: "video", body: "", localUri: first.uri, mime: first.mime, extension: first.extension, media: { duration_ms: ms },
      parts, ...takeReply(),
    });
  }, [send, takeReply]);
  // A finger on the record button stills the silent loops only; what plays with sound stops when the hold really
  // becomes a take (onTake) — a tap that only switches voice and video no longer ends the voice being listened to.
  const onComposerRecording = useCallback((on: boolean) => setRecordingNow(on), []);
  const onComposerTake = useCallback(() => {
    const was = noteRef.current !== null;
    stopNote();
    return stopVoice() || was;
  }, [stopNote]);
  const selecting = selected !== null;
  // What every row shares changes seldom (choosing starts or ends, a block, the name): the message lifted into
  // the menu, the one flashing and the ones chosen go to their own rows as props (see renderRow).
  const rowContext = useMemo<ChatRowContextValue>(() => ({
    me, peerName: name, selecting,
    onRetry: retry, onShare: (message) => void addShared(message), onLongPress, onReply: startReply, onToggle: toggleSelect,
    onJump: (messageId) => void jumpTo(messageId), onReact: (message, emoji) => void react(message, emoji),
    canReact: Boolean(me) && !blocked,
  }), [addShared, blocked, jumpTo, me, name, onLongPress, react, retry, selecting, startReply, toggleSelect]);

  const subtitle = useMemo(() => {
    if (!peer || blocked) return null;
    if (status?.online) return { kind: "online" as const, text: t("online") };
    if (status?.last_seen_at) return { kind: "seen" as const, text: lastSeen(status.last_seen_at, (key, options) => String(t(key as never, options as never))) };
    return peer.username ? { kind: "seen" as const, text: `@${peer.username}` } : null;
  }, [blocked, peer, status, t]);

  function openProfile() {
    if (peer) router.push({ pathname: "/(app)/chat/profile/[userId]", params: { userId: peer.id, conversation: id } });
  }

  // The message held: what can be done with it.
  const target = menu?.message ?? null;
  const menuActions: MenuAction[] = [];
  if (target) {
    if (!blocked) menuActions.push({ key: "reply", label: t("m.reply"), icon: CornerUpLeft, onPress: () => startReply(target) });
    if (target.body) menuActions.push({ key: "copy", label: t("m.copy"), icon: Copy, onPress: () => copyText(target.body) });
    if (!blocked && editable(target, me)) menuActions.push({ key: "edit", label: t("m.edit"), icon: Pencil, onPress: () => { setReplyTo(null); setEditing(target); } });
    menuActions.push(target.pinned_at
      ? { key: "unpin", label: t("m.unpin"), icon: PinOff, onPress: () => void setPin(target, false) }
      : { key: "pin", label: t("m.pin"), icon: Pin, onPress: () => void setPin(target, true) });
    menuActions.push({ key: "forward", label: t("m.forward"), icon: Forward, onPress: () => setForwardIds([target.id]) });
    if (target.sender_id !== me) menuActions.push({ key: "report", label: t("m.report"), icon: Flag, onPress: () => setSheet({ kind: "report", messageId: target.id }) });
    menuActions.push({ key: "delete", label: t("m.delete"), icon: Trash2, destructive: true, onPress: () => setSheet({ kind: "delete", ids: [target.id] }) });
    menuActions.push({ key: "select", label: t("m.select"), icon: CircleCheck, apart: true, onPress: () => { haptic.select(); setSelected(new Set([target.id])); } });
  }

  // The conversation's own menu, from the corner.
  const cornerGroups: CornerItem[][] = peer ? [
    [
      { key: "profile", label: t("viewProfile"), icon: UserRound, onPress: openProfile },
      peer.muted
        ? { key: "unmute", label: t("profile.unmute"), icon: Bell, onPress: () => void setMuted(false) }
        : { key: "mute", label: t("profile.mute"), icon: BellOff, onPress: () => void setMuted(true) },
    ],
    [
      { key: "clear", label: t("m.clear"), icon: Eraser, onPress: () => setSheet({ kind: "clear" }) },
      { key: "protect", label: t("m.protect"), icon: ShieldCheck, toggle: iProtect, onPress: () => void toggleProtect() },
    ],
    [
      { key: "report", label: t("m.report"), icon: Flag, destructive: true, onPress: () => setSheet({ kind: "report", messageId: null }) },
      blocked
        ? { key: "unblock", label: t("block.unblock"), icon: Ban, onPress: () => void setBlocked(false) }
        : { key: "block", label: t("block.block"), icon: Ban, destructive: true, onPress: () => setSheet({ kind: "block" }) },
    ],
  ] : [];

  // The sheet asked for: what it says and what it offers.
  let sheetTitle: string | undefined;
  let sheetBody: string | undefined;
  let sheetActions: SheetAction[] = [];
  if (sheet?.kind === "block") {
    sheetTitle = t("block.confirmTitle", { name });
    sheetBody = t("block.confirmBody");
    sheetActions = [{ key: "block", label: t("block.block"), icon: Ban, destructive: true, onPress: () => void setBlocked(true) }];
  } else if (sheet?.kind === "clear") {
    sheetTitle = t("m.clearTitle");
    sheetBody = theyProtect ? `${t("m.clearBody")} ${t("m.clearProtected")}.` : t("m.clearBody");
    sheetActions = [
      { key: "me", label: t("m.clearForMe"), icon: Eraser, destructive: true, onPress: () => void clear(false) },
      ...(theyProtect ? [] : [{ key: "all", label: t("m.clearForAll"), icon: Trash2, destructive: true, onPress: () => void clear(true) }]),
    ];
  } else if (sheet?.kind === "report") {
    const messageId = sheet.messageId;
    sheetTitle = messageId ? t("m.reportMessage") : t("m.reportTitle");
    sheetBody = t("m.reportBody");
    sheetActions = REPORT_REASONS.map((reason) => ({ key: reason, label: t(`m.reasons.${reason}`), onPress: () => void submitReport(reason, messageId) }));
  } else if (sheet?.kind === "delete") {
    const ids = sheet.ids;
    const all = messages ?? [];
    const mineOnly = ids.every((messageId) => all.find((message) => message.id === messageId)?.sender_id === me);
    sheetTitle = ids.length > 1 ? t("m.deleteManyTitle", { count: ids.length }) : t("m.deleteTitle");
    sheetActions = [
      { key: "me", label: t("m.deleteForMe"), icon: Trash2, destructive: true, onPress: () => void removeMessages(ids, false) },
      ...(mineOnly ? [{ key: "all", label: t("m.deleteForAll"), icon: Trash2, destructive: true, onPress: () => void removeMessages(ids, true) }] : []),
    ];
  }

  const pinnedNow = pinned.length ? pinned[pinAt % pinned.length]! : null;
  const headerBottom = insets.top + 6 + HEADER;
  const topSpace = headerBottom + 8 + (pinnedNow && !selecting ? PIN_BAR + 6 : 0);
  const bottomPad = useAnimatedStyle(() => ({ paddingBottom: insets.bottom * (1 - keyboard.progress.value) + 2 }));
  // Only while choosing: otherwise every render went through the whole conversation for nothing.
  const chosen = selected
    ? (messages ?? []).filter((message) => selected.has(message.id)).sort((a, b) => a.created_at.localeCompare(b.created_at))
    : [];
  const chosenText = chosen.map((message) => message.body).filter(Boolean).join("\n\n");

  /*
   * The list's props stay the same from one render to the next unless what they show changed. FlatList hands
   * every row a new renderer whenever any prop is new, and before, all of them were new on every render: every
   * row on the phone was drawn again for "typing…", a toast, the menu opening, the clock of the status line.
   */
  const liftedId = menu?.message.id ?? null;
  const dayWords = useMemo(() => ({ today: t("today"), yesterday: t("yesterday") }), [t]);
  const renderRow = useCallback(({ item, index }: ListRenderItemInfo<ChatMessage>) => {
    const newer = messages?.[index - 1];
    const previous = messages?.[index + 1];
    return (
      <View>
        {!previous || !sameDay(previous, item) ? <DayDivider label={chatDay(item.created_at, dayWords)} /> : null}
        <MessageBubble
          message={item}
          mine={item.sender_id === me}
          read={Boolean(readAt && !item.pending && item.created_at <= readAt)}
          groupTop={!together(item, previous)}
          groupEnd={!together(item, newer)}
          fresh={!initial.has(item.id)}
          lifted={liftedId === item.id}
          highlighted={highlightId === item.id}
          selected={Boolean(selected?.has(item.id))}
        />
      </View>
    );
  }, [dayWords, highlightId, initial, liftedId, me, messages, readAt, selected]);
  const onEndReached = useCallback(() => { void loadOlder(); }, [loadOlder]);
  const onScrollToIndexFailed = useCallback((info: { index: number; averageItemLength: number }) => {
    list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
    setTimeout(() => { if (jumpTarget.current) scrollToMessage(jumpTarget.current); }, 300);
  }, [scrollToMessage]);
  const listEmpty = useMemo(() => (
    <View style={styles.emptyWrap}>
      <Glass round={18} style={styles.emptyCard}><Text style={styles.empty}>{t("noMessages")}</Text></Glass>
    </View>
  ), [styles, t]);
  // The list is upside down: its footer is the space at the top, under the floating header.
  const listFooter = useMemo(() => (
    <View style={{ height: topSpace, justifyContent: "flex-end" }}>
      {older === "loading" ? <ActivityIndicator color={colors.primary} style={{ marginBottom: spacing.sm }} /> : null}
    </View>
  ), [colors.primary, older, topSpace]);

  return (
    <ChatRowContext.Provider value={rowContext}>
      <VideoHubContext.Provider value={hub}>
        <NoteStageContext.Provider value={stage}>
        <View style={styles.safe}>
          <ChatWallpaper />

          <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
            {error && !messages ? <View style={{ paddingTop: topSpace, flex: 1 }}><ErrorState message={error} /></View> : null}
            {!messages && !error ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : null}
            {messages ? (
              <FlatList
                ref={list}
                data={messages}
                inverted
                keyExtractor={keyOf}
                contentContainerStyle={styles.list}
                onEndReached={onEndReached}
                onEndReachedThreshold={0.4}
                onScroll={onScroll}
                scrollEventThrottle={64}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                onViewableItemsChanged={onViewable}
                viewabilityConfig={VIEWABILITY}
                onScrollToIndexFailed={onScrollToIndexFailed}
                ListEmptyComponent={listEmpty}
                ListFooterComponent={listFooter}
                renderItem={renderRow}
                // A screen and a half of rows on the first frame, so a conversation opens full rather than filling
                // in from the bottom; five screens kept drawn each way rather than ten — every bubble carries its
                // own gestures, gradient and tail, and half as many keeps a long history light to scroll.
                initialNumToRender={15}
                windowSize={11}
              />
            ) : null}

            {away ? (
              <Animated.View entering={ZoomIn.duration(80)} exiting={ZoomOut.duration(60)} style={styles.downWrap}>
                <Pressable accessibilityLabel={t("scrollDown")} onPress={() => { haptic.light(); list.current?.scrollToOffset({ offset: 0, animated: true }); }}>
                  <Glass round={22} style={styles.down}><ArrowDown color={colors.primary} size={22} /></Glass>
                </Pressable>
                {unseen > 0 ? <View style={styles.downBadge}><Text style={styles.downBadgeText}>{unseen > 99 ? "99+" : unseen}</Text></View> : null}
              </Animated.View>
            ) : null}
            {notice ? (
              <Animated.View entering={FadeIn.duration(80)} exiting={FadeOut.duration(80)} style={styles.notice} pointerEvents="none">
                <Text style={styles.noticeText}>{notice}</Text>
              </Animated.View>
            ) : null}

            <Animated.View style={bottomPad}>
              {selecting ? (
                <Animated.View entering={FadeIn.duration(80)} style={styles.selectBar}>
                  <Glass round={24} style={styles.selectGlass}>
                    <Pressable style={styles.selectAction} onPress={() => { if (chosen.length) setForwardIds(chosen.map((message) => message.id)); }}>
                      <Forward color={colors.primary} size={20} /><Text style={styles.selectLabel}>{t("m.forward")}</Text>
                    </Pressable>
                    <Pressable style={styles.selectAction} disabled={!chosenText} onPress={() => { copyText(chosenText); setSelected(null); }}>
                      <Copy color={chosenText ? colors.primary : colors.inkSoft} size={20} /><Text style={[styles.selectLabel, !chosenText && { color: colors.inkSoft }]}>{t("m.copy")}</Text>
                    </Pressable>
                    <Pressable style={styles.selectAction} onPress={() => { if (chosen.length) setSheet({ kind: "delete", ids: chosen.map((message) => message.id) }); }}>
                      <Trash2 color={colors.danger} size={20} /><Text style={[styles.selectLabel, { color: colors.danger }]}>{t("m.delete")}</Text>
                    </Pressable>
                  </Glass>
                </Animated.View>
              ) : blocked ? (
                <Animated.View entering={FadeIn.duration(100)} style={styles.blockedWrap}>
                  <Glass round={22} style={styles.blockedBar}>
                    <Ban color={colors.inkMuted} size={18} />
                    <Text style={styles.blockedText}>{t("block.banner")}</Text>
                    <Pressable onPress={() => void setBlocked(false)} style={styles.unblock}>
                      <Text style={styles.unblockText}>{t("block.unblock")}</Text>
                    </Pressable>
                  </Glass>
                </Animated.View>
              ) : (
                <ChatComposer
                  key={editing?.id ?? "compose"}
                  initialText={editing?.body}
                  editing={composerEditing}
                  onEdit={onComposerEdit}
                  onCancelEdit={onCancelEdit}
                  replying={composerReplying}
                  onCancelReply={onCancelReply}
                  onTyping={onComposerTyping}
                  onText={onComposerText}
                  onAttach={onComposerAttach}
                  onVoice={onComposerVoice}
                  onVideo={onComposerVideo}
                  onRecording={onComposerRecording}
                  onTake={onComposerTake}
                  covered={!onTop}
                  notice={setNotice}
                />
              )}
            </Animated.View>
          </KeyboardAvoidingView>

          {/* The header floats on glass over the top of the conversation. */}
          <View pointerEvents="box-none" style={[styles.header, { paddingTop: insets.top + 6 }]}>
            <LinearGradient
              pointerEvents="none"
              colors={dark ? ["rgba(18,10,40,0.94)", "rgba(18,10,40,0)"] : ["rgba(245,239,255,0.96)", "rgba(245,239,255,0)"]}
              style={[StyleSheet.absoluteFill, { bottom: -26 }]}
            />
            <Pressable accessibilityRole="button" accessibilityLabel={selecting ? t("cancel") : undefined} hitSlop={6}
              onPress={() => { if (selecting) setSelected(null); else router.back(); }}>
              <Glass round={HEADER / 2} style={styles.circle}>
                {selecting ? <X color={colors.ink} size={22} /> : <ChevronLeft color={colors.ink} size={26} />}
              </Glass>
            </Pressable>
            {selecting ? (
              <Glass round={HEADER / 2} style={[styles.titlePill, { flex: 1 }]}>
                <Text style={styles.name}>{t("m.selected", { count: selected?.size ?? 0 })}</Text>
              </Glass>
            ) : (
              <Pressable accessibilityRole="button" disabled={!peer} onPress={openProfile} style={{ flex: 1 }}>
                <Glass round={HEADER / 2} style={styles.titlePill}>
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  {(typing && !blocked) || subtitle ? (
                    <View style={styles.statusLine}>
                      {typing && !blocked ? (
                        <TypingDots label={t("typing")} color={colors.primary} size={12} />
                      ) : subtitle ? (
                        <Animated.Text key={subtitle.kind} entering={FadeIn.duration(90)} style={[styles.status, subtitle.kind === "online" && styles.statusOnline]} numberOfLines={1}>
                          {subtitle.text}
                        </Animated.Text>
                      ) : null}
                    </View>
                  ) : null}
                </Glass>
              </Pressable>
            )}
            {!selecting ? (
              <>
                <Pressable accessibilityRole="button" accessibilityLabel={t("viewProfile")} disabled={!peer} onPress={openProfile} hitSlop={4}>
                  <SquircleAvatar uri={peer?.avatar_url} initials={initialsOf(name || "?")} size={HEADER} online={Boolean(status?.online) && !blocked} />
                </Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel={t("menu")} disabled={!peer} onPress={() => setChatMenu(true)} hitSlop={6}>
                  <Glass round={HEADER / 2} style={styles.circle}><EllipsisVertical color={colors.ink} size={21} /></Glass>
                </Pressable>
              </>
            ) : null}
          </View>

          {/* The pinned message, under the header: a tap finds it (and steps to the next pin). */}
          {pinnedNow && !selecting ? (
            <Animated.View entering={FadeIn.duration(90)} exiting={FadeOut.duration(70)} style={[styles.pinWrap, { top: headerBottom + 6 }]}>
              <Glass round={16} style={styles.pinBar}>
                <Pressable style={styles.pinTap} onPress={() => {
                  haptic.select();
                  void jumpTo(pinnedNow.id);
                  setPinAt((value) => (value + 1) % Math.max(1, pinned.length));
                }}>
                  <View style={styles.pinAccent} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.pinTitle}>{pinned.length > 1 ? t("m.pinnedCount", { at: (pinAt % pinned.length) + 1, count: pinned.length }) : t("m.pinned")}</Text>
                    <Text style={styles.pinText} numberOfLines={1}>{quoteLabel(pinnedNow, t)}</Text>
                  </View>
                </Pressable>
                <Pressable accessibilityLabel={t("m.unpin")} hitSlop={8} onPress={() => void setPin(pinnedNow, false)} style={styles.pinClose}>
                  <PinOff color={colors.inkMuted} size={17} />
                </Pressable>
              </Glass>
            </Animated.View>
          ) : null}

          {/* The playing video message, in the corner, while its own place is scrolled away. */}
          {note && noteFloating ? (
            <Animated.View entering={ZoomIn.duration(90)} exiting={ZoomOut.duration(70)}
              style={[styles.mini, { top: topSpace + 4 }]}>
              <Pressable
                onPress={() => {
                  // Played under its key: the message to find is the one that has it now (sent, or still on its way).
                  const playing = messages?.find((message) => noteKey(message) === note);
                  if (playing) void jumpTo(playing.id);
                }}
                style={styles.miniNote}
              >
                {notePlayer ? <VideoView player={notePlayer} style={StyleSheet.absoluteFill} contentFit="cover" nativeControls={false} playsInline /> : null}
              </Pressable>
              <Pressable accessibilityLabel={t("cancel")} onPress={stopNote} hitSlop={8} style={styles.miniClose}>
                <X color="#FFFFFF" size={14} strokeWidth={3} />
              </Pressable>
            </Animated.View>
          ) : null}

          <MessageMenu
            target={menu}
            actions={menuActions}
            myReaction={target?.reactions?.[me] ?? null}
            onReact={(emoji) => { if (target) void react(target, emoji); }}
            onClose={() => setMenu(null)}
          />

          <CornerMenu
            visible={chatMenu}
            top={headerBottom + 6}
            right={8}
            onClose={() => setChatMenu(false)}
            header={peer ? (
              <View style={styles.cornerHead}>
                <SquircleAvatar uri={peer.avatar_url} initials={initialsOf(name || "?")} size={40} online={Boolean(status?.online) && !blocked} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.cornerName} numberOfLines={1}>{name}</Text>
                  {subtitle ? <Text style={[styles.status, subtitle.kind === "online" && styles.statusOnline]} numberOfLines={1}>{subtitle.text}</Text> : null}
                </View>
              </View>
            ) : undefined}
            groups={cornerGroups}
          />

          <ActionSheet
            visible={sheet !== null}
            onClose={() => setSheet(null)}
            cancelLabel={t("cancel")}
            title={sheetTitle}
            message={sheetBody}
            actions={sheetActions}
          />

          <ForwardSheet visible={forwardIds !== null} count={forwardIds?.length ?? 0} onClose={() => setForwardIds(null)} onSend={(ids) => void forward(ids)} />

          <AttachSheet
            visible={attach}
            me={me}
            onClose={() => setAttach(false)}
            onGallery={() => void pickPictures()}
            onCamera={() => void takePhoto()}
            onShares={sendShares}
          />
        </View>
        </NoteStageContext.Provider>
      </VideoHubContext.Provider>
    </ChatRowContext.Provider>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    position: "absolute", left: 0, right: 0, top: 0, zIndex: 5,
    flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 10, paddingBottom: 6,
  },
  circle: { width: HEADER, height: HEADER, alignItems: "center", justifyContent: "center" },
  titlePill: { height: HEADER, justifyContent: "center", paddingHorizontal: 16 },
  name: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 16, lineHeight: 20, color: colors.ink },
  statusLine: { height: 16, justifyContent: "center" },
  status: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 12.5, color: colors.inkMuted },
  statusOnline: { color: colors.primary, fontFamily: "JaxongirmanSans_600SemiBold" },
  pinWrap: { position: "absolute", left: 10, right: 10, zIndex: 4 },
  pinBar: { height: PIN_BAR, flexDirection: "row", alignItems: "center" },
  pinTap: { flex: 1, flexDirection: "row", alignItems: "center", gap: 10, paddingLeft: 12, height: PIN_BAR },
  pinAccent: { width: 3, height: 30, borderRadius: 2, backgroundColor: colors.primary },
  pinTitle: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 12.5, color: colors.primary },
  pinText: { fontFamily: "JaxongirmanSans_400Regular", fontSize: 14, color: colors.ink },
  pinClose: { width: 44, height: PIN_BAR, alignItems: "center", justifyContent: "center" },
  list: { paddingVertical: spacing.sm, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, transform: [{ scaleY: -1 }] },
  emptyCard: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  empty: { ...typography.bodyMedium, color: colors.ink, textAlign: "center" },
  downWrap: { position: "absolute", right: spacing.md, bottom: 84 },
  down: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  downBadge: {
    position: "absolute", top: -6, right: -2, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.primary,
  },
  downBadgeText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 11, color: colors.onPrimary },
  notice: {
    position: "absolute", left: spacing.xl, right: spacing.xl, bottom: 92, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.ink, alignItems: "center",
  },
  noticeText: { ...typography.caption, color: colors.canvas, textAlign: "center" },
  selectBar: { paddingHorizontal: 8, paddingVertical: 6 },
  selectGlass: { flexDirection: "row", height: 56, alignItems: "center", justifyContent: "space-around" },
  selectAction: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, height: 56 },
  selectLabel: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 12, color: colors.primary },
  blockedWrap: { paddingHorizontal: 8, paddingVertical: 6 },
  blockedBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, minHeight: 52 },
  blockedText: { ...typography.caption, fontSize: 13, color: colors.inkMuted, flex: 1 },
  unblock: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  unblockText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primaryDeep },
  mini: { position: "absolute", right: 12, zIndex: 6 },
  miniNote: {
    width: 118, height: 118, borderRadius: 118 * SQUIRCLE, borderCurve: "continuous", overflow: "hidden", backgroundColor: "#000",
    borderWidth: 2, borderColor: "#FFFFFF",
  },
  miniClose: {
    position: "absolute", top: -6, right: -6, width: 24, height: 24, borderRadius: 12, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(20,10,40,0.85)", borderWidth: 1.5, borderColor: "#FFFFFF",
  },
  cornerHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  cornerName: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, color: colors.ink },
}));
