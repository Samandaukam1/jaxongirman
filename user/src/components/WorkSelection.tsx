import { useFocusEffect, useRouter } from "expo-router";
import { Check, Trash2, X } from "lucide-react-native";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, BackHandler, Pressable, Text, useWindowDimensions, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { Easing, FadeIn, FadeOut } from "react-native-reanimated";

import { deleteWork, isSendable, type WorkKind } from "@/components/DeleteWorkButton";
import { SendGlyph } from "@/components/SendGlyph";
import { asFunctionErrorMessage } from "@/lib/format";
import { haptic } from "@/lib/haptics";
import { isWeb } from "@/lib/web";
import { icon, radius, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

/**
 * Choosing several of one's own works at once, on Loyihalar and on O‘yingoh.
 *
 * A long press on a row used to ask to delete that one row, which made the
 * gesture people reach for to pick things up do the most final thing in the
 * app. Now it starts choosing: the row is ticked, taps tick more, and a bar
 * where the title was offers what can be done with all of them — send them to
 * a chat, or delete them. One hook and one bar for both tabs, so the two lists
 * a person moves between with one tap behave as one list.
 *
 * What may be done to a row is decided by the screen that knows it (`sendable`,
 * `deletable`) and only read here: a bought game is a licence rather than a
 * file, and stays undeletable however it was chosen.
 */

export type SelectableWork = {
  kind: WorkKind;
  id: string;
  title: string;
  /** Finished, and of a kind a chat can carry. */
  sendable: boolean;
  /** Made by this account, rather than bought or shared with it. */
  deletable: boolean;
};

export type WorkSelection = {
  /** Rows are being chosen: taps tick rather than open. */
  active: boolean;
  /** In the order they were chosen — the order they are sent in. */
  selected: readonly SelectableWork[];
  /** Deleting is under way; the bar and the rows hold still until it ends. */
  busy: boolean;
  progress: { done: number; total: number } | null;
  canSend: boolean;
  canDelete: boolean;
  isSelected: (work: Pick<SelectableWork, "kind" | "id">) => boolean;
  /** A long press starts choosing with this row; while choosing, a tap flips it. */
  pick: (work: SelectableWork) => void;
  clear: () => void;
  send: () => void;
  remove: () => void;
};

const keyOf = (work: Pick<SelectableWork, "kind" | "id">) => `${work.kind}:${work.id}`;

/** How many titles the delete question names before it stops listing. */
const NAMED = 6;

/**
 * The selection itself.
 *
 * `works` is everything the screen has loaded, not what a search is showing:
 * a row chosen and then filtered out of view is still chosen, and a row that
 * a refresh no longer returns quietly stops being. `onRemoved` takes each work
 * off the screen's list as soon as its own deletion succeeds, so the list
 * shrinks while the bar counts.
 */
export function useWorkSelection(works: readonly SelectableWork[], onRemoved: (work: SelectableWork) => void): WorkSelection {
  const router = useRouter();
  const { t } = useTranslation(["projects", "common"]);
  const [keys, setKeys] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const running = useRef(false);
  const focused = useRef(true);

  const byKey = useMemo(() => new Map(works.map((work) => [keyOf(work), work])), [works]);
  const selected = useMemo(() => keys.flatMap((key) => {
    const work = byKey.get(key);
    return work ? [work] : [];
  }), [byKey, keys]);
  const chosen = useMemo(() => new Set(selected.map(keyOf)), [selected]);
  const active = selected.length > 0;
  const busy = progress !== null;

  /**
   * The system's back gesture puts the selection down before it leaves the
   * screen, as it does in every list that can be chosen from; Escape does the
   * same in a browser. Neither interrupts a deletion that is under way.
   */
  useFocusEffect(useCallback(() => {
    if (!active) return undefined;
    const back = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!running.current) setKeys([]);
      return true;
    });
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !running.current) setKeys([]);
    };
    if (isWeb) window.addEventListener("keydown", escape);
    return () => {
      back.remove();
      if (isWeb) window.removeEventListener("keydown", escape);
    };
  }, [active]));

  // Leaving the tab leaves the choice behind: coming back to rows still
  // ticked from a minute ago, with taps that tick instead of open, is a trap.
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => {
      focused.current = false;
      if (!running.current) setKeys([]);
    };
  }, []));

  function pick(work: SelectableWork) {
    if (running.current) return;
    const key = keyOf(work);
    if (active) haptic.select(); else haptic.light();
    // Starting afresh drops keys left from rows a refresh has since removed.
    setKeys((current) => (!active ? [key] : current.includes(key) ? current.filter((each) => each !== key) : [...current, key]));
  }

  function clear() {
    if (!running.current) setKeys([]);
  }

  const sendable = selected.filter((work) => work.sendable && isSendable(work.kind));
  const deletable = selected.filter((work) => work.deletable);

  /** Everything that can go, in the order it was chosen; what cannot is counted so the chat screen can say so. */
  function send() {
    if (running.current || sendable.length === 0) return;
    haptic.light();
    router.push({
      pathname: "/(app)/chat/share",
      params: {
        items: JSON.stringify(sendable.map(({ kind, id, title }) => ({ kind, id, title }))),
        skipped: String(selected.length - sendable.length),
      },
    });
    setKeys([]);
  }

  /**
   * One by one rather than all at once: `delete-work` checks each row's owner
   * and takes files with it, and a row that fails should not take the others
   * down. Each success leaves the list at once; failures are told together at
   * the end, and — if the person is still here — stay chosen for another try.
   */
  async function run(doomed: readonly SelectableWork[]) {
    running.current = true;
    setProgress({ done: 0, total: doomed.length });
    const failed: { work: SelectableWork; message: string }[] = [];
    for (const [index, work] of doomed.entries()) {
      try {
        await deleteWork(work.kind, work.id);
        onRemoved(work);
      } catch (failure) {
        failed.push({ work, message: await asFunctionErrorMessage(failure) });
      }
      setProgress({ done: index + 1, total: doomed.length });
    }
    running.current = false;
    setProgress(null);
    setKeys(focused.current ? failed.map(({ work }) => keyOf(work)) : []);
    if (failed.length === 0) {
      haptic.success();
      return;
    }
    haptic.error();
    const title = t("projects:select.deleteFailed", { count: failed.length });
    const body = failed.map(({ work, message }) => `• ${work.title}: ${message}`).join("\n");
    if (isWeb) window.alert(`${title}\n\n${body}`);
    else Alert.alert(title, body);
  }

  /**
   * One question for the lot, naming how many and — up to a handful — which.
   * In a browser the question is the browser's own: react-native-web's `Alert`
   * draws nothing, so a bin there would be a button that never answers.
   */
  function remove() {
    if (running.current || deletable.length === 0) return;
    const kept = selected.length - deletable.length;
    const question = t("projects:select.deleteAsk", { count: deletable.length });
    const names = deletable.slice(0, NAMED).map((work) => `• ${work.title}`);
    if (deletable.length > NAMED) names.push("…");
    const body = [
      names.join("\n"),
      t("projects:select.deleteBody"),
      kept > 0 ? t("projects:select.deleteKept", { count: kept }) : "",
    ].filter(Boolean).join("\n\n");
    const go = () => void run(deletable);
    if (isWeb) {
      if (window.confirm(`${question}\n\n${body}`)) go();
      return;
    }
    haptic.light();
    Alert.alert(question, body, [
      { text: t("common:cancel"), style: "cancel" },
      { text: t("common:delete"), style: "destructive", onPress: go },
    ]);
  }

  return {
    active,
    selected,
    busy,
    progress,
    canSend: sendable.length > 0,
    canDelete: deletable.length > 0,
    isSelected: (work) => chosen.has(keyOf(work)),
    pick,
    clear,
    send,
    remove,
  };
}

