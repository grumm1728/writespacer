import { describe, expect, it } from "vitest";

import {
  normalizeWorksheetPage,
  toAnalysisRect,
  toSourceRect,
  type WorksheetImageInput,
} from "@/lib/detection/normalization";
import type { Rect } from "@/lib/types";

describe("worksheet source normalization", () => {
  it.each([
    { width: 0, height: 10, grayscaleLength: 0, rgbaLength: 0 },
    { width: 10.5, height: 10, grayscaleLength: 105, rgbaLength: 0 },
    { width: 10, height: 10, grayscaleLength: 99, rgbaLength: 0 },
    { width: 10, height: 10, grayscaleLength: 100, rgbaLength: 399 },
  ])("rejects invalid source dimensions %#", ({ width, height, grayscaleLength, rgbaLength }) => {
    const input: WorksheetImageInput = {
      grayscale: new Uint8Array(grayscaleLength),
      width,
      height,
      ...(rgbaLength > 0 ? { rgba: new Uint8Array(rgbaLength) } : {}),
    };

    expect(() => normalizeWorksheetPage(input)).toThrow(
      "Worksheet image data has invalid dimensions.",
    );
  });

  it.each([
    { width: 120, height: 80 },
    { width: 3000, height: 300 },
  ])("records scale and round-trips coordinates for $width x $height", ({ width, height }) => {
    const page = normalizeWorksheetPage({
      grayscale: new Uint8Array(width * height).fill(255),
      width,
      height,
    });
    const sourceRect: Rect = { left: 13, top: 7, width: 41, height: 19 };
    const roundTrip = toSourceRect(toAnalysisRect(sourceRect, page), page);

    expect(page.scale).toBe(page.width / width);
    expect(page.sourceWidth).toBe(width);
    expect(page.sourceHeight).toBe(height);
    expect(rectEdges(roundTrip)).toEqual(
      expect.objectContaining({
        left: expect.closeTo(sourceRect.left, 0),
        top: expect.closeTo(sourceRect.top, 0),
        right: expect.closeTo(sourceRect.left + sourceRect.width, 0),
        bottom: expect.closeTo(sourceRect.top + sourceRect.height, 0),
      }),
    );
  });
});

function rectEdges(rect: Rect) {
  return {
    left: rect.left,
    top: rect.top,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
  };
}
