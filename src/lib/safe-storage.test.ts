import { expect, test, vi } from "vitest";
import { storageGet, storageSet, storageRemove } from "./safe-storage";

test("denied storage getter never interrupts reads, writes or removals", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  try {
    expect(storageGet("aura-crash-diag")).toBeNull();
    expect(() => storageSet("aura-theme", "dark")).not.toThrow();
    expect(() => storageRemove("aura-crash-diag")).not.toThrow();
  } finally {
    if (original) Object.defineProperty(globalThis, "localStorage", original);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
test("reading a crash record leaves it stored until explicitly removed", () => {
  const values = new Map([["aura-crash-diag", "unfinished render"]]);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
  try {
    expect(storageGet("aura-crash-diag")).toBe("unfinished render");
    expect(values.has("aura-crash-diag")).toBe(true);
    storageSet("aura-theme", "dark");
    expect(values.get("aura-theme")).toBe("dark");
    storageRemove("aura-crash-diag");
    expect(values.has("aura-crash-diag")).toBe(false);
  } finally { vi.unstubAllGlobals(); }
});