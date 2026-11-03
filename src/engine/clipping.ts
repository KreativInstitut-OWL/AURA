/** Additional margin beyond the highest sample peak observed so far. */
export const CLIPPING_HEADROOM_DB = 1;

export function suggestedMasterGain(gainDb: number, peakDb: number): number {
  if (peakDb <= 0) return gainDb;
  // Round downward, never reducing the requested safety margin.
  return Math.max(-24, Math.floor((gainDb - peakDb - CLIPPING_HEADROOM_DB) * 10) / 10);
}

/** One explicit continue decision acknowledges hard clipping for this render. */
export class ClippingGate {
  cancelled = false;
  private acknowledged = false;
  private release: (() => void) | null = null;

  shouldPause(peak: number): boolean {
    return peak > 1 && !this.acknowledged && !this.cancelled;
  }

  wait(): Promise<void> {
    return new Promise((resolve) => { this.release = resolve; });
  }

  continue(): void {
    if (!this.release) return;
    this.acknowledged = true;
    this.release();
    this.release = null;
  }

  cancel(): void {
    this.cancelled = true;
    this.release?.();
    this.release = null;
  }
}