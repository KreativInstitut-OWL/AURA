export interface ChunkRef {
  id: string;
  offset: number; // byte offset of the chunk body
  size: number;
}

export interface WavFormat {
  formatTag: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

export interface ContainerInfo {
  isRF64: boolean;
  format: WavFormat;
  dataOffset: number;
  dataSize: number;
  frameCount: number;
  durationSec: number;
  chunks: ChunkRef[];
  chna: ChnaEntry[];
  axml: string | null;
  hasDbmd: boolean;
}

export interface ChnaEntry {
  trackIndex: number; // 1-based
  uid: string;
  trackRef: string;
  packRef: string;
}

export interface TrajectoryPoint {
  /** sample offset from file start */
  start: number;
  end: number;
  azimuth: number; // radians, + = left
  elevation: number; // radians, + = up
  distance: number;
  gain: number;
  jump: boolean;
}

export type SourceKind = "bed" | "object";

export interface RenderSource {
  channelIndex: number; // 0-based track index in the WAV
  kind: SourceKind;
  name: string;
  uid: string;
  isLFE: boolean;
  /** static direction for beds */
  azimuth: number;
  elevation: number;
  gain: number;
  /** keyframes for objects */
  points: TrajectoryPoint[];
}

export interface ResolutionStep {
  label: string;
  value: string | null;
  ok: boolean;
}

export type TrackStatus = "bed" | "object" | "unresolved";

export interface TrackDiagnostic {
  trackIndex: number; // 1-based
  uid: string;
  status: TrackStatus;
  /** true when the position came from a layout-order fallback, not an explicit definition */
  guessed: boolean;
  name: string;
  detail: string;
  steps: ResolutionStep[];
}

export interface AnalysisResult {
  container: ContainerInfo;
  sources: RenderSource[];
  warnings: string[];
  programmeName: string | null;
  diagnostics: TrackDiagnostic[];
}

/**
 * How the low-passed LFE is placed in the ambisonic field.
 * "omni"     – ACN 0 (W) only, equal pressure in every direction
 * "down"     – first-order downward cardioid (W + Z), null at the ceiling
 * "position" – encoded at the LFE loudspeaker coordinates of the active profile
 * "off"      – LFE excluded entirely
 */
export type LfeRouting = "omni" | "down" | "position" | "off";

/** Level of the low-passed LFE, independent of the routing choice. */
export type LfeGain = "minus3" | "unity" | "plus10";

export const LFE_GAIN_VALUE: Record<LfeGain, number> = {
  minus3: Math.SQRT1_2, // -3 dB acoustic power match
  unity: 1, // 0 dB
  plus10: Math.pow(10, 10 / 20), // +10 dB Dolby subwoofer calibration
};

/**
 * Which reference geometry the 7.1.2 bed speakers are placed at.
 * "dolby" = Dolby Atmos studio reference, "itu" = ITU-R BS.2051/BS.2094.
 */
export type BedProfile = "dolby" | "itu";

export interface RenderConfig {
  order: 3 | 5 | 7;
  lfeRouting: LfeRouting;
  lfeGain: LfeGain;
  masterGain: number;
}


export type WorkerRequest = {
  type: "render";
  file: File;
  sources: RenderSource[];
  container: {
    dataOffset: number;
    frameCount: number;
    blockAlign: number;
    bitsPerSample: number;
    /** true when the samples are IEEE float instead of integer PCM */
    isFloat: boolean;

    channels: number;
    sampleRate: number;
  };
  config: RenderConfig;
  handle: FileSystemFileHandle | null;
};

export type WorkerResponse =
  | {
      type: "clipping";
      framesDone: number;
      totalFrames: number;
      bytesWritten: number;
      elapsedMs: number;
      maxPeak: number;
      maxPeakChannel: number;
    }
  | { type: "cancelled" }
  | {
      type: "progress";
      framesDone: number;
      totalFrames: number;
      peaks: Float32Array;
      bytesWritten: number;
      elapsedMs: number;
      /** running maximum absolute sample across all ACN channels (pre-quantisation) */
      maxPeak: number;
      /** ACN index that produced maxPeak */
      maxPeakChannel: number;
      /** live absolute peak of every *input* channel in the block just processed */
      sourcePeaks: Float32Array;
    }
  | {
      type: "done";
      blob: Blob | null;
      bytesWritten: number;
      elapsedMs: number;
      maxPeak: number;
      maxPeakChannel: number;
      /** complete input-channel peak envelope, [channel * bins + bin] */
      envelope: Float32Array | null;
      envelopeBins: number;
      binSamples: number;
    }
  | { type: "error"; message: string };

export type RenderWorkerMessage = WorkerRequest | { type: "continue" | "cancel" };

/** Time resolution of the level envelope shown in the spatial viewer. */
export const ENVELOPE_BIN_SEC = 0.05;

export interface EnvelopeRequest {
  type: "scan";
  file: File;
  container: {
    dataOffset: number;
    frameCount: number;
    blockAlign: number;
    bitsPerSample: number;
    isFloat: boolean;
    channels: number;
    sampleRate: number;
  };
  /** samples per envelope bin, derived from the file's own sample rate */
  binSamples: number;
}

export type EnvelopeResponse =
  | {
      type: "bins";
      startBin: number;
      count: number;
      channels: number;
      /** interleaved [bin * channels + channel] */
      data: Float32Array;
    }
  | { type: "done"; totalBins: number }
  | { type: "error"; message: string };

/** Level data the spatial viewer reads every animation frame. */
export interface LevelState {
  channels: number;
  binSamples: number;
  bins: number;
  /** [channel * bins + bin], filled progressively */
  envelope: Float32Array | null;
  /** live per-input-channel peaks while a render is running */
  live: Float32Array | null;
}

