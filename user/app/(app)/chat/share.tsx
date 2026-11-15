import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { initialsOf, listChats, newClientId, openDirect, peerName, searchPeople, sendMessage, type ChatShare } from "@/lib/chat";
import { asErrorMessage } from "@/lib/format";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Target = { userId: string; name: string; handle: string | null; avatar: string | null; conversation?: string };

/**
 * Sending a deck, a game or a scientific work to someone: recent chats first,
 * anyone else by their handle. The thing goes as a card the other side can
 * add to their own library.
 */
export default function ShareToChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const { kind, id, title } = useLocalSearchParams<{ kind: ChatShare["kind"]; id: string; title?: string }>();
  const [recent, setRecent] = useState<Target[]>([]);
  const [found, setFound] = useState<Target[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    void listChats().then((chats) => setRecent(chats.map((chat) => ({
      userId: chat.peer.id, name: peerName(chat.peer), handle: chat.peer.username, avatar: chat.peer.avatar_url, conversation: chat.id,
    })))).catch((failure) => setError(asErrorMessage(failure)));
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (term.replace(/^@/, "").length < 2) { setFound([]); return; }
    const timer = setTimeout(() => {
      void searchPeople(term).then((people) => setFound(people.map((person) => ({
        userId: person.id, name: person.full_name?.trim() || `@${person.username}`, handle: person.username, avatar: person.avatar_url,
      })))).catch(() => undefined);
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  const shown = useMemo(() => {
    const term = query.trim().toLowerCase().replace(/^@/, "");
    const matching = term ? recent.filter((target) => `${target.name} ${target.handle ?? ""}`.toLowerCase().includes(term)) : recent;
    const known = new Set(matching.map((target) => target.userId));
    return [...matching, ...found.filter((target) => !known.has(target.userId))];
  }, [found, query, recent]);

  async function send(target: Target) {
    if (!kind || !id) return;
    setBusy(target.userId);
    setError(null);
    try {
      const conversation = target.conversation ?? await openDirect(target.userId);
      await sendMessage({ conversationId: conversation, kind: "share", share: { kind, id }, clientId: newClientId() });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDone(t("shareSent", { name: target.name }));
      setTimeout(() => router.back(), 900);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(null);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("shareTo")} subtitle={title ?? ""} onLeave={() => router.back()} />
      <View style={styles.search}>
        <Search color={colors.inkSoft} size={18} />
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t("findPlaceholder")} placeholderTextColor={colors.inkSoft} autoCapitalize="none" autoCorrect={false} />
      </View>
      {done ? <Text style={styles.done}>{done}</Text> : null}
      {error ? <View style={{ paddingHorizontal: spacing.xl }}><InlineError message={error} /></View> : null}
      <FlatList
        data={shown}
        keyExtractor={(target) => target.userId}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.hint}>{t("findHint")}</Text>}
        renderItem={({ item }) => (
          <Pressable disabled={busy !== null || done !== null} onPress={() => void send(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}>
            <Avatar uri={item.avatar} initials={initialsOf(item.name)} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              {item.handle ? <Text style={styles.handle}>@{item.handle}</Text> : null}
            </View>
            {busy === item.userId ? <ActivityIndicator color={colors.primary} /> : null}
          </Pressable>
        )}
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  search: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, margin: spacing.xl, marginTop: spacing.md,
    paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, height: 48,
  },
  input: { flex: 1, ...typography.body, color: colors.ink, paddingVertical: 0 },
  done: { ...typography.bodyMedium, color: colors.success, textAlign: "center", paddingBottom: spacing.sm },
  hint: { ...typography.caption, color: colors.inkMuted, textAlign: "center", padding: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  name: { ...typography.bodyMedium, color: colors.ink },
  handle: { ...typography.caption, color: colors.primary },
}));
