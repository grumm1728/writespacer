# WriteSpacer

WriteSpacer turns a dense image of math exercises into a printable worksheet with room for students to show their work. It is designed for teachers who need to preserve the original problem formatting while balancing handwriting space against the number of printed pages.

All worksheet analysis and PDF generation currently happen in the browser.

## Workflow

1. Upload a PNG, JPEG, or WebP worksheet image, or load the built-in sample.
2. Analyze the image with the CV-first problem detector.
3. Review the detected regions and correct them when needed.
4. Adjust worksheet density and prompt size while watching the live page preview.
5. Generate and download a US Letter PDF.

## Current Features

- Detects individual numbered exercises without using an LLM.
- Preserves equations, diagrams, and problem numbers as source-image crops rather than re-typesetting math.
- Infers visible exercise labels and lets the teacher edit them.
- Formats repeated labels as `2`, `2.1`, `2.2`, and so on.
- Separates instruction headers from individual problem crops and renders them once above the related group.
- Provides include/exclude, move, resize, merge, and draw-missing-region review tools.
- Offers `compact`, `balanced`, and `spacious` worksheet density.
- Offers `Small`, `Med`, and `Large` prompt sizing, with `Small` as the default.
- Shows a live PDF-like preview and page count before generation.
- Leaves clean, unruled handwriting space in the generated PDF.

## Built-In Sample

The committed textbook-style benchmark is [public/fixtures/pershan-problem-set-example.png](public/fixtures/pershan-problem-set-example.png). Use the `Use sample page` button to load it in the app.

The current regression target for this fixture is 35 detected exercises labeled `3` through `37`, with instruction rows kept outside the individual problem crops. The simpler [sample-input.png](sample-input.png) fixture should continue to produce four exercises.

## Local Development

From the repository directory on Windows:

```powershell
npm.cmd install
npm.cmd run dev
```

Open [http://localhost:3000](http://localhost:3000). If port 3000 is occupied:

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

## Verification

```powershell
npm.cmd run lint
npm.cmd run test:detector
npm.cmd run build
```

`test:detector` runs both detector fixture tests and shared layout-placement tests.

## Architecture

- `src/lib/detection.ts`: pure grayscale/image-data detection, source labels, section headers, and debug output.
- `src/lib/client-processing.ts`: image loading, crop composition, layout measurement, preview placements, and PDF generation.
- `src/components/worksheet-app.tsx`: upload, review, editing, preview, and download UI.
- `src/lib/types.ts`: shared analysis, review, layout, and result contracts.

The public processing flow is split into three main functions:

- `analyzeWorksheetFile(file)` returns reviewable problem drafts and detector debug data.
- `previewWorksheetLayout(reviewedProblems, layoutOptions)` returns measured page placements for the live preview.
- `generateWorksheetPdf(file, reviewedProblems, layoutOptions)` renders the reviewed layout as a PDF.

The preview and PDF use the same layout measurement path so page counts and placements stay aligned.

## Current Limitations

- Input is image-only; PDF and document rasterization are not implemented yet.
- The app processes one source page at a time.
- Exercise-number recognition is lightweight and intended for printed anchors, not general OCR.
- CV heuristics can miss, merge, or mislabel regions, so teacher review remains part of the workflow.
- There is no production LLM, server upload, or remote processing path.

See [docs/llm-detection-spike.md](docs/llm-detection-spike.md) for research notes on what a future multimodal detector might improve and the associated privacy, cost, and reliability tradeoffs.

## Privacy

Uploaded worksheet images remain in the browser. The project does not currently send worksheet content to a server or third-party model.

## Deployment

The project is configured as a static Next.js export for GitHub Pages. GitHub Actions publishes the generated `out/` directory using the repository base path in production.

## Tech Stack

- Next.js App Router with TypeScript
- React
- Browser canvas APIs
- `pdf-lib`
- Vitest with `pngjs`
- ESLint with `eslint-config-next`