/** Below this a phone gets the two icons the rows already use; above it, the words beside them. */
const LABELS_FIT = 520;

/**
 * The bar that takes the title's place while rows are being chosen: put the
 * choice down, how many, send, delete.
 *
 * It is laid over the title row by the screen (`style`) rather than swapped in
 * for it, so the header keeps the height it measured and the fold under it
 * does not move by a pixel when choosing starts.
 */
export function SelectionBar({ selection, style }: { selection: WorkSelection; style?: StyleProp<ViewStyle> }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation("projects");
  const { width } = useWindowDimensions();
  const labelled = width >= LABELS_FIT;
  const { busy, progress, canSend, canDelete } = selection;

  return (
    <Animated.View
      entering={FadeIn.duration(160).easing(Easing.out(Easing.cubic))}
      exiting={FadeOut.duration(120).easing(Easing.out(Easing.cubic))}
      accessibilityRole="toolbar"
      style={[styles.bar, style]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("select.cancel")}
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        hitSlop={6}
        onPress={selection.clear}
        style={({ pressed }) => [styles.round, pressed && styles.pressed, busy && styles.off]}
      >
        <X color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
      </Pressable>

      <Text numberOfLines={1} style={styles.count} aria-live="polite">
        {progress ? t("select.deleting", { done: progress.done, total: progress.total }) : t("select.count", { count: selection.selected.length })}
      </Text>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("select.send")}
        accessibilityState={{ disabled: busy || !canSend }}
        disabled={busy || !canSend}
        hitSlop={4}
        onPress={selection.send}
        style={({ pressed }) => [styles.action, styles.send, labelled && styles.labelled, pressed && styles.pressed, (busy || !canSend) && styles.off]}
      >
        <SendGlyph size={18} color={colors.primary} fold={colors.primarySoft} />
        {labelled ? <Text style={styles.sendText}>{t("select.send")}</Text> : null}
      </Pressable>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("select.delete")}
        accessibilityState={{ disabled: busy || !canDelete, busy }}
        disabled={busy || !canDelete}
        hitSlop={4}
        onPress={selection.remove}
        style={({ pressed }) => [styles.action, styles.delete, labelled && styles.labelled, pressed && styles.pressed, !busy && !canDelete && styles.off]}
      >
        {busy
          ? <ActivityIndicator size="small" color={colors.danger} />
          : <Trash2 color={colors.danger} size={18} strokeWidth={2} />}
        {labelled ? <Text style={styles.deleteText}>{t("select.delete")}</Text> : null}
      </Pressable>
    </Animated.View>
  );
}

