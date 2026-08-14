# One-page worksheet workflow decision

Issue: [#9 — Plan the teacher review workflow cleanup](https://github.com/grumm1728/writespacer/issues/9)

## Product promise

WriteSpacer creates one printable page side containing up to eight problems selected from imported source material. The output arrangement is predetermined by the number of selected problems. Teachers choose and repair prompts; they do not design the page layout.

One side is the hard invariant. Eight is the maximum, not a guarantee when prompt crops cannot remain legible or leave useful student workspace.

## Main flow

1. **Add source** — take a photo or import a supported image or document.
2. **Preview** — analysis detects problem candidates, selects up to eight in reading order, and immediately composes the one-page handout.
3. **Adjust if needed** — from the preview, replace or remove selected problems and repair erroneous crops or labels.
4. **Download** — export exactly what the preview shows.

There is no separate mandatory Review step. The handout preview is the primary workspace and the product’s main result.

## Preview behavior

The preview shows one fixed page side with one of four deterministic arrangements:

- 1–2 selected problems;
- 3–4 selected problems;
- 5–6 selected problems;
- 7–8 selected problems.

Each arrangement allocates prompt space and student workspace without teacher controls for density, prompt size, columns, or page count. Fewer selected problems receive more working space.

Selecting a prompt in the preview reveals only three primary actions:

- **Fix crop**;
- **Replace problem**;
- **Remove**.

An empty slot offers **Add problem**. **Change problems** opens the source picker with detected candidates selected up to the eight-problem limit.

## Analysis and uncertainty

Analysis may use the browser CV pipeline, an explicitly approved assist service, or a later hybrid. The teacher does not see confidence scores, model names, or implementation details.

When analysis is uncertain, mark the affected preview slot with a plain-language action such as **Check crop** or **Check diagram**. Do not route the teacher to a general review dashboard. Selecting the marker opens one concrete decision and returns to the preview after it is answered.

Confident-but-wrong output remains recoverable because every preview prompt has **Fix crop** and **Replace problem** actions.

## Selection policy

- Select the first eight usable problem candidates in reading order by default.
- If the source contains fewer than eight candidates, use the matching smaller arrangement.
- Preserve source labels and established duplicate display suffixes.
- Replacing a problem keeps its handout slot when possible.
- Removing a problem recomposes the page using the smaller deterministic arrangement.
- Candidate order is source reading order; selected order can be changed inside **Change problems**.
- Section headers and diagrams remain prompt structure, not separately counted problems.

## Fit policy

Never silently shrink a prompt below the minimum readable size. If a selected crop cannot fit its assigned arrangement while preserving useful student workspace:

1. try a structure-preserving tighter crop;
2. mark the slot **Check crop** when teacher judgment could resolve it;
3. otherwise explain that fewer problems are needed and identify the oversized selections.

The app must never create a second page side to satisfy the selection.

## State model

| State | Role |
| --- | --- |
| Source | Imported image or supported document pages |
| Problem candidates | Detected prompt crops available for selection |
| Problem selection | Ordered set of zero to eight candidates |
| Crop corrections | Teacher-approved geometry and prompt-fragment relationships |
| One-page handout | Deterministic layout derived from the selection and corrections |

The preview and downloaded PDF use the same measurements. Selection and crop changes are undoable. Re-analysis is an explicit action when corrections exist.

## Recovery editor

**Fix crop** opens a focused source view for one selected problem. It supports moving/resizing, split/merge, label repair, section-header structure, and diagram attachment as required by that problem. The complete source-wide editor is secondary and appears only through **Change problems** or **Something else looks wrong**.

## Acceptance criteria

1. Every generated handout is exactly one printable page side.
2. A handout contains no more than eight selected problems.
3. Import leads directly to a representative preview without mandatory box review.
4. The preview exposes no layout, density, prompt-size, or page-count controls.
5. Teachers can add, remove, replace, reorder, and repair selected prompts from the preview.
6. Fewer problems automatically receive a predetermined roomier arrangement.
7. Prompts never shrink below the readability threshold; oversized selections request fewer problems instead of spilling to another side.
8. Analyzer uncertainty appears as a concrete action on the affected preview slot, never as a score.
9. Preview crops and placements match the downloaded PDF.
10. Missed, merged, extra, mislabeled, section-header, diagram-attachment, and reading-order failures remain recoverable without re-importing.

## Deferred

- More than one output side.
- Teacher-designed layouts or spacing controls.
- Shared diagrams attached to multiple problems.
- Remote processing or production LLM detection without an explicit privacy decision.
- Re-typesetting prompt text.
- Persisted or collaborative handouts.
