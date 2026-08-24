import {
  MAX_PRESENTATION_SCALE,
  RESET_PRESENTATION_VIEWPORT,
  SLIDE_MODEL_HEIGHT,
  SLIDE_MODEL_WIDTH,
  clampPresentationViewport,
  type PresentationViewport,
  type RenderableSlide,
  type RenderableSlideElement,
} from "@jaxongirman/types";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";

import { SlideCanvas } from "@/components/SlideCanvas";
import { radius } from "@/theme/tokens";

const NETWORK_EVERY_N_FRAMES = 3;

export type PresentationPreviewHandle = {
  reset: () => void;
};

type Props = {
  slide: RenderableSlide;
  elements: RenderableSlideElement[];
  viewport: PresentationViewport;
  disabled?: boolean;
  onViewportChange: (viewport: PresentationViewport, final: boolean) => void;
};

/**
 * A gallery-like view of one real slide. All gesture state stays on the UI
 * thread; only every third frame crosses to JS for a throttled Realtime send.
 */
export const PresentationPreview = forwardRef<PresentationPreviewHandle, Props>(function PresentationPreview(
  { slide, elements, viewport, disabled = false, onViewportChange },
  ref,
) {
  const [displayScale, setDisplayScale] = useState(1);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const anchorX = useSharedValue(0);
  const anchorY = useSharedValue(0);
  const networkFrame = useSharedValue(0);
  const viewportScale = viewport.scale;
  const viewportTranslateX = viewport.translateX;
  const viewportTranslateY = viewport.translateY;

  const emit = useCallback((nextScale: number, nextX: number, nextY: number, final: boolean) => {
    onViewportChange(clampPresentationViewport({ scale: nextScale, translateX: nextX, translateY: nextY }), final);
  }, [onViewportChange]);

  const reset = useCallback(() => {
    scale.value = withTiming(RESET_PRESENTATION_VIEWPORT.scale, { duration: 160 });
    translateX.value = withTiming(0, { duration: 160 });
    translateY.value = withTiming(0, { duration: 160 });
    emit(1, 0, 0, true);
  }, [emit, scale, translateX, translateY]);

  useImperativeHandle(ref, () => ({ reset }), [reset]);

  useEffect(() => {
    const next = clampPresentationViewport({
      scale: viewportScale,
      translateX: viewportTranslateX,
      translateY: viewportTranslateY,
    });
    scale.value = withTiming(next.scale, { duration: 90 });
    translateX.value = withTiming(next.translateX, { duration: 90 });
    translateY.value = withTiming(next.translateY, { duration: 90 });
  }, [scale, translateX, translateY, viewportScale, viewportTranslateX, viewportTranslateY]);

  function onLayout(event: LayoutChangeEvent) {
    const width = event.nativeEvent.layout.width;
    if (width > 0) setDisplayScale(width / SLIDE_MODEL_WIDTH);
  }

  const gesture = useMemo(() => {
    const clamp = (value: number, minimum: number, maximum: number) => {
      "worklet";
      return Math.min(Math.max(value, minimum), maximum);
    };
    const clampTranslationX = (value: number, nextScale: number) => {
      "worklet";
      const bound = (SLIDE_MODEL_WIDTH * (nextScale - 1)) / 2;
      return clamp(value, -bound, bound);
    };
    const clampTranslationY = (value: number, nextScale: number) => {
      "worklet";
      const bound = (SLIDE_MODEL_HEIGHT * (nextScale - 1)) / 2;
      return clamp(value, -bound, bound);
    };
    const sendLive = () => {
      "worklet";
      networkFrame.value = (networkFrame.value + 1) % NETWORK_EVERY_N_FRAMES;
      if (networkFrame.value === 0) runOnJS(emit)(scale.value, translateX.value, translateY.value, false);
    };
    const sendFinal = () => {
      "worklet";
      runOnJS(emit)(scale.value, translateX.value, translateY.value, true);
    };

    const pinch = Gesture.Pinch()
      .enabled(!disabled)
      .onStart((event) => {
        startScale.value = scale.value;
        startX.value = translateX.value;
        startY.value = translateY.value;
        const focalX = event.focalX / displayScale - SLIDE_MODEL_WIDTH / 2;
        const focalY = event.focalY / displayScale - SLIDE_MODEL_HEIGHT / 2;
        anchorX.value = (focalX - startX.value) / startScale.value;
        anchorY.value = (focalY - startY.value) / startScale.value;
      })
      .onUpdate((event) => {
        const nextScale = clamp(startScale.value * event.scale, 1, MAX_PRESENTATION_SCALE);
        const focalX = event.focalX / displayScale - SLIDE_MODEL_WIDTH / 2;
        const focalY = event.focalY / displayScale - SLIDE_MODEL_HEIGHT / 2;
        scale.value = nextScale;
        translateX.value = clampTranslationX(focalX - nextScale * anchorX.value, nextScale);
        translateY.value = clampTranslationY(focalY - nextScale * anchorY.value, nextScale);
        sendLive();
      })
      .onFinalize(sendFinal);

    // Pinch already turns a moving two-finger focal point into a pan. This
    // gesture adds the familiar one-finger drag once the slide is enlarged.
    const pan = Gesture.Pan()
      .enabled(!disabled)
      .maxPointers(1)
      .minDistance(3)
      .onStart(() => {
        startX.value = translateX.value;
        startY.value = translateY.value;
      })
      .onUpdate((event) => {
        if (scale.value <= 1) return;
        translateX.value = clampTranslationX(startX.value + event.translationX / displayScale, scale.value);
        translateY.value = clampTranslationY(startY.value + event.translationY / displayScale, scale.value);
        sendLive();
      })
      .onFinalize(sendFinal);

    return Gesture.Simultaneous(pinch, pan);
  }, [anchorX, anchorY, disabled, displayScale, emit, networkFrame, scale, startScale, startX, startY, translateX, translateY]);

  const translationStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
  }));
  const scaleStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <View onLayout={onLayout} style={styles.viewport}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={StyleSheet.absoluteFill}>
          <View
            pointerEvents="none"
            style={[
              styles.model,
              { transform: [{ scale: displayScale }], transformOrigin: "top left" },
            ]}
          >
            <Animated.View style={[styles.model, translationStyle]}>
              <Animated.View style={[styles.model, scaleStyle, { transformOrigin: "center" }]}>
                <SlideCanvas slide={slide} elements={elements} />
              </Animated.View>
            </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
});

/**
 * The mat around the slide stays dark in both themes. It is the surround of a
 * projected image, and a light one would wash out the slide it frames.
 */
const MAT = "#150E24";

const styles = StyleSheet.create({
  viewport: {
    width: "100%",
    aspectRatio: SLIDE_MODEL_WIDTH / SLIDE_MODEL_HEIGHT,
    overflow: "hidden",
    borderRadius: radius.lg,
    backgroundColor: MAT,
  },
  model: {
    position: "absolute",
    left: 0,
    top: 0,
    width: SLIDE_MODEL_WIDTH,
    height: SLIDE_MODEL_HEIGHT,
  },
});
