import { LinearGradient } from "expo-linear-gradient";
import { Trophy } from "lucide-react-native";
import { useState, type ReactNode } from "react";
import { Image, Pressable, Text, View, type ViewStyle } from "react-native";

import { posterUrl, type MarathonCampaign } from "@/lib/marathon";
import { brandInk, gradients, icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * The campaign's own artwork, in the shape it was drawn in.
 *
 * 2.35:1 and `cover`, so a poster is never stretched and never letterboxed —
 * a designer handed us a frame and the app's job is to honour it. Nothing is
 * laid over the picture: the title, the clock and the rewards all live below
 * it, because a poster carrying four overlays is a poster nobody commissioned.
 *
 * When there is no artwork yet — or the file will not load — the brand
 * gradient carries the title instead, which keeps the section a section rather
 * than a grey hole.
 */
export function MarathonPoster({ campaign, onPress, style, children }: {
  campaign: MarathonCampaign;
  onPress?: () => void;
  style?: ViewStyle;
  children?: ReactNode;
}) {
  const styles = useStyles();
  const [failed, setFailed] = useState(false);
  const uri = posterUrl(campaign.poster_path);

  const art = uri && !failed ? (
    <Image
      source={{ uri }}
      style={styles.image}
      resizeMode="cover"
      accessibilityLabel={`${campaign.title} afishasi`}
      onError={() => setFailed(true)}
    />
  ) : (
    <LinearGradient colors={gradients.primary} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fallback}>
      <Trophy color={brandInk.strong} size={icon.xl} strokeWidth={icon.stroke} />
      <Text numberOfLines={2} style={styles.fallbackTitle}>{campaign.title}</Text>
    </LinearGradient>
  );

  if (!onPress) return <View style={[styles.frame, style]}>{art}{children}</View>;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${campaign.title} — marafon sahifasi`}
      onPress={onPress}
      style={({ pressed }) => [styles.frame, pressed && styles.pressed, style]}
    >
      {art}
      {children}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  frame: {
    width: "100%", aspectRatio: 2.35,
    borderRadius: radius.lg, overflow: "hidden",
    backgroundColor: colors.surfaceMuted, ...shadow,
  },
  pressed: { opacity: 0.92 },
  image: { width: "100%", height: "100%" },
  fallback: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, padding: spacing.lg },
  fallbackTitle: { ...typography.heading, color: brandInk.strong, textAlign: "center" },
}));
