# WriteSpacer

WriteSpacer is a static Next.js webapp that turns a dense page of math problems into a printable worksheet PDF with room for students to write beside or below each prompt.

## What v1 does

- Accepts a single worksheet image upload
- Detects likely problem regions with a CV-first heuristic pipeline
- Preserves prompts as image crops instead of re-typesetting math
- Lays out adaptive answer space on US Letter PDF pages
- Returns a downloadable PDF directly in the browser

## Tech stack

- Next.js App Router with TypeScript
- Browser canvas APIs for image normalization, segmentation, and crop extraction
- `pdf-lib` for in-browser PDF generation

## Deployment

This project is configured for GitHub Pages. The production build uses `next export` semantics through `output: "export"` and publishes the static `out/` directory with GitHub Actions.

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

- V1 is optimized for one uploaded page at a time.
- There is no manual review UI yet.
- All processing happens locally in the browser so uploads are not sent to a server.
