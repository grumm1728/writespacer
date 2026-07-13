#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_ANNOTATIONS = "public/fixtures/llm-assisted-annotations.json";

async function main() {
  const annotationsPath = path.resolve(process.cwd(), process.argv[2] ?? DEFAULT_ANNOTATIONS);
  const annotations = JSON.parse(await readFile(annotationsPath, "utf8"));
  const fixtures = annotations.fixtures ?? [];
  if (fixtures.length === 0) {
    throw new Error(`No fixtures found in ${path.relative(process.cwd(), annotationsPath)}`);
  }

  const summary = fixtures.map((fixture) => ({
    name: fixture.name,
    path: fixture.path,
    problems: fixture.problems.length,
    sectionHeaders: fixture.sectionHeaders?.length ?? 0,
    labels: fixture.problems.map((problem) => problem.label).join(", "),
  }));

  console.table(summary);
  console.log(
    [
      "Use these reviewed annotations as detector-test oracle data.",
      "Run npm.cmd run test:detector to compare detector proposals and final regions against them.",
      "Raw Claude drafts should stay in .worksheet-data until reviewed.",
    ].join("\n"),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
