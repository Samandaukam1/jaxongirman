import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Which palette the console draws in.
 *
 * Three settings rather than two, and the same three the phone app offers, so
 * somebody moving between them is not learning two different ideas. "System" is
 * the default and the one most people never change; the other two exist because
 * some people want one regardless, and a product that overrules them is one
 * they fight.
 *
 * The choice is a class of one attribute on the root element. Every colour in
 * `styles.css` already resolves through tokens, so the whole console changes
 * when that attribute does — no component reads this, and no page has to know
 * that dark exists.
 */

type ThemeMode = "system" | "light" | "dark";

const KEY = "jaxongirman:admin-theme";

const ThemeContext = createContext<{ mode: ThemeMode; setMode: (mode: ThemeMode) => void }>({
  mode: "system",
  setMode: () => {},
});

const remembered = (): ThemeMode => {
  try {
    const saved = localStorage.getItem(KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
  } catch {
    // A browser refusing storage is a browser that gets the default, not an error.
    return "system";
  }
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setStored] = useState<ThemeMode>(remembered);

  useEffect(() => {
    const root = document.documentElement;
    // Nothing at all for "system": the stylesheet's media query is what answers
    // then, and an attribute would override it in both directions.
    if (mode === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setStored(next);
    try { localStorage.setItem(KEY, next); } catch { /* remembered for this session only */ }
  }, []);

  const value = useMemo(() => ({ mode, setMode }), [mode, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
