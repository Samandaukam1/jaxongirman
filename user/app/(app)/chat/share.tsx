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
import { haptic } from "@/lib/haptics";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Target = { userId: string; name: string; handle: string | null; avatar: string | null; conversation?: string };

/** The kinds a chat can carry as a card. */
const KINDS: readonly ChatShare["kind"][] = ["presentation", "game", "academic"];

/** A route parameter repeated in an address arrives as a list; the first is the one meant. */
const one = (value: string | string[] | undefined): string | undefined => (Array.isArray(value) ? value[0] : value);

/**
 * What arrived to be sent, whichever way it came: one work as `kind`, `id`
 * and `title` (a row's paper plane, a detail screen), or several as `items`, a
 * JSON list in the order they were chosen (a selection on Loyihalar or
 * O‘yingoh). Anything malformed, repeated or of a kind a chat cannot carry is
 * dropped here and counted, so the screen says so up front rather than the
 * server refusing it halfway down the list.
 */
function readItems(params: { kind?: string; id?: string; title?: string; items?: string }): { items: ChatShare[]; dropped: number } {
  const raw: unknown[] = [];
  if (params.items) {
    try {
      const parsed: unknown = JSON.parse(params.items);
      if (Array.isArray(parsed)) raw.push(...parsed);
    } catch {
      // An address edited by hand: nothing in it can be trusted, so nothing in it is sent.
    }
  } else if (params.kind || params.id) {
    raw.push({ kind: params.kind, id: params.id, title: params.title });
  }
  const items: ChatShare[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    const { kind, id, title } = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    if (typeof id !== "string" || !id || !KINDS.includes(kind as ChatShare["kind"])) continue;
    const key = `${String(kind)}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({ kind: kind as ChatShare["kind"], id, title: typeof title === "string" ? title : "" });
  }
  return { items, dropped: raw.length - items.length };
}

/**
 * Sending decks, games or scientific works to someone: recent chats first,
 * anyone else by their handle. Each thing goes as a card the other side can
 * add to their own library — one card per work, sent one after another in the
 * order they were chosen, so the chat reads in that order too.
 */
export default function ShareToChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const params = useLocalSearchParams<{ kind?: string; id?: string; title?: string; items?: string; skipped?: string }>();
  const kind = one(params.kind);
  const id = one(params.id);
  const title = one(params.title);
  const list = one(params.items);
  const { items, dropped } = useMemo(() => readItems({ kind, id, title, items: list }), [id, kind, list, title]);
  // Left behind by the screen that sent us here (unfinished, or a kind a chat cannot carry), plus whatever was dropped above.
  const skipped = dropped + Math.max(0, Number.parseInt(one(params.skipped) ?? "", 10) || 0);
  const several = items.length > 1;
  const [recent, setRecent] = useState<Target[]>([]);
  const [found, setFound] = useState<Target[]>([]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  // How many of the items have gone to the chat being sent to, for a list of several.
  const [progress, setProgress] = useState(0);
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

  /**
   * One after another, never in parallel: each card lands after the one
   * before it, and one the server refuses (a game unmarked as ready since it
   * was chosen, say) does not stop the rest. What failed is listed by name.
   */
  async function send(target: Target) {
    if (items.length === 0 || busy !== null) return;
    setBusy(target.userId);
    setError(null);
    setProgress(0);
    let conversation: string;
    try {
      conversation = target.conversation ?? await openDirect(target.userId);
    } catch (failure) {
      setError(asErrorMessage(failure));
      setBusy(null);
      return;
    }
    const failed: { title: string; message: string }[] = [];
    for (const [index, item] of items.entries()) {
      try {
        await sendMessage({ conversationId: conversation, kind: "share", share: { kind: item.kind, id: item.id }, clientId: newClientId() });
      } catch (failure) {
        failed.push({ title: item.title, message: asErrorMessage(failure) });
      }
      setProgress(index + 1);
    }
    setBusy(null);
    const sent = items.length - failed.length;
    if (sent > 0) {
      haptic.success();
      setDone(several ? t("shareSentMany", { count: sent, name: target.name }) : t("shareSent", { name: target.name }));
    }
    if (failed.length > 0) {
      setError(several
        ? [t("shareFailedMany", { count: failed.length }), ...failed.map((entry) => `• ${entry.title || "—"}: ${entry.message}`)].join("\n")
        : failed[0]?.message ?? "");
      return;
    }
    setTimeout(() => router.back(), 900);
  }

  const subtitle = several ? t("shareItems", { count: items.length }) : items[0]?.title ?? title ?? "";

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("shareTo")} subtitle={subtitle} onLeave={() => router.back()} />
      <View style={styles.search}>
        <Search color={colors.inkSoft} size={18} />
        <TextInput style={styles.input} value={query} onChangeText={setQuery} placeholder={t("findPlaceholder")} placeholderTextColor={colors.inkSoft} autoCapitalize="none" autoCorrect={false} />
      </View>
      {/* Several at once: what is going, by name, so the person can check before picking a chat. */}
      {several ? <Text style={styles.note} numberOfLines={2}>{items.map((item) => item.title).filter(Boolean).join(" · ")}</Text> : null}
      {skipped > 0 && items.length > 0 ? <Text style={styles.note}>{t("shareSkipped", { count: skipped })}</Text> : null}
      {items.length === 0 ? <Text style={styles.note}>{t("shareNothing")}</Text> : null}
      {done ? <Text style={styles.done}>{done}</Text> : null}
      {error ? <View style={{ paddingHorizontal: spacing.xl }}><InlineError message={error} /></View> : null}
      <FlatList
        data={shown}
        keyExtractor={(target) => target.userId}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={<Text style={styles.hint}>{t("findHint")}</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            disabled={busy !== null || done !== null || items.length === 0}
            onPress={() => void send(item)}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}
          >
            <Avatar uri={item.avatar} initials={initialsOf(item.name)} size={48} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              {item.handle ? <Text style={styles.handle}>@{item.handle}</Text> : null}
            </View>
            {busy === item.userId ? (
              <View style={styles.progress}>
                {several ? <Text style={styles.count}>{progress}/{items.length}</Text> : null}
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : null}
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
  note: { ...typography.caption, color: colors.inkMuted, paddingHorizontal: spacing.xl, marginTop: -spacing.sm, paddingBottom: spacing.md },
  done: { ...typography.bodyMedium, color: colors.success, textAlign: "center", paddingBottom: spacing.sm },
  hint: { ...typography.caption, color: colors.inkMuted, textAlign: "center", padding: spacing.xl },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  name: { ...typography.bodyMedium, color: colors.ink },
  handle: { ...typography.caption, color: colors.primary },
  progress: { flexDirection: "row", alignItems: "center", gap: 6 },
  count: { ...typography.caption, color: colors.primary },
}));
