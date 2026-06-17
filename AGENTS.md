# Repository Instructions

## Project Purpose

WriteSpacer is a static Next.js app that turns a dense image of math problems into a printable worksheet PDF with room for students to show work. The core teacher workflow is: add a photographed or scanned problem page, review detected problem boxes, adjust spacing, preview the handout, and download the PDF.

## Tech Stack

- Next.js App Router with TypeScript.
- React for the browser UI.
- Browser canvas APIs for image normalization, segmentation, and crop extraction.
- `pdf-lib` for in-browser PDF generation.
- Vitest for detector and layout tests.
- ESLint with `eslint-config-next`.

## Key Commands

Run commands from this directory:

```powershell
C:\Users\scott\Cloned from GitHub\writespacer
```

Use PowerShell-friendly command names:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd run test:detector
npm.cmd run build
```

The local dev server is usually available at `http://localhost:3000` or `http://127.0.0.1:3000`. If that port is in use, start Next on another port with:

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

## Product Constraints

- Keep the app focused on helping teachers create useful student handouts quickly.
- Prioritize screen real estate for reviewing the input image and previewing the output PDF.
- Do not expose internal confidence scores or detector implementation details as primary user-facing information.
- Preserve prompts as image crops rather than trying to re-typeset math.
- Keep controls understandable for a non-technical teacher: source, review, spacing, preview, download.
- Maintain responsive layouts for desktop and mobile; avoid horizontal overflow.

## Architecture Invariants

- Keep analysis and generation separate: `analyzeWorksheetFile()` returns reviewable drafts and debug data without generating a PDF.
- Keep `previewWorksheetLayout()` and `generateWorksheetPdf()` driven by the same layout measurements so the live preview remains representative of the downloaded PDF.
- Preserve prompts as image crops. Do not re-typeset equations or invent problem text.
- Keep each problem number and its first equation segment on the same visual line when composing prompt crops.
- Treat instruction rows as section headers: exclude them from individual problem crops and render each header once above its related problem group.
- Preserve detected source labels as editable teacher-facing data. Format repeated labels as `2`, `2.1`, `2.2`, and so on.
- Keep output controls available before download: density and prompt size must update the live preview and page-count estimate.
- Reserve answer space as clean whitespace in generated PDFs. Do not add visible answer boxes or ruled lines without an explicit product decision.
- Keep the detector CV-first and browser-compatible unless the product direction explicitly changes.

## Module Boundaries

- `src/lib/detection.ts`: pure image-data detection, source-label inference, section-header detection, and debug snapshots.
- `src/lib/client-processing.ts`: browser image loading, crop composition, shared layout measurement, preview placements, and PDF generation.
- `src/components/worksheet-app.tsx`: analyze, review, correction, output controls, live preview, and download workflow.
- `src/lib/types.ts`: contracts shared by detection, review, layout, preview, and PDF generation.
- `src/lib/detection.test.ts` and `src/lib/layout.test.ts`: fixture benchmarks and layout invariants.

## Privacy Notes

- All worksheet processing should remain in the browser.
- Do not add server upload paths, analytics on worksheet content, or remote processing without an explicit product decision.
- Treat uploaded worksheet images as potentially private classroom material.

## Verification

For UI or workflow changes, run:

```powershell
npm.cmd run lint
npm.cmd run build
```

For detection, layout, or PDF-placement changes, also run:

```powershell
npm.cmd run test:detector
```

The committed regression expectations are:

- `public/fixtures/pershan-problem-set-example.png`: 35 included problems with labels `3` through `37`, with instruction headers kept outside problem crops.
- `sample-input.png`: 4 included problems.
- Blank input: a reviewable debug state rather than an unhandled crash.

When changing the frontend, verify the flow manually in the browser with the built-in sample page: load the sample, analyze it, inspect the review boxes, adjust output settings, and confirm the PDF preview updates without layout overflow.
