import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useVideoPlayer, VideoView, type VideoPlayer } from "expo-video";
import { AlertCircle, Check, CheckCheck, Clock3, FileText, Gamepad2, LibraryBig, Pause, Play, Presentation, Volume2 } from "lucide-react-native";
import { memo, useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Image, Modal, Pressable, Text, View, useWindowDimensions } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";

import { mediaUrl, type ChatMessage } from "@/lib/chat";
import { chatClock, mediaLength } from "@/lib/chatTime";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * A message as a bubble, the way a messenger draws one.
 *
 * One's own in the brand's violet, the other side's in white (deep violet in
 * the dark). Messages from one person a few minutes apart sit together as a
 * group: tighter, with only the last carrying the little tail. The time sits
 * inside the bubble at the bottom right, after the words — with one tick for
 * sent and two, in mint, once the other side has read it — and "edited" in
 * front of it when the sender corrected it. A new message rises into place; a
 * long press opens what can be done with it.
 */

/** The video message's corner, as the spec gives it: a square, rounded. */
export const VIDEO_NOTE_RADIUS = 35;
const VIDEO_NOTE_SIZE = 220;
/** One's own bubble: the brand violet, lit from the top left. */
export const MINE: [string, string] = ["#8E57EC", "#6A35C8"];
/** Read ticks on one's own bubble: mint, plain against the violet. */
const READ_TICK = "#9FFFE0";
const BIG = 18;
const SMALL = 6;

/** A file's address: the local one while it uploads, then a short-lived signed link. */
export function useMedia(message: ChatMessage): string | null {
  const [url, setUrl] = useState<string | null>(message.localUri ?? null);
  useEffect(() => {
    if (message.localUri) { setUrl(message.localUri); return; }
    if (!message.media_path) return;
    let alive = true;
    void mediaUrl(message.media_path).then((next) => { if (alive) setUrl(next); });
    return () => { alive = false; };
  }, [message.localUri, message.media_path]);
  return url;
}

export const MessageBubble = memo(function MessageBubble({ message, mine, read, groupTop, groupEnd, fresh, onRetry, onShare, onLongPress }: {
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
  onRetry: (message: ChatMessage) => void;
  onShare: (message: ChatMessage) => void;
  onLongPress: (message: ChatMessage) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const { width } = useWindowDimensions();
  const failed = message.pending === "failed";
  const bare = message.kind === "video";
  const pictureOnly = message.kind === "image" && !message.body;
  const maxWidth = Math.min(width * 0.8, 440);

  const corners = mine
    ? { borderTopLeftRadius: BIG, borderBottomLeftRadius: BIG, borderTopRightRadius: groupTop ? BIG : SMALL, borderBottomRightRadius: groupEnd ? 4 : SMALL }
    : { borderTopRightRadius: BIG, borderBottomRightRadius: BIG, borderTopLeftRadius: groupTop ? BIG : SMALL, borderBottomLeftRadius: groupEnd ? 4 : SMALL };

  const meta = <Meta message={message} mine={mine} read={read} overlay={bare || pictureOnly} />;
  const words = message.body;

  const content: ReactNode = (() => {
    switch (message.kind) {
      case "image": return <ImageMessage message={message} width={Math.min(maxWidth - 8, 280)} corners={corners} />;
      case "voice": return <VoiceMessage message={message} mine={mine} />;
      case "video": return <VideoMessage message={message} />;
      case "share": return <ShareMessage message={message} mine={mine} onShare={onShare} />;
      default: return null;
    }
  })();

  const text = words ? (
    <Text style={[styles.text, mine && styles.textMine, message.kind !== "text" && styles.caption]}>
      {words}
      {/* Room for the time at the end of the last line, as a messenger leaves it. */}
      {/* Non-breaking, so the room stays on the last line; one's own also leaves room for the ticks. */}
      <Text style={styles.spacer}>{`\u00A0\u00A0\u00A0${message.edited_at ? `${t("edited")}\u00A0` : ""}${chatClock(message.created_at)}${mine ? "\u00A0\u00A0\u00A0\u00A0\u00A0\u00A0" : ""}`}</Text>
    </Text>
  ) : null;

  const bubble = bare ? (
    <View>{content}{meta}</View>
  ) : (
    <View style={[styles.bubbleBox, { maxWidth }]}>
      {mine ? (
        <LinearGradient colors={MINE} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={[styles.bubble, corners, pictureOnly && styles.picturePad]}>
          {content}{text}{meta}
        </LinearGradient>
      ) : (
        <View style={[styles.bubble, styles.bubbleTheirs, corners, pictureOnly && styles.picturePad]}>
          {content}{text}{meta}
        </View>
      )}
      {groupEnd ? <Tail mine={mine} color={mine ? MINE[1] : colors.surface} /> : null}
    </View>
  );

  return (
    <Animated.View entering={fresh ? FadeInDown.springify().damping(17).stiffness(170) : undefined}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, groupEnd ? styles.rowEnd : null]}>
      <Pressable
        onPress={failed ? () => onRetry(message) : undefined}
        onLongPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); onLongPress(message); }}
        delayLongPress={320}
        style={({ pressed }) => [failed && styles.failed, pressed && { opacity: 0.88, transform: [{ scale: 0.985 }] }]}
      >
        {bubble}
      </Pressable>
      {failed ? <Text style={styles.failedText}>{t("failed")}</Text> : null}
    </Animated.View>
  );
});

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

