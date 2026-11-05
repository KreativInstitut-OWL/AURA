/**
 * Candidate regions for the fast peak estimate: one window around the loudest
 * envelope bin of each used input channel, merged where they overlap.
 * The envelope stores the absolute sample peak per bin (channel-major).
 */
export function peakWindows(
  envelope: Float32Array,
  bins: number,
  binSamples: number,
  channels: Iterable<number>,
  halfWindowFrames: number,
  totalFrames: number,
): [number, number][] {
  const raw: [number, number][] = [];
  for (const ci of channels) {
    let best = -1;
    let bestBin = 0;
    const base = ci * bins;
    for (let b = 0; b < bins; b++) {
      const v = envelope[base + b]!;
      if (v > best) { best = v; bestBin = b; }
    }
    if (best <= 0) continue; // silent channel: nothing to check
    const centre = bestBin * binSamples + (binSamples >> 1);
    raw.push([
      Math.max(0, centre - halfWindowFrames),
      Math.min(totalFrames, centre + halfWindowFrames),
    ]);
  }
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const w of raw) {
    const last = merged[merged.length - 1];
    if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
    else merged.push([w[0], w[1]]);
  }
  return merged;
}
