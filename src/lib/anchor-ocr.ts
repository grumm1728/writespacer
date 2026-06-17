import { createWorker, OEM, PSM, type Worker } from "tesseract.js";

import type { WorksheetAnchorProposal } from "@/lib/detection";
import type { AnchorRecognition, Rect } from "@/lib/types";

const CONTACT_COLUMNS = 3;
const CELL_WIDTH = 240;
const CELL_HEIGHT = 72;
const CROP_HEIGHT = 52;
const MAX_PROPOSALS = 320;

let workerPromise: Promise<Worker> | null = null;

export async function recognizeAnchorProposals(
  sourceCanvas: HTMLCanvasElement,
  proposals: WorksheetAnchorProposal[],
): Promise<AnchorRecognition[]> {
  if (proposals.length === 0) {
    return [];
  }

  const selected = [...proposals]
    .sort((left, right) => right.score - left.score)
    .slice(0, MAX_PROPOSALS);
  const contactSheet = buildAnchorContactSheet(sourceCanvas, selected);

  try {
    const worker = await getWorker();
    const result = await worker.recognize(
      contactSheet,
      {},
      { blocks: true, text: true },
    );
    return readRecognitions(result.data.blocks, selected);
  } catch {
    return [];
  }
}

export async function terminateAnchorOcrWorker() {
  if (!workerPromise) {
    return;
  }

  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}

export const __testing = {
  buildAnchorContactSheet,
  readRecognitions,
};

function getWorker() {
  workerPromise ??= createAnchorWorker();
  return workerPromise;
}

async function createAnchorWorker() {
  const assetRoot = resolveAssetRoot();
  const worker = await createWorker("eng", OEM.LSTM_ONLY, {
    workerPath: `${assetRoot}worker.min.js`,
    corePath: `${assetRoot}core`,
    langPath: `${assetRoot}lang`,
    workerBlobURL: false,
  });
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
    tessedit_char_whitelist: "0123456789.)",
    preserve_interword_spaces: "1",
    user_defined_dpi: "300",
  });
  return worker;
}

function resolveAssetRoot() {
  const nextScript = document.querySelector<HTMLScriptElement>('script[src*="/_next/"]');
  if (nextScript?.src) {
    const markerIndex = nextScript.src.indexOf("/_next/");
    if (markerIndex >= 0) {
      return `${nextScript.src.slice(0, markerIndex)}/tesseract/`;
    }
  }
  return new URL("./tesseract/", document.baseURI).href;
}

function buildAnchorContactSheet(
  sourceCanvas: HTMLCanvasElement,
  proposals: WorksheetAnchorProposal[],
) {
  const rows = Math.ceil(proposals.length / CONTACT_COLUMNS);
  const canvas = document.createElement("canvas");
  canvas.width = CONTACT_COLUMNS * CELL_WIDTH;
  canvas.height = Math.max(CELL_HEIGHT, rows * CELL_HEIGHT);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas is unavailable for local number recognition.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  proposals.forEach((proposal, index) => {
    const column = index % CONTACT_COLUMNS;
    const row = Math.floor(index / CONTACT_COLUMNS);
    const cellLeft = column * CELL_WIDTH;
    const cellTop = row * CELL_HEIGHT;
    const crop = thresholdCrop(sourceCanvas, proposal.rect);
    const scale = Math.min(
      CROP_HEIGHT / crop.height,
      (CELL_WIDTH - 18) / crop.width,
      5,
    );
    const width = Math.max(1, Math.round(crop.width * scale));
    const height = Math.max(1, Math.round(crop.height * scale));
    context.drawImage(
      crop,
      cellLeft + 8,
      cellTop + Math.round((CELL_HEIGHT - height) / 2),
      width,
      height,
    );
  });

  return canvas;
}

