import {
  CROSSWORD_ALPHABETS,
  crosswordCells,
  wordCells,
  type Crossword,
  type CrosswordCell,
  type CrosswordDirection,
  type CrosswordLanguage,
  type CrosswordWord,
} from "@jaxongirman/types";
import * as Haptics from "expo-haptics";
import { ChevronLeft, ChevronRight, Delete } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";

import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * A crossword to solve on a phone: the grid, the clue being answered, and a
 * keyboard of the crossword's own letters.
 *
 * Its own keyboard on purpose: an Uzbek grid has Ö Ğ Ş Ç in single cells, and
 * the phone's keyboard types "sh" as two letters or has no Ğ at all. The
 * letters are the grader's letters, so what is typed is what is compared.
 *
 * The same pieces draw the solo solver, a player's phone in a match and the
 * read-only preview; `useCrosswordSolver` holds the selection and the typing.
 */

const key = (row: number, col: number) => `${row},${col}`;

export type CrosswordSolver = {
  crossword: Crossword;
  cells: Map<string, CrosswordCell>;
  selected: { cell: string; direction: CrosswordDirection } | null;
  activeWord: CrosswordWord | null;
  select: (cell: string) => void;
  selectWord: (word: CrosswordWord) => void;
  step: (by: 1 | -1) => void;
  type: (letter: string) => void;
  erase: () => void;
};

export function useCrosswordSolver(
  crossword: Crossword,
  letters: Readonly<Record<string, string>>,
  onLetters: (next: Record<string, string>) => void,
  locked = false,
): CrosswordSolver {
  const cells = useMemo(() => crosswordCells(crossword), [crossword]);
  const ordered = useMemo(
    () => [...crossword.words].sort((a, b) => (a.direction === b.direction ? a.number - b.number : a.direction === "across" ? -1 : 1)),
    [crossword.words],
  );
  const [selected, setSelected] = useState<{ cell: string; direction: CrosswordDirection } | null>(() => {
    const first = ordered[0];
    return first ? { cell: key(first.row, first.col), direction: first.direction } : null;
  });

  const wordAt = useCallback((cell: string, direction: CrosswordDirection) => {
    const id = cells.get(cell)?.[direction];
    return id ? crossword.words.find((word) => word.id === id) ?? null : null;
  }, [cells, crossword.words]);

  const activeWord = selected
    ? wordAt(selected.cell, selected.direction)
      ?? wordAt(selected.cell, selected.direction === "across" ? "down" : "across")
    : null;

  const select = useCallback((cell: string) => {
    const square = cells.get(cell);
    if (!square) return;
    void Haptics.selectionAsync();
    setSelected((current) => {
      // The same cell again turns the way the answer runs, when it can.
      if (current?.cell === cell) {
        const other = current.direction === "across" ? "down" : "across";
        return square[other] ? { cell, direction: other } : current;
      }
      const direction = current && square[current.direction] ? current.direction : square.across ? "across" : "down";
      return { cell, direction };
    });
  }, [cells]);

  const selectWord = useCallback((word: CrosswordWord) => {
    const firstEmpty = wordCells(word).find(([row, col]) => !letters[key(row, col)]);
    const [row, col] = firstEmpty ?? [word.row, word.col];
    setSelected({ cell: key(row, col), direction: word.direction });
  }, [letters]);

  const step = useCallback((by: 1 | -1) => {
    if (!ordered.length) return;
    const at = activeWord ? ordered.findIndex((word) => word.id === activeWord.id) : -1;
    const next = ordered[(at + by + ordered.length) % ordered.length]!;
    selectWord(next);
  }, [activeWord, ordered, selectWord]);

  const type = useCallback((letter: string) => {
    if (locked || !selected || !activeWord) return;
    void Haptics.selectionAsync();
    const path = wordCells(activeWord).map(([row, col]) => key(row, col));
    const at = path.indexOf(selected.cell);
    onLetters({ ...letters, [selected.cell]: letter });
    // On to the next cell of the word; the last one stays where it is.
    const nextCell = path[at + 1];
    if (nextCell) setSelected({ cell: nextCell, direction: activeWord.direction });
  }, [activeWord, letters, locked, onLetters, selected]);

  const erase = useCallback(() => {
    if (locked || !selected || !activeWord) return;
    void Haptics.selectionAsync();
    const path = wordCells(activeWord).map(([row, col]) => key(row, col));
    const at = path.indexOf(selected.cell);
    if (letters[selected.cell]) {
      const next = { ...letters };
      delete next[selected.cell];
      onLetters(next);
      return;
    }
    // An empty cell steps back and clears the one before it.
    const previous = path[at - 1];
    if (!previous) return;
    const next = { ...letters };
    delete next[previous];
    onLetters(next);
    setSelected({ cell: previous, direction: activeWord.direction });
  }, [activeWord, letters, locked, onLetters, selected]);

  return { crossword, cells, selected, activeWord, select, selectWord, step, type, erase };
}

// -------------------------------------------------------------------- grid --

