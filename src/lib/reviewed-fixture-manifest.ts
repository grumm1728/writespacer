import type { Rect } from "@/lib/types";

export const REVIEWED_FIXTURE_SCHEMA_VERSION = 1 as const;

export type FixtureSupportClass = "supported" | "unsupported" | "deferred";

export type FixtureOrientation = "portrait" | "landscape" | "square";

export type FixtureExpectedOutcome = "detected" | "fallback" | "blank" | "unusable";

export type ReviewedFixtureProblem = {
  id: string;
  sourceLabel: string | null;
  anchorRect: Rect;
  promptRects: Rect[];
  diagramAttachments: Rect[];
  sectionHeaderIds: string[];
  allowedPadding: number;
};

export type ReviewedFixtureSectionHeader = {
  id: string;
  rect: Rect;
  problemIds: string[];
};

export type ReviewedFixture = {
  id: string;
  sourcePath: string;
  supportClass: FixtureSupportClass;
  familyTags: string[];
  page: {
    width: number;
    height: number;
    orientation: FixtureOrientation;
  };
  review: {
    reviewer: string;
    reviewedAt: string;
  };
  problems: ReviewedFixtureProblem[];
  sectionHeaders: ReviewedFixtureSectionHeader[];
  expectedOutcome: FixtureExpectedOutcome;
  uncertaintyNotes: string[];
};

export type ReviewedFixtureManifest = {
  schemaVersion: typeof REVIEWED_FIXTURE_SCHEMA_VERSION;
  fixtures: ReviewedFixture[];
};

export type ManifestValidationError = {
  code: string;
  path: string;
  message: string;
};

export type ReviewedFixtureManifestParseResult =
  | { ok: true; manifest: ReviewedFixtureManifest }
  | { ok: false; errors: ManifestValidationError[] };

