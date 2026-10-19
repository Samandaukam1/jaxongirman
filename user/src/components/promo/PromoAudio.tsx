import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { LinearGradient } from "expo-linear-gradient";
import { Pause, Play } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, Text, View, type LayoutChangeEvent } from "react-native";

import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * An audio clip in an article: one round button, the track, the time.
 *
 * Imported only where `AUDIO_LINKED` says the native module is present — like
 * `expo-video`, importing `expo-audio` without it throws at load time. Nothing
 * plays until it is pressed, and leaving the article stops it.
 */
export function PromoAudio({ uri, title, accent }: { uri: string; title: string; accent: string }) {
  const styles = useStyles();
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  const [track, setTrack] = useState(0);

  // Back to the start once it has played through, so the button plays it again.
  useEffect(() => {
    if (status.didJustFinish) void player.seekTo(0);
  }, [player, status.didJustFinish]);

  const progress = status.duration > 0 ? Math.min(status.currentTime / status.duration, 1) : 0;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={status.playing ? "Pause" : "Play"}
        onPress={() => (status.playing ? player.pause() : player.play())}
        style={({ pressed }) => [styles.buttonWrap, pressed && styles.pressed]}
      >
        <LinearGradient colors={[accent, "#1E0B4A"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.button}>
          {status.playing
            ? <Pause color="#FFFFFF" size={22} strokeWidth={2.4} fill="#FFFFFF" />
            : <Play color="#FFFFFF" size={22} strokeWidth={2.4} fill="#FFFFFF" style={styles.playNudge} />}
        </LinearGradient>
      </Pressable>
      <View style={styles.copy}>
        {title ? <Text numberOfLines={1} style={styles.title}>{title}</Text> : null}
        <Pressable
          accessibilityRole="adjustable"
          onLayout={(event: LayoutChangeEvent) => setTrack(event.nativeEvent.layout.width)}
          onPress={(event) => {
            if (track > 0 && status.duration > 0) void player.seekTo((event.nativeEvent.locationX / track) * status.duration);
          }}
          hitSlop={10}
          style={styles.track}
        >
          <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: accent }]} />
        </Pressable>
        <View style={styles.times}>
          <Text style={styles.time}>{clock(status.currentTime)}</Text>
          <Text style={styles.time}>{status.duration > 0 ? clock(status.duration) : "--:--"}</Text>
        </View>
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  buttonWrap: { borderRadius: 26 },
  button: { width: 52, height: 52, borderRadius: 26, alignItems: "center", justifyContent: "center" },
  playNudge: { marginLeft: 3 },
  pressed: { opacity: 0.85, transform: [{ scale: 0.96 }] },
  copy: { flex: 1, gap: 6 },
  title: { ...typography.bodyMedium, color: colors.ink, fontSize: 14.5 },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  fill: { height: "100%", borderRadius: 3 },
  times: { flexDirection: "row", justifyContent: "space-between" },
  time: { ...typography.caption, fontSize: 11, color: colors.inkSoft, fontVariant: ["tabular-nums"] },
}));
