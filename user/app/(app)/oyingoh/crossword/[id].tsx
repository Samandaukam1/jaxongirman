import { crosswordCells, wordCells, type Crossword } from "@jaxongirman/types";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Haptics from "expo-haptics";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCheck, Eraser, Eye, PartyPopper } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CrosswordClueBar, CrosswordClueList, CrosswordGrid, CrosswordKeyboard, useCrosswordSolver } from "@/components/Crossword";
import { ScreenHeader } from "@/components/ScreenHeader";
import { ErrorState } from "@/components/StateBlocks";
import { crosswordLanguage, loadCrossword } from "@/lib/crossword";
import { asErrorMessage } from "@/lib/format";
import { supabase } from "@/lib/supabase";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** Where a half-solved grid waits for its solver, on this device. */
const storageKey = (id: string) => `crossword:letters:${id}`;

type Loaded = { crossword: Crossword; title: string; language: ReturnType<typeof crosswordLanguage> };

/**
 * Solving a crossword alone. The letters stay on the device between visits;
 * right words turn green as they are finished, "Tekshirish" marks wrong cells,
 * and "Javoblar" fills the grid in.
 */
export default function SolveCrosswordScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["games", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      setError(null);
      const [{ data: game, error: gameError }, puzzle] = await Promise.all([
        supabase.from("games").select("title, language").eq("id", id).single(),
        loadCrossword(id),
      ]);
      if (gameError) throw gameError;
      if (!puzzle) throw new Error(t("editor.notFound"));
      setLoaded({ crossword: puzzle.crossword, title: game.title, language: crosswordLanguage(game.language) });
    } catch (failure) {
      setError(asErrorMessage(failure));
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);

  if (error) {
    return (
      <View style={styles.safe}>
        <ScreenHeader title={t("crossword.badge")} onLeave={() => router.back()} />
        <ErrorState message={error} onRetry={() => void load()} />
      </View>
    );
  }
  if (!loaded || !id) {
    return <View style={[styles.safe, styles.center]}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }
  return <Solver id={id} loaded={loaded} bottom={insets.bottom} />;
}

function Solver({ id, loaded, bottom }: { id: string; loaded: Loaded; bottom: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["games", "common"]);
  const router = useRouter();
  const { crossword } = loaded;
  const [letters, setLetters] = useState<Record<string, string>>({});
  const [wrong, setWrong] = useState<Set<string>>(new Set());
  const [reveal, setReveal] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const cells = useMemo(() => crosswordCells(crossword), [crossword]);

  useEffect(() => {
    void AsyncStorage.getItem(storageKey(id)).then((saved) => {
      if (!saved) return;
      try {
        const parsed = JSON.parse(saved) as Record<string, string>;
        if (parsed && typeof parsed === "object") setLetters(parsed);
      } catch {
        // A broken save is an empty grid.
      }
    }).catch(() => undefined);
  }, [id]);

  const change = useCallback((next: Record<string, string>) => {
    setLetters(next);
    setWrong(new Set());
    setNote(null);
    void AsyncStorage.setItem(storageKey(id), JSON.stringify(next)).catch(() => undefined);
  }, [id]);

  const solver = useCrosswordSolver(crossword, letters, change, reveal);

  const solved = useMemo(() => new Set(crossword.words
    .filter((word) => wordCells(word).every(([row, col], at) => letters[`${row},${col}`] === Array.from(word.answer ?? "")[at]))
    .map((word) => word.id)), [crossword.words, letters]);
  const complete = solved.size === crossword.words.length;

  useEffect(() => {
    if (complete) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }, [complete]);

  function check() {
    const marked = new Set([...cells.values()]
      .filter((cell) => letters[`${cell.row},${cell.col}`] && letters[`${cell.row},${cell.col}`] !== cell.letter)
      .map((cell) => `${cell.row},${cell.col}`));
    setWrong(marked);
    setNote(marked.size ? t("crossword.mistakes", { count: marked.size }) : t("crossword.noMistakes"));
    void Haptics.notificationAsync(marked.size ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success);
  }

  function showAnswers() {
    Alert.alert(t("crossword.reveal"), t("crossword.revealConfirm"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("crossword.reveal"), onPress: () => { setReveal(true); setWrong(new Set()); setNote(null); } },
    ]);
  }

  function clear() {
    Alert.alert(t("crossword.clear"), t("crossword.clearConfirm"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("crossword.clear"), style: "destructive", onPress: () => { change({}); setReveal(false); } },
    ]);
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title={loaded.title}
        subtitle={t("crossword.progress", { solved: solved.size, total: crossword.words.length })}
        onLeave={() => router.back()}
      />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <CrosswordGrid solver={solver} letters={letters} solved={solved} wrong={wrong} reveal={reveal} />
        {complete ? (
          <View style={styles.done}>
            <PartyPopper color={colors.success} size={icon.lg} />
            <Text style={styles.doneText}>{t("crossword.solved")}</Text>
          </View>
        ) : note ? <Text style={[styles.note, wrong.size > 0 && styles.noteBad]}>{note}</Text> : null}
        <View style={styles.tools}>
          <Tool icon={CheckCheck} label={t("crossword.check")} onPress={check} disabled={reveal} />
          <Tool icon={Eye} label={t("crossword.reveal")} onPress={showAnswers} disabled={reveal} />
          <Tool icon={Eraser} label={t("crossword.clear")} onPress={clear} />
        </View>
        <CrosswordClueList solver={solver} solved={solved} />
      </ScrollView>
      <View style={[styles.dock, { paddingBottom: Math.max(bottom, spacing.md) }]}>
        <CrosswordClueBar solver={solver} />
        <CrosswordKeyboard solver={solver} language={loaded.language} disabled={reveal || complete} />
      </View>
    </View>
  );
}

function Tool({ icon: Icon, label, onPress, disabled }: { icon: typeof Eye; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress} style={({ pressed }) => [styles.tool, pressed && styles.toolPressed, disabled && styles.toolDisabled]}>
      <Icon color={colors.primaryDeep} size={icon.sm} />
      <Text style={styles.toolText}>{label}</Text>
    </Pressable>
  );
}

const useStyles = makeStyles((colors) => ({
  safe: { flex: 1, backgroundColor: colors.canvas },
  center: { alignItems: "center", justifyContent: "center" },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  tools: { flexDirection: "row", gap: spacing.sm, justifyContent: "center", flexWrap: "wrap" },
  tool: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  toolPressed: { backgroundColor: colors.primarySoft },
  toolDisabled: { opacity: 0.45 },
  toolText: { ...typography.caption, color: colors.primaryDeep, fontFamily: "JaxongirmanSans_700Bold" },
  note: { ...typography.caption, color: colors.success, textAlign: "center" },
  noteBad: { color: colors.danger },
  done: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, alignSelf: "center",
    paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.successSoft,
  },
  doneText: { ...typography.bodyMedium, color: colors.success },
  dock: {
    gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    backgroundColor: colors.surfaceMuted, borderTopWidth: 1, borderTopColor: colors.border,
  },
}));
