import * as Haptics from "expo-haptics";
import { memo } from "react";
import { Pressable, Text, View } from "react-native";

import { OPTION_LETTERS, type ScanFlag } from "@/lib/tests";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

/**
 * A student's answers, one row per question, to read and to correct.
 *
 * A chosen bubble is green when it is the key's answer and red when it is
 * not; a row the scanner was unsure of is yellow until it is touched. Tapping
 * a bubble chooses it, tapping it again leaves the row blank.
 */
export function TestAnswerGrid({ answers, options, keyAnswers, flags, onChange }: {
  answers: (number | null)[];
  options: number;
  keyAnswers?: number[];
  flags?: ScanFlag[];
  onChange: (next: (number | null)[], question: number) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.grid}>
      {answers.map((answer, question) => (
        <Row
          key={question}
          question={question}
          answer={answer}
          options={options}
          right={keyAnswers?.[question]}
          flagged={Boolean(flags?.[question])}
          onPick={(option) => {
            void Haptics.selectionAsync();
            const next = [...answers];
            next[question] = answer === option ? null : option;
            onChange(next, question);
          }}
        />
      ))}
    </View>
  );
}

const Row = memo(function Row({ question, answer, options, right, flagged, onPick }: {
  question: number; answer: number | null; options: number; right?: number; flagged: boolean; onPick: (option: number) => void;
}) {
  const styles = useStyles();
  return (
    <View style={[styles.row, flagged && styles.rowFlagged]}>
      <Text style={styles.number}>{question + 1}</Text>
      {Array.from({ length: options }, (_, option) => {
        const chosen = answer === option;
        const verdict = chosen && right !== undefined ? (right === option ? styles.bubbleRight : styles.bubbleWrong) : null;
        return (
          <Pressable
            key={option}
            accessibilityRole="radio"
            accessibilityState={{ selected: chosen }}
            accessibilityLabel={`${question + 1} ${OPTION_LETTERS[option]}`}
            hitSlop={4}
            onPress={() => onPick(option)}
            style={[styles.bubble, chosen && styles.bubbleChosen, verdict]}
          >
            <Text style={[styles.letter, chosen && styles.letterChosen]}>{OPTION_LETTERS[option]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
});

const useStyles = makeStyles((colors) => ({
  grid: { gap: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 4, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  rowFlagged: { backgroundColor: colors.warningSoft, borderWidth: 1, borderColor: colors.warningBorder },
  number: { ...typography.bodyMedium, color: colors.inkMuted, width: 28, textAlign: "right" },
  bubble: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  bubbleChosen: { backgroundColor: colors.primary, borderColor: colors.primaryDeep },
  bubbleRight: { backgroundColor: colors.success, borderColor: colors.success },
  bubbleWrong: { backgroundColor: colors.danger, borderColor: colors.danger },
  letter: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 14, color: colors.inkMuted },
  letterChosen: { color: "#fff" },
}));
