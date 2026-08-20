# Fixture coverage status

Issue: [#15 — Promote phone-photo fixtures and enable invariant gates](https://github.com/grumm1728/writespacer/issues/15)

The reviewed-fixture manifest is a behavioral oracle only for fields listed in each fixture’s `reviewedFields`. Empty prompt regions, diagram attachments, or section-header data are explicitly incomplete—not inferred gold data.

## Committed source inventory

The repository currently contains no phone-photo source pages. Its raster fixtures are a clean worksheet scan, a workbook page, a textbook spread, and a small calculus image; the remaining fixture is synthetic SVG. Therefore no phone photo can be promoted to a reviewed gold fixture in this change.

| Required family | Classification | Current evidence | Next action |
| --- | --- | --- | --- |
| Clean scan | supported | `sample-input.png` | Complete its prompt-region review before using it for crop coverage. |
| Dense multi-column textbook | supported | `pershan-problem-set-example.png`, `sample-input-03-geometry.jpg` | Complete human review one source page at a time. |
| Repeated labels | supported | `sample-input-02.jpg`, `sample-input-03-geometry.jpg` | Complete prompt-region review before scoring duplicate-label coverage. |
| Phone photo | still-missing | No committed source | Add approved teacher-owned or otherwise reviewed photos before promotion. |
| Classroom markings | still-missing | No committed source | Add an approved marked worksheet page. |
| Upright landscape capture | still-missing | No committed source | Add an approved phone capture in landscape orientation. |
| WebP | still-missing | No committed source | Add an approved WebP page. |
| Shared-figure pressure | deferred | Shared diagrams are outside the current one-problem attachment model. | Revisit with an explicit product decision. |
| Sparse geometric fallback | still-missing | No committed source | Add an approved sparse page with a human-reviewed fallback outcome. |
| Unusable nonblank input | still-missing | No committed source | Add an approved nonblank page with a human-reviewed unusable outcome. |

## Active invariant gates

The automated detector and layout suite gates recoverable blank/crash behavior, manifest rectangle validation, reading order, section-header de-duplication, prompt and answer-area clipping, and the fixed one-page preview/PDF layout contract. These gates do not promote incomplete fixture fields to gold coverage.
