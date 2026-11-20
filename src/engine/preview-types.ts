import type { LfeGain, RenderSource } from "./types";

/** Ambisonic order used for the in-browser binaural audition. */
export type PreviewOrder = 3 | 4;

/**
 * The HOAST (IEM Graz) SH-HRIR filter set ships decoding filters up to 4th
 * order, so the headphone audition decodes at 3rd order for a 3rd-order render
 * and at 4th order for 5th/7th-order renders. The exported file always keeps
 * its full channel count.
 */
export const previewOrderFor = (renderOrder: number): PreviewOrder =>
  renderOrder <= 3 ? 3 : 4;

/** Hard cap on how much audio is held in memory for the audition. */
export const PREVIEW_MAX_SECONDS = 60;

export type PreviewRequest = {
  type: "preview";
  file: File;
  sources: RenderSource[];
  container: {
    dataOffset: number;
    frameCount: number;
    blockAlign: number;
    bitsPerSample: number;
    isFloat: boolean;
    channels: number;
    sampleRate: number;
  };
  order: PreviewOrder;
  lfeMode: LfeGain | "exclude";
  masterGain: number;
  startSample: number;
  maxFrames: number;
};

export type PreviewResponse =
  | { type: "progress"; framesDone: number; totalFrames: number }
  | {
      type: "done";
      channels: Float32Array[];
      sampleRate: number;
      frameCount: number;
      order: PreviewOrder;
      truncated: boolean;
    }
  | { type: "error"; message: string };
