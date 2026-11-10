// DRAFT ONLY — Safari storage self-test. Writes ~2.5 GB of dummy bytes through
// the same OPFS path the render worker uses (RAM fallback if unavailable).
const TOTAL = 2.5e9;
const CHUNK = 8 * 1024 * 1024;
const post = (step: string) => (self as unknown as Worker).postMessage({ type: "diag", step });

self.onmessage = async () => {
  const t0 = performance.now();
  try {
    const est = await navigator.storage?.estimate?.().catch(() => null);
    post(`test: storage api ${navigator.storage ? "present" : "MISSING in worker"}, quota ${est?.quota ? (est.quota / 1e9).toFixed(1) + " GB" : "?"}, used ${est?.usage ? (est.usage / 1e9).toFixed(2) + " GB" : "?"}`);
    const buf = new Uint8Array(CHUNK);
    for (let i = 0; i < CHUNK; i++) buf[i] = i & 255;
    let file: Blob;
    let access: any = null;
    let fh: any = null;
    try {
      const root = await navigator.storage.getDirectory();
      fh = await root.getFileHandle("aura-selftest.bin", { create: true });
      access = await fh.createSyncAccessHandle();
      access.truncate(0);
      post("test: OPFS sync handle OK");
    } catch (e) {
      post(`test: OPFS FAILED (${(e as Error)?.message ?? e}) -> RAM`);
    }
    const parts: Uint8Array[] = [];
    let written = 0;
    let nextLog = 0.5e9;
    while (written < TOTAL) {
      if (access) access.write(buf, { at: written });
      else parts.push(buf.slice());
      written += CHUNK;
      if (written >= nextLog) { post(`test: wrote ${(written / 1e9).toFixed(1)} GB`); nextLog += 0.5e9; }
    }
    const sec = (performance.now() - t0) / 1000;
    post(`test: write done ${(written / 1e9).toFixed(2)} GB in ${sec.toFixed(1)} s (${(written / 1e6 / sec).toFixed(0)} MB/s)`);
    if (access) {
      access.flush(); access.close();
      post("test: handle closed, calling getFile()");
      file = await fh.getFile();
    } else {
      post("test: building RAM blob");
      file = new Blob(parts as BlobPart[]);
    }
    post(`test: file ready ${(file.size / 1e9).toFixed(2)} GB, posting to page`);
    (self as unknown as Worker).postMessage({ type: "done", file, opfs: !!access });
  } catch (e) {
    (self as unknown as Worker).postMessage({ type: "error", message: String((e as Error)?.message ?? e) });
  }
};
