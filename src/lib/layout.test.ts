import { describe, expect, it } from "vitest";

import { __testing, previewWorksheetLayout } from "@/lib/client-processing";
import type { ProblemDraft, Rect } from "@/lib/types";

describe("worksheet layout preview", () => {
  it("uses a consistent prompt scale for simple problems", () => {
    const drafts = [
      makeDraft("problem-1", 0, "1"),
      makeDraft("problem-2", 1, "2"),
    ];

    const preview = previewWorksheetLayout(drafts, {
      density: "compact",
      promptScale: "small",
    });
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

  it("lets compact, balanced, and spacious density change page counts", () => {
    const drafts = Array.from({ length: 30 }, (_, index) =>
      makeDraft(`problem-${index + 1}`, index, String(index + 1)),
    );

    const compact = previewWorksheetLayout(drafts, {
      density: "compact",
      promptScale: "small",
    });
    const spacious = previewWorksheetLayout(drafts, {
      density: "spacious",
      promptScale: "small",
    });

    expect(compact.pageCount).toBeLessThanOrEqual(spacious.pageCount);
    expect(spacious.pageCount).toBeGreaterThan(compact.pageCount);
  });

  it("emits section-header placements before their problem group", () => {
    const headerRect = { left: 12, top: 8, width: 250, height: 24 };
    const draft = makeDraft("problem-1", 0, "9", {
      sectionHeaderRects: [headerRect],
    });

    const preview = previewWorksheetLayout([draft], {
      density: "compact",
      promptScale: "small",
    });
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
