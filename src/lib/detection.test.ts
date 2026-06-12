import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  detectWorksheetStructure,
  finalizeWorksheetDetection,
  formatDuplicateSourceLabels,
} from "@/lib/detection";
import type { AnchorRecognition, Rect } from "@/lib/types";

type FixtureInput = ReturnType<typeof makeBlankImage>;
type Structure = ReturnType<typeof detectWorksheetStructure>;
type Annotation = { label: string; left: number; top: number; tolerance?: number };

const fixtures = {
  pershan: {
    path: "public/fixtures/pershan-problem-set-example.png",
    annotations: [
      ...pairedAnnotations(3, 9, [94, 164, 234], [118, 475]),
      ...pairedAnnotations(9, 19, [361, 431, 502, 571, 641], [119, 462]),
      annotation("19", 104, 710),
      annotation("20", 102, 780),
      annotation("21", 103, 947),
      annotation("22", 474, 947),
      annotation("23", 903, 41),
      annotation("24", 1267, 41),
      ...pairedAnnotations(25, 31, [610, 679, 748], [903, 1261]),
      ...pairedAnnotations(31, 37, [879, 949, 1019], [905, 1261]),
      annotation("37", 906, 1092),
    ],
  },
  original: {
    path: "public/fixtures/sample-input.png",
    annotations: [
      annotation("1", 68, 114),
      annotation("2", 65, 373),
      annotation("3", 66, 694),
      annotation("4", 64, 1183),
    ],
  },
  repeated: {
    path: "public/fixtures/sample-input-02.jpg",
    annotations: [157, 182, 207, 232, 349, 374, 399, 424, 534, 559, 584, 609]
      .flatMap((top, rowIndex) => [
        annotation(String((rowIndex % 4) * 2 + 1), 271, top, 20),
        annotation(String((rowIndex % 4) * 2 + 2), 346, top, 20),
      ]),
  },
  geometry: {
    path: "public/fixtures/sample-input-03-geometry.jpg",
    annotations: [
      annotation("30", 54, 274),
      annotation("31", 54, 318),
      annotation("32", 56, 613),
      annotation("33", 369, 63),
      annotation("32", 370, 85),
      annotation("34", 376, 750),
      annotation("35", 376, 773),
      annotation("36", 376, 794),
      annotation("37", 733, 442),
      annotation("38", 733, 481),
      annotation("39", 733, 519),
      annotation("40", 1050, 313),
      annotation("41", 1050, 352),
      annotation("42", 1050, 391),
      annotation("43", 1049, 736),
      annotation("44", 1049, 775),
    ],
  },
  calculus: {
    path: "public/fixtures/sample-input-04-calculus.png",
    annotations: [
      annotation("1", 11, 9, 18),
      annotation("2", 10, 60, 18),
      annotation("3", 10, 91, 18),
      annotation("4", 10, 127, 18),
      annotation("5", 10, 156, 18),
    ],
  },
} as const;

