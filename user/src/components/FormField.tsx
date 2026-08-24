import { Text, TextInput, View, type TextInputProps } from "react-native";

import { radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = TextInputProps & { label: string; hint?: string; error?: string };

export function FormField({ label, hint, error, multiline, style, ...props }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.group}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
      <TextInput
        placeholderTextColor={colors.inkSoft}
        multiline={multiline}
        style={[styles.input, multiline && styles.multiline, error && styles.errorInput, style]}
        {...props}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  group: { gap: spacing.sm },
  labelRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: spacing.md },
  label: { ...typography.bodyMedium, color: colors.ink },
  hint: { ...typography.caption, color: colors.inkSoft },
  input: {
    ...typography.body,
    color: colors.ink,
    backgroundColor: colors.surfaceMuted,
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  multiline: { minHeight: 104, textAlignVertical: "top" },
  errorInput: { borderColor: colors.danger },
  error: { ...typography.caption, color: colors.danger },
}));