/** Time, "edited" and the ticks, at the bubble's bottom right — or over a picture, on a dark pill. */
function Meta({ message, mine, read, overlay }: { message: ChatMessage; mine: boolean; read: boolean; overlay: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const tint = overlay ? "#FFFFFF" : mine ? "rgba(255,255,255,0.78)" : colors.inkSoft;
  const tick = message.pending === "sending" ? <Clock3 color={tint} size={12} strokeWidth={2.2} />
    : message.pending === "failed" ? <AlertCircle color={colors.danger} size={13} />
    : read ? <CheckCheck color={overlay ? READ_TICK : mine ? READ_TICK : colors.primary} size={16} strokeWidth={2.4} />
    : <Check color={tint} size={15} strokeWidth={2.4} />;
  return (
    <View style={[styles.meta, overlay && styles.metaOver]}>
      {message.edited_at ? <Text style={[styles.time, { color: tint }]}>{t("edited")}</Text> : null}
      <Text style={[styles.time, { color: tint }]}>{chatClock(message.created_at)}</Text>
      {mine ? tick : null}
    </View>
  );
}

function ImageMessage({ message, width, corners }: { message: ChatMessage; width: number; corners: object }) {
  const styles = useStyles();
  const url = useMedia(message);
  const [open, setOpen] = useState(false);
  const w = message.media.width ?? 4;
  const h = message.media.height ?? 3;
  const height = Math.min(360, Math.max(140, (width * h) / w));
  return (
    <>
      <Pressable onPress={() => setOpen(true)} style={[styles.image, corners, { width, height }]}>
        {url ? <Animated.Image entering={FadeIn.duration(220)} source={{ uri: url }} style={{ width, height }} resizeMode="cover" /> : <ActivityIndicator />}
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.viewer} onPress={() => setOpen(false)}>
          {url ? <Image source={{ uri: url }} style={styles.viewerImage} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </>
  );
}

export function VoiceMessage({ message, mine }: { message: ChatMessage; mine: boolean }) {
  const url = useMedia(message);
  return url ? <VoicePlayer url={url} mine={mine} seed={message.id} duration={message.media.duration_ms ?? 0} /> : <ActivityIndicator />;
}

/** A waveform that stays the same for a message: drawn from its id, like a fingerprint. */
function bars(seed: string, count: number): number[] {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return Array.from({ length: count }, (_, at) => {
    hash = Math.imul(hash ^ (at + 1), 16777619);
    const shape = 0.45 + 0.55 * Math.sin((at / count) * Math.PI);
    return Math.max(0.18, Math.min(1, (((hash >>> 0) % 1000) / 1000) * shape + 0.12));
  });
}

function VoicePlayer({ url, mine, duration, seed }: { url: string; mine: boolean; duration: number; seed: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const player = useAudioPlayer(url);
  const status = useAudioPlayerStatus(player);
  const wave = useMemo(() => bars(seed, 30), [seed]);
  const total = (status.duration || duration / 1000) * 1000;
  const progress = total > 0 ? Math.min(1, (status.currentTime * 1000) / total) : 0;
  const strong = mine ? "#FFFFFF" : colors.primary;
  const faint = mine ? "rgba(255,255,255,0.38)" : `${colors.primary}40`;
  useEffect(() => {
    if (status.didJustFinish) { player.pause(); void player.seekTo(0); }
  }, [player, status.didJustFinish]);
  return (
    <View style={styles.voice}>
      <Pressable
        accessibilityRole="button"
        onPress={() => { void Haptics.selectionAsync(); if (status.playing) player.pause(); else player.play(); }}
        style={[styles.voiceButton, { backgroundColor: mine ? "#FFFFFF" : colors.primary }]}
      >
        {status.playing
          ? <Pause color={mine ? MINE[1] : colors.onPrimary} size={18} fill={mine ? MINE[1] : colors.onPrimary} />
          : <Play color={mine ? MINE[1] : colors.onPrimary} size={18} fill={mine ? MINE[1] : colors.onPrimary} style={{ marginLeft: 2 }} />}
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.wave}>
          {wave.map((value, at) => (
            <View key={at} style={[styles.bar, { height: 4 + value * 20, backgroundColor: at / wave.length <= progress ? strong : faint }]} />
          ))}
        </View>
        <Text style={[styles.voiceTime, { color: mine ? "rgba(255,255,255,0.82)" : colors.inkMuted }]}>
          {mediaLength(status.playing || status.currentTime > 0 ? status.currentTime * 1000 : total)}
        </Text>
      </View>
    </View>
  );
}

function VideoMessage({ message }: { message: ChatMessage }) {
  const url = useMedia(message);
  const styles = useStyles();
  return url ? <VideoNote url={url} duration={message.media.duration_ms ?? 0} /> : <View style={styles.note}><ActivityIndicator color="#fff" /></View>;
}

/** Silent on a loop, or once from the start with sound. */
function setLoud(player: VideoPlayer, loud: boolean): void {
  if (loud) player.currentTime = 0;
  player.muted = !loud;
  player.loop = !loud;
  player.play();
}

/** A square video with rounded corners: plays silently on a loop until tapped, then from the start with sound. */
export function VideoNote({ url, duration }: { url: string; duration: number }) {
  const styles = useStyles();
  const [loud, setLoudState] = useState(false);
  const player = useVideoPlayer(url, (created) => {
    created.loop = true;
    created.muted = true;
    created.play();
  });
  function toggle() {
    setLoud(player, !loud);
    setLoudState(!loud);
    void Haptics.selectionAsync();
  }
  return (
    <Pressable onPress={toggle} style={[styles.note, loud && styles.noteLoud]}>
      <VideoView player={player} style={styles.noteVideo} contentFit="cover" nativeControls={false} />
      <View style={styles.noteLength}>
        {!loud ? <Volume2 color="#fff" size={11} strokeWidth={2.4} /> : null}
        <Text style={styles.noteLengthText}>{mediaLength(duration)}</Text>
      </View>
    </Pressable>
  );
}

const SHARE_ICONS = { presentation: Presentation, game: Gamepad2, academic: FileText } as const;

function ShareMessage({ message, mine, onShare }: { message: ChatMessage; mine: boolean; onShare: (message: ChatMessage) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const share = message.share;
  if (!share) return null;
  const Icon = SHARE_ICONS[share.kind] ?? FileText;
  return (
    <View style={styles.share}>
      <View style={styles.shareHead}>
        <View style={[styles.shareIcon, { backgroundColor: mine ? "rgba(255,255,255,0.2)" : colors.primarySoft }]}>
          <Icon color={mine ? "#FFFFFF" : colors.primary} size={22} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={[styles.shareKind, mine && styles.textMineMuted]}>{t(`shareKinds.${share.kind}`)}</Text>
          <Text style={[styles.shareTitle, mine && styles.textMine]} numberOfLines={3}>{share.title}</Text>
          {share.kind === "presentation" ? <Text style={[styles.shareNote, mine && styles.textMineMuted]}>{t("withDefense")}</Text> : null}
        </View>
      </View>
      {mine ? null : (
        <Pressable accessibilityRole="button" onPress={() => onShare(message)} style={({ pressed }) => [styles.shareButton, pressed && { opacity: 0.85 }]}>
          <LibraryBig color={colors.onPrimary} size={16} />
          <Text style={styles.shareButtonText}>{t("addToLibrary")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { paddingHorizontal: 10, paddingVertical: 1, maxWidth: "100%" },
  rowEnd: { paddingBottom: 6 },
  rowMine: { alignItems: "flex-end", paddingRight: 12 },
  rowTheirs: { alignItems: "flex-start", paddingLeft: 12 },
  bubbleBox: { position: "relative" },
  bubble: { paddingHorizontal: 12, paddingTop: 7, paddingBottom: 7, gap: 4, overflow: "hidden" },
  bubbleTheirs: {
    backgroundColor: colors.surface,
    shadowColor: "#2A0F55", shadowOpacity: 0.08, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  picturePad: { padding: 3 },
  failed: { opacity: 0.6 },
  failedText: { ...typography.caption, color: colors.danger, marginTop: 2 },
  text: { fontFamily: "JaxongirmanSans_400Regular", fontSize: 16, lineHeight: 21, color: colors.ink },
  textMine: { color: "#FFFFFF" },
  textMineMuted: { color: "rgba(255,255,255,0.75)" },
  caption: { paddingHorizontal: 6, paddingBottom: 2 },
  spacer: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 11, color: "transparent" },
  meta: { position: "absolute", right: 10, bottom: 5, flexDirection: "row", alignItems: "center", gap: 3 },
  metaOver: { right: 10, bottom: 10, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(0,0,0,0.42)" },
  time: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 11 },
  image: { overflow: "hidden", alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  viewer: { flex: 1, backgroundColor: "rgba(0,0,0,0.94)", alignItems: "center", justifyContent: "center" },
  viewerImage: { width: "100%", height: "86%" },
  voice: { flexDirection: "row", alignItems: "center", gap: 10, width: 236, paddingTop: 2, paddingBottom: 12 },
  voiceButton: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  wave: { flexDirection: "row", alignItems: "center", gap: 2, height: 26 },
  bar: { width: 3, borderRadius: 1.5 },
  voiceTime: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 11.5 },
  note: {
    width: VIDEO_NOTE_SIZE, height: VIDEO_NOTE_SIZE, borderRadius: VIDEO_NOTE_RADIUS, overflow: "hidden",
    backgroundColor: "#000", alignItems: "center", justifyContent: "center",
  },
  noteLoud: { borderWidth: 3, borderColor: colors.primary },
  noteVideo: { width: VIDEO_NOTE_SIZE, height: VIDEO_NOTE_SIZE },
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
