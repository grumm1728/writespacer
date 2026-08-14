# Detector fixture set and scorecard

## Decision

Use one human-reviewed manifest for detector, crop, layout, and PDF expectations. Claude drafts remain suggestions; only reviewed annotations may gate changes.

## Current inventory

The committed core contains five raster fixtures plus one synthetic two-column fixture: Pershan (35 labels, 3-37), original (4), repeated-label (24), geometry (16, including repeated 32), calculus (5), and synthetic two-column (8). Seven additional committed phone photos (`more sample photos/IMG_0926.jpg` through `IMG_0932.jpg`) cover portrait/landscape captures, rotation, page curvature, shadows/glare, dense columns, section headers, compound labels, word problems, tables, graphs, and diagrams, but have no committed reviewed annotations.

The standard 19-test suite checks proposal/finalization behavior, header exclusion, OCR-gap repair, repeated labels, fallback, seven variants of only the original fixture, blank input, and four synthetic layout invariants. Fixture tests inject expected OCR labels into nearest proposals; the OCR adapter mocks Tesseract. Layout tests do not generate or compare PDFs. The sole committed reviewed JSON oracle contains only the clean synthetic fixture. [Sources: `src/lib/detection.test.ts`, `src/lib/anchor-ocr.test.ts`, `src/lib/layout.test.ts`, `public/fixtures/llm-assisted-annotations.json`, `package.json`.]

## Required fixture families

1. Simple portrait scan/worksheet.
2. Dense single-column and dense two/three-column pages.
3. Phone photos in portrait and landscape, including mild skew, curvature, uneven light, padding, and compression.
4. Repeated and compound labels.
5. Section headers and multiple problem groups.
6. Diagrams, graphs, tables, detached/shared figures, and long prompts/subparts.
7. Sparse/cropped pages and OCR-free fallback.
8. Blank and unusable nonblank inputs.

Promote the seven existing phone photos first. Add teacher-authored/classroom-marked pages, an upright landscape capture, WebP input, shared-diagram cases, and nonblank failure fixtures. Keep at least one reviewed page per family as a holdout not used for tuning.

## Gold annotation schema

For every page record support class and family tags; page dimensions/orientation; ordered problems with source label, anchor rectangle, required prompt rectangles, optional diagram/attachment rectangles, and allowed padding; section headers with exact rectangles and the problem range they govern; and expected fallback/failure behavior. Store reviewer identity/date and uncertainty notes. Migrate test-only anchor constants into this manifest.

## Scorecard

Report per fixture and per family:

- anchor precision and recall;
- exact label accuracy and problem-count delta;
- exact reading order (plus adjacent-pair accuracy for diagnosis);
- section-header precision/recall, exclusion from problem crops, association, and render-once result;
- required-content coverage, crop contamination, composition mode, and diagram attachment accuracy;
- fallback correctness and blank/unusable-state correctness;
- preview/PDF page-count equality, placement parity, clipping/overlap, and prompt/answer-space measurements;
- affected items requiring teacher correction and analysis time.

## Merge gates

- At least 90% of supported pages require no more than two affected-item corrections, matching issue #5.
- Every supported page remains recoverable without re-upload/restart; no crash or invalid rectangle.
- Reading order, section-header render-once behavior, and preview/PDF page-count parity are exact on all gold fixtures.
- No required prompt/diagram content may be clipped; contamination and attachment misses count as affected-item corrections.
- Report aggregate and per-family results so a dense-photo regression cannot hide behind easy synthetic pages.
- Generated perturbations are deterministic and applied across families, not only one sample.

## Highest-priority gaps

1. Review and promote the seven phone-photo drafts into committed gold annotations.
2. Add full prompt/header/diagram rectangles and reading order; anchor points alone cannot score crop quality.
3. Add end-to-end real OCR fixture tests.
4. Add fixture-driven preview-versus-generated-PDF parity tests.
5. Add classroom markings, upright landscape, shared diagrams, and unusable nonblank inputs.
6. Make the scorecard a standard CI artifact; keep raw LLM-draft comparison optional and non-authoritative.

Current verification: `npm.cmd run test:detector` passes 19/19. The local strict Claude-draft comparison fails 3/13 (`IMG_0927`, `IMG_0929`, `IMG_0932`), reinforcing that ignored drafts are gap-finding inputs rather than release gates.
