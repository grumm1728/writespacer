#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

import {
  detectWorksheetStructure,
  finalizeWorksheetDetection,
} from "../src/lib/detection.ts";
import {
  evaluateReviewedDetection,
  missingReviewedFields,
  recognizeReviewedAnchors,
} from "../src/lib/reviewed-fixture-evaluation.ts";
import { parseReviewedFixtureManifest } from "../src/lib/reviewed-fixture-manifest.ts";

const DEFAULT_MANIFEST = "public/fixtures/reviewed-fixture-manifest.json";
const DEFAULT_OUTPUT = ".worksheet-data/reviewed-fixture-report.json";

async function main(): Promise<void> {
  const manifestPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_MANIFEST);
  const outputPath = path.resolve(process.cwd(), process.argv[3] ?? DEFAULT_OUTPUT);
  const parsed = parseReviewedFixtureManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (!parsed.ok) {
    throw new Error(
      `Invalid reviewed fixture manifest:\n${parsed.errors
        .map((error) => `${error.code} ${error.path}: ${error.message}`)
        .join("\n")}`,
    );
  }

  const fixtureReports = [];
  for (const fixture of parsed.manifest.fixtures) {
    const input = await decodeImage(
      await readFile(path.resolve(process.cwd(), fixture.sourcePath)),
    );
    const goldDataErrors: string[] = [];
    if (input.width !== fixture.page.width || input.height !== fixture.page.height) {
      goldDataErrors.push(
        `source dimensions are ${input.width} x ${input.height}; manifest records ${fixture.page.width} x ${fixture.page.height}`,
      );
    }

    const structure = detectWorksheetStructure(input);
    const observation = recognizeReviewedAnchors(structure, fixture);
    const result = finalizeWorksheetDetection(structure, observation.recognitions);
    const detectorFailures = [
      ...observation.failures,
      ...evaluateReviewedDetection(fixture, result),
    ];
    const incompleteGoldFields = missingReviewedFields(fixture);
    const status = detectorFailures.length > 0
      ? "detector-failure"
      : goldDataErrors.length > 0
        ? "gold-data-error"
        : incompleteGoldFields.length > 0
          ? "incomplete-gold"
          : "pass";

    fixtureReports.push({
      id: fixture.id,
      sourcePath: fixture.sourcePath,
      supportClass: fixture.supportClass,
      familyTags: fixture.familyTags,
      status,
      reviewedProblemCount: fixture.problems.length,
      detectedProblemCount: result.problemDrafts.length,
      incompleteGoldFields,
      goldDataErrors,
      detectorFailures,
    });
  }

  const report = {
    schemaVersion: 1,
    manifestPath: path.relative(process.cwd(), manifestPath).replaceAll("\\", "/"),
    summary: {
      fixtures: fixtureReports.length,
      pass: fixtureReports.filter((fixture) => fixture.status === "pass").length,
      incompleteGold: fixtureReports.filter(
        (fixture) => fixture.status === "incomplete-gold",
      ).length,
      goldDataErrors: fixtureReports.filter(
        (fixture) => fixture.status === "gold-data-error",
      ).length,
      detectorFailures: fixtureReports.filter(
        (fixture) => fixture.status === "detector-failure",
      ).length,
    },
    fixtures: fixtureReports,
  };

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.table(
    fixtureReports.map((fixture) => ({
      fixture: fixture.id,
      status: fixture.status,
      reviewed: fixture.reviewedProblemCount,
      detected: fixture.detectedProblemCount,
      incompleteGold: fixture.incompleteGoldFields.join(", ") || "-",
      detectorFailures: fixture.detectorFailures.length,
    })),
  );
  console.log(
    `Machine-readable report: ${path.relative(process.cwd(), outputPath)}`,
  );
}

async function decodeImage(buffer: Buffer) {
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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
