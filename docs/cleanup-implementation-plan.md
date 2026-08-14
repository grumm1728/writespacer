# Reliable teacher workflow implementation plan

Issue: [#11 — Synthesize the cleanup plan into implementation slices](https://github.com/grumm1728/writespacer/issues/11)

## Problem statement

WriteSpacer has a capable browser-local detector, rectangle editor, live preview, and PDF generator, but they still form a prototype workflow. Detector changes are judged mostly against hand-written anchor expectations, the detector implementation is concentrated in one large module, correction tools lose prompt structure and omit undo and several recovery operations, and the current multi-page layout controls conflict with the later product decision to create exactly one page side with up to eight selected problems.

The cleanup must make the workflow reliable without assuming perfect detection: at least 90% of representative supported source pages should reach a printable preview within 30 seconds for a returning teacher and require corrections to no more than two affected items, while every supported input remains recoverable without re-importing.

## Solution

Build the cleanup as eight ordered slices. Establish the reviewed fixture manifest and scorecard before structural detector work. Refactor detection behind one deep interface without changing outcomes. Replace open-ended layout controls with four deterministic one-page arrangements. Model selection and correction as undoable commands over a detection draft. Move the production workflow directly from analysis to the one-page preview, with focused correction tools available only when needed. Tune detector behavior only after the harness and module extraction are stable. Finish with parity, accessibility, static-hosting, privacy, and documentation checks.

The accepted one-page decision supersedes the earlier tolerance in issue #5 for a second output side. Image-only, single-source-page input remains the cleanup scope; document and multi-page input are deferred.

## Implementation slices and commits

### Slice 1 — Establish the behavioral oracle

1. **Add a versioned reviewed-fixture manifest contract.** Define support classification, family tags, source dimensions and orientation, ordered problems, source labels, anchor and prompt rectangles, diagram attachments, header associations, fallback expectations, reviewer metadata, and uncertainty notes. Reject invalid rectangles, duplicate identifiers, missing review metadata, and unsupported schema versions. Acceptance: the manifest loader returns a typed fixture or an actionable validation error without invoking detection.
2. **Migrate current core fixture expectations into the manifest.** Move test-only anchor constants and the existing reviewed synthetic oracle into one human-reviewed source of truth without changing detector output. Acceptance: existing fixture assertions read the manifest and the standard detector suite still passes.
3. **Promote the seven committed phone photos one reviewed page at a time.** For each page, record full prompt, header, diagram, and reading-order expectations after human review; raw Claude drafts may suggest regions but never become the oracle automatically. Acceptance for each commit: the new fixture loads, renders a review overlay for inspection, and reports its score without changing prior fixture results.
4. **Add approved missing fixture families.** Add teacher-owned or otherwise approved examples for classroom markings, upright landscape, WebP, shared-figure pressure, sparse fallback, and unusable nonblank input. Keep at least one reviewed page per major family as a holdout and do not upload classroom material to a third party as part of this work. Acceptance: every required family has an explicit supported, unsupported, or deferred classification.
5. **Implement scorecard metrics as a non-gating report.** Report anchor precision/recall, exact labels and count delta, reading order, header behavior, required-content coverage, contamination, diagram attachment, fallback state, affected-item corrections, analysis time, and preview/PDF measurements per fixture and family. Acceptance: a local command emits deterministic human-readable and machine-readable summaries and identifies incomplete gold data separately from detector failures.
6. **Introduce safe merge gates.** Immediately gate crashes, invalid rectangles, reading-order regressions, duplicate header rendering, clipping, and preview/PDF page-count disagreement. Promote the 90%-within-two-corrections target to a gate only after representative gold coverage is complete and the baseline meets it, so the harness does not make the default branch permanently red. Acceptance: an intentional invariant regression fails CI with the fixture family and affected items named.

### Slice 2 — Deepen the detector without retuning it

7. **Add the asynchronous detector facade and outcome contract.** Provide one operation that owns source pixels through reviewable problem drafts, headers, recoverable failure state, and scorecard diagnostics. Keep compatibility wrappers temporarily. Acceptance: the application can call the facade and every existing fixture produces equivalent observable output.
8. **Extract source normalization.** Move validation, scaling, grayscale/RGBA normalization, and coordinate conversion into a typed normalized-page stage. Acceptance: focused tests cover invalid dimensions and round-trip coordinate tolerances, while the scorecard remains unchanged.
9. **Extract visual evidence.** Move masks, connected components, rows, segments, layout regions, and anchor proposals into an evidence stage whose artifact contains evidence rather than final decisions. Acceptance: proposal counts and rectangles remain within recorded compatibility tolerances for every fixture.
10. **Move local OCR behind the anchor-recognizer seam.** Production uses the browser-local Tesseract adapter and tests use reviewed label observations. Empty or failed recognition remains a valid input to geometric fallback. Acceptance: a real local OCR fixture test and a recognizer-failure test both complete through the detector facade.
11. **Extract structure reconciliation with typed provenance.** Move recognized-anchor selection, deterministic sequence repair, geometric supplementation, reading order, header detection, and ownership zones into one stage. Mark accepted anchors as recognized, sequence-repaired, or geometric fallback for diagnostics only. Acceptance: merge precedence is deterministic and no provenance or confidence implementation detail becomes primary teacher-facing UI.
12. **Extract review-draft composition.** Move prompt fragments, diagram/header association, union bounds, fallback blocks, warnings, and recoverable empty outcomes into the final stage. Acceptance: required-content coverage, contamination, header association, and fallback scorecard results remain unchanged.
13. **Remove the leaked internal detector state.** Route application and fixture tests through the facade, retain only narrow invariant tests for coordinate conversion and merge precedence, then delete compatibility wrappers and duplicated tests. Acceptance: no application caller coordinates detector stages, the old internal escape hatch is gone, and lint, build, and detector tests pass.

### Slice 3 — Make the one-page layout invariant executable

14. **Introduce the problem selection contract.** Represent an ordered selection of zero to eight problem candidates independently from the full review draft. Select the first eight usable problems in reading order by default and preserve established repeated-label formatting. Acceptance: selection tests cover fewer than eight, more than eight, replacement, removal, and reorder cases.
15. **Implement four deterministic arrangements.** Measure fixed arrangements for 1–2, 3–4, 5–6, and 7–8 selected problems, with fewer problems receiving more workspace. Remove density, prompt-size, column, and page-count decisions from the production layout interface. Acceptance: every nonempty valid selection produces exactly one Letter-size page side with stable placements.
16. **Add explicit readability and fit outcomes.** Define a minimum readable prompt scale and minimum useful workspace. Tighten structure-preserving crops first; if an item still cannot fit, return a specific check-crop or reduce-selection outcome rather than shrinking silently or creating another page. Acceptance: oversized synthetic prompts produce deterministic, teacher-actionable outcomes and never a second page.
17. **Drive preview and PDF from the same one-page measurement.** Preserve blank answer space without visible boxes or ruled lines. Acceptance: preview and downloaded PDF use identical placement data, page count is always one, and prompt/header content is neither clipped nor overlapped on gold fixtures.

### Slice 4 — Make review state explicit and undoable

18. **Separate the untouched detection draft from the editable review draft.** Store source candidates, current selection, prompt-fragment corrections, reading order, and unresolved review questions without mutating detector output. Acceptance: reset-to-detected restores the exact original draft without re-analysis or re-import.
19. **Introduce review commands and history.** Express add, remove/restore, replace, reorder, relabel, move/resize, split, merge, classify header, attach/detach diagram, and approve-question operations as atomic commands. Changing several fields on one affected item remains one correction. Acceptance: each command has inverse behavior or a documented non-destructive replacement, and undo/redo tests cover mixed command sequences.
20. **Derive handout state from the review draft.** Recompute selection, layout outcome, unresolved questions, and download readiness after every command instead of synchronizing parallel UI state manually. Acceptance: command tests prove that counts, selected slots, labels, questions, and fit outcomes cannot drift apart.
21. **Define re-analysis semantics.** Re-analysis is explicit when corrections exist and never silently discards them. Acceptance: unchanged drafts can re-analyze directly; corrected drafts require a clear keep-or-replace decision and remain recoverable after either choice.

### Slice 5 — Ship the preview-first production workflow

22. **Route successful analysis directly to the one-page preview.** Remove the mandatory box-review and layout-control steps from the production path. Keep the source identity visible and show a recoverable source view when analysis returns no usable candidates. Acceptance: built-in sample import reaches a representative one-page preview with at most eight selected problems and no intermediate confirmation screen.
23. **Add slot selection and primary actions.** Selecting a populated preview slot exposes Fix crop, Replace problem, and Remove; an empty slot exposes Add problem; Change problems opens all candidates in source reading order. Acceptance: each action updates the preview immediately and remains undoable.
24. **Present uncertainty as concrete review questions.** Map detector diagnostics to actions such as Check crop or Check diagram on affected slots, without confidence scores, model names, or CV terminology. Acceptance: resolving a question returns focus to the preview and confident-but-wrong items remain fixable through the same primary actions.
25. **Finish download behavior.** Use Download PDF only when the current preview is downloadable, explain fit blockers beside affected slots, and revoke stale object URLs when state changes. Acceptance: the downloaded PDF corresponds to the visible preview and repeated downloads do not leak stale results.

### Slice 6 — Add focused recovery tools

26. **Build a focused crop editor that preserves prompt structure.** Support zoom/pan plus moving and resizing the selected problem while keeping its label and first equation segment together. Make conversion to a union fallback explicit instead of silently destroying fragments. Acceptance: ordinary crop edits preserve headers and diagram relationships and update the preview live.
27. **Add missed, merged, and extra-problem recovery.** Support drawing a missing problem, splitting a merged problem, merging fragments/problems where valid, and restoring excluded candidates. Acceptance: each audited failure can be corrected without clearing all boxes or re-importing.
28. **Add label and reading-order recovery.** Validate editable source labels, preserve repeated-label suffix behavior, and allow keyboard/touch reordering in the candidate picker. Acceptance: dense multi-column fixtures can be reordered correctly without redrawing regions.
29. **Add section-header and diagram recovery.** Allow a region to be marked or unmarked as a section header, associate it with the following group, and attach or detach a diagram from one problem. Acceptance: headers render once and receive no answer space; a detached diagram can be assigned without enlarging the whole problem crop.
30. **Make the correction surface responsive and accessible.** On small screens use a focused editor with zoom/pan, sticky selected-item controls, and touch-sized handles. Give overlays and controls names, roles, focus treatment, keyboard equivalents, pressed/selected state, and announced updates. Acceptance: the complete correction flow works at desktop and narrow mobile viewports without horizontal overflow and can be completed without a pointing device.

### Slice 7 — Improve detector behavior through scorecard evidence

31. **Establish the post-refactor baseline without tuning.** Publish aggregate and per-family scorecards, correction counts, holdout results, and analysis-time observations. Acceptance: structural extraction is shown not to have changed behavior and the highest-impact supported-family misses are ranked.
32. **Fix one repeated failure pattern per commit.** Prioritize proposal geometry, numeric sequence repair, repeated labels, header exclusion, reading order, fallback block construction, and diagram association according to affected-item impact. Add or update a reviewed fixture expectation before each fix and avoid sample-specific coordinates. Acceptance for each commit: the targeted family improves, holdouts and invariant gates do not regress, and the detector remains browser-compatible.
33. **Meet and enable the teacher-success gate.** Continue evidence-led fixes until at least 90% of representative supported pages require no more than two affected-item corrections. Acceptance: the gate reports aggregate and per-family results, every supported page remains recoverable, and analysis-time measurements leave room for the 30-second end-to-end teacher target.

### Slice 8 — Verify the whole workflow and finish the cleanup

34. **Add generated-PDF parity coverage.** Generate PDFs from reviewed fixtures, inspect page dimensions and placement metadata, and render a small representative set for image-based clipping/overlap checks. Acceptance: preview/PDF placements and page count are exact and every output is one page side.
35. **Run the teacher workflow benchmark.** On representative desktop and mobile browsers, time returning-user import through printable preview, count affected-item corrections, exercise every recovery operation, and verify first-use completion without outside help. Acceptance: results are recorded by fixture family and meet the supported-input target or identify an explicit release blocker.
36. **Remove prototype-only routes and obsolete controls.** Delete experimental variants only after their selected preview-first behavior exists in production, and remove superseded multi-page density/prompt-size UI and state. Acceptance: production has one canonical workflow and no dead control path remains.
37. **Update architecture, product, privacy, and contributor documentation.** Document the deep detector interface, internal stages, reviewed scorecard workflow, one-page product promise, supported/unsupported inputs, browser-local processing, and development-only annotation rules. Acceptance: documentation contains no promise of production remote processing or multi-page/document support and manual commands match package scripts.
38. **Verify static hosting and privacy boundaries.** Build the static export with its repository base path, inspect production bundles and network activity, and confirm worksheet analysis, correction, preview, and PDF generation make no remote content calls. Acceptance: GitHub Pages deployment remains sufficient and uploaded worksheet pixels never leave the browser.
39. **Run the release gate.** Run lint, detector/scorecard tests, layout/PDF parity tests, and production build, then complete the documented sample-page manual flow. Acceptance: all automated checks pass, the scorecard gate is green, the built-in sample produces one page with no overflow, and any deferred work is captured separately.

## Decision document

- The product creates exactly one printable page side containing no more than eight selected problems. The later workflow decision supersedes issue #5's earlier allowance for a second side.
- The production path is Add source → Preview → Adjust if needed → Download; there is no mandatory box-review step.
- Layout is predetermined by selected-problem count. Teachers choose and repair prompts rather than designing page geometry.
- Detection remains CV-first and entirely browser-local. Production LLM and remote worksheet processing are deferred, not authorized by a missed quality target.
- The detector is one deep module with typed internal stages and one asynchronous external operation. The local recognizer is an injected seam; proposal strategies and merge policy stay internal.
- Detection drafts are immutable baselines. Teacher corrections operate on a separate review draft and are undoable.
- Prompts remain source-image fragments. Labels, first equations, headers, and diagrams retain explicit relationships.
- Preview and PDF consume the same one-page measurements.
- Image-only, single-source-page input is the cleanup scope. Multi-page files, PDF/document import, and persisted projects require later product decisions.

## Testing decisions

- The reviewed fixture manifest is the behavioral oracle. Raw LLM drafts are suggestions and never gate changes without human review.
- Detector tests primarily cross the deep detector interface and assert observable drafts, diagnostics, and recoverable outcomes. Internal-stage tests are limited to coordinate conversion and deterministic reconciliation invariants that cannot be diagnosed reasonably from the outcome.
- Scorecards report aggregate and per-family results so easy synthetic fixtures cannot hide phone-photo or dense-layout regressions. Holdouts are never used for tuning.
- Review-state tests exercise commands and derived outcomes without rendering React. UI tests cover wiring, focus, announcements, keyboard behavior, and responsive presentation.
- Layout/PDF tests use the same measurement input, inspect generated PDF placement metadata, and render representative outputs for clipping and overlap verification.
- Performance evidence combines deterministic analysis-time reporting with manual end-to-end teacher timing; flaky wall-clock CI thresholds are avoided.
- Existing detector and layout tests provide prior art, but test-only fixture constants and tests coupled to leaked internal arrays are replaced once equivalent facade coverage exists.

## Out of scope

- Production LLM detection, remote worksheet upload, server APIs, accounts, analytics on worksheet content, or a hosting migration.
- Re-typesetting equations or problem text from OCR.
- More than one output page side, teacher-designed layouts, density controls, prompt-size controls, or automatic spillover.
- Multi-page source files, PDF/document rasterization, collages, severe distortion, folded or obscured pages.
- Shared diagrams attached to multiple problems; the cleanup supports assigning a diagram to one problem.
- Persisted, collaborative, or cloud-synchronized handouts.
- Automatic acceptance of third-party-generated fixture annotations.

## Further notes

Detector structural commits and behavior-tuning commits must remain separate. Every commit should leave the application buildable and the existing green gates passing. When a new gold fixture exposes a current miss, land it first as a non-gating baseline observation or pair it with the smallest general fix; never weaken reviewed expectations to preserve a passing score.
