import * as Haptics from "expo-haptics";
import { Check, Square, SquareCheck } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from "react-native";

import type { SanitizedQuestion } from "@/lib/games";
import { supabase } from "@/lib/supabase";
import { colors, icon, radius, spacing, typography } from "@/theme/tokens";

/**
 * Answer identity is shape and letter first, colour second.
 *
 * A player who cannot tell violet from teal must still be able to say "I
 * pressed B, the triangle". So every option carries a letter, a glyph and a
 * colour, and no rule anywhere depends on the colour alone.
 */
const OPTION_STYLES = [
  { color: "#6C34C9", glyph: "▲", letter: "A" },
  { color: "#0F9D74", glyph: "●", letter: "B" },
  { color: "#E8A13A", glyph: "◆", letter: "C" },
  { color: "#C43552", glyph: "■", letter: "D" },
  { color: "#12A5BC", glyph: "★", letter: "E" },
  { color: "#E8618C", glyph: "⬢", letter: "F" },
] as const;

export function optionStyle(index: number) {
  return OPTION_STYLES[index % OPTION_STYLES.length]!;
}

function publicUrl(path: string | null): string | undefined {
  if (!path) return undefined;
  return supabase.storage.from("game-assets").getPublicUrl(path).data.publicUrl;
}

type Props = {
  question: SanitizedQuestion;
  /** True once the server has taken an answer: everything locks. */
  locked: boolean;
  onSubmit: (payload: Record<string, unknown>) => void;
};

/**
 * The phone half of a question. One component per shape, all of them behind
 * the same contract: build a payload, hand it up once, then go quiet.
 *
 * Nothing here knows a correct answer — the sanitised question never carries
 * one — so there is no way for a fast thumb to read the key off the device.
 */
