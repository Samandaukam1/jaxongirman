import {
  RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState,
} from "expo-audio";
import { CameraView, useCameraPermissions, useMicrophonePermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { Check, ChevronLeft, ChevronUp, Lock, Mic, Paperclip, Pencil, SendHorizontal, Trash2, Video, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Pressable, Text, TextInput, View, useWindowDimensions, type TextStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing, FadeIn, FadeInDown, FadeOut, FadeOutDown, ZoomIn, ZoomOut, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withRepeat,
  withSpring, withTiming, Extrapolation, type SharedValue,
} from "react-native-reanimated";
import Svg, { Rect } from "react-native-svg";

import { MINE, VIDEO_NOTE_RADIUS } from "@/components/ChatBubbles";
import { VIDEO_MAX_MS, VOICE_MAX_MS } from "@/lib/chat";
import { mediaLength } from "@/lib/chatTime";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Shorter than this, a press was a slip, not a message. */
const MIN_MS = 700;
/** How far left a finger slides to throw a recording away, and how far up to lock it. */
const CANCEL_X = 110;
const LOCK_Y = 90;
const NOTE = 264;
/** One line of the field — and the send button beside it — like a messenger's. */
const FIELD = 38;

type Recording = { kind: "voice" | "video"; started: number };

/**
 * Writing a message, as Telegram does it.
 *
 * Words go with the send button that takes the place of the microphone as
 * soon as there are any. With none, the button is a microphone or — one tap
 * — a camera: hold it to record; slide left to throw the recording away;
 * slide up to lock it and let go, finishing with a tap on send. While a voice
 * message records, a ring round the button breathes with the voice; a video
 * message shows the camera in the app's rounded square, its edge filling as
 * the minute runs. Correcting a sent message puts it back in the field under
 * a bar that says so.
 */
export function ChatComposer({ onText, onImage, onVoice, onVideo, notice, onTyping, editing, onEdit, onCancelEdit, initialText }: {
  onText: (text: string) => void;
  onImage: () => void;
  onVoice: (uri: string, durationMs: number) => void;
  onVideo: (uri: string, durationMs: number) => void;
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
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const { height: screenHeight } = useWindowDimensions();
  const [text, setText] = useState(initialText ?? "");
  const [inputWidth, setInputWidth] = useState(0);
  const [mode, setMode] = useState<"voice" | "video">("voice");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [locked, setLocked] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const recorderState = useAudioRecorderState(recorder, 90);
  const [, requestCamera] = useCameraPermissions();
  const [, requestMicrophone] = useMicrophonePermissions();
  const camera = useRef<CameraView | null>(null);
  const video = useRef<Promise<{ uri: string } | undefined> | null>(null);
  const holding = useRef(false);
  const current = useRef<Recording | null>(null);
  const lockedRef = useRef(false);
  const media = Platform.OS !== "web";

  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);
  /** Mirrors of "recording" and "locked" for the gesture, which runs off the JS thread. */
  const active = useSharedValue(0);
  const lockedNow = useSharedValue(0);
  const level = useSharedValue(0);
  const blink = useSharedValue(1);

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(Date.now() - recording.started), 100);
    blink.set(withRepeat(withTiming(0.2, { duration: 520, easing: Easing.inOut(Easing.quad) }), -1, true));
    return () => { clearInterval(timer); blink.set(1); };
  }, [blink, recording]);

  // The voice's loudness, 0 to 1, for the ring and the bars.
  const db = recorderState.metering ?? -160;
  useEffect(() => {
    level.set(withTiming(Math.max(0, Math.min(1, (db + 52) / 52)), { duration: 90 }));
  }, [db, level]);

  function reset() {
    dragX.set(withSpring(0, { damping: 18 }));
    dragY.set(withSpring(0, { damping: 18 }));
  }

  async function startVoice() {
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) { notice(t("micPermission")); return; }
    if (!holding.current) return;
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    begin("voice");
  }

  async function startVideo() {
    const [cameraPermission, microphonePermission] = [await requestCamera(), await requestMicrophone()];
    if (!cameraPermission.granted || !microphonePermission.granted) { notice(t("cameraPermission")); return; }
    if (!holding.current) return;
    begin("video");
  }

  function begin(kind: Recording["kind"]) {
    const started = { kind, started: Date.now() };
    current.current = started;
    lockedRef.current = false;
    active.set(1);
    lockedNow.set(0);
    setLocked(false);
    setElapsed(0);
    setRecording(started);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  function lock() {
    if (lockedRef.current) return;
    lockedRef.current = true;
    lockedNow.set(1);
    setLocked(true);
    reset();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
    reset();
    if (!send) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    try {
      if (held.kind === "voice") {
        await recorder.stop();
        await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true });
        const uri = recorder.uri;
        if (send && uri && ms >= MIN_MS) onVoice(uri, Math.min(ms, VOICE_MAX_MS));
        else if (send) notice(t("tooShort"));
      } else {
        camera.current?.stopRecording();
        const result = await video.current;
        video.current = null;
        if (send && result?.uri && ms >= MIN_MS) onVideo(result.uri, Math.min(ms, VIDEO_MAX_MS));
        else if (send) notice(t("tooShort"));
      }
    } catch {
      notice(t("failed"));
    }
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
  const handlers = useRef({ hold: () => {}, cancel: () => {}, lock: () => {}, release: () => {}, tap: () => {} });
  useEffect(() => {
    handlers.current = {
      hold: () => { holding.current = true; void (mode === "voice" ? startVoice() : startVideo()); },
      cancel: () => { void finish(false); },
      lock,
      release: () => {
        holding.current = false;
        if (current.current && !lockedRef.current) void finish(true);
        else reset();
      },
      tap: () => {
        if (current.current) return;
        setMode((value) => (value === "voice" ? "video" : "voice"));
        void Haptics.selectionAsync();
      },
    };
  });
  const call = useCallback((name: "hold" | "cancel" | "lock" | "release" | "tap") => handlers.current[name](), []);

  // Hold to record; slide left to cancel, up to lock; a quick tap switches microphone and camera.
  // The callbacks are worklets the gesture runs later on the UI thread, never during render; they reach
  // the JS side only through runOnJS. The compiler cannot see that, so its ref rule is off for this block.
  /* eslint-disable react-hooks/refs */
  const gesture = useMemo(() => {
    const hold = Gesture.Pan()
      .activateAfterLongPress(200)
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
  /* eslint-enable react-hooks/refs */

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
  const perimeter = 2 * (NOTE + NOTE) - 8 * VIDEO_NOTE_RADIUS + 2 * Math.PI * VIDEO_NOTE_RADIUS;

  function sendText() {
    const value = text.trim();
    if (!value) return;
    void Haptics.selectionAsync();
    if (editing) onEdit?.(value);
    else onText(value);
    setText("");
  }

  return (
    <View style={styles.wrap}>
      {/* The camera, in the rounded square a video message is, its edge filling with the minute. */}
      {recording?.kind === "video" ? (
        <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(160)} pointerEvents="none"
          style={[styles.noteStage, { height: Math.min(screenHeight * 0.62, 520) }]}>
          <Animated.View entering={ZoomIn.springify().damping(15)} style={styles.noteFrame}>
            {/* A native camera does not round its own corners everywhere: the frame clips it. */}
            <View style={styles.noteClip}>
              <CameraView
                ref={camera}
                style={styles.noteCamera}
                facing="front"
                mode="video"
                onCameraReady={() => {
                  if (current.current?.kind === "video" && !video.current) {
                    video.current = camera.current?.recordAsync({ maxDuration: VIDEO_MAX_MS / 1000 }) ?? null;
                  }
                }}
              />
            </View>
            <Svg width={NOTE + 12} height={NOTE + 12} style={styles.noteRing}>
              <Rect x={4} y={4} width={NOTE + 4} height={NOTE + 4} rx={VIDEO_NOTE_RADIUS + 2} stroke="rgba(255,255,255,0.25)" strokeWidth={4} fill="none" />
              <Rect x={4} y={4} width={NOTE + 4} height={NOTE + 4} rx={VIDEO_NOTE_RADIUS + 2} stroke={MINE[0]} strokeWidth={5} fill="none"
                strokeDasharray={`${perimeter} ${perimeter}`} strokeDashoffset={perimeter * (1 - noteProgress)} strokeLinecap="round" />
            </Svg>
          </Animated.View>
          <Text style={styles.noteTime}>{mediaLength(elapsed)} / {mediaLength(VIDEO_MAX_MS)}</Text>
        </Animated.View>
      ) : null}

      {editing ? (
        <Animated.View entering={FadeInDown.duration(200)} exiting={FadeOutDown.duration(150)} style={styles.editBar}>
          <Pencil color={colors.primary} size={18} strokeWidth={2.2} />
          <View style={styles.editCopy}>
            <Text style={styles.editTitle}>{t("editing")}</Text>
            <Text style={styles.editText} numberOfLines={1}>{editing.body}</Text>
          </View>
          <Pressable accessibilityLabel={t("cancel")} hitSlop={10} onPress={onCancelEdit}>
            <X color={colors.inkMuted} size={20} />
          </Pressable>
        </Animated.View>
      ) : null}

      <View style={styles.bar}>
        {recording ? (
          <Animated.View entering={FadeIn.duration(150)} style={styles.recordingRow}>
            {locked ? (
              <Pressable accessibilityLabel={t("cancel")} onPress={() => void finish(false)} hitSlop={8} style={styles.trash}>
                <Trash2 color={colors.danger} size={22} />
              </Pressable>
            ) : (
              <Animated.View style={[styles.dot, dotStyle]} />
            )}
            <Text style={styles.recordingText}>{mediaLength(elapsed)}</Text>
            {locked ? (
              <View style={styles.liveWave}>
                {Array.from({ length: 18 }, (_, at) => <LiveBar key={at} at={at} level={level} color={recording.kind === "voice" ? colors.primary : colors.danger} />)}
              </View>
            ) : (
              <Animated.View style={[styles.slideHint, hintStyle]}>
                <ChevronLeft color={colors.inkMuted} size={16} />
                <Text style={styles.slideText} numberOfLines={1}>{t("slideCancel")}</Text>
              </Animated.View>
            )}
          </Animated.View>
        ) : (
          <View style={styles.field}>
            <Pressable accessibilityLabel={t("attach")} onPress={onImage} hitSlop={6} style={styles.attach} disabled={Boolean(editing)}>
              <Paperclip color={editing ? colors.border : colors.inkMuted} size={22} strokeWidth={2} />
            </Pressable>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={(value) => { setText(value); if (value.trim()) onTyping?.(); }}
              placeholder={t("placeholder")}
              placeholderTextColor={colors.inkSoft}
              multiline
              // A browser's textarea starts two lines tall; here it starts at one and grows with the words.
              {...(Platform.OS === "web" ? { rows: webRows(text, inputWidth) } : null)}
              onLayout={Platform.OS === "web" ? (event) => setInputWidth(event.nativeEvent.layout.width) : undefined}
              maxLength={4000}
              autoFocus={Boolean(editing)}
            />
          </View>
        )}

        <View style={styles.actionSlot}>
          {recording && locked ? (
            <Animated.View key="locked-send" entering={ZoomIn.springify().damping(14)}>
              <Pressable accessibilityLabel={t("send")} onPress={() => void finish(true)} style={styles.sendCircle}>
                <SendHorizontal color="#FFFFFF" size={19} />
              </Pressable>
            </Animated.View>
          ) : action === "edit" || action === "send" ? (
            <Animated.View key={action} entering={ZoomIn.springify().damping(14)} exiting={ZoomOut.duration(120)}>
              <Pressable accessibilityLabel={t("send")} onPress={sendText} disabled={!typing} style={[styles.sendCircle, !typing && { opacity: 0.45 }]}>
                {action === "edit" ? <Check color="#FFFFFF" size={20} strokeWidth={2.6} /> : <SendHorizontal color="#FFFFFF" size={19} />}
              </Pressable>
            </Animated.View>
          ) : (
            <GestureDetector gesture={gesture}>
              <Animated.View key={`record-${mode}`} entering={ZoomIn.springify().damping(14)} exiting={ZoomOut.duration(120)}
                accessibilityRole="button" accessibilityLabel={mode === "voice" ? t("holdVoice") : t("holdVideo")} style={styles.recordButton}>
                <RecordIcon color={colors.inkMuted} size={24} strokeWidth={2} />
              </Animated.View>
            </GestureDetector>
          )}

          {/* While held: the big button under the finger, the ring that breathes, and the lock above. */}
          {recording && !locked ? (
            <>
              <Animated.View pointerEvents="none" entering={FadeIn.duration(150)} style={[styles.lockPill, lockStyle]}>
                <Lock color={colors.inkMuted} size={17} strokeWidth={2.2} />
                <ChevronUp color={colors.inkSoft} size={16} />
              </Animated.View>
              <Animated.View pointerEvents="none" style={[styles.bigWrap, bigStyle]}>
                <Animated.View style={[styles.ring, { backgroundColor: recording.kind === "voice" ? MINE[0] : colors.danger }, ringStyle]} />
                <Animated.View entering={ZoomIn.springify().damping(12)} style={[styles.big, { backgroundColor: recording.kind === "voice" ? MINE[0] : colors.danger }]}>
                  <RecordIcon color="#FFFFFF" size={30} strokeWidth={2.2} />
                </Animated.View>
              </Animated.View>
            </>
          ) : null}
        </View>
      </View>
    </View>
  );
}

