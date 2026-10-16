import { Check, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PAIRINGS, resolvePairing, type Pairing, type ResolvedFace } from "@/lib/deckFonts";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = {
  visible: boolean;
  /** The pairing the deck is set in now, when it is one of these. */
  current: string | null;
  onClose: () => void;
  /** Applies a pairing to the whole deck. Resolves once it is saved. */
  onApply: (pairing: Pairing, faces: Record<"display" | "strong" | "body", ResolvedFace>) => Promise<void>;
};

/**
 * The deck's typefaces, chosen by looking at them.
 *
 * Every pairing is shown in its own faces — a title word in the display face
 * over a line of text in the body face — because a list of family names is a
 * list nobody can choose from. The files are fetched when the sheet opens and
 * cached, so the second visit is instant. Applying restyles every text row of
 * the deck at once (see `deckFonts.ts`), sized so no line breaks differently.
 */
export function DeckFontSheet({ visible, current, onClose, onApply }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["editor", "common"]);
  const insets = useSafeAreaInsets();
  const [faces, setFaces] = useState<Record<string, Record<"display" | "strong" | "body", ResolvedFace> | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    let active = true;
    setError(null);
    for (const pairing of PAIRINGS) {
      if (faces[pairing.key] !== undefined) continue;
      void resolvePairing(pairing).then((resolved) => {
        if (active) setFaces((known) => ({ ...known, [pairing.key]: resolved }));
      }).catch(() => {
        if (active) setFaces((known) => ({ ...known, [pairing.key]: null }));
      });
    }
    return () => { active = false; };
    // Fetched once per opening; `faces` is the cache, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  async function choose(pairing: Pairing) {
    const resolved = faces[pairing.key];
    if (!resolved || busy) return;
    setBusy(pairing.key);
    setError(null);
    try {
      await onApply(pairing, resolved);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("fonts.failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose} />
      <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
        <View style={styles.head}>
          <View style={styles.headCopy}>
            <Text style={styles.title}>{t("deckFonts")}</Text>
            <Text style={styles.hint}>{t("fonts.hint")}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel={t("common:close")} onPress={onClose} disabled={Boolean(busy)} hitSlop={10}>
            <X color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
          {PAIRINGS.map((pairing) => {
            const resolved = faces[pairing.key];
            const loading = resolved === undefined;
            const selected = current === pairing.key;
            return (
              <Pressable
                key={pairing.key}
                accessibilityRole="button"
                accessibilityState={{ selected, disabled: !resolved }}
                disabled={!resolved || Boolean(busy)}
                onPress={() => void choose(pairing)}
                style={[styles.card, selected && styles.cardSelected, resolved === null && styles.cardOff]}
              >
                <View style={styles.sample}>
                  <Text numberOfLines={1} style={[styles.sampleDisplay, resolved ? { fontFamily: resolved.display.fontFamily } : null]}>
                    {t("fonts.sampleTitle")}
                  </Text>
                  <Text numberOfLines={2} style={[styles.sampleBody, resolved ? { fontFamily: resolved.body.fontFamily } : null]}>
                    {t("fonts.sampleBody")}
                  </Text>
                </View>
                <View style={styles.meta}>
                  <Text style={styles.label} numberOfLines={1}>{pairing.label}</Text>
                  {busy === pairing.key || loading ? (
                    <ActivityIndicator size="small" color={colors.primary} />
                  ) : selected ? (
                    <View style={styles.check}><Check color={colors.onPrimary} size={12} strokeWidth={icon.strokeBold} /></View>
                  ) : resolved === null ? (
                    <Text style={styles.off}>{t("fonts.unavailable")}</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: "rgba(10,6,20,0.45)" },
  sheet: {
    maxHeight: "82%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingTop: spacing.lg,
  },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: spacing.xl, paddingBottom: spacing.md },
  headCopy: { flex: 1, gap: 4 },
  title: { ...typography.heading, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  error: { ...typography.caption, color: colors.danger, paddingHorizontal: spacing.xl, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.sm },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 2, padding: spacing.md - 1, backgroundColor: colors.primarySoft },
  cardOff: { opacity: 0.45 },
  sample: { gap: 2 },
  sampleDisplay: { fontSize: 26, lineHeight: 32, color: colors.ink },
  sampleBody: { fontSize: 14, lineHeight: 19, color: colors.inkMuted },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  label: { ...typography.caption, color: colors.inkSoft, flex: 1 },
  check: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  off: { ...typography.caption, color: colors.inkSoft },
}));