export function GameAnswerInput({ question, locked, onSubmit }: Props) {
  const [choices, setChoices] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [order, setOrder] = useState<string[]>([]);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [activeLeft, setActiveLeft] = useState<string | null>(null);
  const [imageBox, setImageBox] = useState({ width: 1, height: 1 });

  // A new question resets everything: state from question 3 must not decide
  // question 4.
  useEffect(() => {
    setChoices([]);
    setText("");
    setOrder((question.config.items ?? []).map((item) => item.id));
    setPairs({});
    setActiveLeft(null);
  }, [question.id, question.config.items]);

  const tap = () => void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

  function send(payload: Record<string, unknown>) {
    if (locked) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onSubmit(payload);
  }

  const options = question.config.options ?? [];

  switch (question.type) {
    case "single_choice":
    case "image_quiz":
      return (
        <View style={styles.optionGrid}>
          {options.map((option, index) => (
            <OptionButton
              key={option.id}
              index={index}
              text={option.text}
              disabled={locked}
              onPress={() => send({ choice: option.id })}
            />
          ))}
        </View>
      );

    case "poll":
      return (
        <View style={styles.optionGrid}>
          {options.map((option, index) => (
            <OptionButton
              key={option.id}
              index={index}
              text={option.text}
              disabled={locked}
              onPress={() => send({ choice: option.id })}
            />
          ))}
        </View>
      );

    case "true_false":
      return (
        <View style={styles.tfRow}>
          <Pressable
            style={({ pressed }) => [styles.tfButton, { backgroundColor: colors.success }, pressed && styles.pressed, locked && styles.dim]}
            disabled={locked}
            onPress={() => send({ value: true })}
            accessibilityRole="button"
          >
            <Text style={styles.tfGlyph}>✓</Text>
            <Text style={styles.tfLabel}>ROST</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.tfButton, { backgroundColor: colors.danger }, pressed && styles.pressed, locked && styles.dim]}
            disabled={locked}
            onPress={() => send({ value: false })}
            accessibilityRole="button"
          >
            <Text style={styles.tfGlyph}>✕</Text>
            <Text style={styles.tfLabel}>YOLG‘ON</Text>
          </Pressable>
        </View>
      );

    case "multiple_choice":
      return (
        <View style={{ gap: spacing.sm }}>
          {options.map((option, index) => {
            const chosen = choices.includes(option.id);
            const style = optionStyle(index);
            return (
              <Pressable
                key={option.id}
                style={({ pressed }) => [
                  styles.multiRow,
                  chosen && { borderColor: style.color, backgroundColor: `${style.color}18` },
                  pressed && styles.pressed,
                  locked && styles.dim,
                ]}
                disabled={locked}
                onPress={() => {
                  tap();
                  setChoices((current) => current.includes(option.id)
                    ? current.filter((value) => value !== option.id)
                    : [...current, option.id]);
                }}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: chosen }}
              >
                {chosen
                  ? <SquareCheck color={style.color} size={icon.lg} strokeWidth={icon.strokeBold} />
                  : <Square color={colors.borderStrong} size={icon.lg} strokeWidth={icon.stroke} />}
                <Text style={styles.multiGlyph}>{style.letter}</Text>
                <Text style={styles.multiText}>{option.text}</Text>
              </Pressable>
            );
          })}
          <SubmitBar
            label="Javobni yuborish"
            disabled={locked || choices.length === 0}
            onPress={() => send({ choices })}
          />
        </View>
      );

    case "ordering": {
      const items = question.config.items ?? [];
      const byId = new Map(items.map((item) => [item.id, item.text]));
      return (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.hint}>To‘g‘ri ketma-ketlikka qo‘ying.</Text>
          {order.map((itemId, index) => (
            <View key={itemId} style={styles.orderRow}>
              <Text style={styles.orderIndex}>{index + 1}</Text>
              <Text style={styles.orderText}>{byId.get(itemId) ?? ""}</Text>
              <Pressable
                style={styles.orderArrow}
                disabled={locked || index === 0}
                onPress={() => {
                  tap();
                  setOrder((current) => {
                    const next = [...current];
                    [next[index - 1], next[index]] = [next[index]!, next[index - 1]!];
                    return next;
                  });
                }}
                accessibilityLabel="Yuqoriga"
              >
                <Text style={[styles.arrowGlyph, (locked || index === 0) && styles.arrowDim]}>↑</Text>
              </Pressable>
              <Pressable
                style={styles.orderArrow}
                disabled={locked || index === order.length - 1}
                onPress={() => {
                  tap();
                  setOrder((current) => {
                    const next = [...current];
                    [next[index], next[index + 1]] = [next[index + 1]!, next[index]!];
                    return next;
                  });
                }}
                accessibilityLabel="Pastga"
              >
                <Text style={[styles.arrowGlyph, (locked || index === order.length - 1) && styles.arrowDim]}>↓</Text>
              </Pressable>
            </View>
          ))}
          <SubmitBar label="Javobni yuborish" disabled={locked} onPress={() => send({ order })} />
        </View>
      );
    }

    case "matching": {
      const left = question.config.left ?? [];
      const right = question.config.right ?? [];
      const takenRight = new Set(Object.values(pairs));
      const complete = Object.keys(pairs).length === left.length;
      return (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.hint}>Chapdagini tanlab, mos o‘ngdagini bosing.</Text>
          <View style={styles.matchColumns}>
            <View style={styles.matchColumn}>
              {left.map((item) => {
                const paired = pairs[item.id];
                const rightText = right.find((row) => row.id === paired)?.text;
                return (
                  <Pressable
                    key={item.id}
                    style={[
                      styles.matchCell,
                      activeLeft === item.id && styles.matchCellActive,
                      paired && styles.matchCellDone,
                    ]}
                    disabled={locked}
                    onPress={() => {
                      tap();
                      if (paired) {
                        setPairs((current) => {
                          const next = { ...current };
                          delete next[item.id];
                          return next;
                        });
                        setActiveLeft(item.id);
                      } else {
                        setActiveLeft(activeLeft === item.id ? null : item.id);
                      }
                    }}
                  >
                    <Text style={styles.matchText}>{item.text}</Text>
                    {rightText ? <Text style={styles.matchPaired} numberOfLines={1}>↔ {rightText}</Text> : null}
                  </Pressable>
                );
              })}
            </View>
            <View style={styles.matchColumn}>
              {right.map((item) => (
                <Pressable
                  key={item.id}
                  style={[styles.matchCell, takenRight.has(item.id) && styles.matchCellUsed]}
                  disabled={locked || !activeLeft || takenRight.has(item.id)}
                  onPress={() => {
                    if (!activeLeft) return;
                    tap();
                    setPairs((current) => ({ ...current, [activeLeft]: item.id }));
                    setActiveLeft(null);
                  }}
                >
                  <Text style={[styles.matchText, takenRight.has(item.id) && styles.matchTextUsed]}>{item.text}</Text>
                </Pressable>
              ))}
            </View>
          </View>
          <SubmitBar label="Javobni yuborish" disabled={locked || !complete} onPress={() => send({ pairs })} />
        </View>
      );
    }

    case "fill_blank":
    case "word_cloud":
    case "open_answer": {
      const maxLength = question.type === "open_answer" ? 300 : question.type === "word_cloud" ? 40 : 120;
      return (
        <View style={{ gap: spacing.md }}>
          <TextInput
            style={[styles.textAnswer, question.type === "open_answer" && styles.textAnswerTall]}
            value={text}
            onChangeText={setText}
            editable={!locked}
            placeholder={question.type === "word_cloud" ? "Bitta so‘z yoki ibora" : "Javobingiz"}
            placeholderTextColor={colors.inkSoft}
            maxLength={maxLength}
            multiline={question.type === "open_answer"}
            autoCapitalize="none"
            returnKeyType="done"
            onSubmitEditing={() => { if (text.trim()) send({ text: text.trim() }); }}
          />
          <SubmitBar label="Javobni yuborish" disabled={locked || text.trim().length === 0} onPress={() => send({ text: text.trim() })} />
        </View>
      );
    }

    case "hotspot": {
      const url = publicUrl(question.media_path);
      return (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.hint}>Rasmda kerakli joyni bosing.</Text>
          <Pressable
            disabled={locked}
            onLayout={(event: LayoutChangeEvent) => setImageBox({
              width: event.nativeEvent.layout.width,
              height: event.nativeEvent.layout.height,
            })}
            onPress={(event) => send({
              // Normalised, so a small phone and a tablet agree on the same spot.
              x: event.nativeEvent.locationX / imageBox.width,
              y: event.nativeEvent.locationY / imageBox.height,
            })}
          >
            <Image source={{ uri: url }} style={styles.hotspotImage} resizeMode="contain" />
          </Pressable>
        </View>
      );
    }

    default:
      return null;
  }
}

