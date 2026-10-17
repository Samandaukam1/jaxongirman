import { Check, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Modal, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PrimaryButton } from "@/components/PrimaryButton";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = {
  visible: boolean;
  title: string;
  description: string;
  placeholder: string;
  value: string;
  maxLength: number;
  /** Ready-made lines a person can tap in instead of typing them. */
  suggestions?: readonly string[];
  onClose: () => void;
  onSave: (value: string) => void;
};

/**
 * A page of the create form that only exists when it is asked for.
 *
 * Sources and requirements are both optional and both long, and as open text
 * areas in the middle of the form they pushed the button a person came for
 * below the fold. Here each is a button on the form and a sheet of its own:
 * typed into with the keyboard up and the whole screen to do it in, saved or
 * thrown away as one decision.
 */
export function NoteSheet({ visible, title, description, placeholder, value, maxLength, suggestions = [], onClose, onSave }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("common");
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState(value);

  // Every opening starts from what is saved, never from an abandoned draft.
  useEffect(() => { if (visible) setDraft(value); }, [value, visible]);

  const lines = draft.split("\n").map((line) => line.trim()).filter(Boolean);
  const toggle = (line: string) => {
    setDraft((current) => {
      const existing = current.split("\n").map((one) => one.trim()).filter(Boolean);
      const next = existing.includes(line) ? existing.filter((one) => one !== line) : [...existing, line];
      return next.join("\n").slice(0, maxLength);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* Above the keyboard on both platforms: Android draws a Modal edge to edge, where the system no longer resizes it. */}
      <KeyboardAvoidingView behavior="padding" style={styles.fill}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
          <View style={styles.grabber} />
          <View style={styles.head}>
            <View style={styles.headCopy}>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.description}>{description}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={t("close")} onPress={onClose} hitSlop={10}>
              <X color={colors.inkMuted} size={icon.md} strokeWidth={icon.stroke} />
            </Pressable>
          </View>

          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
            <TextInput
              value={draft}
              onChangeText={(text) => setDraft(text.slice(0, maxLength))}
              placeholder={placeholder}
              placeholderTextColor={colors.inkSoft}
              multiline
              autoFocus={suggestions.length === 0}
              textAlignVertical="top"
              style={styles.input}
            />
            <Text style={styles.counter}>{draft.length} / {maxLength}</Text>

            {suggestions.length ? (
              <View style={styles.suggestions}>
                {suggestions.map((line) => {
                  const on = lines.includes(line);
                  return (
                    <Pressable
                      key={line}
                      accessibilityRole="button"
                      accessibilityState={{ selected: on }}
                      onPress={() => toggle(line)}
                      style={[styles.chip, on && styles.chipOn]}
                    >
                      {on ? <Check color={colors.primary} size={13} strokeWidth={icon.strokeBold} /> : null}
                      <Text style={[styles.chipText, on && styles.chipTextOn]}>{line}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </ScrollView>

          <View style={styles.actions}>
            <PrimaryButton label={t("save")} onPress={() => { onSave(draft.trim()); onClose(); }} />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  fill: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(10,6,20,0.45)" },
  sheet: {
    maxHeight: "88%",
    backgroundColor: colors.canvas,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
  },
  grabber: { alignSelf: "center", width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border, marginTop: spacing.sm },
  head: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, paddingHorizontal: spacing.xl, paddingTop: spacing.md },
  headCopy: { flex: 1, gap: 4 },
  title: { ...typography.heading, color: colors.ink },
  description: { ...typography.caption, color: colors.inkMuted },
  body: { paddingHorizontal: spacing.xl, paddingTop: spacing.lg, gap: spacing.sm },
  input: {
    ...typography.body,
    minHeight: 150,
    maxHeight: 260,
    padding: spacing.md,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  counter: { ...typography.caption, color: colors.inkSoft, alignSelf: "flex-end" },
  suggestions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, paddingTop: spacing.xs },
  chip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 9,
    borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface,
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...typography.caption, color: colors.inkMuted },
  chipTextOn: { color: colors.primary, fontFamily: "Manrope_600SemiBold" },
  actions: { paddingHorizontal: spacing.xl, paddingTop: spacing.md },
}));
