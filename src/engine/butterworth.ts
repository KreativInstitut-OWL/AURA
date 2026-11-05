/** 4th-order Butterworth low-pass (two cascaded biquads), direct form I. */
export class Butterworth4 {
  private s: { b0: number; b1: number; b2: number; a1: number; a2: number; x1: number; x2: number; y1: number; y2: number }[] = [];
  constructor(fc: number, fs: number) {
    const qs = [0.541196, 1.306563]; // Butterworth 4th-order section Qs
    for (const q of qs) {
      const w = (2 * Math.PI * fc) / fs;
      const cw = Math.cos(w);
      const alpha = Math.sin(w) / (2 * q);
      const a0 = 1 + alpha;
      this.s.push({
        b0: (1 - cw) / 2 / a0,
        b1: (1 - cw) / a0,
        b2: (1 - cw) / 2 / a0,
        a1: (-2 * cw) / a0,
        a2: (1 - alpha) / a0,
        x1: 0, x2: 0, y1: 0, y2: 0,
      });
    }
  }
  process(x: number): number {
    let v = x;
    for (const s of this.s) {
      const y = s.b0 * v + s.b1 * s.x1 + s.b2 * s.x2 - s.a1 * s.y1 - s.a2 * s.y2;
      s.x2 = s.x1;
      s.x1 = v;
      s.y2 = s.y1;
      s.y1 = y;
      v = y;
    }
    return v;
  }
}

/** Crossover used for every active LFE route. */
export const LFE_CUTOFF_HZ = 120;