/** How many lines the web field shows for these words: one to five, by line breaks and wrapping. */
function webRows(text: string, width: number): number {
  const perLine = Math.max(12, Math.floor((width - 28) / 8.4));
  const lines = text.split("\n").reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / perLine)), 0);
  return Math.min(5, Math.max(1, lines));
}

/** One bar of the live wave under a locked recording, moving with the voice. */
function LiveBar({ at, level, color }: { at: number; level: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const shape = 0.35 + 0.65 * Math.abs(Math.sin(at * 1.7 + level.value * 6));
    return { height: 4 + level.value * 20 * shape };
  });
  return <Animated.View style={[{ width: 3, borderRadius: 1.5, backgroundColor: color }, style]} />;
}

const useStyles = makeStyles((colors) => ({
  wrap: { position: "relative" },
  bar: {
    flexDirection: "row", alignItems: "flex-end", gap: 4, paddingHorizontal: 6, paddingTop: 6, paddingBottom: 6,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  field: { flex: 1, flexDirection: "row", alignItems: "flex-end", minHeight: FIELD },
  attach: { width: 38, height: FIELD, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1, fontFamily: "JaxongirmanSans_400Regular", fontSize: 16, lineHeight: 20, color: colors.ink, maxHeight: 128, minHeight: FIELD,
    paddingHorizontal: 14, paddingTop: 9, paddingBottom: 9, borderRadius: FIELD / 2, backgroundColor: colors.surfaceMuted,
    // No browser focus ring round the field on the web: the caret says where one is typing.
    // ("none" is the web's word only, hence the cast; width alone loses to the browser's "auto" ring.)
    ...(Platform.OS === "web" ? ({ outlineStyle: "none" } as unknown as TextStyle) : null),
  },
  actionSlot: { width: 44, height: FIELD, alignItems: "center", justifyContent: "center" },
  sendCircle: { width: FIELD, height: FIELD, borderRadius: FIELD / 2, alignItems: "center", justifyContent: "center", backgroundColor: MINE[1] },
  recordButton: { width: 44, height: FIELD, alignItems: "center", justifyContent: "center" },
  recordingRow: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: FIELD, paddingLeft: spacing.sm, overflow: "hidden" },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  trash: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  recordingText: { fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 16, color: colors.ink, fontVariant: ["tabular-nums"], minWidth: 44 },
  slideHint: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 2, paddingRight: 30 },
  slideText: { ...typography.caption, fontSize: 14, color: colors.inkMuted },
  liveWave: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 3, height: 30 },
  bigWrap: { position: "absolute", width: 96, height: 96, right: -26, bottom: -(48 - FIELD / 2), alignItems: "center", justifyContent: "center" },
  big: { width: 84, height: 84, borderRadius: 42, alignItems: "center", justifyContent: "center",
    shadowColor: "#2A0F55", shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  ring: { position: "absolute", width: 120, height: 120, borderRadius: 60 },
  lockPill: {
    position: "absolute", right: 2, bottom: 82, width: 40, paddingVertical: 10, gap: 4, alignItems: "center", borderRadius: 20,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    shadowColor: "#2A0F55", shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  editBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 8,
    backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border,
  },
  editCopy: { flex: 1, borderLeftWidth: 2, borderLeftColor: colors.primary, paddingLeft: spacing.sm },
  editTitle: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary },
  editText: { ...typography.caption, color: colors.inkMuted },
  noteStage: {
    position: "absolute", left: 0, right: 0, bottom: "100%", alignItems: "center", justifyContent: "center", gap: spacing.md, zIndex: 10,
    backgroundColor: "rgba(12,6,28,0.55)",
  },
  noteFrame: { width: NOTE + 12, height: NOTE + 12, alignItems: "center", justifyContent: "center" },
  noteClip: { width: NOTE, height: NOTE, borderRadius: VIDEO_NOTE_RADIUS, overflow: "hidden", backgroundColor: "#000" },
  noteCamera: { width: NOTE, height: NOTE },
  noteRing: { position: "absolute", left: 0, top: 0 },
  noteTime: {
    fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, color: "#fff", backgroundColor: "rgba(0,0,0,0.45)", fontVariant: ["tabular-nums"],
    paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, overflow: "hidden",
  },
}));
