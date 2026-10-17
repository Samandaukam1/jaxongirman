import { useCallback, useEffect, useState } from "react";
import { Alert, Modal, Platform, Pressable, Text, View, type AlertButton } from "react-native";

import { i18n } from "@/i18n";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * `Alert.alert` on the web, drawn by the app.
 *
 * react-native-web ships `Alert.alert` as an empty function. Every confirmation
 * in the app — "delete this deck?", "sign out?", "not enough J Tanga" — is an
 * Alert with buttons whose `onPress` does the work, so in a browser the button
 * that asked did nothing at all and no message ever appeared. Here the same
 * call opens a dialog in the app's own type and colours, with the same buttons
 * in the same order; Escape is the cancel button and Enter the last one, the
 * way the platform dialogs behave. Native keeps its own alerts untouched.
 */

type Pending = { id: number; title: string; message?: string; buttons: AlertButton[]; cancelable: boolean };

let show: ((alert: Pending) => void) | null = null;
const waiting: Pending[] = [];
let serial = 0;

if (Platform.OS === "web") {
  Alert.alert = (title, message, buttons, options) => {
    serial += 1;
    const alert: Pending = {
      id: serial,
      title,
      message: message || undefined,
      buttons: buttons?.length ? buttons : [{ text: i18n.t("common:ok") }],
      cancelable: options?.cancelable ?? true,
    };
    if (show) show(alert);
    else waiting.push(alert);
  };
}

export function WebAlertHost() {
  const styles = useStyles();
  const [queue, setQueue] = useState<Pending[]>([]);

  useEffect(() => {
    if (Platform.OS !== "web") return;
    show = (alert) => setQueue((current) => [...current, alert]);
    if (waiting.length) setQueue((current) => [...current, ...waiting.splice(0)]);
    return () => { show = null; };
  }, []);

  const current = queue[0];

  const answer = useCallback((button: AlertButton | null | undefined) => {
    setQueue((rest) => rest.slice(1));
    // After the dialog is gone, so a button that opens another alert or
    // navigates does it from a settled screen.
    if (button?.onPress) setTimeout(() => button.onPress?.(), 0);
  }, []);

  useEffect(() => {
    if (!current || Platform.OS !== "web") return;
    const cancel = current.buttons.find((button) => button.style === "cancel");
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (cancel) answer(cancel);
        else if (current.cancelable || current.buttons.length === 1) answer(current.buttons.length === 1 ? current.buttons[0] : null);
      } else if (event.key === "Enter") {
        event.preventDefault();
        answer(current.buttons[current.buttons.length - 1]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, current]);

  if (Platform.OS !== "web" || !current) return null;

  const stacked = current.buttons.length > 2;
  const cancel = current.buttons.find((button) => button.style === "cancel");

  return (
    <Modal transparent visible animationType="fade" onRequestClose={() => answer(cancel ?? null)}>
      <View style={styles.backdrop}>
        <Pressable
          style={styles.scrim}
          accessibilityLabel={cancel?.text ?? i18n.t("common:close")}
          onPress={() => { if (current.cancelable && cancel) answer(cancel); }}
        />
        <View style={styles.card} accessibilityRole="alert">
          <Text style={styles.title}>{current.title}</Text>
          {current.message ? <Text style={styles.message}>{current.message}</Text> : null}
          <View style={[styles.buttons, stacked && styles.buttonsStacked]}>
            {current.buttons.map((button, index) => {
              const primary = index === current.buttons.length - 1 && button.style !== "cancel";
              return (
                <Pressable
                  key={`${index}-${button.text ?? ""}`}
                  onPress={() => answer(button)}
                  style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => [
                    styles.button,
                    stacked && styles.buttonStacked,
                    button.style === "destructive" ? styles.destructive : primary ? styles.primary : styles.quiet,
                    (hovered || pressed) && styles.buttonHover,
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      button.style === "destructive" || primary ? styles.buttonTextStrong : null,
                    ]}
                  >
                    {button.text ?? "OK"}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },
  scrim: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, backgroundColor: "rgba(17, 10, 36, 0.42)" },
  card: {
    width: "100%",
    maxWidth: 420,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    gap: spacing.sm,
    boxShadow: "0 24px 60px rgba(25, 10, 60, 0.28)",
  },
  title: { ...typography.heading, color: colors.ink },
  message: { ...typography.body, color: colors.inkMuted },
  buttons: { flexDirection: "row", justifyContent: "flex-end", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  buttonsStacked: { flexDirection: "column", alignItems: "stretch" },
  button: { minHeight: 42, paddingHorizontal: spacing.lg, borderRadius: radius.pill, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  buttonStacked: { width: "100%" },
  quiet: { backgroundColor: colors.surface, borderColor: colors.border },
  primary: { backgroundColor: colors.primary, borderColor: colors.primary },
  destructive: { backgroundColor: colors.danger, borderColor: colors.danger },
  buttonHover: { opacity: 0.88 },
  buttonText: { ...typography.bodyMedium, color: colors.ink },
  buttonTextStrong: { color: colors.onPrimary },
}));
