import { mkdir, readFile, writeFile } from "node:fs/promises";

import { PDFDocument, PDFImage, PDFPage, rgb } from "pdf-lib";
import sharp from "sharp";

import {
  clearActiveJob,
  getActiveJob,
  getJobRecord,
  jobPath,
  persistJob,
  setActiveJob,
} from "@/lib/jobs";
import type {
  ConfidenceSummary,
  JobRecord,
  LayoutMode,
  ProblemRegion,
  Rect,
  WorksheetItem,
} from "@/lib/types";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type LineBand = Rect & { density: number };

type CropAsset = {
  regionId: string;
  filename: string;
  buffer: Buffer;
  width: number;
  height: number;
};

type AnalysisResult = {
  width: number;
  height: number;
  regions: ProblemRegion[];
  crops: CropAsset[];
  confidenceSummary: ConfidenceSummary;
};

type RegionCandidate = {
  bounds: Rect;
  confidence: number;
  associatedAuxiliaryIds: string[];
};

export function assertUpload(file: File) {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WebP image.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Keep uploads under 12 MB for this first version.");
  }
}

export async function ensureJobProcessed(jobId: string): Promise<JobRecord> {
  const current = await getJobRecord(jobId);

  if (!current) {
    throw new Error("Job not found.");
  }

  if (current.status === "complete" || current.status === "failed") {
    return current;
  }

  const active = getActiveJob(jobId);
  if (active) {
    return active;
  }

  const promise = processJob(jobId).finally(() => {
    clearActiveJob(jobId);
  });

  setActiveJob(jobId, promise);
  return promise;
}

async function processJob(jobId: string): Promise<JobRecord> {
  const job = await getJobRecord(jobId);

  if (!job) {
    throw new Error("Job not found.");
  }

  job.status = "processing";
  job.error = undefined;
  await persistJob(job);

  try {
    const uploadBuffer = await readFile(job.uploadPath);
    const analysis = await analyzeWorksheet(job.id, uploadBuffer);
    const pdf = await buildWorksheetPdf(analysis.crops);
    const pdfPath = jobPath(job.id, "worksheet.pdf");

    await writeFile(pdfPath, pdf.buffer);

    job.status = "complete";
    job.pdfPath = pdfPath;
    job.sourceImage = {
      width: analysis.width,
      height: analysis.height,
      mimeType: "image/png",
      sizeBytes: uploadBuffer.length,
    };
    job.problemRegions = analysis.regions;
    job.worksheetItems = pdf.items;
    job.itemCount = analysis.regions.length;
    job.pageCount = pdf.pageCount;
    job.confidenceSummary = analysis.confidenceSummary;
    await persistJob(job);
  } catch (error) {
    job.status = "failed";
    job.error =
      error instanceof Error ? error.message : "An unknown processing error occurred.";
    await persistJob(job);
  }

  return job;
}

async function analyzeWorksheet(jobId: string, input: Buffer): Promise<AnalysisResult> {
  const base = sharp(input, { failOn: "none" }).rotate();
  const originalMeta = await base.metadata();
  const resizeWidth =
    originalMeta.width && originalMeta.width > 1700 ? 1700 : originalMeta.width;

  const prepared = sharp(input, { failOn: "none" })
    .rotate()
    .resize({
      width: resizeWidth,
      withoutEnlargement: true,
    })
    .normalise();

  const normalizedBuffer = await prepared.clone().png().toBuffer();
  const grayscale = await prepared
    .clone()
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const width = grayscale.info.width;
  const height = grayscale.info.height;
  const mask = buildDarkMask(grayscale.data);
  const contentBounds = detectContentBounds(mask, width, height);
  const bands = detectLineBands(mask, width, height, contentBounds);
  const baseRegions = groupBandsIntoRegions(bands, contentBounds, width);
  const auxiliaryRegions = detectAuxiliaryRegions(mask, width, height, contentBounds, baseRegions);
  const mergedRegions = mergeRegions(baseRegions, auxiliaryRegions, width, height);
  const paddedRegions: ProblemRegion[] = mergedRegions.map((region, index) => ({
    id: `region-${index + 1}`,
    bounds: padRect(region.bounds, width, height, 18),
    confidence: clamp(region.confidence, 0.22, 0.99),
    associatedAuxiliaryIds: region.associatedAuxiliaryIds,
  }));

  await mkdir(jobPath(jobId, "crops"), { recursive: true });

  const crops = await Promise.all(
    paddedRegions.map(async (region) => {
      const cropBuffer = await sharp(normalizedBuffer)
        .extract({
          left: Math.round(region.bounds.left),
          top: Math.round(region.bounds.top),
          width: Math.round(region.bounds.width),
          height: Math.round(region.bounds.height),
        })
        .png()
        .toBuffer();

      const filename = `${region.id}.png`;
      await writeFile(jobPath(jobId, "crops", filename), cropBuffer);

      return {
        regionId: region.id,
        filename,
        buffer: cropBuffer,
        width: Math.round(region.bounds.width),
        height: Math.round(region.bounds.height),
      };
    }),
  );

  return {
    width,
    height,
    regions: paddedRegions.map((region) => ({
      ...region,
      cropFilename: `${region.id}.png`,
    })),
    crops,
    confidenceSummary: summarizeConfidence(paddedRegions),
  };
}

