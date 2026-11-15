import {
  filledWords, lettersFromWords, readCrossword, type Crossword, type CrosswordLanguage,
} from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { CheckCircle2, Clock, Flag } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, ScrollView, Text, View } from "react-native";

import { CrosswordClueBar, CrosswordClueList, CrosswordGrid, CrosswordKeyboard, useCrosswordSolver } from "@/components/Crossword";
import { PrimaryButton } from "@/components/PrimaryButton";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import { submitAnswer, type PlayerState } from "@/lib/games";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/** How long typing rests before the words go to the server. */
const SEND_AFTER_MS = 700;

/**
 * A crossword in a match: everyone in the room solves the same grid at once.
 *
 * Whole words are sent as they are finished — never single letters — and the
 * answer says which of them are right, so those turn green and the board's
 * race moves. "Tugatdim" hands the grid in; a grid with every word right is
 * handed in by itself.
 */
export function CrosswordMatch({ sessionId, state, language, remaining, bottom }: {
  sessionId: string;
  state: PlayerState;
  language: CrosswordLanguage;
  remaining: number;
  bottom: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["play", "games", "common"]);
  const crossword = useMemo(() => readCrossword(state.question?.config) as Crossword | null, [state.question?.config]);
  const [letters, setLetters] = useState<Record<string, string>>(() =>
    crossword && state.progress ? lettersFromWords(crossword, state.progress.words) : {});
  const [solved, setSolved] = useState<Set<string>>(() => new Set(state.progress?.solved_ids ?? []));
  const [locked, setLocked] = useState(Boolean(state.answered));
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const lastSent = useRef(JSON.stringify(state.progress?.words ?? {}));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (state.answered) setLocked(true); }, [state.answered]);

  const send = useCallback(async (next: Record<string, string>, done: boolean) => {
    if (!crossword) return;
    const words = filledWords(crossword, next);
    const body = JSON.stringify(words);
    if (!done && body === lastSent.current) return;
    setSending(true);
    try {
      const answer = await submitAnswer(sessionId, state.current_index, { words, ...(done ? { done: true } : {}) });
      lastSent.current = body;
      const right = new Set(answer.solved_ids ?? []);
      setSolved((before) => {
        if (right.size > before.size) void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return right;
      });
      if (answer.locked) setLocked(true);
      setError(null);
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setSending(false);
    }
  }, [crossword, sessionId, state.current_index]);

  const change = useCallback((next: Record<string, string>) => {
    setLetters(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void send(next, false); }, SEND_AFTER_MS);
  }, [send]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const solver = useCrosswordSolver(crossword ?? { width: 1, height: 1, words: [] }, letters, change, locked);

  function finish() {
    Alert.alert(t("crossword.finish"), t("crossword.finishConfirm"), [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("crossword.finish"), onPress: () => {
        if (timer.current) clearTimeout(timer.current);
        void send(letters, true);
      } },
    ]);
  }

  if (!crossword) return null;
  const total = crossword.words.length;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.meta}>
          <Text style={styles.progress}>{t("crossword.solvedWords", { solved: solved.size, total })}</Text>
          <View style={styles.timer}>
            <Clock color={remaining <= 30 ? colors.danger : colors.primaryDeep} size={icon.sm} />
            <Text style={[styles.timerText, remaining <= 30 && { color: colors.danger }]}>
              {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
            </Text>
          </View>
        </View>
        <CrosswordGrid solver={solver} letters={letters} solved={solved} />
        {locked ? (
          <View style={styles.locked}>
            <CheckCircle2 color={colors.success} size={icon.lg} />
            <Text style={styles.lockedText}>{solved.size === total ? t("crossword.perfect") : t("crossword.finished")}</Text>
          </View>
        ) : null}
        {error ? <InlineError message={error} /> : null}
        <CrosswordClueList solver={solver} solved={solved} />
      </ScrollView>
      {locked ? null : (
        <View style={[styles.dock, { paddingBottom: Math.max(bottom, spacing.md) }]}>
          <CrosswordClueBar solver={solver} />
          <CrosswordKeyboard solver={solver} language={language} />
          <PrimaryButton label={t("crossword.finish")} icon={Flag} tone="secondary" loading={sending} onPress={finish} />
        </View>
      )}
    </View>
  );
}

/** The grid after the time: every answer in, the player's own right words green. */
export function CrosswordReveal({ config, mine }: { config: unknown; mine: string[] }) {
  const styles = useStyles();
  const { t } = useTranslation("play");
  const crossword = useMemo(() => readCrossword(config), [config]);
  const solved = useMemo(() => new Set(mine), [mine]);
  const solver = useCrosswordSolver(crossword ?? { width: 1, height: 1, words: [] }, {}, () => undefined, true);
  if (!crossword) return null;
  return (
    <View style={{ gap: spacing.lg }}>
      <Text style={styles.progress}>{t("crossword.solvedWords", { solved: solved.size, total: crossword.words.length })}</Text>
      <CrosswordGrid solver={solver} letters={{}} solved={solved} reveal quiet />
      <Text style={styles.answersTitle}>{t("crossword.answers")}</Text>
      <CrosswordClueList solver={solver} solved={solved} showAnswers />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl },
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  progress: { ...typography.bodyMedium, color: colors.ink },
  timer: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft,
  },
  timerText: { ...typography.bodyMedium, color: colors.primaryDeep, fontVariant: ["tabular-nums"] },
  locked: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md,
    borderRadius: radius.md, backgroundColor: colors.successSoft,
  },
  lockedText: { ...typography.bodyMedium, color: colors.success, flex: 1 },
  answersTitle: { ...typography.bodyMedium, color: colors.primaryDeep },
  dock: {
    gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm,
    backgroundColor: colors.surfaceMuted, borderTopWidth: 1, borderTopColor: colors.border,
  },
}));
