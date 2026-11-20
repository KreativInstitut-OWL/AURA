/** Storage may be blocked, full, or absent during SSR; never make it essential. */
export function storageGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function storageSet(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* optional persistence */ }
}
export function storageRemove(key: string): void {
  try { localStorage.removeItem(key); } catch { /* optional persistence */ }
}