export function parseReviewedFixtureManifest(
  input: unknown,
): ReviewedFixtureManifestParseResult {
  if (!isRecord(input)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_manifest",
          path: "$",
          message: "Manifest must be an object.",
        },
      ],
    };
  }

  if (input.schemaVersion !== REVIEWED_FIXTURE_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        {
          code: "unsupported_schema_version",
          path: "schemaVersion",
          message: `Unsupported schema version ${String(input.schemaVersion)}; expected ${REVIEWED_FIXTURE_SCHEMA_VERSION}.`,
        },
      ],
    };
  }

  if (!Array.isArray(input.fixtures)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_manifest",
          path: "fixtures",
          message: "Fixtures must be an array.",
        },
      ],
    };
  }

  const errors: ManifestValidationError[] = [];
  const fixtures = input.fixtures;
  const fixtureIds = new Map<string, number>();
  fixtures.forEach((fixture, fixtureIndex) => {
    const fixtureRecord = isRecord(fixture) ? fixture : {};
    const fixtureId = fixtureRecord.id;
    if (!isNonEmptyString(fixtureId)) {
      errors.push({
        code: "required_field",
        path: `fixtures[${fixtureIndex}].id`,
        message: "Fixture identifier is required.",
      });
    }
    if (isNonEmptyString(fixtureId)) {
      const priorIndex = fixtureIds.get(fixtureId);
      if (priorIndex === undefined) {
        fixtureIds.set(fixtureId, fixtureIndex);
      } else {
        errors.push({
          code: "duplicate_identifier",
          path: `fixtures[${fixtureIndex}].id`,
          message: `Fixture identifier "${fixtureId}" is already used by fixtures[${priorIndex}].id.`,
        });
      }
    }

    if (!isNonEmptyString(fixtureRecord.sourcePath)) {
      errors.push({
        code: "required_field",
        path: `fixtures[${fixtureIndex}].sourcePath`,
        message: "Fixture source path is required.",
      });
    }
    if (!isFixtureSupportClass(fixtureRecord.supportClass)) {
      errors.push({
        code: "invalid_support_class",
        path: `fixtures[${fixtureIndex}].supportClass`,
        message: "Support class must be supported, unsupported, or deferred.",
      });
    }
    if (!isNonEmptyStringArray(fixtureRecord.familyTags)) {
      errors.push({
        code: "invalid_family_tags",
        path: `fixtures[${fixtureIndex}].familyTags`,
        message: "At least one non-empty fixture family tag is required.",
      });
    }
    if (!isFixturePage(fixtureRecord.page)) {
      errors.push({
        code: "invalid_page",
        path: `fixtures[${fixtureIndex}].page`,
        message:
          "Page must have positive finite dimensions and portrait, landscape, or square orientation.",
      });
    }

    const review = isRecord(fixtureRecord.review) ? fixtureRecord.review : {};
    if (!isNonEmptyString(review.reviewer)) {
      errors.push({
        code: "required_review_metadata",
        path: `fixtures[${fixtureIndex}].review.reviewer`,
        message: "Reviewer identity is required.",
      });
    }
    if (!isReviewDate(review.reviewedAt)) {
      errors.push({
        code: "required_review_metadata",
        path: `fixtures[${fixtureIndex}].review.reviewedAt`,
        message: "Review date is required in YYYY-MM-DD format.",
      });
    }

    if (!Array.isArray(fixtureRecord.problems)) {
      errors.push({
        code: "invalid_problem_list",
        path: `fixtures[${fixtureIndex}].problems`,
        message: "Problems must be an ordered array.",
      });
    }
    if (!Array.isArray(fixtureRecord.sectionHeaders)) {
      errors.push({
        code: "invalid_section_header_list",
        path: `fixtures[${fixtureIndex}].sectionHeaders`,
        message: "Section headers must be an array.",
      });
    }
    if (!isFixtureExpectedOutcome(fixtureRecord.expectedOutcome)) {
      errors.push({
        code: "invalid_expected_outcome",
        path: `fixtures[${fixtureIndex}].expectedOutcome`,
        message: "Expected outcome must be detected, fallback, blank, or unusable.",
      });
    }
    if (!isStringArray(fixtureRecord.uncertaintyNotes)) {
      errors.push({
        code: "invalid_uncertainty_notes",
        path: `fixtures[${fixtureIndex}].uncertaintyNotes`,
        message: "Uncertainty notes must be an array of strings.",
      });
    }

    if (isRecord(fixture)) {
      const page = isRecord(fixture.page) ? fixture.page : {};
      const reviewItemIds = new Map<string, string>();
      const itemCollections = [
        ["problems", fixture.problems],
        ["sectionHeaders", fixture.sectionHeaders],
      ] as const;

      itemCollections.forEach(([collectionName, items]) => {
        if (!Array.isArray(items)) {
          return;
        }
        items.forEach((item, itemIndex) => {
          const itemId = isRecord(item) ? item.id : undefined;
          if (!isNonEmptyString(itemId)) {
            return;
          }
          const itemPath = `fixtures[${fixtureIndex}].${collectionName}[${itemIndex}].id`;
          const priorPath = reviewItemIds.get(itemId);
          if (priorPath === undefined) {
            reviewItemIds.set(itemId, itemPath);
          } else {
            errors.push({
              code: "duplicate_identifier",
              path: itemPath,
              message: `Review item identifier "${itemId}" is already used by ${priorPath}.`,
            });
          }
        });
      });

      if (Array.isArray(fixture.problems)) {
        fixture.problems.forEach((problem, problemIndex) => {
          if (!isRecord(problem)) {
            errors.push({
              code: "invalid_problem",
              path: `fixtures[${fixtureIndex}].problems[${problemIndex}]`,
              message: "Problem must be an object.",
            });
            return;
          }
          const problemPath = `fixtures[${fixtureIndex}].problems[${problemIndex}]`;
          if (!isNonEmptyString(problem.id)) {
            errors.push({
              code: "required_field",
              path: `${problemPath}.id`,
              message: "Problem identifier is required.",
            });
          }
          if (problem.sourceLabel !== null && typeof problem.sourceLabel !== "string") {
            errors.push({
              code: "invalid_source_label",
              path: `${problemPath}.sourceLabel`,
              message: "Source label must be a string or null.",
            });
          }
          validateFixtureRect(
            problem.anchorRect,
            `${problemPath}.anchorRect`,
            page,
            errors,
          );
          if (!Array.isArray(problem.promptRects) || problem.promptRects.length === 0) {
            errors.push({
              code: "invalid_prompt_rects",
              path: `${problemPath}.promptRects`,
              message: "At least one prompt rectangle is required.",
            });
          }
          validateFixtureRectList(
            problem.promptRects,
            `${problemPath}.promptRects`,
            page,
            errors,
          );
          if (!Array.isArray(problem.diagramAttachments)) {
            errors.push({
              code: "invalid_diagram_attachments",
              path: `${problemPath}.diagramAttachments`,
              message: "Diagram attachments must be an array of rectangles.",
            });
          }
          validateFixtureRectList(
            problem.diagramAttachments,
            `${problemPath}.diagramAttachments`,
            page,
            errors,
          );
          if (!isIdentifierArray(problem.sectionHeaderIds)) {
            errors.push({
              code: "invalid_header_associations",
              path: `${problemPath}.sectionHeaderIds`,
              message: "Section header associations must be an array of identifiers.",
            });
          }
          if (!isFiniteNumber(problem.allowedPadding) || problem.allowedPadding < 0) {
            errors.push({
              code: "invalid_allowed_padding",
              path: `${problemPath}.allowedPadding`,
              message: "Allowed padding must be a finite non-negative number.",
            });
          }
        });
      }

      if (Array.isArray(fixture.sectionHeaders)) {
        fixture.sectionHeaders.forEach((header, headerIndex) => {
          const headerPath = `fixtures[${fixtureIndex}].sectionHeaders[${headerIndex}]`;
          if (!isRecord(header)) {
            errors.push({
              code: "invalid_section_header",
              path: headerPath,
              message: "Section header must be an object.",
            });
            return;
          }
          if (!isNonEmptyString(header.id)) {
            errors.push({
              code: "required_field",
              path: `${headerPath}.id`,
              message: "Section header identifier is required.",
            });
          }
          validateFixtureRect(
            header.rect,
            `${headerPath}.rect`,
            page,
            errors,
          );
          if (!isIdentifierArray(header.problemIds)) {
            errors.push({
              code: "invalid_problem_associations",
              path: `${headerPath}.problemIds`,
              message: "Problem associations must be an array of identifiers.",
            });
          }
        });
      }

      const problemIds = collectIdentifiers(fixture.problems);
      const headerIds = collectIdentifiers(fixture.sectionHeaders);
      if (Array.isArray(fixture.problems)) {
        fixture.problems.forEach((problem, problemIndex) => {
          if (!isRecord(problem) || !isIdentifierArray(problem.sectionHeaderIds)) {
            return;
          }
          problem.sectionHeaderIds.forEach((headerId, associationIndex) => {
            if (!headerIds.has(headerId)) {
              errors.push({
                code: "unknown_reference",
                path: `fixtures[${fixtureIndex}].problems[${problemIndex}].sectionHeaderIds[${associationIndex}]`,
                message: `Section header identifier "${headerId}" does not exist in this fixture.`,
              });
            }
          });
        });
      }
      if (Array.isArray(fixture.sectionHeaders)) {
        fixture.sectionHeaders.forEach((header, headerIndex) => {
          if (!isRecord(header) || !isIdentifierArray(header.problemIds)) {
            return;
          }
          header.problemIds.forEach((problemId, associationIndex) => {
            if (!problemIds.has(problemId)) {
              errors.push({
                code: "unknown_reference",
                path: `fixtures[${fixtureIndex}].sectionHeaders[${headerIndex}].problemIds[${associationIndex}]`,
                message: `Problem identifier "${problemId}" does not exist in this fixture.`,
              });
            }
          });
        });
      }
    }
  });

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    manifest: input as ReviewedFixtureManifest,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isReviewDate(value: unknown): value is string {
  return isNonEmptyString(value) && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isFixtureSupportClass(value: unknown): value is FixtureSupportClass {
  return value === "supported" || value === "unsupported" || value === "deferred";
}

function isFixtureExpectedOutcome(value: unknown): value is FixtureExpectedOutcome {
  return value === "detected" || value === "fallback" || value === "blank" || value === "unusable";
}

function isFixturePage(value: unknown): value is ReviewedFixture["page"] {
  return (
    isRecord(value) &&
    isFiniteNumber(value.width) &&
    value.width > 0 &&
    isFiniteNumber(value.height) &&
    value.height > 0 &&
    (value.orientation === "portrait" ||
      value.orientation === "landscape" ||
      value.orientation === "square")
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonEmptyStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString);
}

function isIdentifierArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isNonEmptyString);
}

