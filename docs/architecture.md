# WriteSpacer Architecture

## V1 flow

1. The browser uploads a single image to `POST /api/jobs`.
2. The server stores the upload under a per-job workspace in `.worksheet-data/`.
3. The client polls `GET /api/jobs/:jobId`.
4. The first status request triggers on-demand processing:
   - normalize the image
   - detect content bounds
   - convert line bands into prompt regions
   - attach nearby orphan diagrams
   - crop each region
   - place each crop into a worksheet layout
   - generate a PDF
5. The finished worksheet is returned from `GET /api/jobs/:jobId/pdf`.

## Detection approach

- Image normalization uses `sharp` rotation, bounded resizing, and contrast normalization.
- Prompt segmentation is CV-first rather than OCR-first.
- Dense rows of ink are grouped into line bands.
- Nearby line bands are merged into problem regions.
- Larger connected components that do not overlap a prompt are treated as possible diagrams and attached to the nearest region.
- Confidence is heuristic and intentionally conservative.

## Extensibility

- The `JobRecord`, `ProblemRegion`, and `WorksheetItem` types are stable enough to support manual review later.
- Storage is isolated behind job paths so local disk can be replaced with blob storage.
- The polling API and on-demand processing can be swapped for a durable worker queue without changing the browser contract.
