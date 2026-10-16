import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, ChevronRight, LifeBuoy, MessageSquarePlus } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { Appear } from "@/components/Appear";
import { PrimaryButton } from "@/components/PrimaryButton";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { formatLongDate } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import { SupportStatusBadge as StatusBadge } from "@/components/SupportStatusBadge";
import { FAQ, categoryLabel, myTickets, statusLabel, type TicketSummary } from "@/lib/support";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Yordam markazi: a new question, the questions already asked, and the
 * answers to the common ones. Every answer on a ticket is written by the
 * support staff.
 */
export default function SupportScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("support");
  const router = useRouter();
  const params = useLocalSearchParams<{ faq?: string }>();
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openFaq, setOpenFaq] = useState<number | null>(params.faq ? 0 : null);

  const load = useCallback(async (pull = false) => {
    if (pull) setRefreshing(true);
    try {
      setTickets(await myTickets());
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={styles.screen}>
      <ScreenHeader title={t("title")} subtitle={t("subtitle")} />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void load(true)} tintColor={colors.primary} />}
      >
        <PrimaryButton label={t("newTicket")} icon={MessageSquarePlus} onPress={() => router.push("/(app)/support/new")} />

        <Text style={styles.sectionTitle}>{t("mine")}</Text>
        {loading ? <SkeletonCard /> : null}
        {error && !loading ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {!loading && !error && tickets.length === 0 ? (
          <View style={styles.quiet}>
            <LifeBuoy color={colors.inkSoft} size={22} strokeWidth={2} />
            <Text style={styles.quietText}>{t("none")}</Text>
          </View>
        ) : null}
        <View style={styles.list}>
          {tickets.map((ticket, index) => (
            <Appear key={ticket.id} index={index}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${ticket.subject}, ${statusLabel(ticket.status)}`}
                onPress={() => router.push({ pathname: "/(app)/support/[id]", params: { id: ticket.id } })}
                style={({ pressed }) => [styles.ticket, pressed && styles.pressed]}
              >
                <View style={styles.ticketCopy}>
                  <Text style={styles.ticketMeta} numberOfLines={1}>{ticket.ticket_number} · {categoryLabel(ticket.category)}</Text>
                  <Text style={styles.ticketSubject} numberOfLines={2}>{ticket.subject}</Text>
                  <View style={styles.ticketFoot}>
                    <StatusBadge status={ticket.status} />
                    <Text style={styles.ticketDate}>{formatLongDate(new Date(ticket.last_message_at))}</Text>
                  </View>
                </View>
                {ticket.user_unread > 0 ? <View style={styles.unread}><Text style={styles.unreadText}>{ticket.user_unread}</Text></View> : null}
                <ChevronRight color={colors.inkSoft} size={18} strokeWidth={2} />
              </Pressable>
            </Appear>
          ))}
        </View>

        <Text style={styles.sectionTitle}>{t("faqTitle")}</Text>
        <View style={styles.faq}>
          {FAQ.map((item, index) => {
            const open = openFaq === index;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                onPress={() => setOpenFaq(open ? null : index)}
                style={[styles.faqItem, index > 0 && styles.faqRule]}
              >
                <View style={styles.faqHead}>
                  <Text style={styles.faqQuestion}>{t(`faq.${item}.question`)}</Text>
                  <ChevronDown color={colors.inkSoft} size={18} strokeWidth={2} style={open ? styles.flip : undefined} />
                </View>
                {open ? <Text style={styles.faqAnswer}>{t(`faq.${item}.answer`)}</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { paddingHorizontal: spacing.xl, paddingBottom: 48, gap: spacing.md },
  sectionTitle: { ...typography.caption, fontFamily: "Manrope_700Bold", fontSize: 11, letterSpacing: 1.1, color: colors.inkSoft, marginTop: spacing.md, marginLeft: spacing.xs },
  quiet: { flexDirection: "row", gap: spacing.md, alignItems: "center", padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  quietText: { ...typography.caption, flex: 1, color: colors.inkMuted, lineHeight: 18 },
  list: { gap: spacing.sm },
  ticket: {
    flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg,
    borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  ticketCopy: { flex: 1, gap: 4 },
  ticketMeta: { ...typography.caption, fontSize: 11.5, color: colors.inkSoft },
  ticketSubject: { ...typography.bodyMedium, color: colors.ink },
  ticketFoot: { flexDirection: "row", alignItems: "center", gap: spacing.sm, flexWrap: "wrap", marginTop: 2 },
  ticketDate: { ...typography.caption, fontSize: 11.5, color: colors.inkSoft },
  unread: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  unreadText: { ...typography.caption, fontSize: 11, fontFamily: "Manrope_700Bold", color: colors.onPrimary },
  faq: { borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, overflow: "hidden" },
  faqItem: { padding: spacing.lg, gap: spacing.sm },
  faqRule: { borderTopWidth: 1, borderTopColor: colors.border },
  faqHead: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  faqQuestion: { ...typography.bodyMedium, flex: 1, color: colors.ink, fontSize: 14.5 },
  faqAnswer: { ...typography.caption, color: colors.inkMuted, lineHeight: 19, fontSize: 13.5 },
  flip: { transform: [{ rotate: "180deg" }] },
}));
