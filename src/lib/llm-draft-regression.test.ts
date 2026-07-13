import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  detectWorksheetStructure,
  finalizeWorksheetDetection,
} from "@/lib/detection";
import type { AnchorRecognition, Rect } from "@/lib/types";

type DraftProblem = {
  sourceLabel: string;
  anchorBox: Rect;
};

type DraftAnnotation = {
  sourceImage: string;
  sourceMappedAnnotation: {
    problems: DraftProblem[];
  };
};

const draftDir = path.join(process.cwd(), ".worksheet-data", "llm-annotations");
const strictDraftComparison = process.env.LLM_DRAFT_STRICT === "1";
const draftFiles = existsSync(draftDir)
  ? readdirSync(draftDir)
      .filter((file) => file.endsWith(".claude-draft.json"))
      .map((file) => path.join(draftDir, file))
  : [];

describe.skipIf(draftFiles.length === 0)("Claude draft detector comparison", () => {
  for (const draftFile of draftFiles) {
    const draft = JSON.parse(readFileSync(draftFile, "utf8")) as DraftAnnotation;
    const name = path.basename(draftFile).replace(".claude-draft.json", "");

    it(`keeps detector proposals near Claude draft anchors for ${name}`, async () => {
      const input = await loadImage(draft.sourceImage);
      const structure = detectWorksheetStructure(input);
      const recognitions = recognizeDraftAnchors(structure, draft.sourceMappedAnnotation.problems);
      const result = finalizeWorksheetDetection(structure, recognitions);
      const normalizedDraftLabels = draft.sourceMappedAnnotation.problems
        .map((problem) => normalizeDraftLabel(problem.sourceLabel))
        .filter((label): label is string => Boolean(label));
      const minimumRecognitions = Math.ceil(normalizedDraftLabels.length * 0.7);
      const minimumDrafts = Math.ceil(normalizedDraftLabels.length * 0.65);

      if (strictDraftComparison) {
        expect(recognitions.length).toBeGreaterThanOrEqual(minimumRecognitions);
        expect(result.problemDrafts.length).toBeGreaterThanOrEqual(minimumDrafts);
      } else if (
        recognitions.length < minimumRecognitions ||
        result.problemDrafts.length < minimumDrafts
      ) {
        console.warn(
          [
            `${name}: detector is below Claude-draft coverage target`,
            `recognized ${recognitions.length}/${normalizedDraftLabels.length}`,
            `drafts ${result.problemDrafts.length}/${normalizedDraftLabels.length}`,
          ].join("; "),
        );
      }
      expect(result.debug.failureReason).toBeNull();
    });
  }
});

async function loadImage(relativePath: string) {
  const decoded = await sharp(readFileSync(path.join(process.cwd(), relativePath)))
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

function recognizeDraftAnchors(
  structure: ReturnType<typeof detectWorksheetStructure>,
  problems: DraftProblem[],
) {
  const available = new Map(structure.proposals.map((proposal) => [proposal.id, proposal]));
  const recognitions: AnchorRecognition[] = [];

  for (const problem of problems) {
    const label = normalizeDraftLabel(problem.sourceLabel);
    if (!label) {
      continue;
    }
    const target = rectCenter(problem.anchorBox);
    const nearest = [...available.values()]
      .map((proposal) => ({
        proposal,
        distance: Math.hypot(
          rectCenter(proposal.rect).left - target.left,
          rectCenter(proposal.rect).top - target.top,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    const tolerance = Math.max(48, problem.anchorBox.width * 2.5, problem.anchorBox.height * 2.5);
    if (!nearest || nearest.distance > tolerance) {
      continue;
    }
    available.delete(nearest.proposal.id);
    recognitions.push({
      proposalId: nearest.proposal.id,
      sourceLabel: label,
      confidence: 0.9,
    });
  }

  return recognitions;
}

function normalizeDraftLabel(label: string) {
  const match = label.match(/\d{1,3}/);
  return match ? String(Number(match[0])) : null;
}

function rectCenter(rect: Rect) {
  return {
    left: rect.left + rect.width / 2,
    top: rect.top + rect.height / 2,
  };
}
