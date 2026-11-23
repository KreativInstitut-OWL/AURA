<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Project rules

- `/` renders the AURA workstation (`src/routes/index.tsx`); the classic UI was removed. UI strings use `useLang().t(en, de)` from `src/lib/i18n.ts`, German default — no i18n library needed for two languages.
- The AURA UI is themed by the `.v2-theme` scope in `src/styles.css`, light by default with a `.dark` class on `<html>`.
- Binaural audition is disabled in the UI but its engine stays in the repo (`src/lib/hoast.ts`, `src/components/adm/BinauralDeck.tsx`, `src/engine/preview.worker.ts`, `src/engine/decode.worker.ts`) for a future version — do not delete.
- The render worker never buffers output in memory when a `FileSystemFileHandle` is available; without one (Safari) it streams into a temporary private-storage (OPFS) file and returns that disk-backed file for the automatic download, falling back to an in-memory blob only if OPFS is unavailable — this keeps multi-gigabyte renders from crashing the tab.
- Finished files over 1 GiB are not auto-downloaded; the result card shows a download button instead, because Safari crashes the tab on a late scripted click for multi-GB blobs.
- Clipping decisions use a worker message gate before quantisation: cancellation aborts the writable transaction, and explicit continuation acknowledges hard clipping for the remainder of that render; no limiter is introduced.
- Gain recommendations use the shared clipping helper so paused and completed renders apply the same safety margin and rounding.
- The peak pre-scan always encodes at 7th order and reports one peak per order tier (ACN 0–15, 16–35, 36–63), so switching order never needs a rescan; the render inner loops decode each channel once per block and accumulate per ACN channel for speed.
- The background level scan also records a 120 Hz low-passed envelope per channel; the peak estimate places LFE windows on that one, because speech or bleed on an LFE track is removed by the LFE filter and would otherwise hide the real sub peak.
- Multi-programme ADM files: the app filters `analysis.sources` through the selected programme's muted-track set (`mutedTracks` in src/engine/adm.ts) before render, viewer, meters and peak scan; with <=1 programme the set is empty so behaviour is unchanged — one filter point keeps every consumer consistent.
- Object timing: an object's audioObject start/duration bounds when it is audible (block rtimes are relative to that start); outside the window its gain is 0 in render, preview and viewer — ITU-R BS.2076 time-multiplexes many objects on one track.
- Bump `version` in package.json with every user-facing release (and add a CHANGELOG entry) — keeps package metadata honest for the public repo.
- The crash flight recorder (localStorage) is cleared only by a finished/failed render, an explicit Dismiss, or loading a new file — so a real tab kill stays visible until the user acts.
- Output URLs have one owner and delayed retirement; a handoff grace period avoids revocation during asynchronous browser download acquisition.
- Dormant preview requests explicitly carry isFloat and both audition workers use the shared PCM decoder; bit depth alone cannot identify IEEE float.
- Programme muting receives the full input channel count; exclusivity must also exclude tracks outside every programme.
- Peak scan progress reports completed candidate-window frames; render progress remains absolute file frames.
- Optional browser persistence uses guarded access; unavailable storage must not interrupt the workstation.
- LFE level options and the shared default live in `src/engine/types.ts`; the workstation uses that default on initialization and active-route changes to prevent divergent defaults.