/**
 * The tick a row shows while rows are being chosen, in the slot its plane or
 * bin had, so nothing on the row shifts when choosing starts or ends.
 */
export function SelectCheck({ selected }: { selected: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Animated.View entering={FadeIn.duration(140).easing(Easing.out(Easing.cubic))} style={styles.checkSlot}>
      <View style={[styles.check, selected && styles.checkOn]}>
        {selected ? <Check color={colors.onPrimary} size={14} strokeWidth={3} /> : null}
      </View>
    </Animated.View>
  );
}

/** A chosen row: the brand's softest wash and its rim — one look for both tabs' rows. */
export function useSelectedRowStyle(): ViewStyle {
  return useStyles().selectedRow;
}

const useStyles = makeStyles((colors) => ({
  bar: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.canvas },
  // The same 40-point circle as the header's search and bell, so the bar reads as the header's own furniture.
  round: {
    width: 40, height: 40, borderRadius: radius.pill,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surfaceMuted,
  },
  count: { ...typography.heading, color: colors.ink, flex: 1 },
  action: {
    minWidth: 40, height: 40, borderRadius: radius.pill,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6,
  },
  labelled: { paddingHorizontal: spacing.md },
  send: { backgroundColor: colors.primarySoft },
  sendText: { ...typography.bodyMedium, color: colors.primaryDeep },
  delete: { backgroundColor: colors.dangerSoft },
  deleteText: { ...typography.bodyMedium, color: colors.danger },
  pressed: { opacity: 0.75 },
  off: { opacity: 0.4 },
  checkSlot: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  check: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.borderStrong,
  },
  checkOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  selectedRow: { backgroundColor: colors.primarySoft, borderColor: colors.primary },
}));