describe("durable worksheet detection", () => {
  for (const [name, fixture] of Object.entries(fixtures)) {
    it(`preserves annotated anchors and labels for ${name}`, async () => {
      const input = await loadFixture(fixture.path);
      const structure = detectWorksheetStructure(input);
      const recognitions = recognizeAnnotations(structure, fixture.annotations);
      const result = finalizeWorksheetDetection(structure, recognitions);

      expect(result.problemDrafts.map((draft) => draft.sourceLabel)).toEqual(
        fixture.annotations.map((item) => item.label),
      );
      expect(result.problemDrafts).toHaveLength(fixture.annotations.length);
      expect(result.debug.failureReason).toBeNull();
      expect(result.debug.stageCounts.acceptedAnchors).toBe(fixture.annotations.length);
      expect(result.debug.normalizationScale).toBeGreaterThan(0);
      expect(result.debug.layoutTracks.length).toBeGreaterThan(0);

      result.problemDrafts.forEach((draft, index) => {
        const anchor = fixture.annotations[index];
        expect(contains(draft.unionBounds, anchor.left, anchor.top)).toBe(true);
      });
      for (let index = 0; index < result.problemDrafts.length - 1; index += 1) {
        const currentAnchor = center(result.problemDrafts[index].anchorRect);
        const nextAnchor = center(result.problemDrafts[index + 1].anchorRect);
        const currentRects = [
          result.problemDrafts[index].anchorRect,
          ...result.problemDrafts[index].contentRects,
        ];
        const nextRects = [
          result.problemDrafts[index + 1].anchorRect,
          ...result.problemDrafts[index + 1].contentRects,
        ];
        expect(nextRects.some((rect) => contains(rect, currentAnchor.left, currentAnchor.top)))
          .toBe(false);
        expect(currentRects.some((rect) => contains(rect, nextAnchor.left, nextAnchor.top)))
          .toBe(false);
      }
    });
  }

  it("keeps Pershan instruction headers outside problem crops", async () => {
    const input = await loadFixture(fixtures.pershan.path);
    const structure = detectWorksheetStructure(input);
    const result = finalizeWorksheetDetection(
      structure,
      recognizeAnnotations(structure, fixtures.pershan.annotations),
    );

    expect(result.sectionHeaders.length).toBeGreaterThanOrEqual(3);
    for (const draft of result.problemDrafts) {
      for (const header of result.sectionHeaders) {
        expect(overlapArea(draft.anchorRect, header.unionBounds)).toBe(0);
        for (const contentRect of draft.contentRects) {
          expect(overlapArea(contentRect, header.unionBounds)).toBe(0);
        }
      }
    }
  });

  it("fills a single OCR gap inside a coherent Pershan number run", async () => {
    const input = await loadFixture(fixtures.pershan.path);
    const structure = detectWorksheetStructure(input);
    const recognitions = recognizeAnnotations(structure, fixtures.pershan.annotations)
      .filter((recognition) => recognition.sourceLabel !== "4");
    const result = finalizeWorksheetDetection(structure, recognitions);

    expect(result.problemDrafts.map((draft) => draft.sourceLabel)).toEqual(
      fixtures.pershan.annotations.map((item) => item.label),
    );
  });

  it("repairs an isolated OCR misread inside an aligned numeric track", async () => {
    const input = await loadFixture(fixtures.calculus.path);
    const structure = detectWorksheetStructure(input);
    const recognitions = recognizeAnnotations(structure, fixtures.calculus.annotations);
    const used = new Set(recognitions.map((recognition) => recognition.proposalId));
    const splitStroke = noisyRecognition(structure, used, "1", 10, 66, 0.78);
    const result = finalizeWorksheetDetection(structure, [...recognitions, splitStroke]);

    expect(result.problemDrafts.map((draft) => draft.sourceLabel)).toEqual([
      "1",
      "2",
      "3",
      "4",
      "5",
    ]);
  });

  it("retains repeated raw labels for display suffix formatting", async () => {
    const input = await loadFixture(fixtures.geometry.path);
    const structure = detectWorksheetStructure(input);
    const result = finalizeWorksheetDetection(
      structure,
      recognizeAnnotations(structure, fixtures.geometry.annotations),
    );

    expect(result.problemDrafts.map((draft) => draft.sourceLabel).filter((label) => label === "32"))
      .toHaveLength(2);
    expect(formatDuplicateSourceLabels(["32", "32"])).toEqual(["32", "32.1"]);
  });

  it("rejects OCR labels from split strokes beside repeated anchors", async () => {
    const input = await loadFixture(fixtures.repeated.path);
    const structure = detectWorksheetStructure(input);
    const recognitions = recognizeAnnotations(structure, fixtures.repeated.annotations);
    const used = new Set(recognitions.map((recognition) => recognition.proposalId));
    const noise = [
      noisyRecognition(structure, used, "7", 277, 429, 0.46),
      noisyRecognition(structure, used, "1", 277, 539, 0.31),
      noisyRecognition(structure, used, "1", 360, 555, 0.95),
      noisyRecognition(structure, used, "1", 359, 562, 0.96),
      noisyRecognition(structure, used, "1", 360, 605, 0.77),
    ];
    const result = finalizeWorksheetDetection(structure, [...recognitions, ...noise]);

    expect(result.problemDrafts.map((draft) => draft.sourceLabel)).toEqual(
      fixtures.repeated.annotations.map((item) => item.label),
    );
  });

  it("returns conservative blocks when OCR is unavailable", async () => {
    const structure = detectWorksheetStructure(await loadFixture(fixtures.original.path));
    const result = finalizeWorksheetDetection(structure, []);

    expect(result.problemDrafts.length).toBeGreaterThan(0);
    expect(result.debug.fallbackUsed).toBe(true);
    expect(result.debug.failureReason).toBeNull();
  });

  it("keeps anchor proposals across common rendering variants", async () => {
    const source = readFileSync(path.join(process.cwd(), fixtures.original.path));
    const variants = [
      sharp(source).resize({ width: 780 }).png().toBuffer(),
      sharp(source).resize({ width: 1620 }).png().toBuffer(),
      sharp(source).linear(0.68, 42).png().toBuffer(),
      sharp(source).jpeg({ quality: 38 }).toBuffer(),
      sharp(source).extend({ top: 80, bottom: 40, left: 60, right: 20, background: "white" }).png().toBuffer(),
      sharp(source).rotate(3, { background: "white" }).png().toBuffer(),
      sharp(source).rotate(-3, { background: "white" }).png().toBuffer(),
    ];

    for (const variant of variants) {
      const structure = detectWorksheetStructure(await decodeImage(await variant));
      expect(structure.proposals.filter((proposal) => proposal.score >= 0.78).length)
        .toBeGreaterThanOrEqual(4);
    }
  });

  it("returns a reviewable empty state for blank input", () => {
    const structure = detectWorksheetStructure(makeBlankImage(800, 1000));
    const result = finalizeWorksheetDetection(structure, []);

    expect(result.problemDrafts).toHaveLength(0);
    expect(result.debug.failureReason).toContain("No worksheet content");
    expect(result.debug.rows).toEqual([]);
  });
});