function thresholdCrop(sourceCanvas: HTMLCanvasElement, rect: Rect) {
  const padding = Math.max(2, Math.round(rect.height * 0.28));
  const left = Math.max(0, Math.floor(rect.left - padding));
  const top = Math.max(0, Math.floor(rect.top - padding));
  const right = Math.min(
    sourceCanvas.width,
    Math.ceil(rect.left + rect.width + padding),
  );
  const bottom = Math.min(sourceCanvas.height, Math.ceil(rect.top + rect.height + padding));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, right - left);
  canvas.height = Math.max(1, bottom - top);
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (!context) {
    throw new Error("Canvas is unavailable for local number recognition.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    sourceCanvas,
    left,
    top,
    canvas.width,
    canvas.height,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const grayscale = new Uint8Array(image.data.length / 4);
  for (let offset = 0, pixel = 0; offset < image.data.length; offset += 4, pixel += 1) {
    const luminance =
      image.data[offset] * 0.299 +
      image.data[offset + 1] * 0.587 +
      image.data[offset + 2] * 0.114;
    grayscale[pixel] = Math.round(luminance);
  }
  const sorted = [...grayscale].sort((leftValue, rightValue) => leftValue - rightValue);
  const low = sorted[Math.floor(sorted.length * 0.04)] ?? 0;
  const high = sorted[Math.floor(sorted.length * 0.96)] ?? 255;
  const range = Math.max(24, high - low);
  const binaryThreshold = rect.height >= 16 ? otsuThreshold(grayscale) : null;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const value = binaryThreshold === null
      ? Math.round(((grayscale[offset / 4] - low) / range) * 255)
      : grayscale[offset / 4] <= binaryThreshold
        ? 0
        : 255;
    const normalized = Math.max(0, Math.min(255, value));
    image.data[offset] = normalized;
    image.data[offset + 1] = normalized;
    image.data[offset + 2] = normalized;
    image.data[offset + 3] = 255;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function otsuThreshold(values: Uint8Array) {
  const histogram = new Uint32Array(256);
  let totalValue = 0;
  for (const value of values) {
    histogram[value] += 1;
    totalValue += value;
  }

  let backgroundWeight = 0;
  let backgroundValue = 0;
  let bestVariance = -1;
  let bestThreshold = 180;
  for (let threshold = 0; threshold < 256; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (backgroundWeight === 0) {
      continue;
    }
    const foregroundWeight = values.length - backgroundWeight;
    if (foregroundWeight === 0) {
      break;
    }
    backgroundValue += threshold * histogram[threshold];
    const backgroundMean = backgroundValue / backgroundWeight;
    const foregroundMean = (totalValue - backgroundValue) / foregroundWeight;
    const variance =
      backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      bestThreshold = threshold;
    }
  }
  return Math.max(70, Math.min(230, bestThreshold));
}

function readRecognitions(
  blocks: Tesseract.Block[] | null,
  proposals: WorksheetAnchorProposal[],
) {
  const byProposal = new Map<string, AnchorRecognition>();

  for (const block of blocks ?? []) {
    for (const paragraph of block.paragraphs) {
      for (const line of paragraph.lines) {
        for (const word of line.words) {
          const centerX = (word.bbox.x0 + word.bbox.x1) / 2;
          const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
          const column = Math.floor(centerX / CELL_WIDTH);
          const row = Math.floor(centerY / CELL_HEIGHT);
          const index = row * CONTACT_COLUMNS + column;
          const proposal = proposals[index];
          const label = normalizeRecognizedLabel(word.text);
          const relativeLeft = word.bbox.x0 - column * CELL_WIDTH;
          if (!proposal || !label || relativeLeft > CELL_WIDTH * 0.55) {
            continue;
          }

          const recognition = {
            proposalId: proposal.id,
            sourceLabel: label,
            confidence: Math.max(0, Math.min(1, word.confidence / 100)),
          };
          const existing = byProposal.get(proposal.id);
          if (!existing || recognition.confidence > existing.confidence) {
            byProposal.set(proposal.id, recognition);
          }
        }
      }
    }
  }

  return [...byProposal.values()];
}

function normalizeRecognizedLabel(value: string) {
  const match = value.trim().match(/^(\d{1,3})(?:[.)]|$)/);
  if (!match) {
    return null;
  }
  const numeric = Number(match[1]);
  return Number.isFinite(numeric) && numeric <= 999 ? String(numeric) : null;
}