type GridProps = {
  solver: CrosswordSolver;
  letters: Readonly<Record<string, string>>;
  /** Words known to be right: drawn green. */
  solved?: ReadonlySet<string>;
  /** Cells known to be wrong, after "Tekshirish": drawn red. */
  wrong?: ReadonlySet<string>;
  /** Draw the answers instead of what was typed. */
  reveal?: boolean;
  /** The widest the grid may be drawn; the screen's width by default. */
  maxWidth?: number;
  /** Only to look at: no selected cell, no highlighted word. */
  quiet?: boolean;
};

export function CrosswordGrid({ solver, letters, solved, wrong, reveal, maxWidth, quiet }: GridProps) {
  const styles = useStyles();
  const { width: screen } = useWindowDimensions();
  const { crossword, cells, selected, activeWord, select } = solver;
  const room = Math.min(maxWidth ?? screen - spacing.xl * 2, 720);
  const size = Math.max(22, Math.min(44, Math.floor(room / crossword.width)));
  const width = size * crossword.width;
  const height = size * crossword.height;

  const activeCells = useMemo(
    () => new Set(activeWord ? wordCells(activeWord).map(([row, col]) => key(row, col)) : []),
    [activeWord],
  );
  const solvedCells = useMemo(() => {
    const set = new Set<string>();
    for (const word of crossword.words) {
      if (solved?.has(word.id)) for (const [row, col] of wordCells(word)) set.add(key(row, col));
    }
    return set;
  }, [crossword.words, solved]);

  const grid = (
    <View style={[styles.grid, { width, height }]}>
      {[...cells.values()].map((cell) => {
        const where = key(cell.row, cell.col);
        return (
          <GridCell
            key={where}
            where={where}
            cell={cell}
            size={size}
            letter={reveal ? cell.letter ?? "" : letters[where] ?? ""}
            state={!quiet && selected?.cell === where ? "selected"
              : wrong?.has(where) ? "wrong"
              : solvedCells.has(where) ? "solved"
              : !quiet && activeCells.has(where) ? "active" : "idle"}
            onPress={select}
          />
        );
      })}
    </View>
  );

  // A grid wider than the screen scrolls sideways rather than shrinking past reading.
  return width > room + 1 ? (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.scroller}>{grid}</ScrollView>
  ) : (
    <View style={styles.center}>{grid}</View>
  );
}

type CellState = "idle" | "active" | "selected" | "solved" | "wrong";

const GridCell = memo(function GridCell({ where, cell, size, letter, state, onPress }: {
  where: string; cell: CrosswordCell; size: number; letter: string; state: CellState; onPress: (where: string) => void;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityLabel={cell.number ? `${cell.number}` : undefined}
      onPress={() => onPress(where)}
      style={[
        styles.cell,
        { left: cell.col * size, top: cell.row * size, width: size + 1, height: size + 1 },
        state === "active" && styles.cellActive,
        state === "solved" && styles.cellSolved,
        state === "wrong" && styles.cellWrong,
        state === "selected" && styles.cellSelected,
      ]}
    >
      {cell.number !== null ? (
        <Text style={[styles.number, { fontSize: Math.max(8, size * 0.27), lineHeight: Math.max(9, size * 0.3) }, state === "selected" && styles.numberSelected]}>{cell.number}</Text>
      ) : null}
      <Text style={[styles.letter, { fontSize: size * 0.56, lineHeight: size * 0.7 }, state === "selected" && styles.letterSelected]}>
        {letter}
      </Text>
    </Pressable>
  );
});

// --------------------------------------------------------------- clue bar --

export function CrosswordClueBar({ solver }: { solver: CrosswordSolver }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation("games");
  const word = solver.activeWord;
  return (
    <View style={styles.clueBar}>
      <Pressable accessibilityLabel={t("crossword.previous")} hitSlop={8} onPress={() => solver.step(-1)} style={styles.clueStep}>
        <ChevronLeft color={colors.primaryDeep} size={22} />
      </Pressable>
      <View style={{ flex: 1 }}>
        {word ? (
          <>
            <Text style={styles.clueLabel}>
              {word.number} · {word.direction === "across" ? t("crossword.across") : t("crossword.down")} · {t("crossword.letters", { count: word.length })}
            </Text>
            <Text style={styles.clueText} numberOfLines={3}>{word.clue}</Text>
          </>
        ) : null}
      </View>
      <Pressable accessibilityLabel={t("crossword.next")} hitSlop={8} onPress={() => solver.step(1)} style={styles.clueStep}>
        <ChevronRight color={colors.primaryDeep} size={22} />
      </Pressable>
    </View>
  );
}

// --------------------------------------------------------------- keyboard --

