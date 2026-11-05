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
- The render worker never buffers output in memory when a `FileSystemFileHandle` is available; without one it returns a blob that the page downloads automatically — this keeps multi-gigabyte renders from crashing the tab.
- Clipping decisions use a worker message gate before quantisation: cancellation aborts the writable transaction, and explicit continuation acknowledges hard clipping for the remainder of that render; no limiter is introduced.
- Gain recommendations use the shared clipping helper so paused and completed renders apply the same safety margin and rounding.
- The peak pre-scan always encodes at 7th order and reports one peak per order tier (ACN 0–15, 16–35, 36–63), so switching order never needs a rescan; the render inner loops decode each channel once per block and accumulate per ACN channel for speed.