function buildDarkMask(grayscale: Buffer) {
  const mask = new Uint8Array(grayscale.length);

  for (let index = 0; index < grayscale.length; index += 1) {
    mask[index] = grayscale[index] < 208 ? 1 : 0;
  }

  return mask;
}

function detectContentBounds(mask: Uint8Array, width: number, height: number): Rect {
  const rows = new Array<number>(height).fill(0);
  const cols = new Array<number>(width).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = mask[y * width + x];
      rows[y] += dark;
      cols[x] += dark;
    }
  }

  const minRow = Math.max(3, Math.floor(width * 0.0035));
  const minCol = Math.max(3, Math.floor(height * 0.01));
  const top = rows.findIndex((value) => value >= minRow);
  const bottom = findLastIndex(rows, (value) => value >= minRow);
  const left = cols.findIndex((value) => value >= minCol);
  const right = findLastIndex(cols, (value) => value >= minCol);

  if (top < 0 || left < 0 || bottom <= top || right <= left) {
    return { left: 0, top: 0, width, height };
  }

  return padRect(
    { left, top, width: right - left + 1, height: bottom - top + 1 },
    width,
    height,
    16,
  );
}

function detectLineBands(
  mask: Uint8Array,
  width: number,
  height: number,
  contentBounds: Rect,
): LineBand[] {
  const startX = Math.round(contentBounds.left);
  const endX = Math.min(width, Math.round(contentBounds.left + contentBounds.width));
  const startY = Math.round(contentBounds.top);
  const endY = Math.min(height, Math.round(contentBounds.top + contentBounds.height));
  const densities: number[] = [];

  for (let y = startY; y < endY; y += 1) {
    let dark = 0;
    for (let x = startX; x < endX; x += 1) {
      dark += mask[y * width + x];
    }
    densities.push(dark / Math.max(1, endX - startX));
  }

  const average = densities.reduce((sum, value) => sum + value, 0) / Math.max(1, densities.length);
  const threshold = Math.max(0.01, average * 0.72);
  const bands: LineBand[] = [];
  let openStart = -1;

  for (let index = 0; index < densities.length; index += 1) {
    const active = densities[index] >= threshold;

    if (active && openStart < 0) {
      openStart = index;
    }

    if ((!active || index === densities.length - 1) && openStart >= 0) {
      const closeIndex = active && index === densities.length - 1 ? index : index - 1;
      const top = startY + openStart;
      const bottom = startY + closeIndex;
      const bounds = horizontalBounds(mask, width, startX, endX, top, bottom);

      if (bounds && bounds.width * bounds.height > 90) {
        bands.push({
          ...bounds,
          density:
            densities
              .slice(openStart, closeIndex + 1)
              .reduce((sum, value) => sum + value, 0) /
            Math.max(1, closeIndex - openStart + 1),
        });
      }

      openStart = -1;
    }
  }

  return bands;
}

function horizontalBounds(
  mask: Uint8Array,
  width: number,
  startX: number,
  endX: number,
  top: number,
  bottom: number,
): Rect | null {
  let left = endX;
  let right = startX;

  for (let x = startX; x < endX; x += 1) {
    let dark = 0;
    for (let y = top; y <= bottom; y += 1) {
      dark += mask[y * width + x];
    }

    if (dark > 0) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
  }

  if (right <= left) {
    return null;
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
  };
}

function groupBandsIntoRegions(
  bands: LineBand[],
  contentBounds: Rect,
  pageWidth: number,
): RegionCandidate[] {
  if (bands.length === 0) {
    return [{ bounds: contentBounds, confidence: 0.35, associatedAuxiliaryIds: [] }];
  }

  const sorted = [...bands].sort((left, right) => left.top - right.top);
  const gaps: number[] = [];

  for (let index = 1; index < sorted.length; index += 1) {
    gaps.push(sorted[index].top - (sorted[index - 1].top + sorted[index - 1].height));
  }

  const medianGap = percentile(gaps, 0.5) || 10;
  const splitThreshold = Math.max(28, medianGap * 2.2);
  const groups: LineBand[][] = [];

  for (const band of sorted) {
    const current = groups.at(-1);

    if (!current) {
      groups.push([band]);
      continue;
    }

    const previous = current.at(-1)!;
    const gap = band.top - (previous.top + previous.height);
    const horizontalDelta = Math.abs(band.left - previous.left);
    const shouldSplit =
      gap > splitThreshold || (gap > medianGap * 1.2 && horizontalDelta > contentBounds.width * 0.22);

    if (shouldSplit) {
      groups.push([band]);
    } else {
      current.push(band);
    }
  }

  return groups.map((group, index) => {
    const bounds = unionRects(group);
    const averageDensity =
      group.reduce((sum, band) => sum + band.density, 0) / Math.max(1, group.length);

    return {
      bounds: padRect(bounds, pageWidth, Number.MAX_SAFE_INTEGER, 8),
      confidence: clamp(0.44 + averageDensity * 1.9 - index * 0.01, 0.32, 0.95),
      associatedAuxiliaryIds: [],
    };
  });
}

function detectAuxiliaryRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  contentBounds: Rect,
  baseRegions: RegionCandidate[],
) {
  const visited = new Uint8Array(width * height);
  const auxiliaryRegions: Array<{ id: string; bounds: Rect }> = [];
  let index = 0;

  const startX = Math.round(contentBounds.left);
  const endX = Math.min(width, Math.round(contentBounds.left + contentBounds.width));
  const startY = Math.round(contentBounds.top);
  const endY = Math.min(height, Math.round(contentBounds.top + contentBounds.height));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = y * width + x;
      if (!mask[offset] || visited[offset]) {
        continue;
      }

      const component = floodFill(mask, visited, width, height, x, y);

      if (component.area < 180 || component.width < 18 || component.height < 18) {
        continue;
      }

      const overlapsPrompt = baseRegions.some((region) => intersects(region.bounds, component));
      const isLargeVisual = component.height > 42 && (component.width > 70 || component.height > 70);

      if (!overlapsPrompt && isLargeVisual) {
        index += 1;
        auxiliaryRegions.push({ id: `aux-${index}`, bounds: component });
      }
    }
  }

  return auxiliaryRegions;
}

function mergeRegions(
  baseRegions: RegionCandidate[],
  auxiliaryRegions: Array<{ id: string; bounds: Rect }>,
  width: number,
  height: number,
) {
  const regions = baseRegions.map((region) => ({ ...region }));

  for (const auxiliary of auxiliaryRegions) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (let index = 0; index < regions.length; index += 1) {
      const distance = rectDistance(regions[index].bounds, auxiliary.bounds);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }

    if (bestIndex >= 0 && bestDistance < Math.max(180, width * 0.12)) {
      regions[bestIndex].bounds = padRect(
        unionRects([regions[bestIndex].bounds, auxiliary.bounds]),
        width,
        height,
        10,
      );
      regions[bestIndex].associatedAuxiliaryIds.push(auxiliary.id);
      regions[bestIndex].confidence = clamp(regions[bestIndex].confidence + 0.04, 0.2, 0.99);
    }
  }

  return regions;
}

async function buildWorksheetPdf(crops: CropAsset[]) {
  const pdf = await PDFDocument.create();
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 42;
  const contentWidth = pageWidth - margin * 2;
  const items: WorksheetItem[] = [];

  let page = pdf.addPage([pageWidth, pageHeight]);
  let pageIndex = 0;
  let cursorY = pageHeight - margin;

  for (const crop of crops) {
    const image = await pdf.embedPng(crop.buffer);
    const layoutMode = chooseLayoutMode(crop.width, crop.height);
    const placement = measureItem(layoutMode, crop.width, crop.height, contentWidth);

    if (cursorY - placement.blockHeight < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      pageIndex += 1;
      cursorY = pageHeight - margin;
    }

    drawWorksheetItem(page, image, margin, cursorY, placement);
    cursorY -= placement.blockHeight;

    items.push({
      id: `item-${items.length + 1}`,
      regionId: crop.regionId,
      pageIndex,
      layoutMode,
      promptSize: {
        width: Math.round(placement.prompt.width),
        height: Math.round(placement.prompt.height),
      },
      answerArea: {
        width: Math.round(placement.answer.width),
        height: Math.round(placement.answer.height),
      },
    });
  }

  return {
    buffer: Buffer.from(await pdf.save()),
    pageCount: pdf.getPageCount(),
    items,
  };
}

function chooseLayoutMode(width: number, height: number): LayoutMode {
  if (height > 180 || width > 520 || height / Math.max(width, 1) > 0.54) {
    return "below";
  }

  return "side";
}

