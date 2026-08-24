import type { Json, Tables } from "@jaxongirman/types";
import * as Crypto from "expo-crypto";
import * as ImagePicker from "expo-image-picker";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, Download, LoaderCircle, MessageSquareQuote, Redo2, Send, Sparkles, Undo2 } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, runOnUI, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { AddElementBar, type AddKind } from "@/components/AddElementBar";
import { ElementPicker } from "@/components/ElementPicker";
import { ElementToolbar, type ToolPanel } from "@/components/ElementToolbar";
import { ExportSheet } from "@/components/ExportSheet";
import { IconChip } from "@/components/IconChip";
import { SelectionOverlay } from "@/components/SelectionOverlay";
import { MODEL_HEIGHT, MODEL_WIDTH, SlideCanvas } from "@/components/SlideCanvas";
import { asErrorMessage, asFunctionErrorMessage } from "@/lib/format";
import {
  initialPlacement, placementOf, resolveElement, rowsFor,
  type Placement, type ResolvedElement,
} from "@/lib/jelement";
import { supabase } from "@/lib/supabase";
import { bag, isDarkColor, slideSwatches, str } from "@/lib/textStyle";
import { useAuth } from "@/providers/AuthProvider";
import { icon, radius, shadow, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Presentation = Tables<"presentations">;
type Slide = Tables<"slides">;
type Element = Tables<"slide_elements">;
type Patch = Partial<Pick<Element, "x" | "y" | "width" | "height" | "rotation" | "z_index" | "opacity" | "locked" | "style" | "content">>;

/** Videos live in the same bucket as images; anything larger is a bad slide. */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

function jsonObject(value: Json): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, Json | undefined> : {};
}