function annotation(label: string, left: number, top: number, tolerance = 34): Annotation {
  return { label, left, top, tolerance };
}

function pairedAnnotations(
  startLabel: number,
  endLabel: number,
  tops: number[],
  lefts: [number, number],
) {
  const annotations: Annotation[] = [];
  let label = startLabel;
  for (const top of tops) {
    for (const left of lefts) {
      if (label >= endLabel) {
        return annotations;
      }
      annotations.push(annotation(String(label), left, top));
      label += 1;
    }
  }
  return annotations;
}

function recognizeAnnotations(structure: Structure, annotations: readonly Annotation[]) {
  const available = new Map(structure.proposals.map((proposal) => [proposal.id, proposal]));
  const recognitions: AnchorRecognition[] = [];

  for (const item of annotations) {
    const nearest = [...available.values()]
      .map((proposal) => ({
        proposal,
        distance: Math.hypot(proposal.rect.left - item.left, proposal.rect.top - item.top),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    expect(nearest, `missing proposal for ${item.label} at ${item.left},${item.top}`).toBeDefined();
    expect(nearest.distance, `proposal drift for ${item.label} at ${item.left},${item.top}`)
      .toBeLessThanOrEqual(item.tolerance ?? 34);
    available.delete(nearest.proposal.id);
    recognitions.push({
      proposalId: nearest.proposal.id,
      sourceLabel: item.label,
      confidence: 0.96,
    });
  }

  return recognitions;
}

function noisyRecognition(
  structure: Structure,
  used: Set<string>,
  sourceLabel: string,
  left: number,
  top: number,
  confidence: number,
) {
  const nearest = structure.proposals
    .filter((proposal) => !used.has(proposal.id))
    .map((proposal) => ({
      proposal,
      distance: Math.hypot(proposal.rect.left - left, proposal.rect.top - top),
    }))
    .sort((a, b) => a.distance - b.distance)[0];
  expect(nearest.distance).toBeLessThanOrEqual(10);
  used.add(nearest.proposal.id);
  return {
    proposalId: nearest.proposal.id,
    sourceLabel,
    confidence,
  } satisfies AnchorRecognition;
}

async function loadFixture(relativePath: string) {
  return decodeImage(readFileSync(path.join(process.cwd(), relativePath)));
}

async function decodeImage(buffer: Buffer | Uint8Array): Promise<FixtureInput> {
  const decoded = await sharp(buffer)
    .flatten({ background: "white" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const grayscale = new Uint8Array(decoded.info.width * decoded.info.height);

  for (let offset = 0, pixel = 0; offset < decoded.data.length; offset += 4, pixel += 1) {
    grayscale[pixel] = Math.round(
      decoded.data[offset] * 0.299 +
        decoded.data[offset + 1] * 0.587 +
        decoded.data[offset + 2] * 0.114,
    );
  }
  return {
    grayscale,
    height: decoded.info.height,
    rgba: decoded.data,
    width: decoded.info.width,
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

function contains(rect: Rect, left: number, top: number) {
  return (
    left >= rect.left &&
    left <= rect.left + rect.width &&
    top >= rect.top &&
    top <= rect.top + rect.height
  );
}

function center(rect: Rect) {
  return {
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2,
  };
}

function overlapArea(left: Rect, right: Rect) {
  const width = Math.max(
    0,
    Math.min(left.left + left.width, right.left + right.width) - Math.max(left.left, right.left),
  );
  const height = Math.max(
    0,
    Math.min(left.top + left.height, right.top + right.height) - Math.max(left.top, right.top),
  );
  return width * height;
}