function measureItem(layoutMode: LayoutMode, width: number, height: number, contentWidth: number) {
  if (layoutMode === "side") {
    const promptScale = Math.min(1.55, 190 / width, 104 / height);
    const promptWidth = width * promptScale;
    const promptHeight = height * promptScale;
    const answerWidth = contentWidth - promptWidth - 20;
    const answerHeight = Math.max(128, promptHeight + 12);

    return {
      blockHeight: Math.max(promptHeight, answerHeight) + 22,
      prompt: { width: promptWidth, height: promptHeight },
      answer: { width: answerWidth, height: answerHeight },
      gap: 20,
      stack: false,
    };
  }

  const promptScale = Math.min(1.45, contentWidth / width, 170 / height);
  const promptWidth = width * promptScale;
  const promptHeight = height * promptScale;
  const answerHeight = Math.max(152, Math.min(236, promptHeight * 1.18));

  return {
    blockHeight: promptHeight + answerHeight + 34,
    prompt: { width: promptWidth, height: promptHeight },
    answer: { width: contentWidth, height: answerHeight },
    gap: 14,
    stack: true,
  };
}

function drawWorksheetItem(
  page: PDFPage,
  image: PDFImage,
  x: number,
  cursorY: number,
  placement: ReturnType<typeof measureItem>,
) {
  const promptY = cursorY - placement.prompt.height;
  page.drawImage(image, {
    x,
    y: promptY,
    width: placement.prompt.width,
    height: placement.prompt.height,
  });

  if (placement.stack) {
    const answerY = promptY - placement.gap - placement.answer.height;
    drawAnswerArea(page, x, answerY, placement.answer.width, placement.answer.height);
    return;
  }

  const answerX = x + placement.prompt.width + placement.gap;
  const answerY = cursorY - placement.answer.height;
  drawAnswerArea(page, answerX, answerY, placement.answer.width, placement.answer.height);
}

function drawAnswerArea(page: PDFPage, x: number, y: number, width: number, height: number) {
  page.drawRectangle({
    x,
    y,
    width,
    height,
    borderColor: rgb(0.79, 0.48, 0.32),
    borderWidth: 1.1,
    color: rgb(1, 1, 1),
    opacity: 0.96,
  });

  for (let lineY = y + height - 22; lineY > y + 12; lineY -= 22) {
    page.drawLine({
      start: { x: x + 12, y: lineY },
      end: { x: x + width - 12, y: lineY },
      thickness: 0.75,
      color: rgb(0.9, 0.78, 0.72),
      opacity: 0.92,
    });
  }
}

function summarizeConfidence(regions: ProblemRegion[]): ConfidenceSummary {
  const averageConfidence =
    regions.reduce((sum, region) => sum + region.confidence, 0) / Math.max(1, regions.length);
  const lowConfidenceCount = regions.filter((region) => region.confidence < 0.55).length;

  return {
    averageConfidence,
    lowConfidenceCount,
  };
}

function floodFill(
  mask: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
) {
  const queue: Array<[number, number]> = [[startX, startY]];
  visited[startY * width + startX] = 1;

  let left = startX;
  let right = startX;
  let top = startY;
  let bottom = startY;
  let area = 0;

  while (queue.length > 0) {
    const [x, y] = queue.pop()!;
    area += 1;
    left = Math.min(left, x);
    right = Math.max(right, x);
    top = Math.min(top, y);
    bottom = Math.max(bottom, y);

    const neighbors: Array<[number, number]> = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ];

    for (const [nextX, nextY] of neighbors) {
      if (nextX < 0 || nextX >= width || nextY < 0 || nextY >= height) {
        continue;
      }

      const offset = nextY * width + nextX;
      if (!mask[offset] || visited[offset]) {
        continue;
      }

      visited[offset] = 1;
      queue.push([nextX, nextY]);
    }
  }

  return {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1,
    area,
  };
}

function padRect(rect: Rect, maxWidth: number, maxHeight: number, padding: number): Rect {
  const left = Math.max(0, Math.floor(rect.left - padding));
  const top = Math.max(0, Math.floor(rect.top - padding));
  const right = Math.min(maxWidth, Math.ceil(rect.left + rect.width + padding));
  const bottom = Math.min(maxHeight, Math.ceil(rect.top + rect.height + padding));

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function unionRects(rects: Rect[]): Rect {
  const left = Math.min(...rects.map((rect) => rect.left));
  const top = Math.min(...rects.map((rect) => rect.top));
  const right = Math.max(...rects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.top + rect.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function rectDistance(a: Rect, b: Rect) {
  const horizontal = Math.max(0, Math.max(a.left - (b.left + b.width), b.left - (a.left + a.width)));
  const vertical = Math.max(0, Math.max(a.top - (b.top + b.height), b.top - (a.top + a.height)));
  return Math.hypot(horizontal, vertical);
}

function intersects(a: Rect, b: Rect) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function percentile(values: number[], quantile: number) {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * quantile)));
  return sorted[index];
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function findLastIndex<T>(values: T[], predicate: (value: T) => boolean) {
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (predicate(values[index])) {
      return index;
    }
  }

  return -1;
}
