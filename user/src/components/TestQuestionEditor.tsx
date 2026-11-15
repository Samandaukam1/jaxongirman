import { Check } from "lucide-react-native";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, Text, TextInput, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { InlineError } from "@/components/StateBlocks";
import { OPTION_LETTERS } from "@/lib/tests";
import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

export type QuestionDraft = { id?: string; prompt: string; options: string[]; correct: number };

/** One question in a sheet from the bottom: its words, its options and which one is right. */
export function TestQuestionEditor({ draft, onSave, onClose, saving, error }: {
  draft: QuestionDraft;
  onSave: (draft: QuestionDraft) => void;
  onClose: () => void;
  saving: boolean;
  error: string | null;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("tests");
  const insets = useSafeAreaInsets();
  const [value, setValue] = useState(draft);
  const [problem, setProblem] = useState<string | null>(null);

  function save() {
    if (!value.prompt.trim() || value.options.some((option) => !option.trim())) {
      setProblem(t("editor.empty"));
      return;
    }
    onSave({ ...value, prompt: value.prompt.trim(), options: value.options.map((option) => option.trim()) });
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <KeyboardAwareScrollView bottomOffset={spacing.xl} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Text style={styles.title}>{draft.id ? t("editor.title") : t("editor.newTitle")}</Text>
            <TextInput
              style={[styles.input, styles.prompt]}
              value={value.prompt}
              onChangeText={(prompt) => setValue({ ...value, prompt })}
              placeholder={t("editor.promptPlaceholder")}
              placeholderTextColor={colors.inkSoft}
              multiline
              maxLength={1000}
            />
            <Text style={styles.hint}>{t("editor.correctHint")}</Text>
            {value.options.map((option, at) => (
              <View key={at} style={styles.optionRow}>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityState={{ selected: value.correct === at }}
                  onPress={() => setValue({ ...value, correct: at })}
                  style={[styles.letter, value.correct === at && styles.letterRight]}
                >
                  {value.correct === at
                    ? <Check color="#fff" size={18} strokeWidth={2.6} />
                    : <Text style={styles.letterText}>{OPTION_LETTERS[at]}</Text>}
                </Pressable>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={option}
                  onChangeText={(text) => setValue({ ...value, options: value.options.map((other, i) => (i === at ? text : other)) })}
                  placeholder={t("editor.option", { letter: OPTION_LETTERS[at] })}
                  placeholderTextColor={colors.inkSoft}
                  maxLength={300}
                />
              </View>
            ))}
            {problem || error ? <InlineError message={(problem ?? error)!} /> : null}
            <PrimaryButton label={t("editor.save")} loading={saving} onPress={save} />
            <PrimaryButton label={t("editor.cancel")} tone="ghost" disabled={saving} onPress={onClose} />
          </KeyboardAwareScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(10,8,20,0.45)" },
  sheet: { maxHeight: "92%", backgroundColor: colors.canvas, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  content: { padding: spacing.xl, gap: spacing.md },
  title: { ...typography.title, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkMuted },
  input: {
    ...typography.body, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.md,
    paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
  },
  prompt: { minHeight: 90, textAlignVertical: "top" },
  optionRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  letter: {
    width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center",
    borderWidth: 1.5, borderColor: colors.borderStrong, backgroundColor: colors.surface,
  },
  letterRight: { backgroundColor: colors.success, borderColor: colors.success },
  letterText: { fontFamily: "JaxongirmanSans_700Bold", fontSize: 15, color: colors.inkMuted },
}));
