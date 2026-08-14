---
status: accepted
---

# Use a staged internal detection pipeline behind one detector interface

Refactor the monolithic CV/OCR implementation into typed normalization, evidence extraction, anchor observation, structure reconciliation, and review-draft composition stages, while keeping those stages behind one deep browser-facing detector interface. Local Tesseract recognition is an injected seam because production and reviewed-fixture adapters both exist; proposal strategies and merge rules remain internal until a second production detector is approved, avoiding a speculative plugin framework while making scorecard regressions local and diagnosable.

## Consequences

- The detector owns source pixels through `DetectionOutcome`; correction, crop rendering, layout, preview, and PDF generation remain separate.
- Intermediate artifacts enforce stage invariants and replace `WorksheetDetectionStructure.internal`; application callers do not orchestrate stages.
- The fixture scorecard tests observable detector outcomes, with narrow stage tests only for otherwise opaque invariants.
- Extraction and behavior tuning land separately so fixture-family regressions remain attributable.
