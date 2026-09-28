/**
 * Binaural decoding of an Ambisonic (ACN/SN3D) signal for headphones.
 *
 * Uses the HOAST spherical-harmonic HRIR decoding filters published by IEM Graz
 * (Thomas Deppisch, HOAST360), measured on a Neumann KU100 dummy head. The
 * filters live directly in the SH domain, so decoding is one short convolution
 * per ambisonic channel instead of a virtual loudspeaker array.
 *
 * Structure follows JSAmbisonics' binaural decoder (Archontis Politis,
 * David Poirier-Quinot) as adapted in HOAST360.
 *
 * The published filter set covers 1st to 4th order.
 */

export const HOAST_MAX_ORDER = 4;

const IR_BASE = "/hoast-irs/hoast";

/** Band-limited enough for short HRIRs: linear interpolation resampler. */
export function resampleLinear(data: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return data;
  const ratio = to / from;
  const outLen = Math.max(1, Math.round(data.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const p = i / ratio;
    const i0 = Math.floor(p);
    const i1 = Math.min(i0 + 1, data.length - 1);
    const t = p - i0;
    out[i] = data[i0]! * (1 - t) + data[i1]! * t;
  }
  return out;
}

/** Safari only recently added the promise form of decodeAudioData. */
function decodeAudio(ctx: BaseAudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const maybe = ctx.decodeAudioData(data, resolve, reject);
    if (maybe && typeof maybe.then === "function") maybe.then(resolve, reject);
  });
}

const GROUPS: Record<number, string[]> = {
  1: ["_01-04ch"],
  2: ["_01-04ch", "_05-09ch"],
  3: ["_01-04ch", "_05-12ch", "_13-16ch"],
  4: ["_01-04ch", "_05-12ch", "_13-20ch", "_21-25ch"],
};

export interface HoastFilters {
  order: number;
  /** filters for ACN 0..3 */
  foa: AudioBuffer;
  /** filters for ACN 4..(order+1)^2-1, one channel each */
  hoa: AudioBuffer | null;
}

/** Fetch + decode the SH-HRIR filter set for the given order. */
export async function loadHoastFilters(
  ctx: BaseAudioContext,
  order: number,
): Promise<HoastFilters> {
  const groups = GROUPS[order];
  if (!groups) throw new Error(`No HOAST filter set for order ${order}`);

  const buffers = await Promise.all(
    groups.map(async (suffix) => {
      const res = await fetch(`${IR_BASE}_o${order}${suffix}.wav`);
      if (!res.ok) throw new Error(`Could not load binaural filters (${res.status})`);
      return decodeAudio(ctx, await res.arrayBuffer());
    }),
  );

  const foa = buffers[0]!;
  if (order === 1) return { order, foa, hoa: null };

  const nCh = (order + 1) * (order + 1);
  let length = 0;
  for (let i = 1; i < buffers.length; i++) length = Math.max(length, buffers[i]!.length);

  const hoa = ctx.createBuffer(nCh - 4, length, buffers[1]!.sampleRate);
  let dest = 0;
  for (let i = 1; i < buffers.length; i++) {
    const b = buffers[i]!;
    for (let j = 0; j < b.numberOfChannels; j++) {
      hoa.getChannelData(dest++).set(b.getChannelData(j));
    }
  }
  return { order, foa, hoa };
}

export interface BinauralStereo {
  left: Float32Array;
  right: Float32Array;
  sampleRate: number;
  peak: number;
}

/**
 * Offline (non-realtime) binaural decode of an ambisonic window to a plain
 * stereo pair.
 *
 * Head tracking is not in play, so the decode is time invariant and can be
 * pre-computed once. That keeps playback on a normal two channel buffer:
 * browsers disagree badly about live 16/25 channel splitter graphs, and Safari
 * refuses them outright. Each SH channel runs as its own mono source, so no
 * multi-channel node is ever created.
 */
