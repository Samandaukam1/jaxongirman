import type { Json } from "@jaxongirman/types";
import { Check, Plus, Trash2 } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";

import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Editing the numbers behind a chart and the cells of a table (§74, §75).
 *
 * Both write straight into the element's `content`, which is the same field the
 * renderer reads, so a change shows on the slide as it is typed — there is no
 * separate data model to keep in step. The element's *style* is never touched:
 * a user retyping a value must not be able to walk the design out of shape.
 */

type Bag = { [key: string]: Json | undefined };

const CHART_KINDS = [
  { key: "bar", label: "Ustun" },
  { key: "line", label: "Chiziq" },
  { key: "donut", label: "Doira" },
] as const;

/** At least two points, or a chart is a single bar and says nothing. */
const MIN_POINTS = 2;
const MAX_POINTS = 12;

function labelsOf(content: Bag): string[] {
  return Array.isArray(content.labels) ? content.labels.map((label) => String(label ?? "")) : [];
}

function valuesOf(content: Bag): number[] {
  return Array.isArray(content.values) ? content.values.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0)) : [];
}

export function ChartDataEditor({ content, onChange }: { content: Bag; onChange: (next: Bag) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const labels = labelsOf(content);
  const values = valuesOf(content);
  const rows = useMemo(
    () => Array.from({ length: Math.max(labels.length, values.length) }, (_, index) => ({
      label: labels[index] ?? "",
      value: values[index] ?? 0,
    })),
    [labels, values],
  );
  const kind = typeof content.chartType === "string" ? content.chartType : "bar";

  const commit = (next: { label: string; value: number }[]) => {
    onChange({
      ...content,
      labels: next.map((row) => row.label),
      values: next.map((row) => row.value),
    });
  };

  return (
    <View style={styles.panel}>
      <View style={styles.kindRow}>
        {CHART_KINDS.map((option) => {
          const active = option.key === kind;
          return (
            <Pressable
              key={option.key}
              accessibilityRole="radio"
              accessibilityState={{ selected: active }}
              // `chartKind` is what the design asked for; retyping the numbers
              // must not silently claim the author picked a different chart.
              onPress={() => onChange({ ...content, chartType: option.key })}
              style={[styles.kindChip, active && styles.kindChipActive]}
            >
              <Text style={[styles.kindText, active && styles.activeText]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.headerRow}>
        <Text style={[styles.headerCell, styles.grow]}>Kategoriya</Text>
        <Text style={[styles.headerCell, styles.valueColumn]}>Qiymat</Text>
        <View style={styles.actionColumn} />
      </View>

      <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
        {rows.map((row, index) => (
          <View key={index} style={styles.row}>
            <TextInput
              value={row.label}
              onChangeText={(next) => commit(rows.map((entry, at) => (at === index ? { ...entry, label: next } : entry)))}
              placeholder={`Qator ${index + 1}`}
              placeholderTextColor={colors.inkMuted}
              style={[styles.input, styles.grow]}
            />
            <TextInput
              value={String(row.value)}
              onChangeText={(next) => {
                // A half-typed number ("-", "1.") must not blank the chart, so
                // an unparseable entry holds the previous value rather than 0.
                const parsed = Number(next.replace(",", "."));
                const value = next.trim() === "" ? 0 : Number.isFinite(parsed) ? parsed : row.value;
                commit(rows.map((entry, at) => (at === index ? { ...entry, value } : entry)));
              }}
              keyboardType="numeric"
              style={[styles.input, styles.valueColumn]}
            />
            <Pressable
              accessibilityLabel="Qatorni o‘chirish"
              disabled={rows.length <= MIN_POINTS}
              onPress={() => commit(rows.filter((_, at) => at !== index))}
              style={[styles.iconButton, rows.length <= MIN_POINTS && styles.disabled]}
            >
              <Trash2 color={colors.inkMuted} size={16} strokeWidth={icon.stroke} />
            </Pressable>
          </View>
        ))}
      </ScrollView>

      <Pressable
        disabled={rows.length >= MAX_POINTS}
        onPress={() => commit([...rows, { label: `Qator ${rows.length + 1}`, value: 0 }])}
        style={[styles.addButton, rows.length >= MAX_POINTS && styles.disabled]}
      >
        <Plus color={colors.primary} size={16} strokeWidth={icon.strokeBold} />
        <Text style={styles.addText}>Qator qo‘shish</Text>
      </Pressable>
    </View>
  );
}

/* ------------------------------------------------------------------ table */

const MAX_COLUMNS = 6;
const MAX_ROWS = 12;

function gridOf(content: Bag): { columns: string[]; rows: string[][]; header: boolean } {
  const columns = Array.isArray(content.columns) ? content.columns.map((column) => String(column ?? "")) : [];
  const rows = Array.isArray(content.rows)
    ? content.rows.map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? "")) : []))
    : [];
  const width = Math.max(columns.length, ...rows.map((row) => row.length), 1);
  return {
    columns: Array.from({ length: width }, (_, index) => columns[index] ?? ""),
    rows: rows.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? "")),
    header: content.header !== false && columns.length > 0,
  };
}

