import { CheckCircle2 } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";

import type { HostQuestion } from "@/lib/games";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Option = { id: string; text: string };

const list = (value: unknown): Option[] =>
  Array.isArray(value) ? value.filter((row): row is Option => Boolean(row && typeof row === "object" && "id" in row)) : [];
const ids = (value: unknown): string[] => (Array.isArray(value) ? value.map(String) : []);

/**
 * The open question on the host's phone, with its answer.
 *
 * The room sees the question on the board and answers on their phones; the
 * person running the game sees what is right, so they can explain it, settle
 * an argument and keep an eye on the answers coming in. Drawn for every type
 * that has a key — the right option or options, true or false, the order, the
 * pairs, the accepted words — and says so plainly when a question has none.
 */
export function HostQuestionCard({ question, number }: { question: HostQuestion; number: number }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("play");
  const config = question.config ?? {};

  const answer = (() => {
    switch (question.type) {
      case "single_choice":
      case "image_quiz": {
        const found = list(config.options).find((option) => option.id === config.correct);
        return found ? [found.text] : [];
      }
      case "multiple_choice": {
        const wanted = new Set(ids(config.correct));
        return list(config.options).filter((option) => wanted.has(option.id)).map((option) => option.text);
      }
      case "true_false":
        return typeof config.correct === "boolean" ? [config.correct ? t("answer.true") : t("answer.false")] : [];
      case "ordering": {
        const byId = new Map(list(config.items).map((item) => [item.id, item.text]));
        return ids(config.order).map((id, index) => `${index + 1}. ${byId.get(id) ?? ""}`);
      }
      case "matching": {
        const right = new Map(list(config.right).map((item) => [item.id, item.text]));
        const pairs = (config.pairs ?? {}) as Record<string, string>;
        return list(config.left).map((item) => `${item.text} ↔ ${right.get(pairs[item.id] ?? "") ?? "—"}`);
      }
      case "fill_blank":
        return ids(config.answers);
      case "crossword": {
        const words = Array.isArray(config.words) ? config.words as { number: number; direction: string; answer?: string }[] : [];
        return [...words]
          .sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === "across" ? -1 : 1))
          .map((word) => `${word.number} ${word.direction === "across" ? "→" : "↓"} ${word.answer ?? ""}`);
      }
      default:
        return [];
    }
  })();
  const reference = question.type === "open_answer" && typeof config.reference === "string" ? config.reference.trim() : "";

  return (
    <View style={styles.card}>
      <Text style={styles.eyebrow}>{t("host.question", { number })}</Text>
      <Text style={styles.prompt}>{question.prompt}</Text>
      {answer.length > 0 ? (
        <View style={styles.key}>
          <View style={styles.keyHead}>
            <CheckCircle2 color={colors.success} size={18} strokeWidth={2.4} />
            <Text style={styles.keyLabel}>{t("host.answerKey")}</Text>
          </View>
          {answer.map((line, index) => <Text key={`${index}-${line}`} style={styles.keyText}>{line}</Text>)}
        </View>
      ) : reference ? (
        <View style={styles.key}>
          <Text style={styles.keyLabel}>{t("host.openReference")}</Text>
          <Text style={styles.keyText}>{reference}</Text>
        </View>
      ) : (
        <Text style={styles.none}>{t("host.noAnswerKey")}</Text>
      )}
      {question.explanation ? <Text style={styles.explanation}>{question.explanation}</Text> : null}
      {question.crossword_progress?.length ? (
        <View style={styles.race}>
          <Text style={styles.keyLabel}>{t("crossword.race")}</Text>
          {question.crossword_progress.slice(0, 12).map((racer, index) => (
            <View key={racer.player_id} style={styles.racer}>
              <Text style={styles.racerRank}>{index + 1}</Text>
              <Text style={styles.racerName} numberOfLines={1}>{racer.nickname}{racer.team ? ` · ${racer.team}` : ""}</Text>
              <Text style={styles.racerScore}>{racer.solved}{racer.done ? ` · ${t("crossword.done")}` : ""}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { gap: spacing.sm, padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  eyebrow: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", letterSpacing: 1, color: colors.primary },
  prompt: { ...typography.heading, color: colors.ink },
  key: { gap: 4, padding: spacing.md, borderRadius: radius.md, backgroundColor: colors.successSoft },
  keyHead: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  keyLabel: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.success },
  keyText: { ...typography.bodyMedium, color: colors.ink },
  none: { ...typography.caption, color: colors.inkMuted },
  explanation: { ...typography.caption, color: colors.inkMuted },
  race: { gap: 6, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  racer: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  racerRank: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.inkMuted, minWidth: 18 },
  racerName: { ...typography.body, color: colors.ink, flex: 1 },
  racerScore: { ...typography.caption, fontFamily: "JaxongirmanSans_700Bold", color: colors.primaryDeep },
}));
