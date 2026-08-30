import { useRouter } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Touchable } from "@/components/Touchable";
import { deleteMyAccount, forgetLocalAccount } from "@/lib/account";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The sheet between a red button and a permanent thing.
 *
 * A destructive action needs two presses, and the second one has to be worth
 * making: a dialog that says "Are you sure?" and nothing else buys a moment of
 * hesitation and no understanding. So this says what actually happens, in the
 * order somebody cares about it — the account goes, the personal data goes, and
 * it cannot be undone.
 *
 * The cancel is the wide, quiet, obvious one and it is listed first. The
 * destructive one is red and says the word. Neither is a default that a
 * mis-tap can find: the sheet opens with nothing focused and the backdrop
 * dismisses to the safe side.
 */

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function DeleteAccountSheet({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount();
      /**
       * Forget before leaving, not after.
       *
       * The redirect out of `(app)` is driven by the session going null, so
       * clearing it is what performs the navigation. Doing it in this order
       * also means the sign-in screen can never mount over a stale profile
       * still sitting in the account provider.
       */
      await forgetLocalAccount();
      onClose();
      router.replace("/(auth)/sign-in");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Hisobni o‘chirib bo‘lmadi");
      setBusy(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      // A deletion in flight is not something a back gesture should interrupt.
      onRequestClose={() => { if (!busy) onClose(); }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Yopish"
        style={styles.backdrop}
        onPress={() => { if (!busy) onClose(); }}
      >
        {/* Swallows presses so a tap inside the sheet is not a tap on the
            backdrop underneath it. */}
        <Pressable style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md }]}>
          <View style={styles.grabber} />

          <View style={styles.mark}>
            <ShieldAlert color={colors.danger} size={26} strokeWidth={2} />
          </View>

          <Text style={styles.title}>Hisobingizni butunlay o‘chirmoqchimisiz?</Text>
          <Text style={styles.body}>
            Bu amal natijasida akkauntingiz va unga tegishli o‘chirilishi kerak bo‘lgan shaxsiy
            ma’lumotlar o‘chiriladi. Bu amalni ortga qaytarib bo‘lmaydi.
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Touchable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={[styles.button, styles.cancel, busy && styles.dimmed]}
            >
              <Text style={styles.cancelText}>BEKOR QILISH</Text>
            </Touchable>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel="Hisobni o‘chirish"
              disabled={busy}
              onPress={() => void remove()}
              style={[styles.button, styles.destructive]}
            >
              {busy
                ? <ActivityIndicator color={colors.onPrimary} size="small" />
                : <Text style={styles.destructiveText}>O‘CHIRISH</Text>}
            </Touchable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(12,6,24,0.52)" },
  sheet: {
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xl,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surface,
    gap: spacing.md,
  },
  grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, backgroundColor: colors.borderStrong },
  mark: {
    alignSelf: "center",
    width: 56, height: 56, borderRadius: 20,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.dangerSoft,
    borderWidth: 1, borderColor: colors.dangerBorder,
  },
  title: { ...typography.heading, color: colors.ink, textAlign: "center" },
  body: { ...typography.body, color: colors.inkMuted, textAlign: "center" },
  error: {
    ...typography.caption,
    color: colors.danger,
    textAlign: "center",
    padding: spacing.sm,
    borderRadius: radius.sm,
    backgroundColor: colors.dangerSoft,
  },
  actions: { gap: spacing.sm, marginTop: spacing.xs },
  button: { height: 52, borderRadius: radius.md, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: spacing.sm },
  cancel: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  cancelText: { ...typography.bodyMedium, color: colors.ink, letterSpacing: 0.4 },
  destructive: { backgroundColor: colors.danger },
  destructiveText: { ...typography.bodyMedium, color: colors.onPrimary, letterSpacing: 0.6, fontFamily: "Manrope_700Bold" },
  dimmed: { opacity: 0.5 },
}));
