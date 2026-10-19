import { useRouter } from "expo-router";
import { ShieldAlert } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
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

/** A browser moves nothing for its keyboard; the phone's has to be avoided. */
const Avoider = Platform.OS === "web" ? View : KeyboardAvoidingView;

type Props = {
  visible: boolean;
  onClose: () => void;
};

/**
 * Compared the way a person types it, not byte for byte: Uzbek has five
 * apostrophe look-alikes (' ’ ‘ ʻ ʼ) and a keyboard offers whichever it likes,
 * so the phrase is matched on letters. Case is ignored too — the field shows
 * capitals, but a phone that starts a sentence lower-case must not lock the
 * button.
 */
function normalisePhrase(value: string): string {
  return value
    .replace(/[\u2018\u2019\u02BB\u02BC\u0060\u00B4]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleUpperCase("en-US");
}

export function DeleteAccountSheet({ visible, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["misc", "common"]);
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");

  const phrase = t("deleteAccount.phrase");
  const confirmed = normalisePhrase(typed) === normalisePhrase(phrase);

  // A sheet that is opened again starts empty: a phrase typed last time must not
  // carry the next deletion through.
  useEffect(() => {
    if (!visible) { setTyped(""); setError(null); }
  }, [visible]);

  const remove = async () => {
    if (!confirmed) return;
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
      setError(deleteError instanceof Error ? deleteError.message : t("deleteAccount.failed"));
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
      {/* Above the keyboard: the phrase is typed here, and the button it unlocks
          sits under the field. The backdrop is a layer behind the sheet rather
          than its parent — a field and two buttons inside a button is not a
          thing a browser will draw. */}
      <Avoider behavior="padding" style={styles.frame}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("common:close")}
          style={[StyleSheet.absoluteFill, styles.backdrop]}
          onPress={() => { if (!busy) onClose(); }}
        />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) + spacing.md }]}>
          <View style={styles.grabber} />

          <View style={styles.mark}>
            <ShieldAlert color={colors.danger} size={26} strokeWidth={2} />
          </View>

          <Text style={styles.title}>{t("deleteAccount.title")}</Text>
          <Text style={styles.body}>
            {t("deleteAccount.body")}
          </Text>

          <View style={styles.phraseBlock}>
            <Text style={styles.phraseLead}>{t("deleteAccount.typeLead")}</Text>
            <Text selectable={false} style={styles.phrase}>{phrase}</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              editable={!busy}
              autoCapitalize="characters"
              autoCorrect={false}
              autoComplete="off"
              spellCheck={false}
              returnKeyType="done"
              placeholder={phrase}
              placeholderTextColor={colors.inkSoft}
              accessibilityLabel={t("deleteAccount.typeLabel", { phrase })}
              style={[styles.phraseInput, confirmed && styles.phraseInputOk]}
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <View style={styles.actions}>
            <Touchable
              accessibilityRole="button"
              disabled={busy}
              onPress={onClose}
              style={[styles.button, styles.cancel, busy && styles.dimmed]}
            >
              <Text style={styles.cancelText}>{t("deleteAccount.cancel")}</Text>
            </Touchable>

            <Touchable
              accessibilityRole="button"
              accessibilityLabel={t("deleteAccount.label")}
              disabled={busy || !confirmed}
              onPress={() => void remove()}
              style={[styles.button, styles.destructive, !confirmed && styles.dimmed]}
            >
              {busy
                ? <ActivityIndicator color={colors.onPrimary} size="small" />
                : <Text style={styles.destructiveText}>{t("deleteAccount.confirm")}</Text>}
            </Touchable>
          </View>
        </View>
      </Avoider>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  frame: { flex: 1, justifyContent: "flex-end" },
  backdrop: { backgroundColor: "rgba(12,6,24,0.52)" },
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
  phraseBlock: { gap: spacing.sm },
  phraseLead: { ...typography.caption, color: colors.inkMuted, textAlign: "center" },
  phrase: { fontFamily: "Manrope_800ExtraBold", fontSize: 17, letterSpacing: 0.8, color: colors.danger, textAlign: "center" },
  phraseInput: {
    ...typography.bodyMedium, height: 52, textAlign: "center", color: colors.ink, letterSpacing: 0.6,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.md,
  },
  phraseInputOk: { borderColor: colors.danger, backgroundColor: colors.dangerSoft },
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
