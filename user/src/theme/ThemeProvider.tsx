import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { StyleSheet, useColorScheme } from "react-native";

import { dark, light, type Palette } from "./palettes";

/**
 * Which palette the app is drawing in, and how a screen asks for it.
 *
 * Three settings rather than two. "System" is the default and the one most
 * people never change — a phone that goes dark at sunset should take the app
 * with it. The other two exist because some people want one or the other
 * regardless, and an app that overrules them is an app they fight.
 *
 * The choice is remembered on the device rather than on the account: it is a
 * property of the screen you are holding, and somebody who reads in bed on
 * their phone and works on a tablet in daylight wants different answers.
 */

export type ThemeMode = "system" | "light" | "dark";

type ThemeValue = {
  colors: Palette;
  /** What is actually being drawn, after "system" is resolved. */
  scheme: "light" | "dark";
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
};

const STORAGE_KEY = "jaxongirman:theme";

const ThemeContext = createContext<ThemeValue>({
  colors: light,
  scheme: "light",
  mode: "system",
  setMode: () => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setStoredMode] = useState<ThemeMode>("system");

  useEffect(() => {
    let alive = true;
    void AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (alive && (saved === "light" || saved === "dark" || saved === "system")) setStoredMode(saved);
    });
    return () => { alive = false; };
  }, []);

  const setMode = useCallback((next: ThemeMode) => {
    setStoredMode(next);
    void AsyncStorage.setItem(STORAGE_KEY, next);
  }, []);

  const value = useMemo<ThemeValue>(() => {
    const scheme = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
    return { colors: scheme === "dark" ? dark : light, scheme, mode, setMode };
  }, [mode, setMode, system]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = (): ThemeValue => useContext(ThemeContext);

/**
 * A stylesheet that knows which palette it is in.
 *
 * `StyleSheet.create` runs once, at module load, which is exactly why the app
 * could not have a dark mode: a screen's colours were decided before anybody
 * had opened it. This takes the same object but as a function of the palette,
 * and builds one stylesheet per palette — two in the life of the process, not
 * one per render.
 *
 *     const useStyles = makeStyles((colors) => ({
 *       screen: { backgroundColor: colors.canvas },
 *     }));
 *
 *     function Screen() {
 *       const styles = useStyles();
 *     }
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  build: (colors: Palette) => T,
): () => T {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const { colors } = useTheme();
    const known = cache.get(colors);
    if (known) return known;
    const created = StyleSheet.create(build(colors));
    cache.set(colors, created);
    return created;
  };
}
