# WriteSpacer Architecture

## V1 flow

1. The browser loads a single worksheet image.
2. Canvas processing normalizes the image and computes a grayscale mask.
3. The app detects content bounds, line bands, and problem regions.
4. Nearby auxiliary regions such as diagrams are attached to the closest prompt.
5. Each region is cropped in-browser and placed into a worksheet layout.
6. `pdf-lib` generates the final PDF in memory and exposes it as a download blob URL.

## Detection approach

- Prompt segmentation is CV-first rather than OCR-first.
- Dense rows of ink are grouped into line bands.
- Nearby line bands are merged into problem regions.
- Larger connected components that do not overlap a prompt are treated as possible diagrams and attached to the nearest region.
- Confidence is heuristic and intentionally conservative.

## Extensibility

- The `ProblemRegion` and `WorksheetItem` types are stable enough to support manual review later.
- If the app later moves off GitHub Pages, the current browser pipeline can be wrapped in server endpoints without rethinking the worksheet model.