function serializableElement(element: Element): Record<string, Json> {
  return {
    id: element.id,
    type: element.type,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    z_index: element.z_index,
    opacity: element.opacity,
    locked: element.locked,
    style: element.style,
    content: element.content,
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

export default function PresentationEditorScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ id: string }>();
  const presentationId = Array.isArray(params.id) ? params.id[0] : params.id;
  const router = useRouter();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const [presentation, setPresentation] = useState<Presentation | null>(null);
  const [slides, setSlides] = useState<Slide[]>([]);
  const [elements, setElements] = useState<Element[]>([]);
  const [currentSlideId, setCurrentSlideId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** Resolved geometry per element id, so a redraw never refetches. */
  const resolvedElements = useRef<Record<string, ResolvedElement>>({});
  const [toolPanel, setToolPanel] = useState<ToolPanel>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dockHeight, setDockHeight] = useState(120);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [aiCommand, setAiCommand] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [past, setPast] = useState<Element[][]>([]);
  const [future, setFuture] = useState<Element[][]>([]);
  const dragStart = useRef<Element[] | null>(null);
  const textHeights = useRef<Record<string, number>>({});
  /** The text element whose box should track its rewrapped copy right now. */
  const fitTarget = useRef<string | null>(null);

  const baseWidth = Math.min(screenWidth - spacing.xl * 2, 760);

  /**
   * Two fingers to magnify the slide, the way the presenter remote already
   * does — because the thing people actually need to zoom into is a caption
   * they are trying to nudge two pixels, and at phone size that is guesswork.
   *
   * The zoom is committed into `displayScale` rather than laid over it. Every
   * drag, handle and hit test on this screen converts screen pixels to model
   * units by dividing by `displayScale`; a second transform on top would leave
   * all of that arithmetic describing a slide the size it used to be, and an
   * element would move at a fraction of the finger. Making the scale actually
   * larger keeps one number true for everybody.
   *
   * During the pinch itself nothing is committed — a shared value scales the
   * view for free, without re-rendering a slide's worth of elements sixty times
   * a second — and the final value lands in state when the fingers lift.
   */
  const [zoom, setZoom] = useState(1);
  const liveZoom = useSharedValue(1);
  /** Where the magnified slide is, in screen pixels, committed after a drag. */
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const livePanX = useSharedValue(0);
  const livePanY = useSharedValue(0);

  const canvasWidth = baseWidth * zoom;
  const displayScale = canvasWidth / MODEL_WIDTH;
  const canvasHeight = MODEL_HEIGHT * displayScale;

  /**
   * Two fingers zoom; two fingers also move.
   *
   * A magnifier you cannot aim is not a magnifier — every photo editor pairs
   * the pinch with a two-finger drag, and without it the only part of a slide
   * you can work on is whatever happened to be under the middle of the screen.
   * `minPointers(2)` is what keeps it out of the way of the one-finger drag
   * that moves an element, and `Simultaneous` lets a pinch and a pan happen in
   * the same gesture, which is what hands actually do.
   */
  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      "worklet";
      liveZoom.value = Math.min(4, Math.max(1, zoom * event.scale));
    })
    .onEnd(() => {
      "worklet";
      runOnJS(setZoom)(liveZoom.value);
    });

  const drag = Gesture.Pan()
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

  const stageGesture = Gesture.Simultaneous(pinch, drag);

  /**
   * Back to life size, centred.
   *
   * Not memoised: a callback that writes shared values is not a pure function,
   * and wrapping it in `useCallback` tells the compiler otherwise. It is a
   * button handler — there is nothing to save.
   */
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

  const stageStyle = useAnimatedStyle(() => ({
    // Translate first, then scale: the committed zoom is already in the
    // stage's own size, so this only carries what the fingers are doing now.
    transform: [
      { translateX: livePanX.value },
      { translateY: livePanY.value },
      { scale: liveZoom.value / zoom },
    ],
  }), [zoom]);
  const currentSlide = slides.find((slide) => slide.id === currentSlideId) ?? null;
  const currentElements = useMemo(() => elements.filter((element) => element.slide_id === currentSlideId).sort((a, b) => a.z_index - b.z_index), [currentSlideId, elements]);
  const selected = elements.find((element) => element.id === selectedId) ?? null;

  /**
   * The placement of the library element the selection belongs to, if any.
   *
   * An element is several shapes that behave as one thing, so selecting any of
   * them selects the whole placement — and every transform below acts on that
   * rather than on the shape the finger happened to land on.
   */
  const selectedPlacement = selected ? placementOf(selected) : null;

  const groupRows = useMemo(
    () => selectedPlacement
      ? elements.filter((element) => placementOf(element)?.groupId === selectedPlacement.groupId)
      : [],
    [elements, selectedPlacement],
  );

  /**
   * What the selection frame is drawn around.
   *
   * For a library element that is the placement box, not one component's — a
   * handle on the wheel would resize the wheel, and the thing the person
   * selected is the truck.
   */
  const selectionTarget = useMemo<Element | null>(() => {
    if (!selected) return null;
    if (!selectedPlacement) return selected;
    return {
      ...selected,
      x: selectedPlacement.x,
      y: selectedPlacement.y,
      width: selectedPlacement.width,
      height: selectedPlacement.height,
      rotation: selectedPlacement.rotation,
    };
  }, [selected, selectedPlacement]);

  /** Redraws every member of a placement from the element's own geometry. */
  function redrawPlacement(placement: Placement, base: Element[]): Element[] {
    const element = resolvedElements.current[placement.elementId];
    if (!element || !currentSlideId || !presentationId || !user) return base;

    const members = base.filter((row) => placementOf(row)?.groupId === placement.groupId);
    const others = base.filter((row) => placementOf(row)?.groupId !== placement.groupId);
    const zIndex = Math.min(...members.map((row) => row.z_index));

    const drawn = rowsFor(element, placement, {
      slideId: currentSlideId, presentationId, ownerId: user.id, zIndex,
    }, {});

    // Ids are kept so the rows stay the same rows across a gesture — a new id
    // every frame would make the history unreadable and the selection jump.
    return [...others, ...drawn.map((row, index) => ({
      ...(members[index] ?? members[0]!),
      ...row,
      id: members[index]?.id ?? Crypto.randomUUID(),
    } as Element))];
  }
  const swatches = useMemo(
    () => slideSwatches(currentSlide?.background, currentElements.map((element) => bag(element.style))),
    [currentElements, currentSlide],
  );
  const zRange = useMemo(() => ({
    min: currentElements.length ? Math.min(...currentElements.map((element) => element.z_index)) : 0,
    max: currentElements.length ? Math.max(...currentElements.map((element) => element.z_index)) : 0,
  }), [currentElements]);

  // A new selection starts with the tool row closed, never someone else's panel.
  useEffect(() => { setToolPanel(null); }, [selectedId]);

  const hydrateImageUrls = useCallback(async (rows: Element[]) => {
    return Promise.all(rows.map(async (element) => {
      if (element.type !== "image") return element;
      const content = jsonObject(element.content);
      // A video keeps its poster tile — handing its URL to <Image> draws nothing.
      if (content.kind === "video") return element;
      const bucket = typeof content.storageBucket === "string" ? content.storageBucket : null;
      const path = typeof content.storagePath === "string" ? content.storagePath : null;
      if (!bucket || !path) return element;
      const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
      return data?.signedUrl ? { ...element, content: { ...content, signedUrl: data.signedUrl } } : element;
    }));
  }, []);

  const load = useCallback(async () => {
    if (!presentationId) return;
    try {
      const [presentationResult, slideResult, elementResult] = await Promise.all([
        supabase.from("presentations").select("*").eq("id", presentationId).single(),
        supabase.from("slides").select("*").eq("presentation_id", presentationId).order("position"),
        supabase.from("slide_elements").select("*").eq("presentation_id", presentationId).order("z_index"),
      ]);
      if (presentationResult.error) throw presentationResult.error;
      if (slideResult.error) throw slideResult.error;
      if (elementResult.error) throw elementResult.error;
      const hydrated = await hydrateImageUrls(elementResult.data);
      setPresentation(presentationResult.data);
      setSlides(slideResult.data);
      setElements(hydrated);
      setCurrentSlideId((current) => current && slideResult.data.some((slide) => slide.id === current) ? current : slideResult.data[0]?.id ?? null);
      setSelectedId(null);
    } catch (error) {
      Alert.alert("Editor ochilmadi", asErrorMessage(error), [{ text: "Ortga", onPress: () => router.back() }]);
    } finally {
      setLoading(false);
    }
  }, [hydrateImageUrls, presentationId, router]);

  useEffect(() => { void load(); }, [load]);

  async function persist(operation: Json, inverse: Json) {
    if (!presentationId || !currentSlideId) return;
    setSaving(true);
    const { error } = await supabase.rpc("apply_editor_operation", {
      p_presentation_id: presentationId,
      p_slide_id: currentSlideId,
      p_operation: operation,
      p_inverse_operation: inverse,
    });
    setSaving(false);
    if (error) {
      Alert.alert("O‘zgarish saqlanmadi", error.message);
      await load();
    }
  }

  function updateElement(id: string, patch: Patch, persistedPatch: Patch = patch) {
    const old = elements.find((element) => element.id === id);
    if (!old) return;
    const inverse: Patch = {};
    for (const key of Object.keys(persistedPatch) as (keyof Patch)[]) {
      Object.assign(inverse, { [key]: old[key] });
    }
    setPast((history) => [...history.slice(-39), elements]);
    setFuture([]);
    setElements((rows) => rows.map((element) => element.id === id ? { ...element, ...patch } : element));
    void persist(
      { action: "update", elementId: id, patch: operationPatch(persistedPatch) },
      { action: "update", elementId: id, patch: operationPatch(inverse) },
    );
  }

  /** Live gesture feedback — local only, so nothing hits the network per frame. */
  function applyTransform(id: string, patch: Patch) {
    // A library element transforms as a placement: the patch changes the box
    // the whole object sits in, and its shapes are redrawn from that. There is
    // no delta arithmetic anywhere, so a long gesture cannot drift.
    const placement = selectedPlacement && selectedPlacement.groupId === placementOf(
      elements.find((element) => element.id === id) ?? { content: null },
    )?.groupId ? selectedPlacement : null;

    if (placement) {
      const next: Placement = {
        ...placement,
        x: patch.x ?? placement.x,
        y: patch.y ?? placement.y,
        width: patch.width ?? placement.width,
        height: patch.height ?? placement.height,
        rotation: patch.rotation ?? placement.rotation,
      };
      setElements((rows) => redrawPlacement(next, rows));
      return;
    }

    // A sideways stretch rewraps text, so that one gesture lets the box height
    // follow the line count. Corner drags scale the type instead and opt out.
    fitTarget.current = patch.width !== undefined && patch.height === undefined ? id : null;
    setElements((rows) => rows.map((element) => element.id === id ? { ...element, ...patch } : element));
  }

  /**
   * The measured height of a text element's wrapped copy. Outside a sideways
   * resize it is only recorded, so opening a deck never rewrites its layout.
   */
  function measureText(id: string, height: number) {
    textHeights.current[id] = height;
    if (fitTarget.current !== id) return;
    const next = Math.round(height);
    setElements((rows) => {
      const current = rows.find((element) => element.id === id);
      if (!current || current.type !== "text" || Math.abs(current.height - next) < 1) return rows;
      return rows.map((element) => element.id === id ? { ...element, height: next } : element);
    });
  }

  /**
   * One history entry and one round trip per gesture. The final patch comes from
   * the gesture itself rather than state, so a pending render can never drop the
   * last frame of a drag.
   */
  function endTransform(id: string, patch: Patch) {
    const before = dragStart.current;
    dragStart.current = null;
    fitTarget.current = null;
    const old = before?.find((element) => element.id === id);
    if (!before || !old) return;

    // A library element is persisted as a set rather than as a patch to each
    // shape: one operation, so a half-saved drag cannot leave a truck with its
    // wheels somewhere else.
    const placement = placementOf(old);
    if (placement) {
      const next: Placement = {
        ...placement,
        x: patch.x ?? placement.x,
        y: patch.y ?? placement.y,
        width: patch.width ?? placement.width,
        height: patch.height ?? placement.height,
        rotation: patch.rotation ?? placement.rotation,
      };
      const drawn = redrawPlacement(next, before);
      const members = drawn.filter((row) => placementOf(row)?.groupId === placement.groupId);
      const previous = before.filter((row) => placementOf(row)?.groupId === placement.groupId);

      setPast((history) => [...history.slice(-39), before]);
      setFuture([]);
      setElements(drawn);
      void persist(
        { action: "group", groupId: placement.groupId, elements: members.map(serializableElement) },
        { action: "group", groupId: placement.groupId, elements: previous.map(serializableElement) },
      );
      return;
    }

    const changed: Patch = {};
    const inverse: Patch = {};
    for (const key of Object.keys(patch) as (keyof Patch)[]) {
      const next = patch[key];
      if (next === undefined || JSON.stringify(next) === JSON.stringify(old[key])) continue;
      Object.assign(changed, { [key]: next });
      Object.assign(inverse, { [key]: old[key] });
    }
    if (!Object.keys(changed).length) return;
    setPast((history) => [...history.slice(-39), before]);
    setFuture([]);
    setElements((rows) => rows.map((element) => element.id === id ? { ...element, ...changed } : element));
    void persist(
      { action: "update", elementId: id, patch: operationPatch(changed) },
      { action: "update", elementId: id, patch: operationPatch(inverse) },
    );
  }

  /**
   * Saves the height the box settled on. endTransform drops it again when the
   * rewrap changed nothing, so a resize that keeps two lines stays a width edit.
   */
  function fitTextHeight(target: Element, patch: Patch): Patch {
    if (target.type !== "text" || patch.width === undefined || patch.height !== undefined) return patch;
    const measured = textHeights.current[target.id];
    return measured ? { ...patch, height: Math.round(measured) } : patch;
  }

  function deleteSelected() {
    if (!selected) return;

    // Deleting one shape of an object would leave the rest of it behind, which
    // reads as a broken slide rather than as a deletion.
    if (selectedPlacement) {
      const removed = groupRows.map(serializableElement);
      setPast((history) => [...history.slice(-39), elements]);
      setFuture([]);
      setElements((rows) => rows.filter((row) => placementOf(row)?.groupId !== selectedPlacement.groupId));
      setSelectedId(null);
      void persist(
        { action: "group", groupId: selectedPlacement.groupId, elements: [] },
        { action: "group", groupId: selectedPlacement.groupId, elements: removed },
      );
      return;
    }

    setPast((history) => [...history.slice(-39), elements]);
    setFuture([]);
    setElements((rows) => rows.filter((element) => element.id !== selected.id));
    setSelectedId(null);
    void persist({ action: "delete", elementId: selected.id }, { action: "insert", element: serializableElement(selected) });
  }

  function insertElement(element: Element, storedContent?: Json) {
    setPast((history) => [...history.slice(-39), elements]);
    setFuture([]);
    setElements((rows) => [...rows, element]);
    setSelectedId(element.id);
    const payload: Json = storedContent === undefined
      ? serializableElement(element)
      : { ...serializableElement(element), content: storedContent };
    void persist({ action: "insert", element: payload }, { action: "delete", elementId: element.id });
  }

  async function pickAsset(kind: "image" | "video") {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: kind === "video" ? ["videos"] : ["images"],
      quality: 0.9,
      videoMaxDuration: 120,
    });
    if (result.canceled) return null;
    const asset = result.assets[0] ?? null;
    if (asset && kind === "video" && typeof asset.fileSize === "number" && asset.fileSize > MAX_VIDEO_BYTES) {
      Alert.alert("Video juda katta", "Slaydga 60 MB gacha bo‘lgan video qo‘shish mumkin.");
      return null;
    }
    return asset;
  }

  async function uploadAsset(uri: string, mimeType: string | undefined, extension: string) {
    if (!user) throw new Error("Avval hisobga kiring");
    const response = await fetch(uri);
    const blob = await response.blob();
    const path = `${user.id}/${presentationId}/${Crypto.randomUUID()}.${extension}`;
    const { error } = await supabase.storage.from("user-uploads").upload(path, blob, { contentType: mimeType ?? "application/octet-stream" });
    if (error) throw error;
    const { data } = await supabase.storage.from("user-uploads").createSignedUrl(path, 3600);
    return { path, signedUrl: data?.signedUrl ?? uri };
  }

  /** Fits a picked asset inside the middle of the slide without distorting it. */
  function mediaBox(assetWidth: number | undefined, assetHeight: number | undefined) {
    const ratio = assetWidth && assetHeight ? assetWidth / assetHeight : 16 / 9;
    let width = 560;
    let height = width / ratio;
    if (height > 360) { height = 360; width = height * ratio; }
    return { x: (MODEL_WIDTH - width) / 2, y: (MODEL_HEIGHT - height) / 2, width, height };
  }

  /**
   * Puts a library element on the slide.
   *
   * The geometry is fetched once and kept, so dragging redraws from memory
   * rather than from the network. The version is pinned on every member row:
   * an admin improving this element later must not silently redraw a deck
   * somebody already exported.
   */
  async function addLibraryElement(candidate: { id: string; published_version: number }) {
    if (!currentSlideId || !presentationId || !user) return;
    setPickerOpen(false);

    try {
      const element = resolvedElements.current[candidate.id]
        ?? await resolveElement(candidate.id, candidate.published_version);
      if (!element) {
        Alert.alert("Element qo‘shilmadi", "Bu elementning chizmasi topilmadi.");
        return;
      }
      resolvedElements.current[candidate.id] = element;

      const placement = initialPlacement(
        candidate.id, element.version,
        { width: MODEL_WIDTH, height: MODEL_HEIGHT },
        Crypto.randomUUID(),
      );

      const drawn = rowsFor(element, placement, {
        slideId: currentSlideId, presentationId, ownerId: user.id, zIndex: zRange.max + 1,
      }).map((row) => ({
        ...row,
        id: Crypto.randomUUID(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })) as Element[];

      setPast((history) => [...history.slice(-39), elements]);
      setFuture([]);
      setElements((rows) => [...rows, ...drawn]);
      setSelectedId(drawn[0]?.id ?? null);
      void persist(
        { action: "group", groupId: placement.groupId, elements: drawn.map(serializableElement) },
        { action: "group", groupId: placement.groupId, elements: [] },
      );
    } catch (failure) {
      Alert.alert("Element qo‘shilmadi", asErrorMessage(failure));
    }
  }

  async function addElement(kind: AddKind) {
    if (!currentSlide || !currentSlideId || !presentationId || !user) return;
    setAddOpen(false);

    // The library opens a search instead of adding something straight away.
    if (kind === "element") { setPickerOpen(true); return; }
    const base = {
      id: Crypto.randomUUID(),
      slide_id: currentSlideId,
      presentation_id: presentationId,
      owner_id: user.id,
      rotation: 0,
      opacity: 1,
      locked: false,
      z_index: zRange.max + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const background = str(bag(currentSlide.background).color, "#FFFFFF");
    // New elements inherit the slide's own palette rather than app chrome colours.
    const ink = isDarkColor(background) ? "#FFFFFF" : "#150E24";
    const accent = swatches.find((hex) => hex !== background.toUpperCase()) ?? colors.primary;

    if (kind === "text") {
      insertElement({
        ...base, type: "text", x: 240, y: 226, width: 520, height: 110,
        style: { color: ink, fontFamily: "Manrope_700Bold", fontWeight: "700", fontSize: 44, lineHeight: 55, textAlign: "center", letterSpacing: 0 },
        content: { text: "Yangi matn", maxLines: 3 },
      });
      return;
    }
    if (kind === "shape") {
      insertElement({ ...base, type: "shape", x: 360, y: 191, width: 280, height: 180, style: { fill: accent, borderRadius: 20 }, content: {} });
      return;
    }
    if (kind === "frame") {
      insertElement({ ...base, type: "image", x: 330, y: 161, width: 340, height: 240, style: { borderRadius: 28, objectFit: "cover" }, content: { kind: "frame" } });
      return;
    }

    setUploading(true);
    try {
      const asset = await pickAsset(kind);
      if (!asset) return;
      const { path, signedUrl } = await uploadAsset(asset.uri, asset.mimeType, kind === "video" ? "mp4" : "jpg");
      const box = mediaBox(asset.width, asset.height);
      const storedContent: Json = { kind, storageBucket: "user-uploads", storagePath: path };
      insertElement(
        { ...base, type: "image", ...box, style: { borderRadius: 18, objectFit: "cover" }, content: kind === "video" ? storedContent : { ...storedContent, signedUrl } },
        storedContent,
      );
    } catch (error) {
      Alert.alert(kind === "video" ? "Video qo‘shilmadi" : "Rasm qo‘shilmadi", asErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  function duplicateSelected() {
    if (!selected) return;
    const id = Crypto.randomUUID();
    const now = new Date().toISOString();
    const duplicated: Element = { ...selected, id, x: selected.x + 18, y: selected.y + 18, z_index: selected.z_index + 1, locked: false, created_at: now, updated_at: now };
    setPast((history) => [...history.slice(-39), elements]);
    setFuture([]);
    setElements((rows) => [...rows, duplicated]);
    setSelectedId(id);
    void persist({ action: "duplicate", elementId: selected.id, newId: id, offsetX: 18, offsetY: 18 }, { action: "delete", elementId: id });
  }

  async function replaySnapshot(target: Element[]) {
    const previous = elements;
    setElements(target);
    const targetById = new Map(target.map((element) => [element.id, element]));
    const previousById = new Map(previous.map((element) => [element.id, element]));
    for (const old of previous) {
      const next = targetById.get(old.id);
      if (!next) await persist({ action: "delete", elementId: old.id }, { action: "insert", element: serializableElement(old) });
      else if (JSON.stringify(old) !== JSON.stringify(next)) {
        const patch: Patch = { x: next.x, y: next.y, width: next.width, height: next.height, rotation: next.rotation, z_index: next.z_index, opacity: next.opacity, locked: next.locked, style: next.style, content: next.content };
        const inverse: Patch = { x: old.x, y: old.y, width: old.width, height: old.height, rotation: old.rotation, z_index: old.z_index, opacity: old.opacity, locked: old.locked, style: old.style, content: old.content };
        await persist({ action: "update", elementId: old.id, patch: operationPatch(patch) }, { action: "update", elementId: old.id, patch: operationPatch(inverse) });
      }
    }
    for (const next of target) {
      if (!previousById.has(next.id)) await persist({ action: "insert", element: serializableElement(next) }, { action: "delete", elementId: next.id });
    }
  }

  function undo() {
    const target = past[past.length - 1];
    if (!target) return;
    setPast((history) => history.slice(0, -1));
    setFuture((history) => [elements, ...history].slice(0, 40));
    void replaySnapshot(target);
  }

  function redo() {
    const target = future[0];
    if (!target) return;
    setFuture((history) => history.slice(1));
    setPast((history) => [...history.slice(-39), elements]);
    void replaySnapshot(target);
  }

  /** Fills an image, frame or video slot — a frame is just an empty image. */
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
      Alert.alert(kind === "video" ? "Video almashtirilmadi" : "Rasm almashtirilmadi", asErrorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  async function runAiEdit() {
    if (!aiCommand.trim() || !currentSlideId) return;
    setAiLoading(true);
    try {
      const { error } = await supabase.functions.invoke("edit-presentation", { body: { presentationId, slideId: currentSlideId, command: aiCommand.trim() } });
      if (error) throw error;
      setAiCommand("");
      await load();
    } catch (error) {
      Alert.alert("Jaxongir AI o‘zgartirmadi", await asFunctionErrorMessage(error));
    } finally {
      setAiLoading(false);
    }
  }

  if (loading || !presentation || !currentSlide) return <View style={styles.loading}><ActivityIndicator color={colors.primary} size="large" /></View>;

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.screen} keyboardVerticalOffset={8}>
      <View style={styles.header}>
        <Pressable onPress={() => router.replace("/(app)/(tabs)/projects")} style={styles.iconButton}><ArrowLeft color={colors.ink} size={icon.md} strokeWidth={icon.stroke} /></Pressable>
        <View style={styles.headerCenter}><Text numberOfLines={1} style={styles.title}>{presentation.title}</Text><View style={styles.saveRow}>{saving ? <LoaderCircle color={colors.inkSoft} size={12} strokeWidth={icon.stroke} /> : <Check color={colors.success} size={12} strokeWidth={icon.strokeBold} />}<Text style={styles.saved}>{saving ? "Saqlanmoqda" : "Saqlandi"}</Text></View></View>
        {/* Beside the download, because they are the same decision: what do I
            leave with. One is the deck, the other is what to say beside it. */}
        <Pressable
          accessibilityLabel="Himoya matni"
          onPress={() => router.push({ pathname: "/(app)/defense/[id]", params: { id: presentationId } })}
          style={styles.iconButton}
        >
          <MessageSquareQuote color={colors.ink} size={icon.md} strokeWidth={icon.stroke} />
        </Pressable>
        <Pressable onPress={() => setExportOpen(true)} style={styles.iconButton}><Download color={colors.ink} size={icon.md} strokeWidth={icon.stroke} /></Pressable>
      </View>

      <ScrollView contentContainerStyle={[styles.editorScroll, { paddingBottom: dockHeight + spacing.xl }]} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* The stage is unclipped so selection handles can sit outside the slide. */}
        <GestureDetector gesture={stageGesture}>
        <Animated.View style={[{ width: canvasWidth, height: canvasHeight }, stageStyle]}>
          <View style={[styles.canvasFrame, StyleSheet.absoluteFill]}>
            <View style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale: displayScale }], transformOrigin: "top left" }}>
              <SlideCanvas
                slide={currentSlide}
                elements={currentElements}
                displayScale={displayScale}
                interactive
                onSelect={setSelectedId}
                onDragStart={() => { dragStart.current = elements; }}
                onDrag={(id, x, y) => applyTransform(id, { x, y })}
                onDragEnd={(id, x, y) => endTransform(id, { x, y })}
                onRequestEdit={(id) => {
                  const target = elements.find((element) => element.id === id);
                  if (target?.type === "text") setToolPanel("text");
                  // A double tap on a chart or a table opens the thing a reader
                  // actually wants to change on it: the numbers.
                  else if (target?.type === "chart" || target?.type === "table") setToolPanel("data");
                  else if (target?.type === "image") void replaceMedia(target);
                }}
                onTextMeasure={measureText}
              />
            </View>
          </View>
          {selectionTarget ? (
            <SelectionOverlay
              // For a library element this frames the whole placement rather
              // than the component the finger landed on: a handle on the wheel
              // would resize the wheel, and what was selected is the truck.
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

        {/* Only while it is doing something: a control that undoes nothing is
            a control to read past. */}
        {zoom > 1 || pan.x !== 0 || pan.y !== 0 ? (
          <Pressable accessibilityRole="button" onPress={resetZoom} style={styles.zoomReset}>
            <Text style={styles.zoomResetText}>{Math.round(zoom * 100)}% · asliga qaytarish</Text>
          </Pressable>
        ) : (
          <Text style={styles.zoomHint}>Ikki barmoq bilan kattalashtiring va suring</Text>
        )}

        <View style={styles.historyBar}>
          <Pressable disabled={!past.length} onPress={undo} style={[styles.historyButton, !past.length && styles.disabled]}><Undo2 color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} /><Text style={styles.historyText}>Orqaga</Text></Pressable>
          <Pressable disabled={!future.length} onPress={redo} style={[styles.historyButton, !future.length && styles.disabled]}><Redo2 color={colors.primary} size={icon.sm} strokeWidth={icon.stroke} /><Text style={styles.historyText}>Oldinga</Text></Pressable>
          <View style={styles.slideIndicator}><Text style={styles.slideIndicatorText}>{currentSlide.position + 1} / {slides.length}</Text></View>
        </View>

        <FlatList
          horizontal
          data={slides}
          keyExtractor={(slide) => slide.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbnails}
          renderItem={({ item }) => {
            const selectedSlide = item.id === currentSlideId;
            const thumbScale = 0.126;
            return (
              <Pressable onPress={() => { setCurrentSlideId(item.id); setSelectedId(null); }} style={[styles.thumbnailCard, selectedSlide && styles.thumbnailSelected]}>
                <View pointerEvents="none" style={styles.thumbnailClip}>
                  <View style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale: thumbScale }], transformOrigin: "top left" }}>
                    <SlideCanvas slide={item} elements={elements.filter((element) => element.slide_id === item.id)} />
                  </View>
                </View>
                <Text style={[styles.thumbnailNumber, selectedSlide && styles.thumbnailNumberSelected]}>{item.position + 1}</Text>
              </Pressable>
            );
          }}
        />
      </ScrollView>

      <View onLayout={(event) => setDockHeight(event.nativeEvent.layout.height)} style={styles.dockArea}>
        {selected ? (
          <ElementToolbar
            element={selected}
            swatches={swatches}
            panel={toolPanel}
            onPanel={setToolPanel}
            onStyle={(style) => updateElement(selected.id, { style })}
            onContent={(content) => updateElement(selected.id, { content })}
            onElement={(patch) => updateElement(selected.id, patch)}
            onReplaceImage={() => void replaceMedia(selected)}
            zRange={zRange}
          />
        ) : null}

        <AddElementBar
          open={addOpen}
          busy={uploading}
          hint={selected ? null : "Tahrirlash uchun elementni tanlang va suring"}
          onToggle={() => setAddOpen((value) => !value)}
          onAdd={(kind) => void addElement(kind)}
        />

        <View style={styles.aiBar}>
          <IconChip icon={Sparkles} variant="brand" size="sm" />
          <TextInput value={aiCommand} onChangeText={setAiCommand} placeholder="Jaxongir AI ga o‘zgartirishni ayting…" placeholderTextColor={colors.inkSoft} style={styles.aiInput} onSubmitEditing={() => void runAiEdit()} />
          <Pressable disabled={aiLoading || !aiCommand.trim()} onPress={() => void runAiEdit()} style={[styles.sendButton, (!aiCommand.trim() || aiLoading) && styles.disabled]}>{aiLoading ? <ActivityIndicator color={colors.onPrimary} size="small" /> : <Send color={colors.onPrimary} size={icon.sm} strokeWidth={icon.stroke} />}</Pressable>
        </View>
      </View>
      <ElementPicker
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(candidate) => void addLibraryElement(candidate)}
      />

      <ExportSheet
        visible={exportOpen}
        presentationId={presentation.id}
        presentationTitle={presentation.title}
        onClose={() => setExportOpen(false)}
      />
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.canvas },
  header: { paddingTop: 55, paddingHorizontal: spacing.lg, paddingBottom: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: colors.canvas },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },
  title: { ...typography.bodyMedium, color: colors.ink, maxWidth: 230 },
  saveRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  saved: { ...typography.caption, color: colors.inkSoft },
  editorScroll: { paddingTop: spacing.xl, alignItems: "center" },
  canvasFrame: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: "hidden", ...shadow },
  zoomReset: { alignSelf: "center", paddingVertical: 8, paddingHorizontal: spacing.lg, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  zoomResetText: { ...typography.caption, fontWeight: "700", color: colors.primaryDeep },
  zoomHint: { ...typography.caption, color: colors.inkSoft, textAlign: "center" },
  historyBar: { width: "100%", flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.xl, marginTop: spacing.xxl, gap: spacing.sm },
  historyButton: { height: 38, paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.borderStrong, flexDirection: "row", alignItems: "center", gap: 6 },
  historyText: { ...typography.caption, color: colors.ink },
  slideIndicator: { marginLeft: "auto", backgroundColor: colors.primarySoft, borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 7 },
  slideIndicatorText: { ...typography.caption, color: colors.primary },
  thumbnails: { paddingHorizontal: spacing.xl, paddingVertical: spacing.lg, gap: spacing.md },
  thumbnailCard: { width: 142, padding: 7, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  thumbnailSelected: { borderColor: colors.primary, borderWidth: 2, padding: 6 },
  thumbnailClip: { width: 126, height: 71, overflow: "hidden", borderRadius: 5, backgroundColor: colors.surfaceMuted },
  thumbnailNumber: { ...typography.caption, color: colors.inkMuted, marginTop: 5, textAlign: "center" },
  thumbnailNumberSelected: { color: colors.primary },
  // The dock keeps the tools on screen for as long as something is selected —
  // it no longer scrolls away or clears when a finger lifts.
  dockArea: { position: "absolute", left: spacing.md, right: spacing.md, bottom: Platform.OS === "ios" ? 24 : 12, gap: spacing.sm },
  aiBar: { minHeight: 60, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, flexDirection: "row", alignItems: "center", padding: spacing.sm, gap: spacing.sm, ...shadowLifted },
  aiInput: { ...typography.body, color: colors.ink, flex: 1, minHeight: 42 },
  sendButton: { width: 42, height: 42, borderRadius: 13, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
  disabled: { opacity: 0.35 },
}));
