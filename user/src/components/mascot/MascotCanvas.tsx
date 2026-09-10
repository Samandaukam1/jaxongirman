import { GLView, type ExpoWebGLRenderingContext } from "expo-gl";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";

import { loadMascotModel } from "./asset";
import { createStage, type Stage, type StageOptions } from "./stage";

type Props = {
  style?: StyleProp<ViewStyle>;
  options?: StageOptions;
  /** Runs once the first frame is on screen, so the caller can fade it in. */
  onReady?: () => void;
  onFailed?: (error: unknown) => void;
  /** Bumping this replays the greeting. */
  greetToken?: number;
  paused?: boolean;
};

/**
 * A live WebGL surface running the character.
 *
 * The same component serves native and web: expo-gl hands back a real context
 * on both, so there is one renderer and one scene rather than a 3D path and a
 * picture of one.
 */
export function MascotCanvas({ style, options, onReady, onFailed, greetToken, paused }: Props) {
  const stageRef = useRef<Stage | null>(null);
  const frameRef = useRef<number | null>(null);
  const [active, setActive] = useState(AppState.currentState === "active");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => subscription.remove();
  }, []);

  const suspended = paused === true || !active;
  // The GL context is created once, so its callback would otherwise capture
  // whatever `suspended` was on first render and hold the scene frozen there.
  const suspendedRef = useRef(suspended);
  suspendedRef.current = suspended;
  useEffect(() => {
    stageRef.current?.setPaused(suspended);
  }, [suspended]);

  useEffect(() => {
    if (greetToken === undefined) return;
    stageRef.current?.greet();
  }, [greetToken]);

  const onContextCreate = useCallback(
    async (gl: ExpoWebGLRenderingContext) => {
      try {
        const data = await loadMascotModel();
        const stage = await createStage(gl as unknown as WebGL2RenderingContext, data, options ?? {});
        stageRef.current = stage;
        let width = 0;
        let height = 0;
        let last = 0;
        const tick = (now: number) => {
          frameRef.current = requestAnimationFrame(tick);
          const seconds = now / 1000;
          const dt = last ? seconds - last : 1 / 60;
          last = seconds;
          if (gl.drawingBufferWidth !== width || gl.drawingBufferHeight !== height) {
            width = gl.drawingBufferWidth;
            height = gl.drawingBufferHeight;
            if (width > 0 && height > 0) stage.resize(width, height);
          }
          if (width > 0 && height > 0) stage.frame(dt);
        };
        frameRef.current = requestAnimationFrame(tick);
        stage.setPaused(suspendedRef.current);
        stage.greet();
        if (__DEV__) console.log("[mascot] stage ready", gl.drawingBufferWidth, gl.drawingBufferHeight);
        onReady?.();
      } catch (error) {
        // Worth a line in development: a silent empty box is the hardest
        // version of this failure to diagnose.
        if (__DEV__) console.warn("[mascot] scene failed", error);
        setFailed(true);
        onFailed?.(error);
      }
    },
    // The context is created once; re-running this would leak a renderer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    stageRef.current?.dispose();
    stageRef.current = null;
  }, []);

  if (failed) return null;
  return (
    <View pointerEvents="none" style={style}>
      <GLView
        style={StyleSheet.absoluteFill}
        // Web needs premultiplied alpha off-screen to composite cleanly.
        msaaSamples={Platform.OS === "ios" ? 4 : 0}
        onContextCreate={onContextCreate}
      />
    </View>
  );
}
