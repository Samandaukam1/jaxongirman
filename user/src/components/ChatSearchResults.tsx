import { useRouter } from "expo-router";
import { Search } from "lucide-react-native";
import { useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Keyboard, Pressable, SectionList, Text, View } from "react-native";

import { Avatar } from "@/components/Avatar";
import { PeerAvatar } from "@/components/ChatKit";
import { EmptyState, InlineError } from "@/components/StateBlocks";
import { initialsOf, openDirect, peerName, type ChatListItem } from "@/lib/chat";
import { excerpt, splitMatch, type ChatSearch, type FoundMessage, type FoundPerson } from "@/lib/chatSearch";
import { chatListTime } from "@/lib/chatTime";
import { asErrorMessage } from "@/lib/format";
import { spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Row =
  | { type: "chat"; key: string; chat: ChatListItem }
  | { type: "person"; key: string; person: FoundPerson }
  | { type: "message"; key: string; message: FoundMessage };

type Section = { key: string; title: string; data: Row[] };

/** When a message was asked for: the conversation tells the same message asked for twice apart by it. */
const askedNow = () => String(Date.now());

/**
 * What the chat tab's search found, in three groups: one's own chats, people
 * across the app, then messages. A chat row is drawn by the tab itself, so a
 * conversation looks the same found as listed; a person opens their direct
 * chat (made the first time, as the new-chat screen made it); a message opens
 * its conversation at that message.
 */
export function ChatSearchResults({ query, search, chats, me, bottom, renderChat }: {
  query: string;
  search: ChatSearch;
  /** Every conversation, for the name and picture beside a message found. */
  chats: readonly ChatListItem[];
  me: string | null;
  /** Room kept under the last row for the tab bar. */
  bottom: number;
  renderChat: (chat: ChatListItem) => ReactElement;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["chat", "common"]);
  const router = useRouter();
  const [opening, setOpening] = useState<string | null>(null);
  const [openFailed, setOpenFailed] = useState<string | null>(null);

  const chatById = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats]);

  const sections = useMemo(() => {
    const groups: Section[] = [
      { key: "chats", title: t("search.chats"), data: search.chats.map((chat): Row => ({ type: "chat", key: `c:${chat.id}`, chat })) },
      { key: "people", title: t("search.people"), data: search.people.map((person): Row => ({ type: "person", key: `p:${person.id}`, person })) },
      { key: "messages", title: t("search.messages"), data: search.messages.map((message): Row => ({ type: "message", key: `m:${message.id}`, message })) },
    ];
    // An empty group says nothing; with every group empty, the list's own empty state speaks.
    return groups.filter((group) => group.data.length > 0);
  }, [search.chats, search.messages, search.people, t]);

  async function openPerson(person: FoundPerson) {
    Keyboard.dismiss();
    setOpening(person.id);
    setOpenFailed(null);
    try {
      const id = await openDirect(person.id);
      router.push({ pathname: "/(app)/chat/[id]", params: { id, peer: person.id } });
    } catch (failure) {
      setOpenFailed(asErrorMessage(failure));
    } finally {
      setOpening(null);
    }
  }

  function openMessage(message: FoundMessage) {
    Keyboard.dismiss();
    const peer = message.peer_id ?? chatById.get(message.conversation_id)?.peer.id;
    // `focus` brings the conversation to that message; `at` makes the same message asked for twice count twice.
    router.push({
      pathname: "/(app)/chat/[id]",
      params: { id: message.conversation_id, ...(peer ? { peer } : {}), focus: message.id, at: askedNow() },
    });
  }

  function renderPerson(person: FoundPerson) {
    const name = person.full_name?.trim() || `@${person.username}`;
    return (
      <Pressable
        accessibilityRole="button"
        disabled={opening !== null}
        onPress={() => void openPerson(person)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
      >
        <Avatar uri={person.avatar_url} initials={initialsOf(name)} size={56} />
        <View style={styles.rowBody}>
          <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
          <Text style={styles.handle} numberOfLines={1}>@{person.username}</Text>
        </View>
        {opening === person.id ? <ActivityIndicator color={colors.primary} /> : null}
      </Pressable>
    );
  }

  function renderMessage(message: FoundMessage) {
    const chat = chatById.get(message.conversation_id);
    const name = chat ? peerName(chat.peer) : "—";
    const text = excerpt(message.body, query);
    const parts = splitMatch(text, query);
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => openMessage(message)}
        style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
      >
        <PeerAvatar uri={chat?.peer.avatar_url} initials={initialsOf(name)} size={56} />
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={styles.rowName} numberOfLines={1}>{name}</Text>
            <Text style={styles.rowTime}>{chatListTime(message.created_at)}</Text>
          </View>
          <Text style={styles.preview} numberOfLines={1}>
            {message.sender_id && message.sender_id === me ? t("you") : ""}
            {parts ? <>{parts[0]}<Text style={styles.match}>{parts[1]}</Text>{parts[2]}</> : text}
          </Text>
        </View>
      </Pressable>
    );
  }

  const failure = openFailed ?? search.error;

  return (
    <SectionList<Row, Section>
      sections={sections}
      keyExtractor={(row) => row.key}
      stickySectionHeadersEnabled={false}
      // A tap on a result lands with the keyboard still up; a drag puts it away.
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentContainerStyle={{ paddingBottom: bottom + spacing.xl, flexGrow: 1 }}
      ListHeaderComponent={failure ? (
        <View style={styles.failure}>
          <View style={{ flex: 1 }}><InlineError message={openFailed ? failure : `${t("search.failed")} ${failure}`} /></View>
          {!openFailed ? (
            <Pressable accessibilityRole="button" onPress={search.retry} hitSlop={8}>
              <Text style={styles.retry}>{t("common:retry")}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      ListEmptyComponent={search.searching || search.error ? null : (
        <View style={{ padding: spacing.xl }}>
          <EmptyState
            icon={Search}
            title={t("search.none")}
            message={search.asks ? t("search.noneBody", { query: query.trim() }) : t("search.hint")}
          />
        </View>
      )}
      renderSectionHeader={({ section }) => <Text style={styles.section} accessibilityRole="header">{section.title}</Text>}
      renderItem={({ item }) => (item.type === "chat" ? renderChat(item.chat)
        : item.type === "person" ? renderPerson(item.person)
        : renderMessage(item.message))}
      ItemSeparatorComponent={Separator}
    />
  );
}

function Separator() {
  const styles = useStyles();
  return <View style={styles.separator} />;
}

const useStyles = makeStyles((colors) => ({
  section: {
    ...typography.caption, fontFamily: "JaxongirmanSans_600SemiBold", fontSize: 13, color: colors.inkSoft,
    paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs,
  },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: 10 },
  rowBody: { flex: 1, gap: 3 },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 5 },
  rowName: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 16.5, lineHeight: 22, color: colors.ink, flex: 1 },
  rowTime: { ...typography.caption, fontSize: 12.5, color: colors.inkSoft },
  handle: { fontFamily: "JaxongirmanSans_500Medium", fontSize: 14.5, lineHeight: 20, color: colors.primary },
  preview: { fontFamily: "JaxongirmanSans_400Regular", fontSize: 14.5, lineHeight: 20, color: colors.inkMuted },
  match: { fontFamily: "JaxongirmanSans_600SemiBold", color: colors.ink },
  separator: { height: 1, marginLeft: 84, backgroundColor: colors.border },
  failure: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  retry: { ...typography.bodyMedium, color: colors.primary },
}));
