import type { Json } from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  ArrowLeft, Check, Frame, Image as ImageIcon, Library, LoaderCircle, Redo2, Shapes, Type, Undo2, Video,
  type LucideIcon,
} from "lucide-react-native";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type ListRenderItemInfo } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useReanimatedKeyboardAnimation } from "react-native-keyboard-controller";
import Animated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { DeckFontSheet } from "@/components/DeckFontSheet";
import { Spin } from "@/components/Spin";
import { ElementPicker } from "@/components/ElementPicker";
import { ElementToolbar, type ToolPanel } from "@/components/ElementToolbar";
import { SelectionOverlay, type TransformPatch } from "@/components/SelectionOverlay";
import { MODEL_HEIGHT, MODEL_WIDTH, SlideCanvas } from "@/components/SlideCanvas";
import { loadDeck, useSlideGroups, loadDeckFonts, type Element, type Presentation, type Slide } from "@/lib/deck";
import { deckFacesOf, PAIRINGS, restyle, type Pairing, type ResolvedFace } from "@/lib/deckFonts";
import { asErrorMessage } from "@/lib/format";
import {
  initialPlacement, placementOf, resolveElement, rowsFor,
  type Placement, type ResolvedElement,
} from "@/lib/jelement";
import { supabase } from "@/lib/supabase";
import { bag, isDarkColor, slideSwatches, str } from "@/lib/textStyle";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, shadow, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Patch = Partial<Pick<Element, "x" | "y" | "width" | "height" | "rotation" | "z_index" | "opacity" | "locked" | "style" | "content">>;
type InsertKind = "text" | "image" | "shape" | "frame" | "video" | "element";

/** Videos live in the same bucket as images; anything larger is a bad slide. */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
const HISTORY = 40;

/** What can be put on a slide; each kind's name is in the `editor` table under `insert`. */
const INSERTS: { kind: InsertKind; icon: LucideIcon }[] = [
  { kind: "text", icon: Type },
  { kind: "image", icon: ImageIcon },
  { kind: "shape", icon: Shapes },
  { kind: "frame", icon: Frame },
  { kind: "video", icon: Video },
  { kind: "element", icon: Library },
];

function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
}

function serializableElement(element: Element): Record<string, Json> {
  return {
    id: element.id, type: element.type, x: element.x, y: element.y, width: element.width, height: element.height,
    rotation: element.rotation, z_index: element.z_index, opacity: element.opacity, locked: element.locked,
    style: element.style, content: element.content,
  };
}

function operationPatch(patch: Patch): Record<string, Json> {
  const result: Record<string, Json> = {};
  if (patch.x !== undefined) result.x = patch.x;
  if (patch.y !== undefined) result.y = patch.y;
  if (patch.width !== undefined) result.width = patch.width;
  if (patch.height !== undefined) result.height = patch.height;
  if (patch.rotation !== undefined) result.rotation = patch.rotation;
  if (patch.z_index !== undefined) result.zIndex = patch.z_index;
  if (patch.opacity !== undefined) result.opacity = patch.opacity;
  if (patch.locked !== undefined) result.locked = patch.locked;
  if (patch.style !== undefined) result.style = patch.style;
  if (patch.content !== undefined) result.content = patch.content;
  return result;
}

/** One slide in the strip. Memoised on its rows, so a drag on one slide redraws none of them. */
const SlideThumb = memo(function SlideThumb({ slide, elements, active, revision, onPress }: {
  slide: Slide; elements: Element[]; active: boolean; revision: number; onPress: (id: string) => void;
}) {
  const styles = useStyles();
  const { t } = useTranslation("editor");
  const scale = THUMB_WIDTH / MODEL_WIDTH;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t("slide", { number: slide.position + 1 })} onPress={() => onPress(slide.id)} style={[styles.thumb, active && styles.thumbActive]}>
      <View pointerEvents="none" style={styles.thumbClip}>
        <View style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale }], transformOrigin: "top left" }}>
          <SlideCanvas slide={slide} elements={elements} revision={revision} />
        </View>
      </View>
      <Text style={[styles.thumbNumber, active && styles.thumbNumberActive]}>{slide.position + 1}</Text>
    </Pressable>
  );
});

const THUMB_WIDTH = 96;
const NO_ROWS: Element[] = [];

/**
 * The slide editor.
 *
 * Built around the one thing it is for — the slide — at the largest size the
 * screen allows, with nothing scrolling around it: a finger that moves a
 * caption up must move the caption, not the page. Tools live at the bottom
 * where a thumb already is, and change with what is selected.
 *
 * Speed comes from what does not happen. A drag updates a single "live" copy
 * of the rows being moved; the deck, the slide strip and every other element
 * stay as they are until the finger lifts, and only then is one change saved.
 */
