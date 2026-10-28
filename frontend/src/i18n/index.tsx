import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en, type TranslationKey } from "./en";
import { hi } from "./hi";

/** To add a language: create its file (see en.ts) and add one line here. The language picker lists whatever is in this object. */
const languages = {
  en: { label: "English", strings: en as Record<TranslationKey, string> },
  hi: { label: "हिन्दी", strings: hi },
} as const;

export type Lang = keyof typeof languages;
export const LANGUAGE_OPTIONS = (Object.keys(languages) as Lang[]).map((code) => ({ code, label: languages[code].label }));
const KEY = "lms.lang";

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && saved in languages) return saved as Lang;
  } catch {
    /* ignore */
  }
  const browser = navigator.language.slice(0, 2);
  return browser in languages ? (browser as Lang) : "en";
}

/** Fills {name} placeholders. Exported for testing. */
export function format(template: string, vars?: Record<string, string | number>): string {
  return vars ? template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole)) : template;
}

interface I18nValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  /** t("nav.courses") -> "Courses". A key missing in the chosen language falls back to English. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}
const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang; // screen readers pick the right voice from this
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ lang, setLang, t: (key, vars) => format(languages[lang].strings[key] ?? en[key], vars) }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useT must be used inside <I18nProvider>");
  return ctx;
}
