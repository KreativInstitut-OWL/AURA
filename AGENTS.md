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
- HOAST HRIR filters are resampled to the AudioContext rate before being assigned to a ConvolverNode — Safari throws NotSupportedError on a rate mismatch.
- Rendered AmbiX files are auditioned by re-decoding the output blob in `src/engine/decode.worker.ts` windows (leading 16/25 ACN channels only) — keeps full-length monitoring within a fixed memory budget.
