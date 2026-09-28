import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

type Mode = "light" | "dark";

const KEY = "aura-theme";

function apply(mode: Mode) {
  document.documentElement.classList.toggle("dark", mode === "dark");
}

export function useThemeMode() {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    const stored = localStorage.getItem(KEY);
    const initial: Mode =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
    setMode(initial);
    apply(initial);
  }, []);

  const toggle = () => {
    setMode((m) => {
      const next: Mode = m === "dark" ? "light" : "dark";
      localStorage.setItem(KEY, next);
      apply(next);
      return next;
    });
  };

  return { mode, toggle };
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const { mode, toggle } = useThemeMode();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      title={mode === "dark" ? "Light mode" : "Dark mode"}
      className={`inline-flex size-8 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:text-foreground ${className}`}
    >
      {mode === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
    </button>
  );
}
