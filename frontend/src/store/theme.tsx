import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

type Choice = "light" | "dark" | "system";
const KEY = "lms.theme";

const systemPrefersDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const resolve = (choice: Choice): "light" | "dark" => (choice === "system" ? (systemPrefersDark() ? "dark" : "light") : choice);

function readChoice(): Choice {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

interface ThemeValue {
  /** What is actually showing right now. */
  theme: "light" | "dark";
  toggle: () => void;
}
const ThemeContext = createContext<ThemeValue | null>(null);

/**
 * Light/dark mode. Until the person clicks the toggle we follow their device setting; after that we remember their choice.
 * The <html data-theme="..."> attribute is what the CSS in index.css reacts to. index.html sets it before the first paint
 * so a dark-mode user never sees a white flash.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Choice>(readChoice);
  const [theme, setTheme] = useState<"light" | "dark">(() => resolve(readChoice()));

  useEffect(() => {
    const apply = () => {
      const next = resolve(choice);
      setTheme(next);
      document.documentElement.dataset.theme = next;
    };
    apply();
    if (choice !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", apply); // the device switched (e.g. sunset): follow it
    return () => media.removeEventListener("change", apply);
  }, [choice]);

  const toggle = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setChoice(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* private mode: the choice just won't be remembered */
    }
  }, [theme]);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
