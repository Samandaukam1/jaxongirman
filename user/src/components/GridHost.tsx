import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { Check, Crown, Eye, X } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import { InlineError } from "@/components/StateBlocks";
import { asErrorMessage } from "@/lib/format";
import {
  gridClose, gridFinish, gridJudge, gridOpen, gridReveal, gridStart, TEAM_COLORS, type GridView, type HostState,
} from "@/lib/games";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * The host's side of a team grid game: the teams before it starts, then the
 * grid — tap the cell the team calls, read the question and its answer,
 * judge it — and the standings at the end. Every tap is one server call; the
 * board follows the session row.
 */
export function GridHost({ sessionId, state, questionCount, onChanged, onCancel }: {
  sessionId: string;
  state: HostState;
  questionCount: number;
  onChanged: () => Promise<void> | void;
  onCancel: () => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation(["games", "common"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(work: () => Promise<unknown>, feel?: Haptics.NotificationFeedbackType) {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (feel !== undefined) void Haptics.notificationAsync(feel);
      await onChanged();
    } catch (failure) {
      setError(asErrorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const grid = state.grid ?? null;
  return (
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
      {state.status === "lobby" || !grid ? (
        <Setup questionCount={questionCount} busy={busy} onStart={(teams) => void act(() => gridStart(sessionId, teams), Haptics.NotificationFeedbackType.Success)} />
      ) : state.status === "finished" ? (
        <Standings grid={grid} />
      ) : (
        <Play
          grid={grid}
          busy={busy}
          onOpen={(cell) => void act(() => gridOpen(sessionId, cell))}
          onReveal={() => void act(() => gridReveal(sessionId))}
          onClose={() => void act(() => gridClose(sessionId))}
          onJudge={(correct) => void act(() => gridJudge(sessionId, correct),
            correct ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning)}
        />
      )}
      {error ? <InlineError message={error} /> : null}
      {state.status === "question" ? (
        <PrimaryButton
          label={t("grid.finish")}
          tone="secondary"
          disabled={busy}
          onPress={() => Alert.alert(t("grid.finish"), t("grid.finishConfirm"), [
            { text: t("common:no"), style: "cancel" },
            { text: t("grid.finish"), style: "destructive", onPress: () => void act(() => gridFinish(sessionId)) },
          ])}
        />
      ) : null}
      {state.status !== "finished" ? <PrimaryButton label={t("common:cancel")} tone="ghost" disabled={busy} onPress={onCancel} /> : <LeaveButton />}
    </ScrollView>
  );
}

function LeaveButton() {
  const { t } = useTranslation("games");
  const router = useRouter();
  return <PrimaryButton label={t("grid.leave")} tone="secondary" onPress={() => router.back()} />;
}

function Setup({ questionCount, busy, onStart }: { questionCount: number; busy: boolean; onStart: (teams: string[]) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("games");
  const [count, setCount] = useState(2);
  const [names, setNames] = useState(["", "", ""]);
  const cells = Math.min(count === 2 ? 30 : 36, questionCount);
  return (
    <View style={styles.block}>
      <Text style={styles.title}>{t("grid.title")}</Text>
      <Text style={styles.label}>{t("grid.teams")}</Text>
      <View style={styles.chipRow}>
        {[2, 3].map((value) => (
          <Pressable key={value} onPress={() => { setCount(value); void Haptics.selectionAsync(); }} style={[styles.chip, count === value && styles.chipActive]}>
            <Text style={[styles.chipText, count === value && styles.chipTextActive]}>{value}</Text>
          </Pressable>
        ))}
      </View>
      {Array.from({ length: count }, (_, at) => (
        <View key={at} style={styles.nameRow}>
          <View style={[styles.swatch, { backgroundColor: TEAM_COLORS[at] }]} />
          <TextInput
            style={styles.input}
            value={names[at]}
            onChangeText={(text) => setNames(names.map((name, i) => (i === at ? text : name)))}
            placeholder={t("grid.teamDefault", { number: at + 1 })}
            placeholderTextColor={colors.inkSoft}
            maxLength={40}
          />
        </View>
      ))}
      <Text style={styles.hint}>{t("grid.cells", { cells, questions: questionCount })}</Text>
      <PrimaryButton
        label={t("grid.start")}
        loading={busy}
        onPress={() => onStart(names.slice(0, count).map((name, at) => name.trim() || t("grid.teamDefault", { number: at + 1 })))}
      />
    </View>
  );
}

function Scores({ grid }: { grid: GridView }) {
  const styles = useStyles();
  return (
    <View style={styles.scores}>
      {grid.teams.map((team, at) => (
        <View key={at} style={[styles.score, { borderColor: TEAM_COLORS[at] }, grid.turn === at && { backgroundColor: `${TEAM_COLORS[at]}22` }]}>
          <Text style={styles.scoreName} numberOfLines={1}>{team}</Text>
          <Text style={[styles.scoreValue, { color: TEAM_COLORS[at] }]}>{grid.scores[at] ?? 0}</Text>
        </View>
      ))}
    </View>
  );
}

function Play({ grid, busy, onOpen, onReveal, onClose, onJudge }: {
  grid: GridView; busy: boolean; onOpen: (cell: number) => void; onReveal: () => void; onClose: () => void; onJudge: (correct: boolean) => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("games");
  const turnTeam = grid.teams[grid.turn] ?? "";
  return (
    <View style={styles.block}>
      <Scores grid={grid} />
      <Text style={[styles.turn, { color: TEAM_COLORS[grid.turn] }]}>{t("grid.turn", { team: turnTeam })}</Text>
      {grid.open ? (
        <View style={styles.openCard}>
          <Text style={styles.openPoints}>{grid.open.cell + 1} · {t("grid.points", { count: grid.open.points })}</Text>
          <Text style={styles.openPrompt}>{grid.open.prompt}</Text>
          <View style={styles.answer}>
            <Text style={styles.answerLabel}>{t("grid.answer")}</Text>
            <Text style={styles.answerText}>{grid.open.answer ?? ""}</Text>
          </View>
          <View style={styles.judge}>
            <Pressable disabled={busy} onPress={() => onJudge(true)} style={({ pressed }) => [styles.judgeButton, { backgroundColor: colors.success }, pressed && styles.pressed]}>
              <Check color="#fff" size={26} strokeWidth={2.6} />
              <Text style={styles.judgeText}>{t("grid.right")}</Text>
            </Pressable>
            <Pressable disabled={busy} onPress={() => onJudge(false)} style={({ pressed }) => [styles.judgeButton, { backgroundColor: colors.danger }, pressed && styles.pressed]}>
              <X color="#fff" size={26} strokeWidth={2.6} />
              <Text style={styles.judgeText}>{t("grid.wrong")}</Text>
            </Pressable>
          </View>
          {grid.open.revealed
            ? <Text style={styles.hint}>{t("grid.revealed")}</Text>
            : <PrimaryButton label={t("grid.reveal")} icon={Eye} tone="secondary" disabled={busy} onPress={onReveal} />}
          <PrimaryButton label={t("grid.close")} tone="ghost" disabled={busy} onPress={onClose} />
        </View>
      ) : (
        <>
          <Text style={styles.hint}>{t("grid.pickHint")}</Text>
          <View style={styles.cells}>
            {grid.cells.map((cell, at) => (
              <Pressable
                key={at}
                disabled={busy || cell.state !== "closed"}
                onPress={() => onOpen(at)}
                style={({ pressed }) => [
                  styles.cell,
                  cell.state === "won" && { backgroundColor: TEAM_COLORS[cell.team ?? 0], borderColor: TEAM_COLORS[cell.team ?? 0] },
                  cell.state === "missed" && styles.cellMissed,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={[styles.cellNumber, cell.state !== "closed" && styles.cellNumberDone]}>{at + 1}</Text>
                {cell.state === "closed" ? <Text style={styles.cellPoints}>{cell.points}</Text> : null}
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function Standings({ grid }: { grid: GridView }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("games");
  const order = grid.teams.map((team, at) => ({ team, at, score: grid.scores[at] ?? 0 })).sort((a, b) => b.score - a.score);
  const draw = order.length > 1 && order[0]!.score === order[1]!.score;
  return (
    <View style={styles.block}>
      <Text style={styles.title}>{t("grid.finished")}</Text>
      <View style={styles.winner}>
        <Crown color={colors.warning} size={28} />
        <Text style={styles.winnerText}>{draw ? t("grid.draw") : t("grid.winner", { team: order[0]!.team })}</Text>
      </View>
      {order.map((entry, place) => (
        <View key={entry.at} style={[styles.standing, { borderColor: TEAM_COLORS[entry.at] }]}>
          <Text style={styles.standingPlace}>{place + 1}</Text>
          <Text style={styles.standingName} numberOfLines={1}>{entry.team}</Text>
          <Text style={[styles.standingScore, { color: TEAM_COLORS[entry.at] }]}>{entry.score}</Text>
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },
  block: { gap: spacing.md },
  title: { ...typography.title, color: colors.ink },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  chipRow: { flexDirection: "row", gap: spacing.sm },
  chip: { minWidth: 56, alignItems: "center", paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted, borderWidth: 1.5, borderColor: "transparent" },
  chipActive: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  chipText: { ...typography.bodyMedium, color: colors.inkMuted },
  chipTextActive: { color: colors.primaryDeep },
  nameRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  swatch: { width: 14, height: 14, borderRadius: 7 },
  input: { flex: 1, ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  scores: { flexDirection: "row", gap: spacing.sm },
  score: { flex: 1, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, backgroundColor: colors.surface, gap: 2 },
  scoreName: { ...typography.caption, color: colors.inkMuted },
  scoreValue: { ...typography.title },
  turn: { ...typography.bodyMedium },
  cells: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  cell: {
    width: "15.2%", aspectRatio: 1, borderRadius: radius.sm, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.borderStrong,
  },
  cellMissed: { backgroundColor: colors.surfaceMuted, borderColor: colors.border, opacity: 0.55 },
  cellNumber: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 18, color: colors.ink },
  cellNumberDone: { color: "#fff" },
  cellPoints: { ...typography.caption, fontSize: 10, color: colors.inkMuted },
  pressed: { opacity: 0.8 },
  openCard: { gap: spacing.md, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  openPoints: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primary, letterSpacing: 0.5 },
  openPrompt: { ...typography.heading, color: colors.ink },
  answer: { gap: 2, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  answerLabel: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.success },
  answerText: { ...typography.bodyMedium, color: colors.ink },
  judge: { flexDirection: "row", gap: spacing.sm },
  judgeButton: { flex: 1, minHeight: 72, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", gap: 2 },
  judgeText: { ...typography.bodyMedium, color: "#fff" },
  winner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.warningSoft },
  winnerText: { ...typography.heading, color: colors.ink, flex: 1 },
  standing: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radius.md, borderWidth: 2, backgroundColor: colors.surface },
  standingPlace: { ...typography.title, color: colors.inkMuted, width: 28 },
  standingName: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
  standingScore: { ...typography.title },
}));