function collectIdentifiers(value: unknown): Set<string> {
  if (!Array.isArray(value)) {
    return new Set();
  }
  return new Set(
    value.flatMap((item) =>
      isRecord(item) && isNonEmptyString(item.id) ? [item.id] : [],
    ),
  );
}

function validateFixtureRectList(
  value: unknown,
  path: string,
  page: Record<string, unknown>,
  errors: ManifestValidationError[],
): void {
  if (!Array.isArray(value)) {
    return;
  }
  value.forEach((rect, index) =>
    validateFixtureRect(rect, `${path}[${index}]`, page, errors),
  );
}

function validateFixtureRect(
  value: unknown,
  path: string,
  page: Record<string, unknown>,
  errors: ManifestValidationError[],
): void {
  if (
    !isRecord(value) ||
    !isFiniteNumber(value.left) ||
    !isFiniteNumber(value.top) ||
    !isFiniteNumber(value.width) ||
    !isFiniteNumber(value.height) ||
    value.left < 0 ||
    value.top < 0 ||
    value.width <= 0 ||
    value.height <= 0
  ) {
    errors.push({
      code: "invalid_rectangle",
      path,
      message: "Rectangle must have finite non-negative left/top and positive width/height.",
    });
    return;
  }

  if (
    isFiniteNumber(page.width) &&
    isFiniteNumber(page.height) &&
    (value.left + value.width > page.width || value.top + value.height > page.height)
  ) {
    errors.push({
      code: "rectangle_out_of_bounds",
      path,
      message: `Rectangle must fit within the ${page.width} x ${page.height} source page.`,
    });
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
