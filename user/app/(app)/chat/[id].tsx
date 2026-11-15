import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowDown, Ban, Bell, BellOff, ChevronLeft, Copy, EllipsisVertical, Pencil, UserRound } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import Animated, { FadeIn, FadeOut, ZoomIn, ZoomOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { MessageBubble } from "@/components/ChatBubbles";
import { ChatComposer } from "@/components/ChatComposer";
import { ActionSheet, ChatWallpaper, DayDivider, PeerAvatar, TypingDots, type SheetAction } from "@/components/ChatKit";
import { ErrorState } from "@/components/StateBlocks";
import {
  addToLibrary, blockUser, chatProfile, conversationPeer, editable, editMessage, followConversation, initialsOf, isBlockedFailure, libraryHref,
  loadMessages, markRead, newClientId, peerName, peerReadAt, peerStatus, saveContact, sendMessage, unblockUser, uploadChatFile,
  type ChatMessage, type ChatPeer,
} from "@/lib/chat";
import { chatDay, lastSeen } from "@/lib/chatTime";
import { sendTyping, useTyping } from "@/lib/chatTyping";
import { asErrorMessage } from "@/lib/format";
import { setOpenConversation } from "@/lib/push";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/AuthProvider";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** What a pending message needs to be sent again after a failure. */
type Outbox = { kind: ChatMessage["kind"]; body: string; localUri?: string; mime?: string; extension?: string; media: ChatMessage["media"] };

/** Messages from one person this close together are one run. */
const GROUP_MS = 5 * 60_000;
const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
const together = (a: ChatMessage | undefined, b: ChatMessage | undefined) =>
  Boolean(a && b && a.sender_id === b.sender_id && sameDay(a.created_at, b.created_at)
    && Math.abs(new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) < GROUP_MS);

/**
 * One conversation, as a messenger draws it: the other person at the top with
 * whether they are here or typing; the wallpaper; the messages in runs with
 * the day between them; and the field to write in.
 *
 * Messages arrive live; one's own appear at once and are confirmed by the
 * server (a failed one is tapped to send again); the other side's reading
 * turns one tick into two; a correction made on either side replaces the
 * bubble where it is. Older messages load as the list is scrolled up.
 */
export default function ConversationScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const me = user?.id ?? "";
  const { id, peer: peerParam } = useLocalSearchParams<{ id: string; peer?: string }>();
  const [peer, setPeer] = useState<ChatPeer | null>(null);
  const [status, setStatus] = useState<{ online: boolean; last_seen_at: string | null } | null>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [readAt, setReadAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [older, setOlder] = useState<"idle" | "loading" | "done">("idle");
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [menuFor, setMenuFor] = useState<ChatMessage | null>(null);
  const [chatMenu, setChatMenu] = useState(false);
  const [askBlock, setAskBlock] = useState(false);
  const [away, setAway] = useState(false);
  const [unseen, setUnseen] = useState(0);
  // What was on screen when the conversation opened: only what arrives after rises into place.
  const [initial] = useState(() => new Set<string>());
  const outbox = useRef(new Map<string, Outbox>());
  const awayRef = useRef(false);
  const list = useRef<FlatList<ChatMessage>>(null);
  const typingIn = useTyping(id ? [id] : [], me || null);
  const typing = Boolean(id && typingIn.has(id));

  const loadPeer = useCallback(async () => {
    if (!id || !me) return;
    const next = typeof peerParam === "string" && peerParam ? await chatProfile(peerParam) : await conversationPeer(id, me);
    setPeer(next);
    if (next) setStatus({ online: Boolean(next.online), last_seen_at: next.last_seen_at ?? null });
  }, [id, me, peerParam]);

  // While this conversation is on screen, its own pushes stay quiet.
  useEffect(() => {
    if (!id) return;
    setOpenConversation(id);
    return () => setOpenConversation(null);
  }, [id]);

  useEffect(() => {
    if (!id || !me) return;
    let alive = true;
    void (async () => {
      try {
        const [first, read] = await Promise.all([loadMessages(id), peerReadAt(id, me), loadPeer()]);
        if (!alive) return;
        for (const message of first) initial.add(message.id);
        setMessages(first);
        setReadAt(read);
        if (first.length < 40) setOlder("done");
        void markRead(id);
      } catch (failure) {
        if (alive) setError(asErrorMessage(failure));
      }
    })();
    const channel = followConversation(id, {
      onMessage: (incoming) => {
        setMessages((current) => {
          if (!current) return current;
          if (current.some((message) => message.id === incoming.id)) return current;
          // One's own, coming back: it replaces the bubble already on screen.
          const at = incoming.client_id ? current.findIndex((message) => message.client_id === incoming.client_id && message.pending) : -1;
          if (at >= 0) return current.map((message, index) => (index === at ? { ...incoming, localUri: message.localUri } : message));
          return [incoming, ...current];
        });
        if (incoming.sender_id !== me) {
          void Haptics.selectionAsync();
          void markRead(id);
          if (awayRef.current) setUnseen((count) => count + 1);
        }
      },
      onEdit: (changed) => {
        setMessages((current) => current?.map((message) => (message.id === changed.id ? { ...message, ...changed, localUri: message.localUri } : message)) ?? current);
      },
      onRead: (userId, at) => { if (userId !== me) setReadAt(at); },
    });
    return () => { alive = false; void supabase.removeChannel(channel); };
  }, [id, initial, loadPeer, me]);

  // Whether they are here: asked again every 20 seconds while the conversation is open.
  const peerId = peer?.id;
  const blocked = Boolean(peer?.blocked);
  useEffect(() => {
    if (!peerId || blocked) return;
    const ask = () => void peerStatus(peerId).then(setStatus).catch(() => undefined);
    const timer = setInterval(ask, 20_000);
    return () => clearInterval(timer);
  }, [blocked, peerId]);

  async function loadOlder() {
    if (!id || !messages?.length || older !== "idle") return;
    setOlder("loading");
    try {
      const page = await loadMessages(id, messages[messages.length - 1]!.created_at);
      for (const message of page) initial.add(message.id);
      setMessages((current) => [...(current ?? []), ...page.filter((message) => !current?.some((other) => other.id === message.id))]);
      setOlder(page.length < 40 ? "done" : "idle");
    } catch {
      setOlder("idle");
    }
  }

  /** Puts a message on screen at once, then sends it; uploads its file first when it has one. */
  const send = useCallback(async (clientId: string, item: Outbox) => {
    if (!id || !me) return;
    outbox.current.set(clientId, item);
    const shown: ChatMessage = {
      id: `local-${clientId}`, conversation_id: id, sender_id: me, kind: item.kind, body: item.body, media_path: null,
      media: item.media, share: null, client_id: clientId, created_at: new Date().toISOString(), pending: "sending", localUri: item.localUri,
    };
    setMessages((current) => {
      const rest = (current ?? []).filter((message) => message.client_id !== clientId);
      return [shown, ...rest];
    });
    list.current?.scrollToOffset({ offset: 0, animated: true });
    try {
      const mediaPath = item.localUri && item.mime && item.extension
        ? await uploadChatFile(id, me, item.localUri, item.mime, item.extension)
        : null;
      const saved = await sendMessage({ conversationId: id, kind: item.kind, body: item.body, mediaPath, media: item.media, clientId });
      outbox.current.delete(clientId);
      // The confirmed row keeps the bubble's place and does not rise a second time.
      initial.add(saved.id);
      setMessages((current) => (current ?? []).map((message) => (message.client_id === clientId && message.pending ? { ...saved, localUri: item.localUri } : message))
        .filter((message, index, all) => all.findIndex((other) => other.id === message.id) === index));
    } catch (failure) {
      if (isBlockedFailure(failure)) setNotice(t("block.cantSend"));
      setMessages((current) => (current ?? []).map((message) => (message.client_id === clientId && message.pending ? { ...message, pending: "failed" } : message)));
    }
  }, [id, initial, me, t]);

  function retry(message: ChatMessage) {
    const item = message.client_id ? outbox.current.get(message.client_id) : null;
    if (item && message.client_id) void send(message.client_id, item);
  }

  async function pickImage() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 1 });
    const asset = result.canceled ? null : result.assets[0];
    if (!asset) return;
    const long = Math.max(asset.width, asset.height);
    const resize = long > 1600 ? [asset.width >= asset.height ? { resize: { width: 1600 } } : { resize: { height: 1600 } }] : [];
    const small = await ImageManipulator.manipulateAsync(asset.uri, resize, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    void send(newClientId(), { kind: "image", body: "", localUri: small.uri, mime: "image/jpeg", extension: "jpg", media: { width: small.width, height: small.height } });
  }

  async function saveEdit(text: string) {
    const target = editing;
    setEditing(null);
    if (!target || text === target.body) return;
    const before = target.body;
    setMessages((current) => current?.map((message) => (message.id === target.id ? { ...message, body: text, edited_at: new Date().toISOString() } : message)) ?? current);
    try {
      await editMessage(target.id, text);
    } catch (failure) {
      setMessages((current) => current?.map((message) => (message.id === target.id ? { ...message, body: before, edited_at: target.edited_at } : message)) ?? current);
      setNotice(isBlockedFailure(failure) ? t("block.cantSend") : asErrorMessage(failure));
    }
  }

  async function addShared(message: ChatMessage) {
    try {
      const added = await addToLibrary(message.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(t("added"), message.share?.title ?? "", [
        { text: t("profile.close"), style: "cancel" },
        { text: t("open"), onPress: () => router.push(libraryHref(added.kind, added.id) as never) },
      ]);
    } catch (failure) {
      Alert.alert(t("addToLibrary"), asErrorMessage(failure));
    }
  }

  async function setBlocked(on: boolean) {
    if (!peer) return;
    try {
      if (on) await blockUser(peer.id);
      else await unblockUser(peer.id);
      void Haptics.notificationAsync(on ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
      setEditing(null);
      await loadPeer();
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  async function setMuted(muted: boolean) {
    if (!peer || !me) return;
    try {
      await saveContact(me, peer.id, { muted });
      await loadPeer();
    } catch (failure) {
      setNotice(asErrorMessage(failure));
    }
  }

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 3200);
    return () => clearTimeout(timer);
  }, [notice]);

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const next = event.nativeEvent.contentOffset.y > 320;
    if (next !== awayRef.current) {
      awayRef.current = next;
      setAway(next);
      if (!next) setUnseen(0);
    }
  }

  const name = peer ? peerName(peer) : "";
  const subtitle = useMemo(() => {
    if (!peer || blocked) return null;
    if (status?.online) return { kind: "online" as const, text: t("online") };
    if (status?.last_seen_at) return { kind: "seen" as const, text: lastSeen(status.last_seen_at, (key, options) => String(t(key as never, options as never))) };
    return peer.username ? { kind: "seen" as const, text: `@${peer.username}` } : null;
  }, [blocked, peer, status, t]);

  const canEdit = Boolean(menuFor && editable(menuFor, me));
  const messageActions: SheetAction[] = [];
  if (menuFor?.body) {
    const body = menuFor.body;
    messageActions.push({ key: "copy", label: t("copy"), icon: Copy, onPress: () => { void Clipboard.setStringAsync(body).then(() => setNotice(t("copied"))); } });
  }
  if (canEdit && menuFor) {
    const target = menuFor;
    messageActions.push({ key: "edit", label: t("edit"), icon: Pencil, onPress: () => setEditing(target) });
  }
  const chatActions: SheetAction[] = peer ? [
    { key: "profile", label: t("viewProfile"), icon: UserRound,
      onPress: () => router.push({ pathname: "/(app)/chat/profile/[userId]", params: { userId: peer.id, conversation: id } }) },
    peer.muted
      ? { key: "unmute", label: t("profile.unmute"), icon: Bell, onPress: () => void setMuted(false) }
      : { key: "mute", label: t("profile.mute"), icon: BellOff, onPress: () => void setMuted(true) },
    blocked
      ? { key: "unblock", label: t("block.unblock"), icon: Ban, onPress: () => void setBlocked(false) }
      : { key: "block", label: t("block.block"), icon: Ban, destructive: true, onPress: () => setAskBlock(true) },
  ] : [];

  return (
    <View style={styles.safe}>
      <ChatWallpaper />

      <View style={[styles.header, { paddingTop: Math.max(insets.top, 20) + spacing.xs }]}>
        <Pressable accessibilityRole="button" onPress={() => router.back()} hitSlop={8} style={styles.back}>
          <ChevronLeft color={colors.ink} size={27} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          disabled={!peer}
          onPress={() => peer && router.push({ pathname: "/(app)/chat/profile/[userId]", params: { userId: peer.id, conversation: id } })}
          style={styles.who}
        >
          <PeerAvatar uri={peer?.avatar_url} initials={initialsOf(name || "?")} size={42} online={Boolean(status?.online) && !blocked} />
          <View style={{ flex: 1 }}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            {/* Nothing to say under the name (a blocked person): the name sits centred alone. */}
            {(typing && !blocked) || subtitle ? (
              <View style={styles.statusLine}>
                {typing && !blocked ? (
                  <TypingDots label={t("typing")} color={colors.primary} />
                ) : subtitle ? (
                  <Animated.Text key={subtitle.kind} entering={FadeIn.duration(180)} style={[styles.status, subtitle.kind === "online" && styles.statusOnline]} numberOfLines={1}>
                    {subtitle.text}
                  </Animated.Text>
                ) : null}
              </View>
            ) : null}
          </View>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("menu")} disabled={!peer} onPress={() => setChatMenu(true)} hitSlop={8} style={styles.back}>
          <EllipsisVertical color={colors.ink} size={22} />
        </Pressable>
      </View>

      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        {error && !messages ? <ErrorState message={error} /> : null}
        {!messages && !error ? <View style={styles.center}><ActivityIndicator color={colors.primary} /></View> : null}
        {messages ? (
          <FlatList
            ref={list}
            data={messages}
            inverted
            keyExtractor={(message) => message.client_id ?? message.id}
            contentContainerStyle={styles.list}
            onEndReached={() => void loadOlder()}
            onEndReachedThreshold={0.4}
            onScroll={onScroll}
            scrollEventThrottle={64}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyWrap}>
                <View style={styles.emptyCard}><Text style={styles.empty}>{t("noMessages")}</Text></View>
              </View>
            }
            ListFooterComponent={older === "loading" ? <ActivityIndicator color={colors.primary} style={{ margin: spacing.md }} /> : null}
            renderItem={({ item, index }) => {
              const newer = messages[index - 1];
              const previous = messages[index + 1];
              return (
                <View>
                  {!previous || !sameDay(previous.created_at, item.created_at)
                    ? <DayDivider label={chatDay(item.created_at, { today: t("today"), yesterday: t("yesterday") })} />
                    : null}
                  <MessageBubble
                    message={item}
                    mine={item.sender_id === me}
                    read={Boolean(readAt && !item.pending && item.created_at <= readAt)}
                    groupTop={!together(item, previous)}
                    groupEnd={!together(item, newer)}
                    fresh={!initial.has(item.id)}
                    onRetry={retry}
                    onShare={(message) => void addShared(message)}
                    onLongPress={setMenuFor}
                  />
                </View>
              );
            }}
          />
        ) : null}

        {away ? (
          <Animated.View entering={ZoomIn.springify().damping(14)} exiting={ZoomOut.duration(140)} style={styles.downWrap}>
            <Pressable accessibilityLabel={t("scrollDown")} onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} style={styles.down}>
              <ArrowDown color={colors.primary} size={22} />
            </Pressable>
            {unseen > 0 ? <View style={styles.downBadge}><Text style={styles.downBadgeText}>{unseen > 99 ? "99+" : unseen}</Text></View> : null}
          </Animated.View>
        ) : null}
        {notice ? (
          <Animated.View entering={FadeIn.duration(160)} exiting={FadeOut.duration(160)} style={styles.notice}>
            <Text style={styles.noticeText}>{notice}</Text>
          </Animated.View>
        ) : null}

        <View style={{ paddingBottom: insets.bottom, backgroundColor: colors.surface }}>
          {blocked ? (
            <Animated.View entering={FadeIn.duration(200)} style={styles.blockedBar}>
              <Ban color={colors.inkMuted} size={18} />
              <Text style={styles.blockedText}>{t("block.banner")}</Text>
              <Pressable onPress={() => void setBlocked(false)} style={styles.unblock}>
                <Text style={styles.unblockText}>{t("block.unblock")}</Text>
              </Pressable>
            </Animated.View>
          ) : (
            <ChatComposer
              key={editing?.id ?? "compose"}
              initialText={editing?.body}
              editing={editing ? { id: editing.id, body: editing.body } : null}
              onEdit={(text) => void saveEdit(text)}
              onCancelEdit={() => setEditing(null)}
              onTyping={() => { if (id && me) sendTyping(id, me); }}
              onText={(text) => void send(newClientId(), { kind: "text", body: text, media: {} })}
              onImage={() => void pickImage()}
              onVoice={(uri, ms) => void send(newClientId(), { kind: "voice", body: "", localUri: uri, mime: "audio/mp4", extension: "m4a", media: { duration_ms: ms } })}
              onVideo={(uri, ms) => {
                const mov = uri.toLowerCase().endsWith(".mov");
                void send(newClientId(), { kind: "video", body: "", localUri: uri, mime: mov ? "video/quicktime" : "video/mp4", extension: mov ? "mov" : "mp4", media: { duration_ms: ms } });
              }}
              notice={setNotice}
            />
          )}
        </View>
      </KeyboardAvoidingView>

      {/* A message, pressed and held: what can be done with it. */}
      <ActionSheet
        visible={menuFor !== null && messageActions.length > 0}
        onClose={() => setMenuFor(null)}
        cancelLabel={t("cancel")}
        header={menuFor?.body ? <View style={styles.quote}><Text style={styles.quoteText} numberOfLines={3}>{menuFor.body}</Text></View> : undefined}
        actions={messageActions}
      />

      {/* The conversation's own menu. */}
      <ActionSheet visible={chatMenu} onClose={() => setChatMenu(false)} cancelLabel={t("cancel")} title={name} actions={chatActions} />

      <ActionSheet
        visible={askBlock}
        onClose={() => setAskBlock(false)}
        cancelLabel={t("cancel")}
        title={t("block.confirmTitle", { name })}
        message={t("block.confirmBody")}
        actions={[{ key: "block", label: t("block.block"), icon: Ban, destructive: true, onPress: () => void setBlocked(true) }]}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: spacing.xs, paddingBottom: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border, zIndex: 2,
    shadowColor: "#2A0F55", shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 2,
  },
  back: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21 },
  who: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  name: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 17, lineHeight: 22, color: colors.ink },
  statusLine: { height: 18, justifyContent: "center" },
  status: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 13, color: colors.inkMuted },
  statusOnline: { color: colors.primary, fontFamily: "JaxongirmanSans_600SemiBold" },
  list: { paddingVertical: spacing.sm, flexGrow: 1 },
  emptyWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, transform: [{ scaleY: -1 }] },
  emptyCard: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.lg, backgroundColor: "rgba(40,22,80,0.32)" },
  empty: { ...typography.bodyMedium, color: "#FFFFFF", textAlign: "center" },
  downWrap: { position: "absolute", right: spacing.md, bottom: 90 },
  down: {
    width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface,
    shadowColor: "#2A0F55", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  downBadge: {
    position: "absolute", top: -6, right: -2, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10,
    alignItems: "center", justifyContent: "center", backgroundColor: colors.primary,
  },
  downBadgeText: { fontFamily: "JaxongirmanSans_800ExtraBold", fontSize: 11, color: colors.onPrimary },
  notice: {
    position: "absolute", left: spacing.xl, right: spacing.xl, bottom: 96, padding: spacing.md, borderRadius: radius.md,
    backgroundColor: colors.ink, alignItems: "center",
  },
  noticeText: { ...typography.caption, color: colors.canvas },
  blockedBar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, minHeight: 58, borderTopWidth: 1, borderTopColor: colors.border },
  blockedText: { ...typography.caption, fontSize: 13, color: colors.inkMuted, flex: 1 },
  unblock: { paddingHorizontal: spacing.md, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  unblockText: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primaryDeep },
  quote: { marginHorizontal: spacing.sm, padding: spacing.md, borderRadius: 16, backgroundColor: colors.surface, borderLeftWidth: 3, borderLeftColor: colors.primary },
  quoteText: { ...typography.body, color: colors.ink },
}));
