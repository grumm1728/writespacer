import { describe, expect, it } from "vitest";

import {
  __testing,
  MAX_PROBLEM_SELECTION,
  previewWorksheetLayout,
  selectProblemCandidates,
} from "@/lib/client-processing";
import { formatDuplicateSourceLabels } from "@/lib/detection";
import type { ProblemDraft, Rect } from "@/lib/types";

describe("worksheet layout preview", () => {
  it("uses a consistent prompt scale for simple problems", () => {
    const drafts = [
      makeDraft("problem-1", 0, "1"),
      makeDraft("problem-2", 1, "2"),
    ];

    const preview = previewWorksheetLayout(drafts);
    const prompts = preview.pages
      .flatMap((page) => page.placements)
      .filter((placement) => placement.type === "problem")
      .map((placement) => placement.prompt);

    expect(prompts).toHaveLength(2);
    expect(prompts[0].width).toBeCloseTo(prompts[1].width, 4);
    expect(prompts[0].height).toBeCloseTo(prompts[1].height, 4);
  });

  it("composes the anchor and first equation segment on one line", () => {
    const anchorRect = { left: 10, top: 20, width: 20, height: 20 };
    const firstEquation = { left: 36, top: 18, width: 80, height: 24 };
    const secondLine = { left: 38, top: 56, width: 58, height: 18 };
    const draft = makeDraft("problem-1", 0, "3", {
      anchorRect,
      contentRects: [firstEquation, secondLine],
    });

    const promptRects = __testing.getPromptSourceRects(draft);

    expect(promptRects).toHaveLength(2);
    expect(promptRects[0]).toEqual({ left: 10, top: 18, width: 106, height: 24 });
    expect(promptRects[1]).toEqual(secondLine);
  });

  it("uses one fixed Letter-size page for every nonempty selection of up to eight", () => {
    for (let count = 1; count <= MAX_PROBLEM_SELECTION; count += 1) {
      const drafts = Array.from({ length: count }, (_, index) =>
        makeDraft(`problem-${index + 1}`, index, String(index + 1)),
      );
      const preview = previewWorksheetLayout(drafts);

      expect(preview.pageCount).toBe(1);
      expect(preview.pages).toHaveLength(1);
      expect(preview.worksheetItems).toHaveLength(count);
      for (const placement of preview.pages[0].placements) {
        expect(placement.rect.left).toBeGreaterThanOrEqual(36);
        expect(placement.rect.top).toBeGreaterThanOrEqual(36);
        expect(placement.rect.left + placement.rect.width).toBeLessThanOrEqual(576);
        expect(placement.rect.top + placement.rect.height).toBeLessThanOrEqual(756);
      }
    }
  });

  it("supports an empty selection without creating problem placements", () => {
    const preview = previewWorksheetLayout([makeDraft("excluded", 0, "1", { included: false })]);

    expect(preview.pageCount).toBe(1);
    expect(preview.worksheetItems).toEqual([]);
    expect(preview.pages[0].placements).toEqual([]);
  });

  it("defaults to the first eight usable candidates in reading order", () => {
    const drafts = Array.from({ length: 12 }, (_, index) =>
      makeDraft(`problem-${index + 1}`, index, String(index + 1)),
    );
    drafts[0] = makeDraft("excluded", 99, "ignored", { included: false });
    drafts[9] = makeDraft("duplicate", 1, "2");

    const selection = selectProblemCandidates(drafts);
    const preview = previewWorksheetLayout(drafts);

    expect(selection).toHaveLength(MAX_PROBLEM_SELECTION);
    expect(selection.map((draft) => draft.sourceLabel)).toEqual([
      "2", "2", "3", "4", "5", "6", "7", "8",
    ]);
    expect(preview.worksheetItems.map((item) => item.sourceLabel)).toEqual(
      selection.map((draft) => draft.sourceLabel),
    );
    expect(formatDuplicateSourceLabels(selection.map((draft) => draft.sourceLabel))).toEqual([
      "2", "2.1", "3", "4", "5", "6", "7", "8",
    ]);
  });

  it("emits section-header placements before their problem group", () => {
    const headerRect = { left: 12, top: 8, width: 250, height: 24 };
    const draft = makeDraft("problem-1", 0, "9", {
      sectionHeaderRects: [headerRect],
    });

    const preview = previewWorksheetLayout([draft]);
    const placements = preview.pages[0].placements;

    expect(placements[0]).toMatchObject({
      type: "section-header",
      regionId: "problem-1",
      sourceRect: headerRect,
    });
    expect(placements[1]).toMatchObject({
      type: "problem",
      regionId: "problem-1",
    });
  });

  it("renders a shared section header once for its problem group", () => {
    const headerRect = { left: 12, top: 8, width: 250, height: 24 };
    const preview = previewWorksheetLayout([
      makeDraft("problem-1", 0, "1", { sectionHeaderRects: [headerRect] }),
      makeDraft("problem-2", 1, "2", { sectionHeaderRects: [headerRect] }),
    ]);

    expect(preview.pages[0].placements.filter((placement) => placement.type === "section-header"))
      .toHaveLength(1);
  });

  it("keeps oversized prompt crops and answer space inside the one-page bounds", () => {
    const preview = previewWorksheetLayout([
      makeDraft("oversized", 0, "1", {
        unionBounds: { left: 0, top: 0, width: 2000, height: 1600 },
        contentRects: [{ left: 0, top: 0, width: 2000, height: 1600 }],
      }),
    ]);

    const problem = preview.pages[0].placements.find((placement) => placement.type === "problem");
    expect(problem?.type).toBe("problem");
    if (problem?.type === "problem") {
      expect(problem.prompt.left + problem.prompt.width).toBeLessThanOrEqual(576);
      expect(problem.prompt.top + problem.prompt.height).toBeLessThanOrEqual(756);
      expect(problem.answerArea.left + problem.answerArea.width).toBeLessThanOrEqual(576);
      expect(problem.answerArea.top + problem.answerArea.height).toBeLessThanOrEqual(756);
    }
  });

  it("gives a smaller selection more clean answer space", () => {
    const one = previewWorksheetLayout([makeDraft("problem-1", 0, "1")]);
    const eight = previewWorksheetLayout(
      Array.from({ length: 8 }, (_, index) => makeDraft(`problem-${index}`, index, String(index))),
    );
    const oneAnswer = one.pages[0].placements.find((placement) => placement.type === "problem");
    const eightAnswer = eight.pages[0].placements.find((placement) => placement.type === "problem");

    expect(oneAnswer?.type).toBe("problem");
    expect(eightAnswer?.type).toBe("problem");
    if (oneAnswer?.type === "problem" && eightAnswer?.type === "problem") {
      expect(oneAnswer.answerArea.height).toBeGreaterThan(eightAnswer.answerArea.height);
    }
  });
});

function makeDraft(
  id: string,
  orderIndex: number,
  sourceLabel: string,
  overrides: Partial<ProblemDraft> = {},
): ProblemDraft {
  const anchorRect = overrides.anchorRect ?? { left: 10, top: 10, width: 24, height: 20 };
  const contentRects = overrides.contentRects ?? [
    { left: 38, top: 10, width: 92, height: 20 },
  ];
  const unionBounds = overrides.unionBounds ?? unionRects([anchorRect, ...contentRects]);

  return {
    id,
    orderIndex,
    sourceLabel,
    anchorRect,
    contentRects,
    sectionHeaderRects: [],
    unionBounds,
    confidence: 0.82,
    fragments: [
      { id: `${id}-anchor`, kind: "anchor", rect: anchorRect, confidence: 0.82 },
      ...contentRects.map((rect, index) => ({
        id: `${id}-content-${index + 1}`,
        kind: "content" as const,
        rect,
        confidence: 0.82,
      })),
    ],
    compositionMode: "composite-stack",
    columnHint: 0,
    included: true,
    ...overrides,
  };
}

function unionRects(rects: Rect[]) {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}