export function CrosswordKeyboard({ solver, language, disabled }: { solver: CrosswordSolver; language: CrosswordLanguage; disabled?: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation("games");
  const { width: screen } = useWindowDimensions();
  const letters = CROSSWORD_ALPHABETS[language] ?? CROSSWORD_ALPHABETS.uz;
  const perRow = letters.length > 30 ? 11 : 10;
  const rows: string[][] = [];
  for (let at = 0; at < letters.length; at += perRow) rows.push(letters.slice(at, at + perRow) as string[]);
  const keyWidth = Math.floor((Math.min(screen, 720) - spacing.md * 2 - 4 * (perRow - 1)) / perRow);

  return (
    <View style={[styles.keyboard, disabled && styles.keyboardDisabled]}>
      {rows.map((row, index) => (
        <View key={index} style={styles.keyRow}>
          {row.map((letter) => (
            <Pressable
              key={letter}
              disabled={disabled}
              onPress={() => solver.type(letter)}
              style={({ pressed }) => [styles.key, { width: keyWidth }, pressed && styles.keyPressed]}
            >
              <Text style={styles.keyText}>{letter}</Text>
            </Pressable>
          ))}
          {index === rows.length - 1 ? (
            <Pressable
              accessibilityLabel={t("crossword.erase")}
              disabled={disabled}
              onPress={solver.erase}
              style={({ pressed }) => [styles.key, styles.keyErase, { width: keyWidth * 1.6 }, pressed && styles.keyPressed]}
            >
              <Delete color={colors.ink} size={20} />
            </Pressable>
          ) : null}
        </View>
      ))}
    </View>
  );
}

// -------------------------------------------------------------- clue list --

export function CrosswordClueList({ solver, solved, showAnswers }: { solver: CrosswordSolver; solved?: ReadonlySet<string>; showAnswers?: boolean }) {
  const styles = useStyles();
  const { t } = useTranslation("games");
  return (
    <View style={styles.clueList}>
      {(["across", "down"] as const).map((direction) => (
        <View key={direction} style={styles.clueGroup}>
          <Text style={styles.clueHeading}>{direction === "across" ? t("crossword.across") : t("crossword.down")}</Text>
          {solver.crossword.words
            .filter((word) => word.direction === direction)
            .sort((a, b) => a.number - b.number)
            .map((word) => {
              const active = solver.activeWord?.id === word.id;
              return (
                <Pressable key={word.id} onPress={() => solver.selectWord(word)} style={[styles.clueRow, active && styles.clueRowActive]}>
                  <Text style={styles.clueNumber}>{word.number}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.clueRowText, solved?.has(word.id) && styles.clueRowSolved]}>
                      {word.clue} <Text style={styles.clueLength}>· {t("crossword.letters", { count: word.length })}</Text>
                    </Text>
                    {showAnswers && word.answer ? <Text style={styles.clueAnswer}>{word.answer}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
        </View>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { alignItems: "center" },
  scroller: { paddingHorizontal: spacing.xs },
  grid: { position: "relative" },
  cell: {
    position: "absolute",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    alignItems: "center",
    justifyContent: "center",
  },
  cellActive: { backgroundColor: colors.primarySoft },
  cellSolved: { backgroundColor: colors.successSoft },
  cellWrong: { backgroundColor: colors.dangerSoft },
  cellSelected: { backgroundColor: colors.primary, borderColor: colors.primaryDeep },
  number: { position: "absolute", top: 1, left: 2, fontFamily: "JaxongirmanSans_600SemiBold", color: colors.inkMuted },
  letter: { fontFamily: "JaxongirmanSans_700Bold", color: colors.ink, textAlign: "center", marginTop: 2 },
  letterSelected: { color: colors.onPrimary },
  numberSelected: { color: colors.onPrimaryMuted },
  clueBar: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    backgroundColor: colors.primarySoft, borderRadius: radius.md, minHeight: 64,
  },
  clueStep: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  clueLabel: { ...typography.caption, color: colors.primaryDeep, fontFamily: "JaxongirmanSans_700Bold" },
  clueText: { ...typography.body, color: colors.ink },
  keyboard: { gap: 6, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  keyboardDisabled: { opacity: 0.4 },
  keyRow: { flexDirection: "row", justifyContent: "center", gap: 4 },
  key: {
    height: 44, borderRadius: radius.sm - 2, alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  keyErase: { backgroundColor: colors.surfaceMuted },
  keyPressed: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
  keyText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 17, color: colors.ink },
  clueList: { gap: spacing.lg },
  clueGroup: { gap: 2 },
  clueHeading: { ...typography.bodyMedium, color: colors.primaryDeep, marginBottom: spacing.xs },
  clueRow: { flexDirection: "row", gap: spacing.sm, paddingVertical: 6, paddingHorizontal: spacing.sm, borderRadius: radius.sm },
  clueRowActive: { backgroundColor: colors.primarySoft },
  clueNumber: { ...typography.bodyMedium, color: colors.inkMuted, minWidth: 22 },
  clueRowText: { ...typography.body, color: colors.ink },
  clueRowSolved: { color: colors.success },
  clueLength: { ...typography.caption, color: colors.inkSoft },
  clueAnswer: { ...typography.caption, color: colors.success, fontFamily: "JaxongirmanSans_700Bold", letterSpacing: 1 },
}));
