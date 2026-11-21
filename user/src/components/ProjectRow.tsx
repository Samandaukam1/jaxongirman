import { LinearGradient } from "expo-linear-gradient";
import { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useDeleteWork, useWorkRowAccessibility, WorkRowEnd } from "@/components/DeleteWorkButton";
import { Touchable } from "@/components/Touchable";
import { SelectCheck, useSelectedRowStyle } from "@/components/WorkSelection";
import { isWeb } from "@/lib/web";
import { ObjectiveArt, PortraitArt, ScientificArt, SlideCreateArt, type Art } from "@/components/toolArt";
import { kindLabel, statusLabel, type Project, type ProjectKind } from "@/lib/projects";
import { withAlpha } from "@/theme/color";
import { radius, shadow, spacing, toolTint, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * One thing this account has made, whatever kind of thing it is.
 *
 * The same row for all four, because from the reader's side they are the same
 * object: something with a name, a date, and a place it opens. A different card
 * per kind would say the opposite — that these are four apps sharing a screen.
 *
 * What varies is the mark, and it is the same mark the tool above it carries —
 * the drawing that made the thing, on a plate in that tool's own colour. Four
 * identical violet glyphs told you nothing until you read the line under the
 * title; a green cap and a blue document are read before the words are.
 */

type Mark = { art: Art; tint: string };

const MARK: Record<ProjectKind, Mark> = {
  presentation: { art: SlideCreateArt, tint: toolTint.slideCreate },
  portrait: { art: PortraitArt, tint: toolTint.portrait },
  objective: { art: ObjectiveArt, tint: toolTint.objective },
  academic: { art: ScientificArt, tint: toolTint.academic },
};

const ART = 26;

/**
 * The plate under the mark, in that tool's colour.
 *
 * The same construction as the cards on the shelf above — the hue at a wash,
 * never at strength — so the two read as one system rather than as a list that
 * happens to be colourful. Dark mode leans on it a little harder because a
 * fifth of an alpha that is felt on white disappears on near-black.
 */
const Plate = memo(function Plate({ tint, night }: { tint: string; night: boolean }) {
  const stops = useMemo<readonly [string, string]>(() => (night
    ? [withAlpha(tint, 0.34), withAlpha(tint, 0.1)]
    : [withAlpha(tint, 0.22), withAlpha(tint, 0.05)]), [night, tint]);

  return (
    <LinearGradient
      colors={stops}
      start={{ x: 0.2, y: 0 }}
      end={{ x: 0.8, y: 1 }}
      style={StyleSheet.absoluteFill}
    />
  );
});

/** Anything not finished says so; a finished thing says nothing. */
const LOUD = new Set(["writing", "planning", "paused", "failed", "generating", "draft"]);

function ago(iso: string): string {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 1) return "hozir";
  if (minutes < 60) return `${minutes} daqiqa oldin`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} soat oldin`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days} kun oldin` : new Date(iso).toLocaleDateString("uz");
}

/** A finished deck or scientific work can go to a chat; a photo sheet or an obyektivka cannot. */
export const projectSendable = (project: Project): boolean =>
  (project.kind === "presentation" || project.kind === "academic") && project.status === "ready";

export function ProjectRow({ project, onPress, onDeleted, selecting = false, selected = false, onSelect }: {
  project: Project;
  onPress: () => void;
  onDeleted?: () => void;
  /** Rows are being chosen: a tap ticks this one instead of opening it. */
  selecting?: boolean;
  selected?: boolean;
  /** A long press, or a tap while choosing — see `useWorkSelection`. */
  onSelect?: () => void;
}) {
  const { scheme } = useTheme();
  const styles = useStyles();
  const chosen = useSelectedRowStyle();
  const { art: Art, tint } = MARK[project.kind];
  const status = statusLabel(project.status);
  const loud = project.status ? LOUD.has(project.status) : false;
  const deletion = useDeleteWork(project.kind, project.id, project.title, onDeleted ?? (() => undefined));
  const sendable = projectSendable(project);
  const access = useWorkRowAccessibility({
    kind: project.kind, id: project.id, title: project.title, sendable, onDeleted, deletion, selecting, onSelect,
  });

  return (
    <Touchable
      // While choosing, the row is a checkbox: that is what a tap on it does.
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${kindLabel(project.kind)}: ${project.title}`}
      {...access}
      disabled={deletion.busy}
      onPress={selecting && onSelect ? onSelect : onPress}
      onLongPress={onSelect}
      // Longer in a browser, where a long press is also a slow click.
      delayLongPress={isWeb ? 600 : 380}
      style={[styles.row, selected && chosen]}
    >
      <View style={[styles.glyph, { borderColor: withAlpha(tint, scheme === "dark" ? 0.3 : 0.2) }]}>
        <Plate tint={tint} night={scheme === "dark"} />
        <Art width={ART} height={ART} />
      </View>
      <View style={styles.copy}>
        <Text numberOfLines={2} style={styles.title}>{project.title}</Text>
        <Text numberOfLines={1} style={styles.meta}>
          {kindLabel(project.kind)} · {project.detail} · {ago(project.updatedAt)}
        </Text>
      </View>
      {/**
        * A finished thing gets a dot; an unfinished one gets the word.
        *
        * O‘yingoh's rows end in a status dot and these should read as the same
        * furniture, but a dot cannot say "Yozilmoqda" — and a half-written
        * academic work is exactly the row a person is scanning for.
        */}
      {status && loud
        ? <View style={styles.badge}><Text style={styles.badgeText}>{status}</Text></View>
        : <View style={styles.dot} />}
      {selecting
        ? <SelectCheck selected={selected} />
        : <WorkRowEnd kind={project.kind} id={project.id} title={project.title} sendable={sendable} onDeleted={onDeleted} deletion={deletion} />}
    </Touchable>
  );
}

const useStyles = makeStyles((colors) => ({
  // Geometry copied from O‘yingoh's rows on purpose: one padding, one corner,
  // one chip size, so a person moving between the two tabs sees one list style
  // rather than two that nearly agree.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadow,
  },
  glyph: {
    width: 42, height: 42, borderRadius: radius.md,
    alignItems: "center", justifyContent: "center",
    // The plate is a gradient behind the mark, so the box clips rather than
    // fills, and the rim is set per row from the tool's own hue.
    overflow: "hidden",
    borderWidth: 1,
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.body, fontWeight: "700", color: colors.ink },
  meta: { ...typography.caption, color: colors.inkSoft },
  badge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: radius.sm, backgroundColor: colors.primarySoft },
  badgeText: { ...typography.caption, fontWeight: "700", color: colors.primaryDeep },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success },
}));