export function TableDataEditor({ content, onChange }: { content: Bag; onChange: (next: Bag) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const grid = useMemo(() => gridOf(content), [content]);
  const width = grid.columns.length;

  const commit = (next: Partial<{ columns: string[]; rows: string[][]; header: boolean }>) => {
    onChange({
      ...content,
      columns: next.columns ?? grid.columns,
      rows: next.rows ?? grid.rows,
      header: next.header ?? grid.header,
      // A hand-edited table is whatever the user made it; the renderer's own
      // truncation flag would be stale the moment they added a row.
      truncated: false,
    });
  };

  return (
    <View style={styles.panel}>
      <View style={styles.kindRow}>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: grid.header }}
          onPress={() => commit({ header: !grid.header })}
          style={[styles.kindChip, grid.header && styles.kindChipActive]}
        >
          {grid.header ? <Check color={colors.onPrimary} size={13} strokeWidth={icon.strokeBold} /> : null}
          <Text style={[styles.kindText, grid.header && styles.activeText]}>Sarlavha qatori</Text>
        </Pressable>
        <Pressable
          disabled={width >= MAX_COLUMNS}
          onPress={() => commit({
            columns: [...grid.columns, ""],
            rows: grid.rows.map((row) => [...row, ""]),
          })}
          style={[styles.kindChip, width >= MAX_COLUMNS && styles.disabled]}
        >
          <Plus color={colors.primary} size={14} strokeWidth={icon.strokeBold} />
          <Text style={styles.kindText}>Ustun</Text>
        </Pressable>
        <Pressable
          disabled={width <= 1}
          onPress={() => commit({
            columns: grid.columns.slice(0, -1),
            rows: grid.rows.map((row) => row.slice(0, -1)),
          })}
          style={[styles.kindChip, width <= 1 && styles.disabled]}
        >
          <Trash2 color={colors.inkMuted} size={14} strokeWidth={icon.stroke} />
          <Text style={styles.kindText}>Ustun</Text>
        </Pressable>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <View>
          {grid.header ? (
            <View style={styles.row}>
              {grid.columns.map((column, index) => (
                <TextInput
                  key={index}
                  value={column}
                  onChangeText={(next) => commit({ columns: grid.columns.map((entry, at) => (at === index ? next : entry)) })}
                  placeholder={`Ustun ${index + 1}`}
                  placeholderTextColor={colors.inkMuted}
                  style={[styles.input, styles.cell, styles.headerInput]}
                />
              ))}
              <View style={styles.actionColumn} />
            </View>
          ) : null}

          <ScrollView style={styles.scroll} keyboardShouldPersistTaps="handled">
            {grid.rows.map((row, rowIndex) => (
              <View key={rowIndex} style={styles.row}>
                {row.map((cell, cellIndex) => (
                  <TextInput
                    key={cellIndex}
                    value={cell}
                    onChangeText={(next) => commit({
                      rows: grid.rows.map((entry, at) =>
                        at === rowIndex ? entry.map((value, column) => (column === cellIndex ? next : value)) : entry),
                    })}
                    style={[styles.input, styles.cell]}
                  />
                ))}
                <Pressable
                  accessibilityLabel="Qatorni o‘chirish"
                  disabled={grid.rows.length <= 1}
                  onPress={() => commit({ rows: grid.rows.filter((_, at) => at !== rowIndex) })}
                  style={[styles.iconButton, grid.rows.length <= 1 && styles.disabled]}
                >
                  <Trash2 color={colors.inkMuted} size={16} strokeWidth={icon.stroke} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      </ScrollView>

      <Pressable
        disabled={grid.rows.length >= MAX_ROWS}
        onPress={() => commit({ rows: [...grid.rows, Array.from({ length: width }, () => "")] })}
        style={[styles.addButton, grid.rows.length >= MAX_ROWS && styles.disabled]}
      >
        <Plus color={colors.primary} size={16} strokeWidth={icon.strokeBold} />
        <Text style={styles.addText}>Qator qo‘shish</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  panel: { gap: spacing.sm, maxHeight: 300 },
  kindRow: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  kindChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: spacing.md, paddingVertical: 7, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  kindChipActive: { backgroundColor: colors.primary },
  kindText: { ...typography.caption, color: colors.ink },
  activeText: { color: colors.onPrimary },
  headerRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: 2 },
  headerCell: { ...typography.caption, color: colors.inkMuted },
  scroll: { maxHeight: 168 },
  row: { flexDirection: "row", gap: spacing.xs, alignItems: "center", marginBottom: spacing.xs },
  input: { ...typography.bodyMedium, color: colors.ink, backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 8 },
  cell: { width: 132 },
  headerInput: { fontWeight: "700" },
  grow: { flex: 1 },
  valueColumn: { width: 84, textAlign: "right" },
  actionColumn: { width: 32 },
  iconButton: { width: 32, height: 32, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  disabled: { opacity: 0.35 },
  addButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 9, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  addText: { ...typography.caption, color: colors.primary },
}));