export async function renderBinauralStereo(
  channels: Float32Array[],
  frameCount: number,
  sampleRate: number,
  order: number,
): Promise<BinauralStereo> {
  if (frameCount <= 0) throw new Error("Nothing to decode");
  const ctx = new OfflineAudioContext(2, frameCount, sampleRate);
  const filters = await loadHoastFilters(ctx, order);

  const nCh = Math.min((order + 1) * (order + 1), channels.length);
  const merger = ctx.createChannelMerger(2);
  const mid = ctx.createGain();
  const side = ctx.createGain();
  const invert = ctx.createGain();
  invert.gain.value = -1;
  mid.connect(merger, 0, 0);
  mid.connect(merger, 0, 1);
  side.connect(merger, 0, 0);
  side.connect(invert);
  invert.connect(merger, 0, 1);
  merger.connect(ctx.destination);

  for (let i = 0; i < nCh; i++) {
    const raw = i < 4 ? filters.foa.getChannelData(i) : filters.hoa?.getChannelData(i - 4);
    if (!raw) continue;
    const rate = i < 4 ? filters.foa.sampleRate : filters.hoa!.sampleRate;
    const ir = rate === sampleRate ? raw : resampleLinear(raw, rate, sampleRate);
    const irBuf = ctx.createBuffer(1, ir.length, sampleRate);
    irBuf.getChannelData(0).set(ir);

    const conv = ctx.createConvolver();
    conv.normalize = false;
    conv.buffer = irBuf;

    const inBuf = ctx.createBuffer(1, frameCount, sampleRate);
    inBuf.getChannelData(0).set(channels[i]!.subarray(0, frameCount));
    const src = ctx.createBufferSource();
    src.buffer = inBuf;
    src.connect(conv);

    // m >= 0 harmonics are left/right symmetric, m < 0 antisymmetric.
    const n = Math.floor(Math.sqrt(i));
    const m = i - n * n - n;
    conv.connect(m >= 0 ? mid : side);
    src.start(0);
  }

  const out = await ctx.startRendering();
  const left = new Float32Array(out.getChannelData(0));
  const right = new Float32Array(out.getChannelData(1));
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i]!);
    const b = Math.abs(right[i]!);
    if (a > peak) peak = a;
    if (b > peak) peak = b;
  }
  return { left, right, sampleRate, peak };
}

/**
 * SH-domain binaural decoder. Feed it an nCh-channel ambisonic signal on `input`
 * and take stereo off `output`.
 */
export class HoastBinauralDecoder {
  readonly order: number;
  readonly nCh: number;
  readonly input: ChannelSplitterNode;
  readonly output: ChannelMergerNode;

  private ctx: BaseAudioContext;
  private convolvers: ConvolverNode[] = [];
  private gainMid: GainNode;
  private gainSide: GainNode;
  private invertSide: GainNode;

  constructor(ctx: BaseAudioContext, order: number) {
    this.ctx = ctx;
    this.order = order;
    this.nCh = (order + 1) * (order + 1);

    this.input = ctx.createChannelSplitter(this.nCh);
    // Safari otherwise down-mixes a 16/25-channel feed before it reaches the
    // splitter; force the full channel count through untouched.
    this.input.channelCount = this.nCh;
    this.input.channelCountMode = "explicit";
    this.input.channelInterpretation = "discrete";
    this.output = ctx.createChannelMerger(2);

    this.gainMid = ctx.createGain();
    this.gainSide = ctx.createGain();
    this.invertSide = ctx.createGain();
    this.invertSide.gain.value = -1;

    for (let i = 0; i < this.nCh; i++) {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      this.convolvers.push(conv);
      this.input.connect(conv, i, 0);
      // Mid/side symmetry: m >= 0 harmonics are left/right symmetric,
      // m < 0 harmonics are antisymmetric and get inverted for the right ear.
      const n = Math.floor(Math.sqrt(i));
      const m = i - n * n - n;
      conv.connect(m >= 0 ? this.gainMid : this.gainSide);
    }

    this.gainMid.connect(this.output, 0, 0);
    this.gainSide.connect(this.output, 0, 0);
    this.gainMid.connect(this.output, 0, 1);
    this.gainSide.connect(this.invertSide, 0, 0);
    this.invertSide.connect(this.output, 0, 1);

    this.loadCardioidFallback();
  }

  /** Install the real HOAST decoding filters. */
  setFilters(filters: HoastFilters) {
    const target = this.ctx.sampleRate;
    const assign = (i: number, data: Float32Array, rate: number) => {
      // Safari follows the spec strictly: a ConvolverNode buffer whose sample
      // rate differs from the context throws NotSupportedError. The published
      // HOAST filters are 44.1 kHz, so resample them onto the context rate.
      const src = rate === target ? data : resampleLinear(data, rate, target);
      const buf = this.ctx.createBuffer(1, src.length, target);
      buf.getChannelData(0).set(src);
      this.convolvers[i]!.buffer = buf;
    };
    for (let i = 0; i < 4 && i < this.nCh; i++) {
      assign(i, filters.foa.getChannelData(i), filters.foa.sampleRate);
    }
    if (filters.hoa) {
      for (let i = 4; i < this.nCh; i++) {
        assign(i, filters.hoa.getChannelData(i - 4), filters.hoa.sampleRate);
      }
    }
  }

  /** Plain cardioid virtual mics, used until the HRIR set has loaded. */
  private loadCardioidFallback() {
    for (let i = 0; i < this.nCh; i++) {
      // Safari misbehaves on impulse buffers shorter than 64 samples.
      const buf = this.ctx.createBuffer(1, 64, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      d[0] = i === 0 ? 0.5 : i === 1 ? 0.5 / Math.sqrt(3) : 0;
      this.convolvers[i]!.buffer = buf;
    }
  }

  disconnect() {
    this.input.disconnect();
    for (const c of this.convolvers) c.disconnect();
    this.gainMid.disconnect();
    this.gainSide.disconnect();
    this.invertSide.disconnect();
    this.output.disconnect();
  }
}
