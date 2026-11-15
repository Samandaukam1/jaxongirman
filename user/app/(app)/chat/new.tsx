import { useRouter } from "expo-router";
import { MessageCirclePlus, Search, UserSearch } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

import { Avatar } from "@/components/Avatar";
import { ScreenHeader } from "@/components/ScreenHeader";
import { InlineError } from "@/components/StateBlocks";
import { initialsOf, openDirect, searchPeople } from "@/lib/chat";
import { asErrorMessage } from "@/lib/format";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Person = Awaited<ReturnType<typeof searchPeople>>[number];

/** A new conversation: find someone by their handle, then talk. */
export default function NewChatScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("chat");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);

  useEffect(() => {
    const term = query.trim();
    if (term.replace(/^@/, "").length < 2) { setPeople([]); return; }
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPeople(term).then((found) => { setPeople(found); setError(null); })
        .catch((failure) => setError(asErrorMessage(failure)))
        .finally(() => setSearching(false));
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);

  async function open(person: Person) {
    setOpening(person.id);
    try {
      const id = await openDirect(person.id);
      router.replace({ pathname: "/(app)/chat/[id]", params: { id, peer: person.id } });
    } catch (failure) {
      setError(asErrorMessage(failure));
      setOpening(null);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title={t("newChat")} subtitle={t("title")} onLeave={() => router.back()} />
      <View style={styles.search}>
        <Search color={colors.inkSoft} size={18} />
        <TextInput
          style={styles.input}
          value={query}
          onChangeText={setQuery}
          placeholder={t("findPlaceholder")}
          placeholderTextColor={colors.inkSoft}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
        {searching ? <ActivityIndicator color={colors.primary} size="small" /> : null}
      </View>
      {error ? <View style={{ paddingHorizontal: spacing.xl }}><InlineError message={error} /></View> : null}
      <FlatList
        data={people}
        keyExtractor={(person) => person.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          <Animated.View entering={FadeIn.duration(260)} style={styles.emptyBox}>
            <View style={styles.emptyIcon}><UserSearch color={colors.primary} size={28} strokeWidth={2} /></View>
            <Text style={styles.hint}>{query.trim().replace(/^@/, "").length < 2 ? t("findHint") : searching ? "" : t("noResults")}</Text>
          </Animated.View>
        }
        renderItem={({ item, index }) => {
          const name = item.full_name?.trim() || `@${item.username}`;
          return (
            <Animated.View entering={FadeInDown.delay(Math.min(index, 8) * 40).duration(300)}>
              <Pressable disabled={opening !== null} onPress={() => void open(item)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.surfaceMuted }]}>
                <Avatar uri={item.avatar_url} initials={initialsOf(name)} size={50} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>{name}</Text>
                  <Text style={styles.handle}>@{item.username}</Text>
                </View>
                {opening === item.id ? <ActivityIndicator color={colors.primary} /> : <MessageCirclePlus color={colors.primary} size={22} strokeWidth={2} />}
              </Pressable>
            </Animated.View>
          );
        }}
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
  hint: { ...typography.caption, fontSize: 13.5, color: colors.inkMuted, textAlign: "center", paddingHorizontal: spacing.xl },
  emptyBox: { alignItems: "center", gap: spacing.md, paddingTop: spacing.xxl },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.xl, paddingVertical: spacing.md },
  name: { ...typography.bodyMedium, color: colors.ink },
  handle: { ...typography.caption, color: colors.primary },
}));
