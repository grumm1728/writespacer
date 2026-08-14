# Detection pipeline cleanup decision

Issue: [#8 — Choose the cleanup shape for the detection pipeline](https://github.com/grumm1728/writespacer/issues/8)

## Decision

Keep one deep detector module with a small browser-facing interface, but split its implementation into explicit pure stages with typed, immutable intermediate artifacts. Preserve the current CV-first approach and local Tesseract recognition. Do not keep extending the monolithic `detection.ts`, and do not introduce a generic plugin registry or production remote-detector seam.

The detector owns every step from decoded source pixels through a reviewable detection draft. Crop rendering, teacher corrections, layout, preview, and PDF generation remain outside it.

## External interface

The application should learn one primary detector operation:

```ts
analyzeWorksheetImage(input, anchorRecognizer): Promise<DetectionOutcome>
```

`DetectionOutcome` contains reviewable problem drafts, section headers, a recoverable failure state, and scorecard diagnostics. The caller must not coordinate normalization, proposal sources, sequence repair, header detection, fallback selection, or draft composition.

The anchor recognizer is the one real seam because production uses local Tesseract while detector tests use reviewed recognitions. It accepts source pixels plus anchor proposals and returns label observations. The detector validates and reconciles those observations; recognizers never produce final problems.

Keep compatibility wrappers for `detectWorksheetStructure()` and `finalizeWorksheetDetection()` only during migration. Remove them from application code once the new operation is established.

## Internal stages and artifacts

1. **Normalize source** → `NormalizedPage`
   - Validates dimensions, estimates scale, and produces the normalized grayscale/RGBA buffers.
   - Owns source-to-analysis coordinate conversion.
2. **Extract visual evidence** → `PageEvidence`
   - Produces content bounds, connected components, text rows, row segments, layout regions, and scored anchor proposals.
   - Contains evidence only; it does not decide final labels or problem ownership.
3. **Observe anchor labels** → `AnchorObservation[]`
   - Calls the injected recognizer and normalizes its raw results.
   - Empty observations are valid and feed the geometric fallback path.
4. **Reconcile worksheet structure** → `ReconciledStructure`
   - Selects recognized anchors, applies deterministic sequence repair, adds geometric anchors, detects section headers, establishes reading order, and builds ownership zones.
   - Every accepted anchor records typed provenance such as `recognized`, `sequence-repair`, or `geometric-fallback`; this is diagnostic data, not a user-facing confidence score.
5. **Compose review draft** → `DetectionOutcome`
   - Builds prompt fragments and union bounds, associates headers and diagrams, chooses fallback blocks, and returns the recoverable failure/debug state.

Artifacts cross a stage only after that stage's invariants hold. Analysis-space rectangles stay inside the detector implementation; source-space rectangles are used in `DetectionOutcome`. Replace the current `WorksheetDetectionStructure.internal` escape hatch with the typed artifacts rather than exposing private arrays alongside duplicate public projections.

## Module shape

Use a `src/lib/detection/` directory organized around the stages, with an `index.ts` facade owning the external interface. Stage files are implementation details, not application imports. Shared domain contracts that the review and layout modules consume remain in `src/lib/types.ts`; detector-only artifacts live with the detector.

The reconciliation stage may contain several deterministic proposal strategies, but they are internal functions over the same artifact and share one deterministic merge policy. Record proposal provenance instead of creating interchangeable adapters. Introduce another detector adapter only if a second production implementation is actually approved; issue #10 explicitly defers remote/LLM production processing.

## Scorecard alignment

The human-reviewed fixture manifest remains the behavioral oracle. Tests at the detector interface score:

- anchor precision/recall and exact labels from accepted-anchor diagnostics;
- exact reading order and section-header association from `DetectionOutcome`;
- required prompt/diagram coverage and contamination from composed fragments;
- fallback and blank/unusable behavior from the typed outcome state;
- affected items needing correction from the final review draft.

Stage-level tests should cover only stage invariants that are difficult to diagnose through the outcome, such as coordinate conversion or deterministic merge precedence. They must not duplicate the fixture scorecard or lock tests to incidental component arrays. Preview/PDF parity remains an integration test across `DetectionOutcome` and the shared layout measurements, not detector logic.

## Rejected options

- **Continue tuning the monolith:** preserves short-term momentum but concentrates unrelated normalization, CV, OCR reconciliation, sequence repair, crop ownership, fallback, and diagnostics in one file. The scorecard cannot localize regressions without reaching through `internal` state.
- **Expose every stage as an application interface:** creates a shallow pipeline whose callers must understand ordering and invariants. Stages are internal seams for locality and focused tests, not work for `client-processing.ts` to orchestrate.
- **Generic proposal/plugin framework:** no second approved production detector exists. A registry would make merge policy and intermediate types public before real variation justifies that interface.
- **Rewrite detection around OCR or an LLM:** conflicts with the CV-first, browser-local decisions and does not remove the need for deterministic crops and recovery tools.

## Migration sequence

1. Land the reviewed fixture manifest and scorecard harness so current observable behavior is captured before moves.
2. Add the detector facade and `DetectionOutcome` without changing output; route `analyzeWorksheetFile()` through it.
3. Extract normalization and visual evidence with coordinate-space invariant tests.
4. Move Tesseract behind the anchor-recognizer interface and keep reviewed recognitions as the test adapter.
5. Extract reconciliation, provenance, and deterministic merge policy.
6. Extract draft composition and map scorecard diagnostics from typed artifacts.
7. Delete the `internal` escape hatch, compatibility wrappers, and superseded tests after facade-level fixtures cover their behavior.

Each step should preserve the detector scorecard. Do not combine the structural extraction with detector retuning; behavioral improvements should be separate changes measured per fixture family.
