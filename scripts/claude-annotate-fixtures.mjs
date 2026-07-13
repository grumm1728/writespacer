#!/usr/bin/env node
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_OUTPUT_DIR = ".worksheet-data/llm-annotations";
const MAX_EDGE = 1568;
const MAX_TOKENS = 1568;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "page", "problems", "sectionHeaders", "uncertaintyNotes"],
  properties: {
    schemaVersion: { type: "integer", const: 1 },
    page: {
      type: "object",
      additionalProperties: false,
      required: ["width", "height"],
      properties: {
        width: { type: "integer" },
        height: { type: "integer" },
      },
    },
    problems: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceLabel", "anchorBox", "problemBox", "readingOrder", "confidence"],
        properties: {
          sourceLabel: { type: "string" },
          anchorBox: { $ref: "#/$defs/rect" },
          problemBox: { $ref: "#/$defs/rect" },
          readingOrder: { type: "integer" },
          confidence: { type: "number" },
        },
      },
    },
    sectionHeaders: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["box", "confidence", "note"],
        properties: {
          box: { $ref: "#/$defs/rect" },
          confidence: { type: "number" },
          note: { type: "string" },
        },
      },
    },
    uncertaintyNotes: { type: "array", items: { type: "string" } },
  },
  $defs: {
    rect: {
      type: "object",
      additionalProperties: false,
      required: ["left", "top", "width", "height"],
      properties: {
        left: { type: "number" },
        top: { type: "number" },
        width: { type: "number" },
        height: { type: "number" },
      },
    },
  },
};

async function main() {
  await loadDotEnv(path.resolve(process.cwd(), ".env"));
  const args = parseArgs(process.argv.slice(2));
  const imagePaths = await resolveImagePaths(args);
  if (imagePaths.length === 0) {
    throw new Error(
      "Usage: npm.cmd run annotate:detector:claude -- --image public/fixtures/page.png",
    );
  }

  if (args.dryRun) {
    console.log(`Would annotate ${imagePaths.length} image(s):`);
    for (const imagePath of imagePaths) {
      console.log(`- ${imagePath}`);
    }
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Set ANTHROPIC_API_KEY before calling Claude.");
  }

  const repoRoot = process.cwd();
  const model = args.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  const outputDir = path.resolve(repoRoot, args.outputDir ?? DEFAULT_OUTPUT_DIR);
  await mkdir(outputDir, { recursive: true });

  for (const imagePath of imagePaths) {
    const absoluteImagePath = path.resolve(repoRoot, imagePath);
    const prepared = await prepareImage(absoluteImagePath);
    const annotation = await annotateImage({ apiKey, model, prepared });
    const mapped = mapAnnotationToSource(annotation, prepared);
    const outputPath = path.join(outputDir, `${safeOutputStem(imagePath)}.claude-draft.json`);
    await writeFile(
      outputPath,
      `${JSON.stringify(
        {
          sourceImage: imagePath,
          model,
          generatedAt: new Date().toISOString(),
          resizedPage: { width: prepared.width, height: prepared.height },
          sourcePage: { width: prepared.sourceWidth, height: prepared.sourceHeight },
          annotation,
          sourceMappedAnnotation: mapped,
        },
        null,
        2,
      )}\n`,
    );
    console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
  }
}

