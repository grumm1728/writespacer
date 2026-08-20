import { readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  analyzeWorksheetImage,
  detectWorksheetStructure,
  finalizeWorksheetDetection,
  formatDuplicateSourceLabels,
} from "@/lib/detection";
import {
  createReviewedAnchorRecognizer,
  evaluateReviewedDetection,
  recognizeReviewedAnchors,
} from "@/lib/reviewed-fixture-evaluation";
import {
  parseReviewedFixtureManifest,
  type ReviewedFixture,
} from "@/lib/reviewed-fixture-manifest";
import reviewedFixtureManifest from "../../public/fixtures/reviewed-fixture-manifest.json";
import type { AnchorRecognition, Rect } from "@/lib/types";

type FixtureInput = ReturnType<typeof makeBlankImage>;
type Structure = ReturnType<typeof detectWorksheetStructure>;

const parsedManifest = parseReviewedFixtureManifest(reviewedFixtureManifest);
if (!parsedManifest.ok) {
  throw new Error(JSON.stringify(parsedManifest.errors, null, 2));
}
const fixtures = parsedManifest.manifest.fixtures;

function fixture(id: string): ReviewedFixture {
  const match = fixtures.find((item) => item.id === id);
  if (!match) {
    throw new Error(`Missing reviewed fixture ${id}`);
  }
  return match;
}

function recognizeFixture(structure: Structure, reviewedFixture: ReviewedFixture) {
  const observation = recognizeReviewedAnchors(structure.proposals, reviewedFixture);
  expect(observation.failures).toEqual([]);
  return observation.recognitions;
}

describe("durable worksheet detection", () => {
  for (const reviewedFixture of fixtures) {
    it(`preserves reviewed anchors and labels for ${reviewedFixture.id}`, async () => {
      const input = await loadFixture(reviewedFixture.sourcePath);
      const structure = detectWorksheetStructure(input);
      const observation = recognizeReviewedAnchors(structure.proposals, reviewedFixture);
      expect(observation.failures).toEqual([]);
      const compatibilityResult = finalizeWorksheetDetection(
        structure,
        observation.recognitions,
      );
      const facadeRecognition = createReviewedAnchorRecognizer(reviewedFixture);
      const facadeRecognitionFailures = recognizeReviewedAnchors(
        structure.proposals,
        reviewedFixture,
      ).failures;
      const result = await analyzeWorksheetImage(input, facadeRecognition);

      expect(facadeRecognitionFailures).toEqual([]);
      expect(evaluateReviewedDetection(reviewedFixture, result)).toEqual([]);
      expect(result.problemDrafts).toEqual(compatibilityResult.problemDrafts);
      expect(result.sectionHeaders).toEqual(compatibilityResult.sectionHeaders);
      expect(result.diagnostics).toEqual(compatibilityResult.debug);
      expect(result.failure).toBeNull();
      expect(result.diagnostics.stageCounts.acceptedAnchors).toBe(
        reviewedFixture.problems.length,
      );
      expect(result.diagnostics.normalizationScale).toBeGreaterThan(0);
      expect(result.diagnostics.layoutTracks.length).toBeGreaterThan(0);

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
    const pershan = fixture("pershan");
    const input = await loadFixture(pershan.sourcePath);
    const structure = detectWorksheetStructure(input);
    const result = finalizeWorksheetDetection(
      structure,
      recognizeFixture(structure, pershan),
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
    const pershan = fixture("pershan");
    const input = await loadFixture(pershan.sourcePath);
    const structure = detectWorksheetStructure(input);
    const recognitions = recognizeFixture(structure, pershan)
      .filter((recognition) => recognition.sourceLabel !== "4");
    const result = finalizeWorksheetDetection(structure, recognitions);

    expect(result.problemDrafts.map((draft) => draft.sourceLabel)).toEqual(
      pershan.problems.map((problem) => problem.sourceLabel),
    );
  });

  it("repairs an isolated OCR misread inside an aligned numeric track", async () => {
    const calculus = fixture("calculus");
    const input = await loadFixture(calculus.sourcePath);
    const structure = detectWorksheetStructure(input);
    const recognitions = recognizeFixture(structure, calculus);
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
    const geometry = fixture("geometry");
    const input = await loadFixture(geometry.sourcePath);
    const structure = detectWorksheetStructure(input);
    const result = finalizeWorksheetDetection(
      structure,
      recognizeFixture(structure, geometry),
    );

    expect(result.problemDrafts.map((draft) => draft.sourceLabel).filter((label) => label === "32"))
      .toHaveLength(2);
    expect(formatDuplicateSourceLabels(["32", "32"])).toEqual(["32", "32.1"]);
  });

  it("rejects OCR labels from split strokes beside repeated anchors", async () => {
    const repeated = fixture("repeated-label");
    const input = await loadFixture(repeated.sourcePath);
    const structure = detectWorksheetStructure(input);
    const recognitions = recognizeFixture(structure, repeated);
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
      repeated.problems.map((problem) => problem.sourceLabel),
    );
  });

  it("returns conservative blocks when OCR is unavailable", async () => {
    const structure = detectWorksheetStructure(
      await loadFixture(fixture("original").sourcePath),
    );
    const result = finalizeWorksheetDetection(structure, []);

    expect(result.problemDrafts.length).toBeGreaterThan(0);
    expect(result.debug.fallbackUsed).toBe(true);
    expect(result.debug.failureReason).toBeNull();
  });

  it("keeps anchor proposals across common rendering variants", async () => {
    const source = readFileSync(
      path.join(process.cwd(), fixture("original").sourcePath),
    );
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

  it("returns a recoverable failure and diagnostics for blank input", async () => {
    const result = await analyzeWorksheetImage(
      makeBlankImage(800, 1000),
      async () => [],
    );

    expect(result.problemDrafts).toHaveLength(0);
    expect(result.failure).toEqual({
      reason:
        "No worksheet content could be separated into problem regions. Draw regions manually.",
      recoverable: true,
    });
    expect(result.diagnostics.failureReason).toBe(result.failure?.reason);
    expect(result.diagnostics.rows).toEqual([]);
  });

  it("falls back when the injected recognizer fails", async () => {
    const input = await loadFixture(fixture("original").sourcePath);
    const result = await analyzeWorksheetImage(input, async () => {
      throw new Error("local OCR worker was unavailable");
    });

    expect(result.problemDrafts.length).toBeGreaterThan(0);
    expect(result.diagnostics.fallbackUsed).toBe(true);
    expect(result.failure).toBeNull();
  });
});

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
