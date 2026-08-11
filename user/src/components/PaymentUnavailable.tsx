import { Lock } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

/**
 * What a screen shows instead of a purchase, on a platform that may not offer
 * one. Written once so all four surfaces say the same thing in the same shape,
 * and so the copy comes from the server rather than from four string literals.
 *
 * Deliberately says nothing about where else to buy. Guideline 3.1.1(a) forbids
 * "buttons, external links, or other calls to action that direct customers to
 * purchasing mechanisms other than in-app purchase" in every storefront except
 * the United States, and Jaxongirman ships to Uzbekistan. An operator who holds
 * a StoreKit External Purchase Link entitlement can put steering copy in the
 * admin console; nothing here assumes one.
 */
export function PaymentUnavailable({ title, message, action, onLeave }: {
  title: string;
  message?: string;
  /** Somewhere useful that is not a purchase — a library, a wallet, back. */
  action?: { label: string; onPress: () => void };
  /** When set, the screen draws its own header with a close affordance. */
  onLeave?: () => void;
}) {
  return (
    <View style={styles.screen}>
      {onLeave ? <ScreenHeader title="Jaxongirman" variant="close" onLeave={onLeave} /> : null}
      <View style={styles.body}>
        <View style={styles.badge}>
          <Lock color={colors.inkMuted} size={icon.lg} strokeWidth={icon.stroke} />
        </View>
        <Text style={styles.title}>{title}</Text>
        {message ? <Text style={styles.message}>{message}</Text> : null}
        {action ? <PrimaryButton label={action.label} tone="secondary" onPress={action.onPress} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: spacing.xl, gap: spacing.lg },
  badge: {
    alignSelf: "center", width: 64, height: 64, borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center",
  },
  title: { ...typography.heading, color: colors.ink, textAlign: "center" },
  message: { ...typography.body, color: colors.inkMuted, textAlign: "center", lineHeight: 22 },
});