async function annotateImage({ apiKey, model, prepared }) {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      output_config: {
        format: {
          type: "json_schema",
          schema,
        },
      },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                "Annotate this math worksheet image for a deterministic CV detector.",
                "Return only the requested JSON shape.",
                "Use pixel coordinates in the exact resized image dimensions provided.",
                `The image you see is ${prepared.width} by ${prepared.height} pixels.`,
                "A problem anchor is the printed exercise number and punctuation at the start of a prompt.",
                "A problem box should include the prompt content belonging to that exercise, but not blank answer workspace.",
                "Section headers are instruction rows that should be rendered once above related problems, not included inside individual problem boxes.",
                "Sort problems in natural worksheet reading order.",
              ].join(" "),
            },
            {
              type: "image",
              source: {
                type: "base64",
                media_type: "image/png",
                data: prepared.base64,
              },
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude request failed: ${response.status} ${await response.text()}`);
  }

  const body = await response.json();
  const text = body.content?.find((part) => part.type === "text")?.text;
  if (!text) {
    throw new Error("Claude response did not include text JSON.");
  }

  return JSON.parse(text);
}

function parseArgs(args) {
  const parsed = { images: [], dirs: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--image") {
      parsed.images.push(args[index + 1]);
      index += 1;
    } else if (arg === "--dir") {
      parsed.dirs.push(args[index + 1]);
      index += 1;
    } else if (arg === "--model") {
      parsed.model = args[index + 1];
      index += 1;
    } else if (arg === "--output-dir") {
      parsed.outputDir = args[index + 1];
      index += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    }
  }
  return parsed;
}

async function resolveImagePaths(args) {
  const imagePaths = [...args.images];
  for (const dir of args.dirs) {
    const entries = await readdir(path.resolve(process.cwd(), dir), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && isSupportedImage(entry.name)) {
        imagePaths.push(path.join(dir, entry.name));
      }
    }
  }
  return [...new Set(imagePaths)].sort((left, right) => left.localeCompare(right));
}

function isSupportedImage(filePath) {
  return [".jpg", ".jpeg", ".png", ".webp", ".svg"].includes(
    path.extname(filePath).toLowerCase(),
  );
}

async function loadDotEnv(dotEnvPath) {
  let content = "";
  try {
    content = await readFile(dotEnvPath, "utf8");
  } catch {
    return;
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    if (process.env[key]) {
      continue;
    }
    process.env[key] = unquoteEnvValue(rawValue.trim());
  }
}

function unquoteEnvValue(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

async function prepareImage(imagePath) {
  const image = sharp(await readFile(imagePath)).flatten({ background: "white" });
  const metadata = await image.metadata();
  const sourceWidth = metadata.width;
  const sourceHeight = metadata.height;
  if (!sourceWidth || !sourceHeight) {
    throw new Error(`Could not read image dimensions for ${imagePath}`);
  }
  const [width, height] = resizedSize(sourceWidth, sourceHeight);
  const png = await image.resize(width, height, { fit: "fill" }).png().toBuffer();
  return {
    base64: png.toString("base64"),
    width,
    height,
    sourceWidth,
    sourceHeight,
  };
}

function resizedSize(width, height) {
  if (fitsClaudeImage(width, height)) {
    return [width, height];
  }
  if (height > width) {
    const [resizedHeight, resizedWidth] = resizedSize(height, width);
    return [resizedWidth, resizedHeight];
  }
  const aspectRatio = width / height;
  let low = 1;
  let high = width;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    const candidateHeight = Math.max(1, Math.round(mid / aspectRatio));
    if (fitsClaudeImage(mid, candidateHeight)) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return [low, Math.max(1, Math.round(low / aspectRatio))];
}

function fitsClaudeImage(width, height) {
  return (
    Math.ceil(width / 28) * 28 <= MAX_EDGE &&
    Math.ceil(height / 28) * 28 <= MAX_EDGE &&
    Math.ceil(width / 28) * Math.ceil(height / 28) <= MAX_TOKENS
  );
}

function mapAnnotationToSource(annotation, prepared) {
  const scaleX = prepared.sourceWidth / prepared.width;
  const scaleY = prepared.sourceHeight / prepared.height;
  return {
    ...annotation,
    page: { width: prepared.sourceWidth, height: prepared.sourceHeight },
    problems: annotation.problems.map((problem) => ({
      ...problem,
      anchorBox: scaleRect(problem.anchorBox, scaleX, scaleY),
      problemBox: scaleRect(problem.problemBox, scaleX, scaleY),
    })),
    sectionHeaders: annotation.sectionHeaders.map((header) => ({
      ...header,
      box: scaleRect(header.box, scaleX, scaleY),
    })),
  };
}

function scaleRect(rect, scaleX, scaleY) {
  return {
    left: Math.round(rect.left * scaleX),
    top: Math.round(rect.top * scaleY),
    width: Math.round(rect.width * scaleX),
    height: Math.round(rect.height * scaleY),
  };
}

function safeOutputStem(filePath) {
  return filePath
    .replace(/^[A-Za-z]:/, "")
    .replace(/\.[^.]+$/, "")
    .split(/[\\/]+/)
    .filter(Boolean)
    .join("__")
    .replace(/[^A-Za-z0-9_.-]/g, "_");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
