import * as ImagePicker from "expo-image-picker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { ImagePlus, RotateCcw, Send, X } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState, SkeletonCard } from "@/components/StateBlocks";
import { SupportStatusBadge } from "@/components/SupportStatusBadge";
import { formatClock, formatLongDate } from "@/lib/datetime";
import { asErrorMessage } from "@/lib/format";
import {
  attachmentUrl, categoryLabel, replyToTicket, reopenTicket, ticketDetail, uploadSupportImage,
  type TicketAttachment, type TicketDetail,
} from "@/lib/support";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** How often an open ticket looks for a new answer while it is on screen. */
const POLL_MS = 20_000;

/**
 * One ticket: the conversation with the support staff.
 *
 * Reading it marks the answers read. While it is on screen it checks for a
 * new answer every twenty seconds; leaving stops that.
 */
export default function TicketScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["support", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [shots, setShots] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [sending, setSending] = useState(false);
  const scroll = useRef<ScrollView>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setDetail(await ticketDetail(id));
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [id]);

  useFocusEffect(useCallback(() => {
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [load]));

  async function pickShot() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.8, allowsMultipleSelection: true, selectionLimit: 3 - shots.length });
    if (!result.canceled) setShots((current) => [...current, ...result.assets].slice(0, 3));
  }

  async function send() {
    if (!user || !id || (!draft.trim() && shots.length === 0)) return;
    setSending(true);
    try {
      const paths: string[] = [];
      for (const shot of shots) paths.push(await uploadSupportImage(user.id, shot));
      setDetail(await replyToTicket(id, draft.trim() || t("thread.imageOnly"), paths));
      setDraft("");
      setShots([]);
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
    } catch (failure) {
      Alert.alert(t("thread.sendFailed"), asErrorMessage(failure));
    } finally {
      setSending(false);
    }
  }

  async function reopen() {
    if (!id) return;
    try {
      setDetail(await reopenTicket(id));
    } catch (failure) {
      Alert.alert(t("thread.reopenFailed"), asErrorMessage(failure));
    }
  }

  const ticket = detail?.ticket;
  const closed = ticket?.status === "closed";
  const resolved = ticket?.status === "resolved";

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen}>
      <ScreenHeader title={ticket?.ticket_number ?? t("thread.fallbackTitle")} subtitle={ticket ? categoryLabel(ticket.category) : undefined} />
      {!detail && !error ? <View style={styles.pad}><SkeletonCard /></View> : null}
      {error && !detail ? <View style={styles.pad}><ErrorState message={error} onRetry={() => void load()} /></View> : null}

      {ticket ? (
        <>
          <ScrollView
            ref={scroll}
            contentContainerStyle={styles.thread}
            onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.summary}>
              <Text style={styles.subject}>{ticket.subject}</Text>
              <SupportStatusBadge status={ticket.status} />
              {ticket.related_order_number || ticket.related_presentation_title || ticket.related_transaction_ref ? (
                <Text style={styles.related}>
                  {[ticket.related_order_number && t("thread.order", { value: ticket.related_order_number }),
                    ticket.related_transaction_ref && t("thread.transaction", { value: ticket.related_transaction_ref }),
                    ticket.related_presentation_title && t("thread.deck", { value: ticket.related_presentation_title })].filter(Boolean).join(" · ")}
                </Text>
              ) : null}
            </View>

            {detail.messages.map((message) => {
              const mine = message.author_kind === "user";
              return (
                <View key={message.id} style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
                  <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {!mine ? <Text style={styles.author}>{message.author_name ?? t("thread.staff")}</Text> : null}
                    <Text style={[styles.body, mine && styles.bodyMine]}>{message.body}</Text>
                    {message.attachments.length ? (
                      <View style={styles.attachments}>
                        {message.attachments.map((file) => <Attachment key={file.id} file={file} />)}
                      </View>
                    ) : null}
                    <Text style={[styles.time, mine && styles.timeMine]}>
                      {formatLongDate(new Date(message.created_at))} · {formatClock(new Date(message.created_at))}
                    </Text>
                  </View>
                </View>
              );
            })}

            {resolved ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>{t("thread.resolved")}</Text>
                <Pressable accessibilityRole="button" onPress={() => void reopen()} style={styles.reopen}>
                  <RotateCcw color={colors.primary} size={16} strokeWidth={2.2} />
                  <Text style={styles.reopenText}>{t("thread.reopen")}</Text>
                </Pressable>
              </View>
            ) : null}
            {closed ? (
              <View style={styles.notice}>
                <Text style={styles.noticeText}>{t("thread.closed")}</Text>
                <Pressable accessibilityRole="button" onPress={() => router.replace("/(app)/support/new")} style={styles.reopen}>
                  <Text style={styles.reopenText}>{t("newTicket")}</Text>
                </Pressable>
              </View>
            ) : null}
          </ScrollView>

          {!closed ? (
            <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.md) }]}>
              {shots.length ? (
                <View style={styles.pending}>
                  {shots.map((shot, index) => (
                    <View key={shot.uri} style={styles.pendingShot}>
                      <Image source={{ uri: shot.uri }} style={styles.pendingImage} />
                      <Pressable hitSlop={8} accessibilityLabel={t("thread.remove")} onPress={() => setShots((current) => current.filter((_, at) => at !== index))} style={styles.pendingRemove}>
                        <X color="#FFFFFF" size={12} strokeWidth={2.6} />
                      </Pressable>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={styles.inputRow}>
                <Pressable accessibilityRole="button" accessibilityLabel={t("thread.attach")} disabled={shots.length >= 3} onPress={() => void pickShot()} style={styles.iconButton}>
                  <ImagePlus color={shots.length >= 3 ? colors.inkSoft : colors.primary} size={22} strokeWidth={2} />
                </Pressable>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder={t("thread.placeholder")}
                  placeholderTextColor={colors.inkSoft}
                  multiline
                  maxLength={5000}
                  style={styles.input}
                />
                <Pressable accessibilityRole="button" accessibilityLabel={t("common:send")} disabled={sending || (!draft.trim() && shots.length === 0)}
                  onPress={() => void send()} style={[styles.send, (sending || (!draft.trim() && shots.length === 0)) && styles.sendOff]}>
                  {sending ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Send color={colors.onPrimary} size={18} strokeWidth={2.2} />}
                </Pressable>
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </KeyboardAvoidingView>
  );
}

/** A screenshot in the thread: fetched by a short-lived link, opened full size on tap. */
function Attachment({ file }: { file: TicketAttachment }) {
  const styles = useStyles();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => { void attachmentUrl(file.path).then(setUrl); }, [file.path]);
  const image = (file.mime_type ?? "").startsWith("image/");
  return (
    <Pressable accessibilityRole="imagebutton" disabled={!url} onPress={() => url && void Linking.openURL(url)} style={styles.attachment}>
      {url && image ? <Image source={{ uri: url }} style={styles.attachmentImage} /> : <Text style={styles.attachmentText}>{image ? "…" : "PDF"}</Text>}
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  pad: { padding: spacing.xl },
  thread: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl, gap: spacing.md },
  summary: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  subject: { ...typography.heading, fontSize: 17, color: colors.ink },
  related: { ...typography.caption, color: colors.inkMuted, lineHeight: 18 },
  bubbleRow: { flexDirection: "row" },
  rowMine: { justifyContent: "flex-end" },
  rowTheirs: { justifyContent: "flex-start" },
  bubble: { maxWidth: "86%", padding: spacing.md, borderRadius: radius.lg, gap: 6 },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: 6 },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 6 },
  author: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep, fontSize: 12 },
  body: { ...typography.body, color: colors.ink, fontSize: 14.5, lineHeight: 21 },
  bodyMine: { color: colors.onPrimary },
  time: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  timeMine: { color: "rgba(255,255,255,0.75)" },
  attachments: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  attachment: { width: 96, height: 96, borderRadius: radius.md, overflow: "hidden", backgroundColor: colors.surfaceMuted, alignItems: "center", justifyContent: "center" },
  attachmentImage: { width: "100%", height: "100%" },
  attachmentText: { ...typography.caption, color: colors.inkSoft },
  notice: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  noticeText: { ...typography.caption, color: colors.inkMuted, lineHeight: 19, fontSize: 13.5 },
  reopen: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" },
  reopenText: { ...typography.bodyMedium, color: colors.primary, fontSize: 14 },
  composer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.canvas },
  pending: { flexDirection: "row", gap: spacing.sm },
  pendingShot: { width: 56, height: 56, borderRadius: radius.sm, overflow: "hidden" },
  pendingImage: { width: "100%", height: "100%" },
  pendingRemove: { position: "absolute", top: 3, right: 3, width: 18, height: 18, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" },
  inputRow: { flexDirection: "row", alignItems: "flex-end", gap: spacing.sm },
  iconButton: { width: 42, height: 42, alignItems: "center", justifyContent: "center" },
  input: {
    ...typography.body, flex: 1, minHeight: 42, maxHeight: 140, paddingHorizontal: spacing.md, paddingTop: 10, paddingBottom: 10,
    borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, color: colors.ink, fontSize: 15,
  },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  sendOff: { opacity: 0.45 },
}));
