/** Retire old URLs after browser download handoff, not during the click itself.
 * There is no browser API for download completion. Already acquired downloads
 * retain their Blob; the grace period also covers asynchronous acquisition.
 */
export const DOWNLOAD_HANDOFF_MS = 60_000;
export class OutputUrlOwner {
  private current: string | null = null;
  replace(blob: Blob): string {
    this.clear();
    this.current = URL.createObjectURL(blob);
    return this.current;
  }
  clear(): void {
    const url = this.current;
    this.current = null;
    if (url) setTimeout(() => URL.revokeObjectURL(url), DOWNLOAD_HANDOFF_MS);
  }
}