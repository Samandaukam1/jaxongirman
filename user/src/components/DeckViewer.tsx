import { memo, useCallback, useRef, useState } from "react";
import { FlatList, Pressable, Text, View, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

import { MODEL_HEIGHT, MODEL_WIDTH, SlideCanvas } from "@/components/SlideCanvas";
import { useSlideGroups, type Element, type Slide } from "@/lib/deck";
import { radius, shadowLifted, spacing, typography } from "@/theme/tokens";
import { makeStyles } from "@/theme/ThemeProvider";

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

  const jump = (target: number) => {
    list.current?.scrollToOffset({ offset: target * (width + gap), animated: true });
    setIndex(target);
  };

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
        style={{ height: pageHeight + spacing.lg }}
        contentContainerStyle={styles.track}
      />
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

function Gap() {
  return <View style={{ width: spacing.md }} />;
}

const useStyles = makeStyles((colors) => ({
  wrap: { gap: spacing.sm },
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