export default function EditorScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { t } = useTranslation(["editor", "common"]);
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ id: string }>();
  const presentationId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [elements, setElements] = useState<Element[]>([]);
  /** Rows a gesture is moving, drawn in place of the saved ones until it ends. */
  const [live, setLive] = useState<Record<string, Element> | null>(null);
  const [currentSlideId, setCurrentSlideId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [fontsOpen, setFontsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pending, setPending] = useState(0);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [past, setPast] = useState<Element[][]>([]);
  const [future, setFuture] = useState<Element[][]>([]);
  const [stage, setStage] = useState({ width: 0, height: 0 });

  const resolvedElements = useRef<Record<string, ResolvedElement>>({});
  const dragStart = useRef<Element[] | null>(null);
  const textHeights = useRef<Record<string, number>>({});
  /** The text element whose box should track its rewrapped copy right now. */
  const fitTarget = useRef<string | null>(null);

  /* ---------------------------------------------------------------- load */

  const load = useCallback(async () => {
    if (!presentationId) return;
    try {
      const deck = await loadDeck(presentationId);
      setPresentation(deck.presentation);
      setSlides(deck.slides);
      setElements(deck.elements);
      setLive(null);
      setCurrentSlideId((current) => current && deck.slides.some((slide) => slide.id === current) ? current : deck.slides[0]?.id ?? null);
      setSelectedId(null);
      void loadDeckFonts(deck.elements).then(() => setRevision((value) => value + 1));
    } catch (error) {
      Alert.alert(t("openFailed"), asErrorMessage(error), [{ text: t("common:back"), onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [presentationId, router, t]);

  useEffect(() => { void load(); }, [load]);

  /* ------------------------------------------------------------- derived */

  const bySlide = useSlideGroups(elements);

  const currentSlide = slides.find((slide) => slide.id === currentSlideId) ?? null;
  const currentElements = (currentSlideId ? bySlide.get(currentSlideId) : undefined) ?? NO_ROWS;
  const stageElements = useMemo(() => {
    if (!live) return currentElements;
    const merged = currentElements.map((row) => live[row.id] ?? row);
    // Rows a placement redraw created this frame, not yet in the deck.
    for (const row of Object.values(live)) if (!merged.some((existing) => existing.id === row.id) && row.slide_id === currentSlideId) merged.push(row);
    return merged;
  }, [currentElements, currentSlideId, live]);

  const selected = useMemo(
    () => (selectedId ? (live?.[selectedId] ?? elements.find((element) => element.id === selectedId) ?? null) : null),
    [elements, live, selectedId],
  );
  const selectedPlacement = selected ? placementOf(selected) : null;

  const selectionTarget = useMemo<Element | null>(() => {
    if (!selected) return null;
    if (!selectedPlacement) return selected;
    return { ...selected, x: selectedPlacement.x, y: selectedPlacement.y, width: selectedPlacement.width, height: selectedPlacement.height, rotation: selectedPlacement.rotation };
  }, [selected, selectedPlacement]);

  const swatches = useMemo(
    () => slideSwatches(currentSlide?.background, currentElements.map((element) => bag(element.style))),
    [currentElements, currentSlide],
  );
  const zRange = useMemo(() => ({
    min: currentElements.length ? Math.min(...currentElements.map((element) => element.z_index)) : 0,
    max: currentElements.length ? Math.max(...currentElements.map((element) => element.z_index)) : 0,
  }), [currentElements]);

  // A new selection starts with its tools closed, never someone else's panel.
  useEffect(() => { setToolPanel(null); }, [selectedId]);

  // A library element placed in an earlier session moves as one piece only
  // once its drawing is known; fetch it the moment one of its parts is picked.
  const placementKey = selectedPlacement ? `${selectedPlacement.elementId}:${selectedPlacement.version}` : null;
  useEffect(() => {
    if (!placementKey) return;
    const [elementId, version] = placementKey.split(":");
    if (!elementId || resolvedElements.current[elementId]) return;
    let live = true;
    resolveElement(elementId, Number(version))
      .then((element) => { if (live && element) resolvedElements.current[elementId] = element; })
      .catch(() => undefined);
    return () => { live = false; };
  }, [placementKey]);

  /* ---------------------------------------------------------------- stage */

  const fit = stage.width > 0
    ? Math.min((stage.width - spacing.lg * 2) / MODEL_WIDTH, (stage.height - spacing.lg * 2) / MODEL_HEIGHT)
    : 0;
  const [zoom, setZoom] = useState(1);
  const liveZoom = useSharedValue(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const livePanX = useSharedValue(0);
  const livePanY = useSharedValue(0);
  const displayScale = Math.max(0.01, fit * zoom);
  const canvasWidth = MODEL_WIDTH * displayScale;
  const canvasHeight = MODEL_HEIGHT * displayScale;

  /**
   * Two fingers zoom and move the slide, the way a photo does. One finger is
   * always the element under it — `minPointers(2)` keeps the two apart.
   */
  // Rebuilt only when the resting zoom or pan changes — never per drag frame.
  const stageGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .onUpdate((event) => {
        "worklet";
        liveZoom.value = Math.min(4, Math.max(1, zoom * event.scale));
      })
      .onEnd(() => {
        "worklet";
        runOnJS(setZoom)(liveZoom.value);
      });
    const move = Gesture.Pan()
      .minPointers(2)
      .onUpdate((event) => {
        "worklet";
        livePanX.value = pan.x + event.translationX;
        livePanY.value = pan.y + event.translationY;
      })
      .onEnd(() => {
        "worklet";
        runOnJS(setPan)({ x: livePanX.value, y: livePanY.value });
      });
    return Gesture.Simultaneous(pinch, move);
  }, [liveZoom, livePanX, livePanY, pan.x, pan.y, zoom]);
  const stageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: livePanX.value }, { translateY: livePanY.value }, { scale: liveZoom.value / zoom }],
  }), [zoom]);

  function resetZoom() {
    runOnUI(() => {
      "worklet";
      liveZoom.value = 1;
      livePanX.value = 0;
      livePanY.value = 0;
    })();
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }

  /**
   * The dock rides the keyboard, so the field being typed in stays visible.
   * Read from the keyboard library the whole app now uses: Reanimated's own
   * keyboard hook and it both claim the window's insets on Android, and the
   * second one to ask stops hearing about the keyboard. Its height is negative
   * while the keyboard is up.
   */
  const keyboard = useReanimatedKeyboardAnimation();
  const dockLift = useAnimatedStyle(() => ({ transform: [{ translateY: Math.min(0, keyboard.height.value + insets.bottom) }] }), [insets.bottom]);

  /* -------------------------------------------------------------- saving */

  async function persist(slideId: string, operation: Json, inverse: Json) {
    if (!presentationId) return;
    setPending((count) => count + 1);
    const { error } = await supabase.rpc("apply_editor_operation", {
      p_presentation_id: presentationId,
      p_slide_id: slideId,
      p_operation: operation,
      p_inverse_operation: inverse,
    });
    setPending((count) => Math.max(0, count - 1));
    if (error) {
      Alert.alert(t("saveFailed"), asErrorMessage(error));
      await load();
    }
  }

  function remember(snapshot: Element[] = elements) {
    setPast((history) => [...history.slice(-(HISTORY - 1)), snapshot]);
    setFuture([]);
  }

  function updateElement(id: string, patch: Patch, persistedPatch: Patch = patch) {
    const old = elements.find((element) => element.id === id);
    if (!old) return;
    const inverse: Patch = {};
    for (const key of Object.keys(persistedPatch) as (keyof Patch)[]) Object.assign(inverse, { [key]: old[key] });
    remember();
    setElements((rows) => rows.map((element) => element.id === id ? { ...element, ...patch } : element));
    void persist(old.slide_id, { action: "update", elementId: id, patch: operationPatch(persistedPatch) }, { action: "update", elementId: id, patch: operationPatch(inverse) });
  }

  /**
   * A style change from the toolbar.
   *
   * A Liquid Glass card is filled by its gradient; picking a colour for it
   * changed `fill` and nothing on screen, because the gradient is drawn over
   * the fill. Choosing a colour is choosing a flat fill, so the gradient goes.
   */
  function changeStyle(element: Element, next: Record<string, Json | undefined>) {
    const before = bag(element.style);
    const style: Record<string, Json | undefined> = { ...next };
    if (element.type === "shape" && style.fill !== before.fill) {
      delete style.gradientStops;
      delete style.gradientTo;
      delete style.gradientType;
    }
    updateElement(element.id, { style: style as Json });
  }

  /* ------------------------------------------------------------ gestures */

  /** Redraws every member of a placement from the element's own geometry. */
  function placementRows(placement: Placement, base: Element[]): Element[] {
    const element = resolvedElements.current[placement.elementId];
    if (!element || !presentationId || !user) return base.filter((row) => placementOf(row)?.groupId === placement.groupId);
    const members = base.filter((row) => placementOf(row)?.groupId === placement.groupId);
    const zIndex = Math.min(...members.map((row) => row.z_index));
    const slideId = members[0]?.slide_id ?? currentSlideId ?? "";
    const drawn = rowsFor(element, placement, { slideId, presentationId, ownerId: user.id, zIndex }, {});
    // Ids are kept so a gesture moves the same rows rather than new ones.
    return drawn.map((row, index) => ({ ...(members[index] ?? members[0]!), ...row, id: members[index]?.id ?? Crypto.randomUUID() } as Element));
  }

  function nextPlacement(placement: Placement, patch: TransformPatch): Placement {
    return {
      ...placement,
      x: patch.x ?? placement.x, y: patch.y ?? placement.y,
      width: patch.width ?? placement.width, height: patch.height ?? placement.height,
      rotation: patch.rotation ?? placement.rotation,
    };
  }

  /** Live feedback only: nothing is saved and nothing else redraws. */
  function applyTransform(id: string, patch: TransformPatch) {
    const base = elements.find((element) => element.id === id);
    if (!base) return;
    const placement = placementOf(base);
    if (placement && resolvedElements.current[placement.elementId]) {
      const rows = placementRows(nextPlacement(placement, patch), elements);
      setLive(Object.fromEntries(rows.map((row) => [row.id, row])));
      return;
    }
    // A sideways stretch rewraps text, so its box height follows the lines.
    fitTarget.current = patch.width !== undefined && patch.height === undefined ? id : null;
    setLive((current) => ({ [id]: { ...(current?.[id] ?? base), ...patch } as Element }));
  }

  /** One history entry and one save per gesture, from the gesture's final patch. */
  function endTransform(id: string, patch: TransformPatch) {
    const before = dragStart.current ?? elements;
    dragStart.current = null;
    fitTarget.current = null;
    setLive(null);
    const old = before.find((element) => element.id === id);
    if (!old) return;

    const placement = placementOf(old);
    if (placement && resolvedElements.current[placement.elementId]) {
      const members = placementRows(nextPlacement(placement, patch), before);
      const previous = before.filter((row) => placementOf(row)?.groupId === placement.groupId);
      const memberIds = new Set(previous.map((row) => row.id));
      remember(before);
      setElements([...before.filter((row) => !memberIds.has(row.id)), ...members]);
      void persist(old.slide_id,
        { action: "group", groupId: placement.groupId, elements: members.map(serializableElement) },
        { action: "group", groupId: placement.groupId, elements: previous.map(serializableElement) });
      return;
    }

    const changed: Patch = {};
    const inverse: Patch = {};
    for (const key of Object.keys(patch) as (keyof Patch)[]) {
      const next = (patch as Patch)[key];
      if (next === undefined || JSON.stringify(next) === JSON.stringify(old[key])) continue;
      Object.assign(changed, { [key]: next });
      Object.assign(inverse, { [key]: old[key] });
    }
    if (!Object.keys(changed).length) return;
    remember(before);
    setElements((rows) => rows.map((element) => element.id === id ? { ...element, ...changed } : element));
    void persist(old.slide_id, { action: "update", elementId: id, patch: operationPatch(changed) }, { action: "update", elementId: id, patch: operationPatch(inverse) });
  }

  function measureText(id: string, height: number) {
    textHeights.current[id] = height;
    if (fitTarget.current !== id) return;
    const next = Math.round(height);
    setLive((current) => {
      const row = current?.[id];
      if (!row || row.type !== "text" || Math.abs(row.height - next) < 1) return current;
      return { ...current, [id]: { ...row, height: next } };
    });
  }

  /** A width-only resize of text keeps the height its copy settled on. */
  function fitTextHeight(target: Element, patch: TransformPatch): TransformPatch {
    if (target.type !== "text" || patch.width === undefined || patch.height !== undefined) return patch;
    const measured = textHeights.current[target.id];
    return measured ? { ...patch, height: Math.round(measured) } : patch;
  }

  function requestEdit(id: string) {
    const target = elements.find((element) => element.id === id);
    if (target?.type === "text") setToolPanel("text");
    else if (target?.type === "chart" || target?.type === "table") setToolPanel("data");
    else if (target?.type === "image") void replaceMedia(target);
  }

  // Stable entry points for the canvas: memoised rows keep these forever, so
  // they read the screen's current state through a ref rather than a closure.
  const api = useRef({ applyTransform, endTransform, measureText, requestEdit, elements });
  useLayoutEffect(() => { api.current = { applyTransform, endTransform, measureText, requestEdit, elements }; });
  const onSelect = useCallback((id: string | null) => setSelectedId(id), []);
  const deselect = useCallback(() => setSelectedId(null), []);
  const onDragStart = useCallback(() => { dragStart.current = null; }, []);
  const onDrag = useCallback((id: string, x: number, y: number) => {
    if (!dragStart.current) dragStart.current = api.current.elements;
    api.current.applyTransform(id, { x, y });
  }, []);
  const onDragEnd = useCallback((id: string, x: number, y: number) => api.current.endTransform(id, { x, y }), []);
  const onRequestEdit = useCallback((id: string) => api.current.requestEdit(id), []);
  const onTextMeasure = useCallback((id: string, height: number) => api.current.measureText(id, height), []);

  /* ------------------------------------------------------------ actions */

  function deleteSelected() {
    if (!selected) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (selectedPlacement) {
      const removed = elements.filter((row) => placementOf(row)?.groupId === selectedPlacement.groupId);
      remember();
      setElements((rows) => rows.filter((row) => placementOf(row)?.groupId !== selectedPlacement.groupId));
      setSelectedId(null);
      void persist(selected.slide_id,
        { action: "group", groupId: selectedPlacement.groupId, elements: [] },
        { action: "group", groupId: selectedPlacement.groupId, elements: removed.map(serializableElement) });
      return;
    }
    remember();
    setElements((rows) => rows.filter((element) => element.id !== selected.id));
    setSelectedId(null);
    void persist(selected.slide_id, { action: "delete", elementId: selected.id }, { action: "insert", element: serializableElement(selected) });
  }

  function duplicateSelected() {
    if (!selected || selectedPlacement) return;
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const copy: Element = { ...selected, id, x: selected.x + 18, y: selected.y + 18, z_index: zRange.max + 1, locked: false, created_at: now, updated_at: now };
    remember();
    setElements((rows) => [...rows, copy]);
    setSelectedId(id);
    void persist(selected.slide_id, { action: "duplicate", elementId: selected.id, newId: id, offsetX: 18, offsetY: 18 }, { action: "delete", elementId: id });
  }

  function insertElement(element: Element, storedContent?: Json) {
    remember();
    setElements((rows) => [...rows, element]);
    setSelectedId(element.id);
    const payload: Json = storedContent === undefined ? serializableElement(element) : { ...serializableElement(element), content: storedContent };
    void persist(element.slide_id, { action: "insert", element: payload }, { action: "delete", elementId: element.id });
  }

  async function pickAsset(kind: "image" | "video") {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: kind === "video" ? ["videos"] : ["images"], quality: 0.9, videoMaxDuration: 120 });
    if (result.canceled) return null;
    const asset = result.assets[0] ?? null;
    if (asset && kind === "video" && typeof asset.fileSize === "number" && asset.fileSize > MAX_VIDEO_BYTES) {
      Alert.alert(t("videoTooBig"), t("videoTooBigBody"));
      return null;
    }
    return asset;
  }

  async function uploadAsset(uri: string, mimeType: string | undefined, extension: string) {
    if (!user) throw new Error(t("signIn"));
    const blob = await (await fetch(uri)).blob();
    const path = `${user.id}/${presentationId}/${Crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("user-uploads").upload(path, blob, { contentType: mimeType ?? "application/octet-stream" });
    if (error) throw error;
    const { data } = await supabase.storage.from("user-uploads").createSignedUrl(path, 3600);
    return { path, signedUrl: data?.signedUrl ?? uri };
  }

  function mediaBox(assetWidth: number | undefined, assetHeight: number | undefined) {
    const ratio = assetWidth && assetHeight ? assetWidth / assetHeight : 16 / 9;
    let width = 560;
    let height = width / ratio;
    if (height > 360) { height = 360; width = height * ratio; }
    return { x: (MODEL_WIDTH - width) / 2, y: (MODEL_HEIGHT - height) / 2, width, height };
  }

  async function addLibraryElement(candidate: { id: string; published_version: number }) {
    if (!currentSlideId || !presentationId || !user) return;
    setPickerOpen(false);
    try {
      const element = resolvedElements.current[candidate.id] ?? await resolveElement(candidate.id, candidate.published_version);
      if (!element) { Alert.alert(t("elementFailed"), t("elementMissing")); return; }
      resolvedElements.current[candidate.id] = element;
      const placement = initialPlacement(candidate.id, element.version, { width: MODEL_WIDTH, height: MODEL_HEIGHT }, Crypto.randomUUID());
      const now = new Date().toISOString();
      const drawn = rowsFor(element, placement, { slideId: currentSlideId, presentationId, ownerId: user.id, zIndex: zRange.max + 1 })
        .map((row) => ({ ...row, id: Crypto.randomUUID(), created_at: now, updated_at: now })) as Element[];
      remember();
      setElements((rows) => [...rows, ...drawn]);
      setSelectedId(drawn[0]?.id ?? null);
      void persist(currentSlideId,
        { action: "group", groupId: placement.groupId, elements: drawn.map(serializableElement) },
        { action: "group", groupId: placement.groupId, elements: [] });
    } catch (failure) {
      Alert.alert(t("elementFailed"), asErrorMessage(failure));
    }
  }

  async function insert(kind: InsertKind) {
    if (!currentSlide || !currentSlideId || !presentationId || !user) return;
    void Haptics.selectionAsync();
    if (kind === "element") { setPickerOpen(true); return; }
    const now = new Date().toISOString();
    const base = {
      id: Crypto.randomUUID(), slide_id: currentSlideId, presentation_id: presentationId, owner_id: user.id,
      rotation: 0, opacity: 1, locked: false, z_index: zRange.max + 1, created_at: now, updated_at: now,
    };
    const ground = str(bag(currentSlide.background).color, "#FFFFFF");
    // New elements take the slide's own palette, never the app's chrome colours.
    const ink = isDarkColor(ground) ? "#FFFFFF" : "#150E24";
    const accent = swatches.find((hex) => hex !== ground.toUpperCase()) ?? colors.primary;

    if (kind === "text") {
      insertElement({
        ...base, type: "text", x: 240, y: 226, width: 520, height: 110,
        style: { color: ink, fontFamily: "Manrope_700Bold", fontWeight: "700", fontSize: 44, lineHeight: 55, textAlign: "center", letterSpacing: 0, verticalAlign: "top" },
        content: { text: t("newText"), maxLines: 3 },
      });
      setToolPanel("text");
      return;
    }
    if (kind === "shape") { insertElement({ ...base, type: "shape", x: 360, y: 191, width: 280, height: 180, style: { fill: accent, borderRadius: 20 }, content: {} }); return; }
    if (kind === "frame") { insertElement({ ...base, type: "image", x: 330, y: 161, width: 340, height: 240, style: { borderRadius: 28, objectFit: "cover" }, content: { kind: "frame" } }); return; }

    setUploading(true);
    try {
      const asset = await pickAsset(kind);
      if (!asset) return;
      const { path, signedUrl } = await uploadAsset(asset.uri, asset.mimeType, kind === "video" ? "mp4" : "jpg");
      const storedContent: Json = { kind, storageBucket: "user-uploads", storagePath: path };
      insertElement(
        { ...base, type: "image", ...mediaBox(asset.width, asset.height), style: { borderRadius: 18, objectFit: "cover" }, content: kind === "video" ? storedContent : { ...storedContent, signedUrl } },
        storedContent,
      );
    } catch (error) {
      Alert.alert(kind === "video" ? t("videoAddFailed") : t("imageAddFailed"), asErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function replaceMedia(target: Element) {
    if (target.type !== "image" || !user) return;
    const kind = str(bag(target.content).kind) === "video" ? "video" : "image";
    setUploading(true);
    try {
      const asset = await pickAsset(kind);
      if (!asset) return;
      const { path, signedUrl } = await uploadAsset(asset.uri, asset.mimeType, kind === "video" ? "mp4" : "jpg");
      const storedContent: Json = { ...jsonObject(target.content), storageBucket: "user-uploads", storagePath: path };
      const displayContent: Json = kind === "video" ? storedContent : { ...jsonObject(storedContent), signedUrl };
      updateElement(target.id, { content: displayContent }, { content: storedContent });
    } catch (error) {
      Alert.alert(kind === "video" ? t("videoReplaceFailed") : t("imageReplaceFailed"), asErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  /* ------------------------------------------------------------- history */

  async function replaySnapshot(target: Element[]) {
    const previous = elements;
    setElements(target);
    setLive(null);
    setSelectedId(null);
    const targetById = new Map(target.map((element) => [element.id, element]));
    const previousById = new Map(previous.map((element) => [element.id, element]));
    for (const old of previous) {
      const next = targetById.get(old.id);
      if (!next) await persist(old.slide_id, { action: "delete", elementId: old.id }, { action: "insert", element: serializableElement(old) });
      else if (next !== old && JSON.stringify(old) !== JSON.stringify(next)) {
        const patch: Patch = { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation, z_index: next.z_index, opacity: next.opacity, locked: next.locked, style: next.style, content: next.content };
        const inverse: Patch = { x: old.x, y: old.y, width: old.width, height: old.height, rotation: old.rotation, z_index: old.z_index, opacity: old.opacity, locked: old.locked, style: old.style, content: old.content };
        await persist(old.slide_id, { action: "update", elementId: old.id, patch: operationPatch(patch) }, { action: "update", elementId: old.id, patch: operationPatch(inverse) });
      }
    }
    for (const next of target) {
      if (!previousById.has(next.id)) await persist(next.slide_id, { action: "insert", element: serializableElement(next) }, { action: "delete", elementId: next.id });
    }
  }

  function undo() {
    const target = past[past.length - 1];
    if (!target) return;
    void Haptics.selectionAsync();
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [elements, ...history].slice(0, HISTORY));
    void replaySnapshot(target);
  }

  function redo() {
    const target = future[0];
    if (!target) return;
    void Haptics.selectionAsync();
    setFuture((history) => history.slice(1));
    setPast((history) => [...history.slice(-(HISTORY - 1)), elements]);
    void replaySnapshot(target);
  }

  /* --------------------------------------------------------------- fonts */

  const currentPairing = useMemo(() => {
    const fonts = (presentation?.design_dna as { fonts?: Record<string, { family?: string; weight?: number }> } | null)?.fonts;
    if (!fonts?.display || !fonts.body) return null;
    return PAIRINGS.find((pairing) => pairing.display.family === fonts.display?.family && pairing.display.weight === fonts.display?.weight
      && pairing.body.family === fonts.body?.family)?.key ?? null;
  }, [presentation?.design_dna]);

  async function applyPairing(pairing: Pairing, faces: Record<"display" | "strong" | "body", ResolvedFace>) {
    if (!presentationId || !presentation) return;
    const changes = restyle(elements, deckFacesOf(presentation.design_dna), pairing, faces);
    if (changes.length === 0) return;
    setPending((count) => count + 1);
    const { error } = await supabase.rpc("apply_deck_text_styles", {
      p_presentation_id: presentationId,
      p_changes: changes as unknown as Json,
      p_fonts: { display: pairing.display, title: pairing.display, strong: pairing.strong, body: pairing.body, label: { ...pairing.strong, tracking: 2.2 } } as unknown as Json,
    });
    setPending((count) => Math.max(0, count - 1));
    if (error) throw new Error(asErrorMessage(error));
    const byId = new Map(changes.map((change) => [change.id, change.style]));
    setElements((rows) => rows.map((row) => (byId.has(row.id) ? { ...row, style: byId.get(row.id) as Json } : row)));
    setPresentation((current) => current ? {
      ...current,
      design_dna: { ...((current.design_dna as Record<string, Json> | null) ?? {}), fonts: { display: pairing.display, body: pairing.body, strong: pairing.strong } } as Json,
    } : current);
    setPast([]);
    setFuture([]);
    setRevision((value) => value + 1);
  }

  /* -------------------------------------------------------------- render */

  const onStageLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setStage((current) => (Math.abs(current.width - width) < 1 && Math.abs(current.height - height) < 1 ? current : { width, height }));
  }, []);

  const chooseSlide = useCallback((id: string) => {
    setCurrentSlideId(id);
    setSelectedId(null);
    setLive(null);
    void Haptics.selectionAsync();
  }, []);

  const renderThumb = useCallback(({ item }: ListRenderItemInfo<Slide>) => (
    <SlideThumb slide={item} elements={bySlide.get(item.id) ?? NO_ROWS} active={item.id === currentSlideId} revision={revision} onPress={chooseSlide} />
  ), [bySlide, chooseSlide, currentSlideId, revision]);

  const done = () => (router.canGoBack() ? router.back() : router.replace({ pathname: "/(app)/presentation/[id]", params: { id: presentationId ?? "" } }));

  if (loading || !presentation) {
    return <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>;
  }

  return (
    <View style={styles.screen}>
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <Pressable accessibilityRole="button" accessibilityLabel={t("common:back")} onPress={done} style={styles.iconButton}>
          <ArrowLeft color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
        </Pressable>
        <View style={styles.headerCenter}>
          <Text numberOfLines={1} style={styles.title}>{presentation.title}</Text>
          <View style={styles.saveRow}>
            {pending > 0
              ? <Spin><LoaderCircle color={colors.inkSoft} size={11} strokeWidth={icon.stroke} /></Spin>
              : <Check color={colors.success} size={11} strokeWidth={icon.strokeBold} />}
            <Text style={styles.saved}>{pending > 0 ? t("saving") : t("saved")}</Text>
          </View>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel={t("undo")} disabled={!past.length} onPress={undo} style={[styles.iconButton, !past.length && styles.dim]}>
          <Undo2 color={colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("redo")} disabled={!future.length} onPress={redo} style={[styles.iconButton, !future.length && styles.dim]}>
          <Redo2 color={colors.ink} size={icon.sm} strokeWidth={icon.stroke} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("deckFonts")} onPress={() => setFontsOpen(true)} style={styles.iconButton}>
          <Text style={styles.fontsGlyph}>Aa</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={t("done")} onPress={done} style={styles.doneButton}>
          <Text style={styles.doneText}>{t("done")}</Text>
        </Pressable>
      </View>

      <View style={styles.stage} onLayout={onStageLayout}>
        {/* A tap beside the slide puts the selection down. */}
        <Pressable accessible={false} onPress={deselect} style={StyleSheet.absoluteFill} />
        {currentSlide && fit > 0 ? (
          <GestureDetector gesture={stageGesture}>
            <Animated.View style={[{ width: canvasWidth, height: canvasHeight }, stageStyle]}>
              <View style={[styles.canvasFrame, StyleSheet.absoluteFill]}>
                <View style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale: displayScale }], transformOrigin: "top left" }}>
                  <SlideCanvas
                    slide={currentSlide}
                    elements={stageElements}
                    displayScale={displayScale}
                    interactive
                    revision={revision}
                    onSelect={onSelect}
                    onDragStart={onDragStart}
                    onDrag={onDrag}
                    onDragEnd={onDragEnd}
                    onRequestEdit={onRequestEdit}
                    onTextMeasure={onTextMeasure}
                  />
                </View>
              </View>
              {selectionTarget ? (
                <SelectionOverlay
                  element={selectionTarget}
                  scale={displayScale}
                  stageWidth={canvasWidth}
                  stageHeight={canvasHeight}
                  onTransformStart={() => { dragStart.current = elements; }}
                  onTransform={(patch) => applyTransform(selectionTarget.id, patch)}
                  onTransformEnd={(patch) => endTransform(selectionTarget.id, fitTextHeight(selectionTarget, patch))}
                  onDuplicate={duplicateSelected}
                  onDelete={deleteSelected}
                />
              ) : null}
            </Animated.View>
          </GestureDetector>
        ) : null}
        {zoom > 1.01 || pan.x !== 0 || pan.y !== 0 ? (
          <Pressable accessibilityRole="button" onPress={resetZoom} style={styles.zoomReset}>
            <Text style={styles.zoomResetText}>{Math.round(zoom * 100)}% · asliga</Text>
          </Pressable>
        ) : null}
      </View>

      <FlatList
        horizontal
        data={slides}
        keyExtractor={(slide) => slide.id}
        renderItem={renderThumb}
        extraData={currentSlideId}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        style={styles.stripList}
        initialNumToRender={6}
        windowSize={5}
        getItemLayout={(_, at) => ({ length: THUMB_WIDTH + 14 + spacing.sm, offset: (THUMB_WIDTH + 14 + spacing.sm) * at, index: at })}
      />

      <Animated.View style={[styles.dock, { paddingBottom: Math.max(insets.bottom, spacing.md) }, dockLift]}>
        {selected ? (
          <ElementToolbar
            element={selected}
            swatches={swatches}
            panel={toolPanel}
            onPanel={setToolPanel}
            onStyle={(style) => changeStyle(selected, style as Record<string, Json | undefined>)}
            onContent={(content) => updateElement(selected.id, { content: content as Json })}
            onElement={(patch) => updateElement(selected.id, patch)}
            onReplaceImage={() => void replaceMedia(selected)}
            zRange={zRange}
          />
        ) : (
          <View style={styles.insertBar}>
            {INSERTS.map((item) => (
              <Pressable
                key={item.kind}
                accessibilityRole="button"
                accessibilityLabel={t("insertLabel", { item: t(`insert.${item.kind}`) })}
                disabled={uploading}
                onPress={() => void insert(item.kind)}
                style={({ pressed }) => [styles.insert, pressed && styles.pressed, uploading && styles.dim]}
              >
                <View style={styles.insertGlyph}>
                  {uploading && (item.kind === "image" || item.kind === "video")
                    ? <ActivityIndicator size="small" color={colors.primary} />
                    : <item.icon color={colors.primary} size={20} strokeWidth={2} />}
                </View>
                <Text numberOfLines={1} style={styles.insertLabel}>{t(`insert.${item.kind}`)}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </Animated.View>

      <ElementPicker visible={pickerOpen} onClose={() => setPickerOpen(false)} onPick={(candidate) => void addLibraryElement(candidate)} />
      <DeckFontSheet visible={fontsOpen} current={currentPairing} onClose={() => setFontsOpen(false)} onApply={applyPairing} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  header: {
    flexDirection: "row", alignItems: "center", gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingBottom: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, backgroundColor: colors.canvas,
  },
  iconButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  headerCenter: { flex: 1, paddingHorizontal: spacing.xs },
  title: { ...typography.bodyMedium, color: colors.ink },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  saved: { ...typography.caption, fontSize: 11, color: colors.inkSoft },
  fontsGlyph: { fontFamily: "Manrope_700Bold", fontSize: 14, color: colors.ink },
  doneButton: { height: 38, paddingHorizontal: spacing.md, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary, marginLeft: 2 },
  doneText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.onPrimary },
  dim: { opacity: 0.35 },
  pressed: { opacity: 0.7 },
  stage: { flex: 1, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  canvasFrame: { backgroundColor: colors.surface, borderRadius: radius.sm, overflow: "hidden", ...shadow },
  zoomReset: { position: "absolute", top: spacing.sm, alignSelf: "center", paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  zoomResetText: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.primaryDeep },
  stripList: { flexGrow: 0 },
  strip: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.sm },
  thumb: { width: THUMB_WIDTH + 14, padding: 6, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  thumbActive: { borderColor: colors.primary, borderWidth: 2, padding: 5 },
  thumbClip: { width: THUMB_WIDTH, height: (THUMB_WIDTH * MODEL_HEIGHT) / MODEL_WIDTH, overflow: "hidden", borderRadius: 4, backgroundColor: colors.surfaceMuted },
  thumbNumber: { ...typography.caption, fontSize: 11, color: colors.inkMuted, marginTop: 3, textAlign: "center" },
  thumbNumberActive: { color: colors.primary, fontFamily: "Manrope_700Bold" },
  dock: { paddingHorizontal: spacing.md, paddingTop: spacing.sm, backgroundColor: colors.canvas, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  insertBar: { flexDirection: "row", justifyContent: "space-between", gap: spacing.xs },
  insert: { flex: 1, alignItems: "center", gap: 4, paddingVertical: spacing.xs },
  insertGlyph: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", backgroundColor: colors.primarySoft },
  insertLabel: { ...typography.caption, fontSize: 11, color: colors.inkMuted },
}));
