# WriteSpacer

WriteSpacer is a Next.js webapp that turns a dense page of math problems into a printable worksheet PDF with room for students to write beside or below each prompt.

## What v1 does

- Accepts a single worksheet image upload
- Detects likely problem regions with a CV-first heuristic pipeline
- Preserves prompts as image crops instead of re-typesetting math
- Lays out adaptive answer space on US Letter PDF pages
- Returns a downloadable PDF through a typed job API

## Tech stack

- Next.js App Router with TypeScript
- `sharp` for image normalization and crop extraction
- `pdf-lib` for server-side PDF generation

## API

- `POST /api/jobs`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/pdf`

## Local development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment

Copy `.env.example` if you want to customize where temporary jobs are stored.

```bash
WORKSHEET_DATA_DIR=.worksheet-data
```

## Notes

- V1 is optimized for one uploaded page at a time.
- There is no manual review UI yet.
- The job model is designed so multi-page input, review tooling, and OCR can be added later.
