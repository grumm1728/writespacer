import type { AnchorRecognition, Rect } from "@/lib/types";
import type {
  WorksheetDetectionStructure,
  finalizeWorksheetDetection,
} from "@/lib/detection";
import {
  REVIEWED_FIXTURE_FIELDS,
  type ReviewedFixture,
  type ReviewedFixtureField,
} from "./reviewed-fixture-manifest.ts";

type DetectionDraft = ReturnType<typeof finalizeWorksheetDetection>;

export type ReviewedRecognitionResult = {
  recognitions: AnchorRecognition[];
  failures: string[];
};

export function missingReviewedFields(fixture: ReviewedFixture): ReviewedFixtureField[] {
  if (fixture.reviewedFields === undefined) {
    return [];
  }
  const reviewed = new Set(fixture.reviewedFields);
  return REVIEWED_FIXTURE_FIELDS.filter((field) => !reviewed.has(field));
}

export function recognizeReviewedAnchors(
  structure: WorksheetDetectionStructure,
  fixture: ReviewedFixture,
): ReviewedRecognitionResult {
  const available = new Map(structure.proposals.map((proposal) => [proposal.id, proposal]));
  const recognitions: AnchorRecognition[] = [];
  const failures: string[] = [];

  for (const problem of fixture.problems) {
    const nearest = [...available.values()]
      .map((proposal) => ({
        proposal,
        distance: Math.hypot(
          proposal.rect.left - problem.anchorRect.left,
          proposal.rect.top - problem.anchorRect.top,
        ),
      }))
      .sort((left, right) => left.distance - right.distance)[0];
    if (!nearest) {
      failures.push(`missing proposal for ${problem.id}`);
      continue;
    }
    if (nearest.distance > problem.allowedPadding) {
      failures.push(
        `proposal drift for ${problem.id}: ${nearest.distance.toFixed(2)} > ${problem.allowedPadding}`,
      );
      continue;
    }
    if (problem.sourceLabel === null) {
      failures.push(`reviewed anchor ${problem.id} has no injectable source label`);
      continue;
    }
    available.delete(nearest.proposal.id);
    recognitions.push({
      proposalId: nearest.proposal.id,
      sourceLabel: problem.sourceLabel,
      confidence: 0.96,
    });
  }

  return { recognitions, failures };
}

export function evaluateReviewedDetection(
  fixture: ReviewedFixture,
  result: DetectionDraft,
): string[] {
  const failures: string[] = [];
  const reviewedFields = new Set(
    fixture.reviewedFields ?? REVIEWED_FIXTURE_FIELDS,
  );

  if (reviewedFields.has("expectedOutcome")) {
    if (fixture.expectedOutcome === "detected" && result.debug.failureReason !== null) {
      failures.push(`expected detected outcome; got ${result.debug.failureReason}`);
    }
    if (fixture.expectedOutcome === "detected" && result.debug.fallbackUsed) {
      failures.push("expected detected outcome; geometric fallback was used");
    }
    if (fixture.expectedOutcome === "fallback" && !result.debug.fallbackUsed) {
      failures.push("expected geometric fallback; fallback was not used");
    }
    if (fixture.expectedOutcome === "blank" && result.problemDrafts.length > 0) {
      failures.push(`expected blank outcome; got ${result.problemDrafts.length} problems`);
    }
    if (fixture.expectedOutcome === "unusable" && result.debug.failureReason === null) {
      failures.push("expected unusable outcome; no failure reason was returned");
    }
  }

  if (reviewedFields.has("problemOrder") && result.problemDrafts.length !== fixture.problems.length) {
    failures.push(
      `problem count mismatch: expected ${fixture.problems.length}, got ${result.problemDrafts.length}`,
    );
  }

  if (reviewedFields.has("sourceLabels")) {
    const expected = fixture.problems.map((problem) => problem.sourceLabel);
    const actual = result.problemDrafts.map((draft) => draft.sourceLabel);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      failures.push(
        `source label mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
      );
    }
  }

  if (reviewedFields.has("anchorRects")) {
    fixture.problems.forEach((problem, index) => {
      const draft = result.problemDrafts[index];
      if (draft && !contains(draft.unionBounds, problem.anchorRect.left, problem.anchorRect.top)) {
        failures.push(`problem ${problem.id} does not contain its reviewed anchor`);
      }
    });
  }

  if (reviewedFields.has("sectionHeaders")) {
    if (result.sectionHeaders.length !== fixture.sectionHeaders.length) {
      failures.push(
        `section header count mismatch: expected ${fixture.sectionHeaders.length}, got ${result.sectionHeaders.length}`,
      );
    }
  }

  return failures;
}

function contains(rect: Rect, left: number, top: number): boolean {
  return (
    left >= rect.left &&
    left <= rect.left + rect.width &&
    top >= rect.top &&
    top <= rect.top + rect.height
  );
}