function OptionButton({ index, text, disabled, onPress }: {
  index: number; text: string; disabled: boolean; onPress: () => void;
}) {
  const style = optionStyle(index);
  return (
    <Pressable
      style={({ pressed }) => [
        styles.optionButton,
        { backgroundColor: style.color },
        pressed && styles.pressed,
        disabled && styles.dim,
      ]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${style.letter}: ${text}`}
    >
      <View style={styles.optionBadge}>
        <Text style={styles.optionGlyph}>{style.glyph}</Text>
        <Text style={styles.optionLetter}>{style.letter}</Text>
      </View>
      <Text style={styles.optionText} numberOfLines={4}>{text}</Text>
    </Pressable>
  );
}

function SubmitBar({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.submitBar, pressed && styles.pressed, disabled && styles.dim]}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
    >
      <Check color={colors.onPrimary} size={icon.md} strokeWidth={icon.strokeBold} />
      <Text style={styles.submitText}>{label}</Text>
    </Pressable>
  );
}

/** The reveal: what the room chose, and what was right. Read-only. */
export function GameRevealPanel({ question, config, stats }: {
  question: SanitizedQuestion;
  config: Record<string, unknown>;
  stats: { answers: number; correct: number; incorrect: number; choices: Record<string, number>; words: Record<string, number> };
}) {
  const options = question.config.options ?? [];
  const correct = config.correct;

  const words = useMemo(
    () => Object.entries(stats.words ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 20),
    [stats.words],
  );
  const peak = words[0]?.[1] ?? 1;

  if (question.type === "word_cloud") {
    return (
      <View style={styles.cloudWrap}>
        {words.length === 0 ? <Text style={styles.hint}>Hech kim javob yozmadi.</Text> : words.map(([word, count]) => (
          <Text key={word} style={[styles.cloudWord, { fontSize: 14 + (count / peak) * 20, opacity: 0.55 + (count / peak) * 0.45 }]}>
            {word}
          </Text>
        ))}
      </View>
    );
  }

  if (question.type === "poll" || options.length > 0) {
    const total = Math.max(stats.answers, 1);
    return (
      <View style={{ gap: spacing.sm }}>
        {options.map((option, index) => {
          const style = optionStyle(index);
          const count = stats.choices?.[option.id] ?? 0;
          const isCorrect = Array.isArray(correct) ? correct.includes(option.id) : correct === option.id;
          return (
            <View key={option.id} style={styles.resultRow}>
              <View style={[styles.resultBar, { width: `${(count / total) * 100}%`, backgroundColor: `${style.color}30` }]} />
              <Text style={styles.resultLetter}>{style.letter}</Text>
              <Text style={styles.resultText} numberOfLines={2}>{option.text}</Text>
              {isCorrect ? <Check color={colors.success} size={icon.md} strokeWidth={icon.strokeBold} /> : null}
              <Text style={styles.resultCount}>{count}</Text>
            </View>
          );
        })}
      </View>
    );
  }

  if (question.type === "true_false") {
    return (
      <Text style={styles.revealAnswer}>To‘g‘ri javob: {correct === true ? "ROST" : "YOLG‘ON"}</Text>
    );
  }

  if (question.type === "fill_blank") {
    const answers = Array.isArray(config.answers) ? config.answers as string[] : [];
    return <Text style={styles.revealAnswer}>To‘g‘ri javob: {answers[0] ?? "—"}</Text>;
  }

  if (question.type === "ordering") {
    const items = question.config.items ?? [];
    const byId = new Map(items.map((item) => [item.id, item.text]));
    const sequence = Array.isArray(config.order) ? config.order as string[] : [];
    return (
      <View style={{ gap: 4 }}>
        {sequence.map((itemId, index) => (
          <Text key={itemId} style={styles.revealAnswer}>{index + 1}. {byId.get(itemId) ?? ""}</Text>
        ))}
      </View>
    );
  }

  if (question.type === "matching") {
    const left = question.config.left ?? [];
    const right = question.config.right ?? [];
    const pairs = (config.pairs ?? {}) as Record<string, string>;
    return (
      <View style={{ gap: 4 }}>
        {left.map((item) => (
          <Text key={item.id} style={styles.revealAnswer}>
            {item.text} ↔ {right.find((row) => row.id === pairs[item.id])?.text ?? "—"}
          </Text>
        ))}
      </View>
    );
  }

  return (
    <Text style={styles.hint}>
      {stats.answers} javob · {stats.correct} to‘g‘ri · {stats.incorrect} noto‘g‘ri
    </Text>
  );
}

/** A horizontal strip of option letters, for the compact result header. */
export function GameStatsSummary({ stats }: { stats: { answers: number; correct: number; incorrect: number } }) {
  const total = Math.max(stats.correct + stats.incorrect, 1);
  return (
    <View style={{ gap: spacing.sm }}>
      <View style={styles.splitBar}>
        <View style={[styles.splitCorrect, { flex: stats.correct || 0.001 }]} />
        <View style={[styles.splitWrong, { flex: stats.incorrect || 0.001 }]} />
      </View>
      <Text style={styles.hint}>
        {Math.round((stats.correct / total) * 100)}% to‘g‘ri · {Math.round((stats.incorrect / total) * 100)}% noto‘g‘ri
      </Text>
    </View>
  );
}

/** Scrollable leaderboard rows shared by the play screen and the host remote. */
export function GameLeaderboardList({ players, meId }: {
  players: { id: string; nickname: string; avatar_id: number; total_score: number; rank: number }[];
  meId?: string;
}) {
  return (
    <ScrollView contentContainerStyle={{ gap: spacing.sm }}>
      {players.map((player) => (
        <View key={player.id} style={[styles.boardRow, player.id === meId && styles.boardRowMe]}>
          <Text style={styles.boardRank}>{player.rank}</Text>
          <Text style={styles.boardName} numberOfLines={1}>{player.nickname}</Text>
          <Text style={styles.boardScore}>{player.total_score.toLocaleString("uz-UZ")}</Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pressed: { transform: [{ scale: 0.97 }] },
  dim: { opacity: 0.5 },
  hint: { ...typography.caption, color: colors.inkMuted },
  optionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  optionButton: {
    width: "48%", flexGrow: 1, minHeight: 96, borderRadius: radius.lg,
    padding: spacing.lg, gap: spacing.sm, justifyContent: "center",
  },
  optionBadge: { flexDirection: "row", alignItems: "center", gap: 6 },
  optionGlyph: { color: colors.onPrimary, fontSize: 18 },
  optionLetter: { ...typography.bodyMedium, color: colors.onPrimary, opacity: 0.85 },
  optionText: { ...typography.bodyMedium, color: colors.onPrimary, fontSize: 16 },
  tfRow: { flexDirection: "row", gap: spacing.md },
  tfButton: { flex: 1, minHeight: 150, borderRadius: radius.lg, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  tfGlyph: { color: colors.onPrimary, fontSize: 44 },
  tfLabel: { ...typography.heading, color: colors.onPrimary },
  multiRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border,
    borderRadius: radius.lg, padding: spacing.lg, minHeight: 60,
  },
  multiGlyph: { ...typography.bodyMedium, color: colors.inkMuted, width: 16 },
  multiText: { ...typography.bodyMedium, color: colors.ink, flex: 1 },
  submitBar: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
    backgroundColor: colors.primary, borderRadius: radius.lg, paddingVertical: spacing.lg,
  },
  submitText: { ...typography.bodyMedium, color: colors.onPrimary, fontSize: 16 },
  orderRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  orderIndex: { ...typography.bodyMedium, color: colors.primaryDeep, width: 22, textAlign: "center" },
  orderText: { ...typography.body, color: colors.ink, flex: 1 },
  orderArrow: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  arrowGlyph: { fontSize: 20, color: colors.ink },
  arrowDim: { color: colors.border },
  matchColumns: { flexDirection: "row", gap: spacing.sm },
  matchColumn: { flex: 1, gap: spacing.sm },
  matchCell: {
    backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md, minHeight: 54, justifyContent: "center",
  },
  matchCellActive: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  matchCellDone: { borderColor: colors.success, backgroundColor: colors.successSoft },
  matchCellUsed: { opacity: 0.4 },
  matchText: { ...typography.body, color: colors.ink },
  matchTextUsed: { color: colors.inkSoft },
  matchPaired: { ...typography.caption, color: colors.success },
  textAnswer: {
    ...typography.heading, color: colors.ink, backgroundColor: colors.surfaceMuted,
    borderRadius: radius.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.lg,
  },
  textAnswerTall: { ...typography.body, minHeight: 120, textAlignVertical: "top" },
  hotspotImage: { width: "100%", height: 300, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted },
  cloudWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, alignItems: "center", justifyContent: "center", paddingVertical: spacing.lg },
  cloudWord: { fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  resultRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surfaceMuted, borderRadius: radius.md,
    padding: spacing.md, overflow: "hidden",
  },
  resultBar: { position: "absolute", left: 0, top: 0, bottom: 0 },
  resultLetter: { ...typography.bodyMedium, color: colors.inkMuted, width: 16 },
  resultText: { ...typography.body, color: colors.ink, flex: 1 },
  resultCount: { ...typography.bodyMedium, color: colors.ink },
  revealAnswer: { ...typography.bodyMedium, color: colors.ink },
  splitBar: { flexDirection: "row", height: 12, borderRadius: 6, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  splitCorrect: { backgroundColor: colors.success },
  splitWrong: { backgroundColor: colors.danger },
  boardRow: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, padding: spacing.md,
  },
  boardRowMe: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  boardRank: { ...typography.bodyMedium, color: colors.primaryDeep, width: 26 },
  boardName: { ...typography.body, color: colors.ink, flex: 1 },
  boardScore: { ...typography.bodyMedium, color: colors.ink },
});
