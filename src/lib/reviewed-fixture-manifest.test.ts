import { describe, expect, it } from "vitest";

import { parseReviewedFixtureManifest } from "@/lib/reviewed-fixture-manifest";

describe("reviewed fixture manifest", () => {
  it("rejects a non-object manifest with an actionable error", () => {
    expect(parseReviewedFixtureManifest(null)).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_manifest",
          path: "$",
          message: "Manifest must be an object.",
        },
      ],
    });
  });

  it("returns a typed fixture for a valid reviewed manifest", () => {
    const input = validManifest();

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: true,
      manifest: input,
    });
  });

  it("rejects unsupported schema versions with an actionable error", () => {
    const input = { ...validManifest(), schemaVersion: 2 };

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "unsupported_schema_version",
          path: "schemaVersion",
          message: "Unsupported schema version 2; expected 1.",
        },
      ],
    });
  });

  it("requires a fixture list before returning typed data", () => {
    expect(parseReviewedFixtureManifest({ schemaVersion: 1 })).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_manifest",
          path: "fixtures",
          message: "Fixtures must be an array.",
        },
      ],
    });
  });

  it("reports actionable paths for an incomplete fixture contract", () => {
    expect(
      parseReviewedFixtureManifest({ schemaVersion: 1, fixtures: [{}] }),
    ).toEqual({
      ok: false,
      errors: [
        {
          code: "required_field",
          path: "fixtures[0].id",
          message: "Fixture identifier is required.",
        },
        {
          code: "required_field",
          path: "fixtures[0].sourcePath",
          message: "Fixture source path is required.",
        },
        {
          code: "invalid_support_class",
          path: "fixtures[0].supportClass",
          message: "Support class must be supported, unsupported, or deferred.",
        },
        {
          code: "invalid_family_tags",
          path: "fixtures[0].familyTags",
          message: "At least one non-empty fixture family tag is required.",
        },
        {
          code: "invalid_page",
          path: "fixtures[0].page",
          message:
            "Page must have positive finite dimensions and portrait, landscape, or square orientation.",
        },
        {
          code: "required_review_metadata",
          path: "fixtures[0].review.reviewer",
          message: "Reviewer identity is required.",
        },
        {
          code: "required_review_metadata",
          path: "fixtures[0].review.reviewedAt",
          message: "Review date is required in YYYY-MM-DD format.",
        },
        {
          code: "invalid_problem_list",
          path: "fixtures[0].problems",
          message: "Problems must be an ordered array.",
        },
        {
          code: "invalid_section_header_list",
          path: "fixtures[0].sectionHeaders",
          message: "Section headers must be an array.",
        },
        {
          code: "invalid_expected_outcome",
          path: "fixtures[0].expectedOutcome",
          message: "Expected outcome must be detected, fallback, blank, or unusable.",
        },
        {
          code: "invalid_uncertainty_notes",
          path: "fixtures[0].uncertaintyNotes",
          message: "Uncertainty notes must be an array of strings.",
        },
      ],
    });
  });

  it("reports actionable paths for an incomplete problem contract", () => {
    const input = validManifest();
    input.fixtures[0].problems[0] = {} as (typeof input.fixtures)[number]["problems"][number];

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "required_field",
          path: "fixtures[0].problems[0].id",
          message: "Problem identifier is required.",
        },
        {
          code: "invalid_source_label",
          path: "fixtures[0].problems[0].sourceLabel",
          message: "Source label must be a string or null.",
        },
        {
          code: "invalid_rectangle",
          path: "fixtures[0].problems[0].anchorRect",
          message:
            "Rectangle must have finite non-negative left/top and positive width/height.",
        },
        {
          code: "invalid_prompt_rects",
          path: "fixtures[0].problems[0].promptRects",
          message: "At least one prompt rectangle is required.",
        },
        {
          code: "invalid_diagram_attachments",
          path: "fixtures[0].problems[0].diagramAttachments",
          message: "Diagram attachments must be an array of rectangles.",
        },
        {
          code: "invalid_header_associations",
          path: "fixtures[0].problems[0].sectionHeaderIds",
          message: "Section header associations must be an array of identifiers.",
        },
        {
          code: "invalid_allowed_padding",
          path: "fixtures[0].problems[0].allowedPadding",
          message: "Allowed padding must be a finite non-negative number.",
        },
      ],
    });
  });

  it("reports actionable paths for an incomplete section header contract", () => {
    const input = validManifest();
    input.fixtures[0].sectionHeaders = [
      {} as (typeof input.fixtures)[number]["sectionHeaders"][number],
    ];

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "required_field",
          path: "fixtures[0].sectionHeaders[0].id",
          message: "Section header identifier is required.",
        },
        {
          code: "invalid_rectangle",
          path: "fixtures[0].sectionHeaders[0].rect",
          message:
            "Rectangle must have finite non-negative left/top and positive width/height.",
        },
        {
          code: "invalid_problem_associations",
          path: "fixtures[0].sectionHeaders[0].problemIds",
          message: "Problem associations must be an array of identifiers.",
        },
      ],
    });
  });

  it("rejects header associations that reference unknown review items", () => {
    const input = validManifest();
    input.fixtures[0].problems[0].sectionHeaderIds = ["missing-header"];
    input.fixtures[0].sectionHeaders = [
      {
        id: "header-1",
        rect: { left: 40, top: 20, width: 500, height: 30 },
        problemIds: ["missing-problem"],
      },
    ];

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "unknown_reference",
          path: "fixtures[0].problems[0].sectionHeaderIds[0]",
          message: 'Section header identifier "missing-header" does not exist in this fixture.',
        },
        {
          code: "unknown_reference",
          path: "fixtures[0].sectionHeaders[0].problemIds[0]",
          message: 'Problem identifier "missing-problem" does not exist in this fixture.',
        },
      ],
    });
  });

  it("rejects non-object problem and section header entries", () => {
    const input = validManifest();
    (input.fixtures[0] as unknown as { problems: unknown[] }).problems = [null];
    (input.fixtures[0] as unknown as { sectionHeaders: unknown[] }).sectionHeaders = [null];

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_problem",
          path: "fixtures[0].problems[0]",
          message: "Problem must be an object.",
        },
        {
          code: "invalid_section_header",
          path: "fixtures[0].sectionHeaders[0]",
          message: "Section header must be an object.",
        },
      ],
    });
  });

  it("requires reviewer identity and review date for every fixture", () => {
    const input = validManifest();
    input.fixtures[0].review = { reviewer: "", reviewedAt: "" };

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "required_review_metadata",
          path: "fixtures[0].review.reviewer",
          message: "Reviewer identity is required.",
        },
        {
          code: "required_review_metadata",
          path: "fixtures[0].review.reviewedAt",
          message: "Review date is required in YYYY-MM-DD format.",
        },
      ],
    });
  });

  it("rejects duplicate fixture identifiers", () => {
    const input = validManifest();
    input.fixtures.push({
      ...structuredClone(input.fixtures[0]),
      sourcePath: "public/fixtures/another-page.png",
    });

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "duplicate_identifier",
          path: "fixtures[1].id",
          message: 'Fixture identifier "simple-portrait" is already used by fixtures[0].id.',
        },
      ],
    });
  });

  it("rejects duplicate review item identifiers within a fixture", () => {
    const input = validManifest();
    input.fixtures[0].sectionHeaders = [
      {
        id: "problem-1",
        rect: { left: 40, top: 20, width: 500, height: 30 },
        problemIds: ["problem-1"],
      },
    ];

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "duplicate_identifier",
          path: "fixtures[0].sectionHeaders[0].id",
          message:
            'Review item identifier "problem-1" is already used by fixtures[0].problems[0].id.',
        },
      ],
    });
  });

  it("rejects rectangles with invalid geometry", () => {
    const input = validManifest();
    input.fixtures[0].problems[0].anchorRect.width = 0;

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "invalid_rectangle",
          path: "fixtures[0].problems[0].anchorRect",
          message:
            "Rectangle must have finite non-negative left/top and positive width/height.",
        },
      ],
    });
  });

  it("rejects rectangles outside the reviewed source page", () => {
    const input = validManifest();
    input.fixtures[0].problems[0].promptRects[0] = {
      left: 1100,
      top: 80,
      width: 200,
      height: 120,
    };

    expect(parseReviewedFixtureManifest(input)).toEqual({
      ok: false,
      errors: [
        {
          code: "rectangle_out_of_bounds",
          path: "fixtures[0].problems[0].promptRects[0]",
          message: "Rectangle must fit within the 1200 x 1600 source page.",
        },
      ],
    });
  });
});

function validManifest() {
  return {
    schemaVersion: 1,
    fixtures: [
      {
        id: "simple-portrait",
        sourcePath: "public/fixtures/sample-input.png",
        supportClass: "supported",
        familyTags: ["simple-portrait"],
        page: {
          width: 1200,
          height: 1600,
          orientation: "portrait",
        },
        review: {
          reviewer: "fixture-team",
          reviewedAt: "2026-08-14",
        },
        problems: [
          {
            id: "problem-1",
            sourceLabel: "1",
            anchorRect: { left: 40, top: 80, width: 30, height: 24 },
            promptRects: [{ left: 40, top: 80, width: 620, height: 120 }],
            diagramAttachments: [],
            sectionHeaderIds: [],
            allowedPadding: 12,
          },
        ],
        sectionHeaders: [],
        expectedOutcome: "detected",
        uncertaintyNotes: [],
      },
    ],
  };
}
