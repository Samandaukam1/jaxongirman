import {
  SURVEY_QUESTION_TYPES, questionHasOptions, supportsLatinOnly,
  type SurveyQuestionType,
} from "@jaxongirman/types";
import { ChevronDown, ChevronUp, Copy, GripVertical, Plus, Trash2, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Pressable, Switch, Text, TextInput, View } from "react-native";

import { i18n } from "@/i18n";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export type DraftOption = { key: string; label: string };

export type DraftQuestion = {
  key: string;
  type: SurveyQuestionType;
  label: string;
  helper_text: string;
  is_required: boolean;
  latin_only: boolean;
  config: { max_length?: number; min?: number; max?: number };
  options: DraftOption[];
};

export function makeKey(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function blankQuestion(type: SurveyQuestionType = "short_text"): DraftQuestion {
  return {
    key: makeKey(),
    type,
    label: "",
    helper_text: "",
    is_required: true,
    latin_only: false,
    config: {},
    options: questionHasOptions(type)
      ? [{ key: makeKey(), label: "" }, { key: makeKey(), label: "" }]
      : [],
  };
}

/** The wire shape `save_survey_form()` expects. */
export function toPayload(questions: readonly DraftQuestion[]) {
  return questions.map((question) => ({
    type: question.type,
    label: question.label.trim(),
    helper_text: question.helper_text.trim(),
    is_required: question.is_required,
    latin_only: question.latin_only && supportsLatinOnly(question.type),
    config: question.config,
    options: questionHasOptions(question.type)
      ? question.options.map((option) => ({ label: option.label.trim() })).filter((option) => option.label !== "")
      : [],
  }));
}

/** The first thing wrong with this draft, in the order a person would fix it. */
export function firstQuestionProblem(questions: readonly DraftQuestion[]): string | null {
  if (questions.length === 0) return i18n.t("survey:question.needOne");
  for (const [index, question] of questions.entries()) {
    if (question.label.trim() === "") return i18n.t("survey:question.needLabel", { number: index + 1 });
    if (questionHasOptions(question.type)) {
      const filled = question.options.filter((option) => option.label.trim() !== "");
      if (filled.length < 2) return i18n.t("survey:question.needOptions", { number: index + 1 });
    }
    const { min, max } = question.config;
    if (question.type === "number" && min !== undefined && max !== undefined && min > max) {
      return i18n.t("survey:question.badRange", { number: index + 1 });
    }
  }
  return null;
}

type Props = {
  question: DraftQuestion;
  index: number;
  total: number;
  onChange: (next: DraftQuestion) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  /** Positional move. A drag layer can call this with any target index. */
  onMove: (to: number) => void;
};

/**
 * One question in the builder.
 *
 * Reordering is exposed as a positional `onMove(to)` rather than a pair of
 * swap handlers, so the arrows here and a future drag gesture drive the same
 * operation — the list owner never learns which one moved a row.
 */
export function QuestionEditor({ question, index, total, onChange, onRemove, onDuplicate, onMove }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["survey", "labels"]);
  const hasOptions = questionHasOptions(question.type);
  const canBeLatin = supportsLatinOnly(question.type);

  function patch(changes: Partial<DraftQuestion>) {
    onChange({ ...question, ...changes });
  }

  function changeType(type: SurveyQuestionType) {
    onChange({
      ...question,
      type,
      // A rule that no longer applies must not survive the switch: a phone
      // question carrying `latin_only` would be rejected by the table's own check.
      latin_only: supportsLatinOnly(type) ? question.latin_only : false,
      config: {},
      options: questionHasOptions(type)
        ? (question.options.length >= 2 ? question.options : [{ key: makeKey(), label: "" }, { key: makeKey(), label: "" }])
        : [],
    });
  }

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <GripVertical color={colors.inkSoft} size={18} strokeWidth={2} />
        <Text style={styles.position}>{t("question.position", { number: index + 1 })}</Text>
        <View style={styles.headActions}>
          <Pressable accessibilityLabel={t("question.up")} disabled={index === 0} onPress={() => onMove(index - 1)} style={[styles.iconButton, index === 0 && styles.iconDisabled]}>
            <ChevronUp color={colors.ink} size={16} strokeWidth={2.2} />
          </Pressable>
          <Pressable accessibilityLabel={t("question.down")} disabled={index === total - 1} onPress={() => onMove(index + 1)} style={[styles.iconButton, index === total - 1 && styles.iconDisabled]}>
            <ChevronDown color={colors.ink} size={16} strokeWidth={2.2} />
          </Pressable>
          <Pressable accessibilityLabel={t("question.duplicate")} onPress={onDuplicate} style={styles.iconButton}>
            <Copy color={colors.ink} size={15} strokeWidth={2} />
          </Pressable>
          <Pressable accessibilityLabel={t("question.remove")} onPress={onRemove} style={[styles.iconButton, styles.iconDanger]}>
            <Trash2 color={colors.danger} size={15} strokeWidth={2} />
          </Pressable>
        </View>
      </View>

      <TextInput
        value={question.label}
        onChangeText={(value) => patch({ label: value.slice(0, 200) })}
        placeholder={t("question.label")}
        placeholderTextColor={colors.inkSoft}
        style={styles.labelInput}
        multiline
      />

      <View style={styles.typeGrid}>
        {SURVEY_QUESTION_TYPES.map((type) => (
          <Pressable
            key={type}
            accessibilityRole="button"
            accessibilityState={{ selected: question.type === type }}
            onPress={() => changeType(type)}
            style={[styles.typeChip, question.type === type && styles.typeChipActive]}
          >
            <Text style={[styles.typeText, question.type === type && styles.typeTextActive]}>{t(`labels:surveyQuestion.${type}`)}</Text>
          </Pressable>
        ))}
      </View>

      <TextInput
        value={question.helper_text}
        onChangeText={(value) => patch({ helper_text: value.slice(0, 300) })}
        placeholder={t("question.hint")}
        placeholderTextColor={colors.inkSoft}
        style={styles.helperInput}
      />

      {hasOptions ? (
        <View style={styles.options}>
          {question.options.map((option, optionIndex) => (
            <View key={option.key} style={styles.optionRow}>
              <View style={styles.optionBullet} />
              <TextInput
                value={option.label}
                onChangeText={(value) => patch({
                  options: question.options.map((item) => item.key === option.key ? { ...item, label: value.slice(0, 160) } : item),
                })}
                placeholder={t("question.option", { number: optionIndex + 1 })}
                placeholderTextColor={colors.inkSoft}
                style={styles.optionInput}
              />
              {question.options.length > 2 ? (
                <Pressable
                  accessibilityLabel={t("question.removeOption")}
                  onPress={() => patch({ options: question.options.filter((item) => item.key !== option.key) })}
                  style={styles.optionRemove}
                >
                  <X color={colors.inkSoft} size={14} strokeWidth={2.2} />
                </Pressable>
              ) : null}
            </View>
          ))}
          <Pressable
            accessibilityRole="button"
            onPress={() => patch({ options: [...question.options, { key: makeKey(), label: "" }] })}
            style={styles.optionAdd}
          >
            <Plus color={colors.primary} size={15} strokeWidth={2.4} />
            <Text style={styles.optionAddText}>{t("question.addOption")}</Text>
          </Pressable>
        </View>
      ) : null}

      {question.type === "number" ? (
        <View style={styles.rangeRow}>
          <View style={styles.rangeField}>
            <Text style={styles.rangeLabel}>{t("question.min")}</Text>
            <TextInput
              value={question.config.min === undefined ? "" : String(question.config.min)}
              onChangeText={(value) => patch({ config: { ...question.config, min: value === "" ? undefined : Number(value.replace(/[^0-9-]/g, "")) } })}
              keyboardType="numbers-and-punctuation"
              placeholder="—"
              placeholderTextColor={colors.inkSoft}
              style={styles.rangeInput}
            />
          </View>
          <View style={styles.rangeField}>
            <Text style={styles.rangeLabel}>{t("question.max")}</Text>
            <TextInput
              value={question.config.max === undefined ? "" : String(question.config.max)}
              onChangeText={(value) => patch({ config: { ...question.config, max: value === "" ? undefined : Number(value.replace(/[^0-9-]/g, "")) } })}
              keyboardType="numbers-and-punctuation"
              placeholder="—"
              placeholderTextColor={colors.inkSoft}
              style={styles.rangeInput}
            />
          </View>
        </View>
      ) : null}

      {question.type === "image" ? (
        <Text style={styles.hint}>
          {t("question.imageNote")}
        </Text>
      ) : null}

      <View style={styles.toggles}>
        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>{t("question.required")}</Text>
          <Switch
            value={question.is_required}
            onValueChange={(value) => patch({ is_required: value })}
            trackColor={{ true: colors.primary, false: colors.borderStrong }}
            thumbColor={colors.surface}
          />
        </View>
        {canBeLatin ? (
          <View style={styles.toggleRow}>
            <View style={styles.toggleCopy}>
              <Text style={styles.toggleLabel}>{t("question.latinOnly")}</Text>
              <Text style={styles.toggleHint}>{t("question.latinOnlyHint")}</Text>
            </View>
            <Switch
              value={question.latin_only}
              onValueChange={(value) => patch({ latin_only: value })}
              trackColor={{ true: colors.primary, false: colors.borderStrong }}
              thumbColor={colors.surface}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  card: { padding: spacing.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, gap: spacing.md },
  head: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  position: { ...typography.caption, color: colors.inkMuted, flex: 1 },
  headActions: { flexDirection: "row", gap: 6 },
  iconButton: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  iconDisabled: { opacity: 0.35 },
  iconDanger: { backgroundColor: colors.dangerSoft },

  labelInput: { ...typography.bodyMedium, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 52 },
  helperInput: { ...typography.caption, color: colors.inkMuted, backgroundColor: colors.surfaceMuted, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, minHeight: 42 },

  typeGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip: { paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  typeChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  typeText: { ...typography.caption, fontSize: 11, color: colors.inkMuted },
  typeTextActive: { color: colors.onPrimary },

  options: { gap: spacing.sm },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  optionBullet: { width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: colors.borderStrong },
  optionInput: { ...typography.body, color: colors.ink, flex: 1, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 42 },
  optionRemove: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  optionAdd: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  optionAddText: { ...typography.caption, color: colors.primary, fontFamily: "Manrope_600SemiBold" },

  rangeRow: { flexDirection: "row", gap: spacing.md },
  rangeField: { flex: 1, gap: 4 },
  rangeLabel: { ...typography.caption, color: colors.inkSoft },
  rangeInput: { ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, minHeight: 44 },

  hint: { ...typography.caption, color: colors.inkSoft, lineHeight: 17 },

  toggles: { gap: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  toggleCopy: { flex: 1, gap: 1 },
  toggleLabel: { ...typography.caption, color: colors.ink, fontFamily: "Manrope_600SemiBold" },
  toggleHint: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
}));
