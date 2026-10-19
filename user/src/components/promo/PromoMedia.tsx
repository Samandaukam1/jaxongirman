import type { PromoMediaKind } from "@jaxongirman/types";
import { LinearGradient } from "expo-linear-gradient";
import { Headphones, Play } from "lucide-react-native";
import { Image, Linking, Pressable, StyleSheet, Text, View, type ImageStyle, type StyleProp, type ViewStyle } from "react-native";

import { AUDIO_LINKED, VIDEO_LINKED } from "@/lib/promos";
import { gradients, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * The video and audio players, loaded only when their native modules are in
 * this binary. `expo-video` and `expo-audio` throw on import without them, so
 * they cannot be imported at the top of a file every screen reaches.
 */
type VideoModule = typeof import("./PromoVideo");
type AudioModule = typeof import("./PromoAudio");
/* eslint-disable @typescript-eslint/no-require-imports */
const video: VideoModule | null = VIDEO_LINKED ? (require("./PromoVideo") as VideoModule) : null;
const audio: AudioModule | null = AUDIO_LINKED ? (require("./PromoAudio") as AudioModule) : null;
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * A banner's or a hero's picture: a still, or a silent looping video.
 *
 * A video on a phone whose build has no video player shows the brand gradient
 * with a play mark instead of a broken box; the banner still reads and still
 * opens.
 */
export function PromoMedia({ uri, kind, style }: { uri: string | null; kind: PromoMediaKind; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  if (!uri) {
    return <LinearGradient colors={gradients.surface} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={style} />;
  }
  if (kind === "video") {
    if (video) {
      const Looping = video.LoopingVideo;
      return <Looping uri={uri} style={style} />;
    }
    return (
      <View style={style}>
        <LinearGradient colors={gradients.surface} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        <View style={styles.playMark}><Play color="#FFFFFF" size={22} fill="#FFFFFF" /></View>
      </View>
    );
  }
  return <Image source={{ uri }} style={style as StyleProp<ImageStyle>} resizeMode="cover" fadeDuration={0} accessibilityIgnoresInvertColors />;
}

/** A video block inside an article, with controls. */
export function PromoVideoBlock({ uri, style }: { uri: string; style?: StyleProp<ViewStyle> }) {
  const styles = useStyles();
  if (video) {
    const Player = video.ArticleVideo;
    return <Player uri={uri} style={style} />;
  }
  return (
    <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(uri).catch(() => undefined)} style={style}>
      <LinearGradient colors={gradients.surface} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
      <View style={styles.playMark}><Play color="#FFFFFF" size={24} fill="#FFFFFF" /></View>
    </Pressable>
  );
}

/** An audio block inside an article. Without the player, a row that opens the file. */
export function PromoAudioBlock({ uri, title, accent }: { uri: string; title: string; accent: string }) {
  const styles = useStyles();
  if (audio) {
    const Player = audio.PromoAudio;
    return <Player uri={uri} title={title} accent={accent} />;
  }
  return (
    <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(uri).catch(() => undefined)} style={styles.audioFallback}>
      <View style={[styles.audioIcon, { backgroundColor: accent }]}><Headphones color="#FFFFFF" size={20} /></View>
      <Text numberOfLines={1} style={styles.audioTitle}>{title || "Audio"}</Text>
      <Play color={accent} size={18} fill={accent} />
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  playMark: {
    position: "absolute", left: "50%", top: "50%", marginLeft: -26, marginTop: -26,
    width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.18)", borderWidth: 1, borderColor: "rgba(255,255,255,0.35)",
  },
  audioFallback: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  audioIcon: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  audioTitle: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
}));
