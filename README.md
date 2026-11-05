# AURA — ADM Universal Renderer into Ambisonics

> **Goal:** Immersive audio engineers get their Atmos and ADM mixes as faithful Ambisonics masters.

Original build prompt: ADM-to-Ambisonics Renderer (Web App)

Goal:
Render Dolby Atmos ADM content directly into Ambisonics with object-level spatial precision. No intermediate loudspeaker-gain stage: every source (fixed 7.1.2 bed or time-varying object) gets Ambisonics coefficients computed directly from its position into Higher-Order Ambisonics (order 3/5/7 selectable: 16/36/64 channel output) using ACN channel ordering and SN3D normalization. Avoid the phantom-source blur and comb filtering caused by routing through virtual loudspeakers.

Implementation specifications:
- Pure client-side web app (no server/DB for audio processing).
- Input: BWF / RF64 Dolby Atmos ADM master files.
- Binary parsing: Parse RIFF/RF64 containers with ds64 chunk support for multi-gigabyte masters. Parse chna chunk for track UID allocations. Parse axml chunk (ITU-R BS.2076) using DOMParser to identify DirectSpeakers (7.1.2 bed) vs Objects. Ignore proprietary dbmd chunk. Do NOT use decodeAudioData() (it cannot handle >32 channels or RF64); unpack 24-bit PCM directly from raw ArrayBuffers.
- Bed handling: Capped at 7.1.2 (L, R, C, LFE, Lss, Rss, Lrs, Rrs, Ltm, Rtm). Precompute static spherical harmonic coefficients. LFE is low-pass filtered (~120 Hz) and injected into 0th order (channel 0, W) with -3 dB gain or optional bypass.
- Object handling: Continuous azimuth/elevation/distance or Cartesian coordinates from audioBlockFormat with linear/spherical trajectory interpolation between keyframes. Sub-block coefficient ramping (e.g. 64-sample intervals) to guarantee click-free rendering without evaluating transcendental functions per sample.
- Spherical Harmonics Math (ACN / SN3D):
  - ACN indexing: k = n*(n + 1) + m, where n = floor(sqrt(k)) and m = k - n*(n + 1).
  - SN3D normalization: S_n^m = sqrt((2 - delta_{m,0}) * (n - |m|)! / (n + |m|)!), where S_n^0 = 1 and S_n^m = sqrt(2*(n-|m|)!/(n+|m|)!) for m != 0.
  - CRITICAL: Omit the quantum-mechanical Condon-Shortley phase (-1)^m (per AmbiX, RFC 8486, and BS.2076).
  - First-order verification: ACN 0 (W=1.0), ACN 1 (Y=sin(phi)*cos(delta)), ACN 2 (Z=sin(delta)), ACN 3 (X=cos(phi)*cos(delta)).
- Architecture: Pure TypeScript audio processing engine running in dedicated Web Workers.
- Memory & Streaming: Stream multi-gigabyte audio using File.slice() in ~2048-sample blocks. Stream output AmbiX RF64 directly to disk via the File System Access API (FileSystemWritableFileStream) with fallback to chunked download, maintaining RAM < 150 MB.
- Export format: Standard AmbiX WAV/RF64 with WAVE_FORMAT_EXTENSIBLE, ACN channel sequence, and SN3D normalization.
- UI: File dropzone with container analysis, interactive 3D spatial trajectory viewer showing bed anchors and animated object paths, order selector (3rd / 5th / 7th), channel level meters, and streaming render progress bar.

Reference the attached architecture and build plan document for full mathematical definitions and pipeline details.

## License

Released under the [MIT License](./LICENSE) — © Sascha Armin Etezazi, KreativInstitut.OWL. Third-party trademarks (e.g. Dolby) belong to their owners; used here only for nominative-fair-use compatibility descriptions.


This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/6a1b91db-51d4-4071-beac-f4ccb149d933).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## Deploy with Coolify (Railpack)

This is a TanStack Start app with a Nitro server, not a static Vite SPA.
The production output is `.output`, not `dist`.

- Select the **Railpack** build pack and leave the application in server mode
  (not static-site mode).
- `railpack.json` selects `bun run build:coolify`, which builds Nitro with the
  `node-server` preset. Leave any custom build-command override empty, or set it
  to `bun run build:coolify`.
- The `start` script runs `node .output/server/index.mjs` and tells Railpack to
  deploy a server instead of serving `dist` with Caddy. Leave any custom
  start-command override empty, or set it to `bun run start`.
- Set the exposed application port to **3000** and the runtime variables
  `PORT=3000` and `HOST=0.0.0.0`. If health checks are enabled, use `/`.
- Remove any `RAILPACK_SPA_OUTPUT_DIR` override, which forces static-site
  detection even when a start script exists.

To verify the production server locally:

```sh
bun install --frozen-lockfile
bun run build:coolify
PORT=3000 HOST=0.0.0.0 bun run start
```

The regular `build` script is unchanged, preserving Lovable's default build target.
