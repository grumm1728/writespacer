#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_ANNOTATIONS = "public/fixtures/reviewed-fixture-manifest.json";

async function main() {
  const annotationsPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_ANNOTATIONS);
  const annotations = JSON.parse(await readFile(annotationsPath, "utf8"));
  const fixtures = annotations.fixtures ?? [];
  if (fixtures.length === 0) {
    throw new Error(`No fixtures found in ${path.relative(process.cwd(), annotationsPath)}`);
  }

  const summary = fixtures.map((fixture) => ({
    name: fixture.id,
    path: fixture.sourcePath,
    problems: fixture.problems.length,
    reviewedFields: fixture.reviewedFields?.join(", ") ?? "all",
    labels: fixture.problems.map((problem) => problem.sourceLabel).join(", "),
  }));

  console.table(summary);
  console.log(
    [
      "These annotations are the reviewed detector-test oracle.",
      "Run npm.cmd run report:detector-fixtures for detector and gold-coverage results.",
      "Raw Claude drafts should stay in .worksheet-data until reviewed.",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
