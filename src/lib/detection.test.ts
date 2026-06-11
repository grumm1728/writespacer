import { readFileSync } from "node:fs";
import path from "node:path";

import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import { analyzeWorksheetImage, formatDuplicateSourceLabels } from "@/lib/detection";

function loadPngFixture(relativePath: string) {
  const absolutePath = path.join(process.cwd(), relativePath);
  const png = PNG.sync.read(readFileSync(absolutePath));
  const grayscale = new Uint8Array(png.width * png.height);

  for (let offset = 0, pixel = 0; offset < png.data.length; offset += 4, pixel += 1) {
    const red = png.data[offset];
    const green = png.data[offset + 1];
    const blue = png.data[offset + 2];
    grayscale[pixel] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  return {
    grayscale,
    height: png.height,
    rgba: png.data,
    width: png.width,
  };
}

function makeBlankImage(width: number, height: number) {
  return {
    grayscale: new Uint8Array(width * height).fill(255),
    height,
    rgba: new Uint8Array(width * height * 4).fill(255),
    width,
  };
}

describe("analyzeWorksheetImage", () => {
  it("detects each exercise in the dense textbook fixture", () => {
    const result = analyzeWorksheetImage(
      loadPngFixture("public/fixtures/pershan-problem-set-example.png"),
    );

    expect(result.problemDrafts.filter((draft) => draft.included)).toHaveLength(35);
    expect(result.problemDrafts.map((draft) => draft.sourceLabel)).toEqual(
      Array.from({ length: 35 }, (_, index) => String(index + 3)),
    );
    expect(result.debug.failureReason).toBeNull();
  });

  it("keeps instruction headers separate from nearby problem crops", () => {
    const result = analyzeWorksheetImage(
      loadPngFixture("public/fixtures/pershan-problem-set-example.png"),
    );

    expect(result.sectionHeaders.length).toBeGreaterThanOrEqual(3);
    for (const index of [5, 17, 27]) {
      expect(result.problemDrafts[index].sectionHeaderRects).toEqual([]);
      for (const header of result.sectionHeaders) {
        expect(intersects(result.problemDrafts[index].unionBounds, header.unionBounds)).toBe(false);
      }
    }
  });

  it("keeps the simple sample at four detected prompts", () => {
    const result = analyzeWorksheetImage(loadPngFixture("sample-input.png"));

    expect(result.problemDrafts.filter((draft) => draft.included)).toHaveLength(4);
    expect(result.debug.failureReason).toBeNull();
  });

  it("returns a reviewable debug state for blank input", () => {
    const result = analyzeWorksheetImage(makeBlankImage(800, 1000));

    expect(result.problemDrafts).toHaveLength(0);
    expect(result.debug.failureReason).toContain("No numbered problem anchors");
    expect(result.debug.rows).toEqual([]);
  });

  it("formats duplicate source labels with decimal occurrence suffixes", () => {
    expect(formatDuplicateSourceLabels(["2", "2", "3", "2"])).toEqual([
      "2",
      "2.1",
      "3",
      "2.2",
    ]);
  });
});

function intersects(a: { left: number; top: number; width: number; height: number }, b: { left: number; top: number; width: number; height: number }) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}
