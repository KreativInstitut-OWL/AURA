import { useCallback, useSyncExternalStore } from "react";

export type Lang = "de" | "en";

const KEY = "aura-lang";
const listeners = new Set<() => void>();
let current: Lang | null = null;

function read(): Lang {
  if (current) return current;
  try {
    const s = localStorage.getItem(KEY);
    current = s === "en" ? "en" : "de";
  } catch {
    current = "de";
  }
  return current;
}

export function setLang(l: Lang) {
  current = l;
  try {
    localStorage.setItem(KEY, l);
  } catch {
    /* ignore */
  }
  document.documentElement.lang = l;
  listeners.forEach((f) => f());
}

function subscribe(f: () => void) {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** German is the default language; English is opt-in and remembered. */
export function useLang() {
  const lang = useSyncExternalStore(subscribe, read, () => "de" as Lang);
  /** t(english, german) */
  const t = useCallback((en: string, de: string) => (lang === "de" ? de : en), [lang]);
  return { lang, setLang, t };
}
