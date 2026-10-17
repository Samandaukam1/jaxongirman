import { useFocusEffect } from "expo-router";
import { ChevronLeft, ChevronRight } from "lucide-react-native";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { FlatList, Platform, Pressable, Text, View, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { MODEL_HEIGHT, MODEL_WIDTH, SlideCanvas } from "@/components/SlideCanvas";
import { useSlideGroups, type Element, type Slide } from "@/lib/deck";
import { radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles, useTheme } from "@/theme/ThemeProvider";

type Props = {
  slides: Slide[];
  elements: Element[];
  /** The width each slide is drawn at. */
  width: number;
  /** Bumped when the deck's fonts land, so the pages redraw in them. */
  revision?: number;
};

/** One page of the deck, drawn once and kept: paging does not redraw its neighbours. */
const Page = memo(function Page({ slide, elements, width, revision }: { slide: Slide; elements: Element[]; width: number; revision: number }) {
  const styles = useStyles();
  const scale = width / MODEL_WIDTH;
  return (
    <View style={[styles.page, { width, height: MODEL_HEIGHT * scale }]}>
      <View pointerEvents="none" style={{ width: MODEL_WIDTH, height: MODEL_HEIGHT, transform: [{ scale }], transformOrigin: "top left" }}>
        <SlideCanvas slide={slide} elements={elements} revision={revision} />
      </View>
    </View>
  );
});

/**
 * The finished deck, one slide at a time.
 *
 * The page a person lands on when their deck is done is a viewer, not an
 * editor: swipe through it, and nothing else on the slide can be grabbed by
 * mistake. Each page is drawn at the width it is shown at and memoised, and
 * the list only mounts the pages near the one in view, so a thirty-slide deck
 * opens as fast as a five-slide one.
 */
export function DeckViewer({ slides, elements, width, revision = 0 }: Props) {
  const styles = useStyles();
  const [index, setIndex] = useState(0);
  // The page in view, for the key handler, which outlives any one render.
  const shown = useRef(0);
  useEffect(() => { shown.current = index; }, [index]);
  const list = useRef<FlatList<Slide>>(null);
  const bySlide = useSlideGroups(elements);
  const gap = spacing.md;
  const pageHeight = (MODEL_HEIGHT * width) / MODEL_WIDTH;

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(event.nativeEvent.contentOffset.x / (width + gap));
    setIndex((current) => (current === next ? current : Math.max(0, Math.min(slides.length - 1, next))));
  }, [gap, slides.length, width]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<Slide>) => (
    <Page slide={item} elements={bySlide.get(item.id) ?? EMPTY} width={width} revision={revision} />
  ), [bySlide, revision, width]);

  const jump = useCallback((target: number) => {
    const next = Math.max(0, Math.min(slides.length - 1, target));
    list.current?.scrollToOffset({ offset: next * (width + gap), animated: true });
    setIndex(next);
  }, [gap, slides.length, width]);

  // A browser has no swipe: the arrow keys page, while this screen is the one
  // in front and nobody is typing.
  useFocusEffect(useCallback(() => {
    if (Platform.OS !== "web") return undefined;
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === "ArrowRight") { event.preventDefault(); jump(shown.current + 1); }
      if (event.key === "ArrowLeft") { event.preventDefault(); jump(shown.current - 1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [jump]));

  return (
    <View style={styles.wrap}>
      <FlatList
        ref={list}
        data={slides}
        horizontal
        keyExtractor={(slide) => slide.id}
        renderItem={renderItem}
        showsHorizontalScrollIndicator={false}
        snapToInterval={width + gap}
        decelerationRate="fast"
        disableIntervalMomentum
        onScroll={onScroll}
        scrollEventThrottle={32}
        ItemSeparatorComponent={Gap}
        initialNumToRender={2}
        windowSize={3}
        maxToRenderPerBatch={2}
        getItemLayout={(_, at) => ({ length: width + gap, offset: (width + gap) * at, index: at })}
        // On the web the list is exactly one page wide, so the last page can be
        // scrolled to the start like the others; a phone keeps the peek.
        style={[{ height: pageHeight + spacing.lg }, Platform.OS === "web" ? { width, flexGrow: 0 } : null]}
        contentContainerStyle={styles.track}
      />
      {Platform.OS === "web" && slides.length > 1 ? (
        <>
          <Arrow side="left" disabled={index === 0} top={spacing.sm + pageHeight / 2} left={spacing.md} onPress={() => jump(index - 1)} />
          <Arrow side="right" disabled={index === slides.length - 1} top={spacing.sm + pageHeight / 2} left={width - spacing.md - ARROW} onPress={() => jump(index + 1)} />
        </>
      ) : null}
      <View style={styles.pager}>
        <View style={styles.dots}>
          {slides.length <= 14
            ? slides.map((slide, at) => (
              <Pressable key={slide.id} hitSlop={6} onPress={() => jump(at)} accessibilityLabel={`${at + 1}-slayd`}>
                <View style={[styles.dot, at === index && styles.dotActive]} />
              </Pressable>
            ))
            : <View style={styles.progressTrack}><View style={[styles.progressFill, { width: `${((index + 1) / slides.length) * 100}%` }]} /></View>}
        </View>
        <Text style={styles.count}>{index + 1} / {slides.length}</Text>
      </View>
    </View>
  );
}

const EMPTY: Element[] = [];
const ARROW = 44;

/** Paging with a mouse: a round button on the edge of the slide in view. */
function Arrow({ side, disabled, top, left, onPress }: { side: "left" | "right"; disabled: boolean; top: number; left: number; onPress: () => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={side === "left" ? "‹" : "›"}
      disabled={disabled}
      onPress={onPress}
      style={({ hovered }: { hovered?: boolean; pressed: boolean }) => [
        styles.arrow, { top: top - ARROW / 2, left }, hovered && styles.arrowHover, disabled && styles.arrowOff,
      ]}
    >
      <Icon color={colors.ink} size={22} strokeWidth={2.2} />
    </Pressable>
  );
}

function Gap() {
  return <View style={{ width: spacing.md }} />;
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: spacing.sm, position: "relative" },
  arrow: {
    position: "absolute", width: ARROW, height: ARROW, borderRadius: ARROW / 2,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    boxShadow: "0 6px 18px rgba(25, 10, 60, 0.18)",
  },
  arrowHover: { backgroundColor: colors.surfaceMuted },
  arrowOff: { opacity: 0 },
  track: { paddingVertical: spacing.sm },
  page: { borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surface, ...shadowLifted },
  pager: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  dots: { flexDirection: "row", alignItems: "center", gap: 6, flex: 1 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.borderStrong },
  dotActive: { width: 18, backgroundColor: colors.primary },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: "hidden" },
  progressFill: { height: "100%", borderRadius: 2, backgroundColor: colors.primary },
  count: { ...typography.caption, fontFamily: "Manrope_700Bold", color: colors.inkMuted },
}));

