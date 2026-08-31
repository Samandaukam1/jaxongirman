import { QrCode as QrGlyph, Share2, X } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, Share, Text, View } from "react-native";

import { QrCode } from "@/components/QrCode";
import { candidateLink, shareMessage } from "@/lib/marathon-link";
import { type MarathonCampaign } from "@/lib/marathon";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The two ways a candidate hands their link to somebody.
 *
 * Share for a person who is somewhere else, a QR for a person standing in front
 * of you — which is most of them, because this campaign is run in lecture halls
 * and dormitories. Both carry the same URL, so a vote arrives the same way
 * whichever was used.
 *
 * The code is shown large on a plain white card: a phone held out across a
 * table is read at an angle, in whatever light the room has, and a code tinted
 * to match the app is a code that photographs well and scans badly.
 */
export function MarathonShareRow({ campaign, candidateId, username }: {
  campaign: MarathonCampaign;
  candidateId: string;
  username: string | null;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [qrOpen, setQrOpen] = useState(false);
  const link = candidateLink(campaign.id, candidateId);

  return (
    <>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Havolani ulashish"
          onPress={() => {
            void Share.share({ message: `${shareMessage(campaign.title, username)}\n${link}`, url: link })
              .catch(() => { /* dismissed */ });
          }}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Share2 color={colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
          <Text style={styles.label}>Ulashish</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="QR kodni ko‘rsatish"
          onPress={() => setQrOpen(true)}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <QrGlyph color={colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
          <Text style={styles.label}>QR</Text>
        </Pressable>
      </View>

      <Modal visible={qrOpen} transparent animationType="fade" onRequestClose={() => setQrOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setQrOpen(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHead}>
            <Text style={styles.sheetTitle}>QR kod</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Yopish" onPress={() => setQrOpen(false)}>
              <X color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
            </Pressable>
          </View>

          <View style={styles.codeCard}>
            <QrCode value={link} size={232} />
          </View>

          {username ? <Text style={styles.handle}>@{username}</Text> : null}
          <Text style={styles.hint}>
            Kodni skanerlagan odam to‘g‘ridan-to‘g‘ri sizga ovoz berish sahifasiga tushadi.
          </Text>
        </View>
      </Modal>
    </>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: "row", gap: spacing.sm },
  button: {
    flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    height: 46, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  label: { ...typography.bodyMedium, color: colors.ink },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)" },
  sheet: {
    position: "absolute", left: 0, right: 0, bottom: 0, alignItems: "center", gap: spacing.sm,
    padding: spacing.xl, paddingBottom: spacing.xxl,
    borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
  },
  sheetHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", width: "100%" },
  sheetTitle: { ...typography.heading, color: colors.ink },
  // White under the code in both themes: a dark card behind a QR inverts it.
  codeCard: { padding: spacing.md, borderRadius: radius.lg, backgroundColor: "#FFFFFF", marginTop: spacing.sm },
  handle: { ...typography.bodyMedium, color: colors.ink, marginTop: spacing.sm },
  hint: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
}));
