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

export type LfeMode = "inject" | "exclude";

export interface RenderConfig {
  order: 3 | 5 | 7;
  lfeMode: LfeMode;
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
    channels: number;
    sampleRate: number;
  };
  config: RenderConfig;
  handle: FileSystemFileHandle | null;
};

export type WorkerResponse =
  | {
      type: "progress";
      framesDone: number;
      totalFrames: number;
      peaks: Float32Array;
      bytesWritten: number;
      elapsedMs: number;
    }
  | { type: "done"; blob: Blob | null; bytesWritten: number; elapsedMs: number }
  | { type: "error"; message: string };
