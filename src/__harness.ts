import { parseContainer } from "@/engine/container";
import { analyseAdm } from "@/engine/adm";
import { previewOrderFor, PREVIEW_MAX_SECONDS, type PreviewResponse } from "@/engine/preview-types";
import { loadHoastFilters, HoastBinauralDecoder } from "@/lib/hoast";

declare global { interface Window { __run: () => Promise<any> } }

window.__run = async () => {
  const out: any = {};
  const blob = await (await fetch("/__test_adm.wav")).blob();
  const file = new File([blob], "test_adm.wav", { type: "audio/wav" });
  const c = await parseContainer(file);
  const a = analyseAdm(c, "dolby");
  out.sources = a.sources.length;
  out.beds = a.sources.filter((s) => s.kind === "bed").map((s) => `${s.name} ${s.azimuth.toFixed(1)}/${s.elevation.toFixed(1)}`);
  out.objects = a.sources.filter((s) => s.kind === "object").map((s) => s.name);
  out.warnings = a.warnings;

  const order = previewOrderFor(5);
  out.previewOrder = order;
  const worker = new Worker(new URL("@/engine/preview.worker.ts", import.meta.url), { type: "module" });
  const done = await new Promise<any>((res, rej) => {
    worker.onmessage = (e: MessageEvent<PreviewResponse>) => {
      if (e.data.type === "done") res(e.data);
      if (e.data.type === "error") rej(new Error(e.data.message));
    };
    worker.onerror = (e) => rej(new Error(e.message));
    worker.postMessage({
      type: "preview", file, sources: a.sources,
      container: {
        dataOffset: c.dataOffset, frameCount: c.frameCount,
        blockAlign: c.format.blockAlign, bitsPerSample: c.format.bitsPerSample,
        channels: c.format.channels, sampleRate: c.format.sampleRate,
      },
      order, lfeMode: "inject", masterGain: 1, startSample: 0,
      maxFrames: PREVIEW_MAX_SECONDS * c.format.sampleRate,
    });
  });
  out.previewChannels = done.channels.length;
  out.previewFrames = done.frameCount;
  out.peakW = Math.max(...Array.from(done.channels[0] as Float32Array).map(Math.abs));
  out.nonSilentChannels = done.channels.filter((ch: Float32Array) => ch.some((v) => Math.abs(v) > 1e-6)).length;

  // HOAST offline decode check
  const ctx = new OfflineAudioContext(2, done.sampleRate * 1, done.sampleRate);
  const filters = await loadHoastFilters(ctx, order);
  out.filterChannels = filters.length;
  const dec = new HoastBinauralDecoder(ctx, order);
  dec.updateFilters(filters);
  const buf = ctx.createBuffer(done.channels.length, done.frameCount, done.sampleRate);
  for (let i = 0; i < done.channels.length; i++) buf.getChannelData(i).set(done.channels[i]);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.connect(dec.input);
  dec.output.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  const L = rendered.getChannelData(0), R = rendered.getChannelData(1);
  out.binauralPeakL = Math.max(...Array.from(L).map(Math.abs));
  out.binauralPeakR = Math.max(...Array.from(R).map(Math.abs));
  return out;
};
