import { PDFDocument, PDFImage, PDFPage } from "pdf-lib";

import { createLocalAnchorRecognizer } from "@/lib/anchor-ocr";
import {
  analyzeWorksheetImage,
  summarizeConfidence,
} from "@/lib/detection";
import type {
  CompositionMode,
  InputProblemRegion,
  ProblemDraft,
  Rect,
  SourceImageMetadata,
  WorksheetAnalysis,
  WorksheetItem,
  WorksheetPagePlacement,
  WorksheetPreviewPage,
  WorksheetLayoutPreview,
  WorksheetResult,
} from "@/lib/types";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const MAX_PROBLEM_SELECTION = 8;

type WorksheetSource = {
  canvas: HTMLCanvasElement;
  grayscale: Uint8Array;
  imageData: ImageData;
  metadata: SourceImageMetadata;
};

type CropMetric = {
  regionId: string;
  width: number;
  height: number;
  classification: "simple" | "standard" | "complex";
  sourceLabel: string | null;
  problemNumber: number | null;
  compositionMode: CompositionMode;
  sectionHeaders: SectionHeaderMetric[];
};

type SectionHeaderMetric = {
  id: string;
  sourceRect: Rect;
  width: number;
  height: number;
};

type CropAsset = CropMetric & {
  bytes: Uint8Array;
  sectionHeaderAssets: SectionHeaderAsset[];
};

type SectionHeaderAsset = SectionHeaderMetric & {
  bytes: Uint8Array;
};

export async function analyzeWorksheetFile(file: File): Promise<WorksheetAnalysis> {
  assertUpload(file);

  const source = await loadWorksheetSource(file);
  const analysis = await analyzeWorksheetImage(
    {
      grayscale: source.grayscale,
      height: source.metadata.height,
      rgba: source.imageData.data,
      width: source.metadata.width,
    },
    createLocalAnchorRecognizer(source.canvas),
  );

  return {
    sourceImage: source.metadata,
    problemDrafts: analysis.problemDrafts,
    sectionHeaders: analysis.sectionHeaders,
    debug: analysis.diagnostics,
    confidenceSummary: summarizeConfidence(analysis.problemDrafts),
    itemCount: analysis.problemDrafts.filter((draft) => draft.included).length,
  };
}

export async function generateWorksheetPdf(
  file: File,
  reviewedProblems: ProblemDraft[],
): Promise<WorksheetResult> {
  assertUpload(file);

  const source = await loadWorksheetSource(file);
  const problemRegions = toProblemRegions(selectProblemCandidates(reviewedProblems));

  if (problemRegions.length === 0) {
    throw new Error("Include at least one problem region before generating the PDF.");
  }

  const crops = await buildCropAssets(source.canvas, problemRegions);
  const pdf = await buildWorksheetPdf(crops);
  const pdfBytes = new Uint8Array(pdf.bytes.byteLength);
  pdfBytes.set(pdf.bytes);

  return {
    sourceImage: source.metadata,
    problemRegions,
    worksheetItems: pdf.items,
    sectionHeaders: [],
    confidenceSummary: summarizeConfidence(problemRegions),
    pageCount: pdf.pageCount,
    itemCount: problemRegions.length,
    pdfUrl: URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" })),
  };
}

export function previewWorksheetLayout(reviewedProblems: ProblemDraft[]): WorksheetLayoutPreview {
  const metrics = toProblemRegions(selectProblemCandidates(reviewedProblems)).map(
    measureProblemCrop,
  );
  return measureWorksheetLayout(metrics);
}

export async function processWorksheetFile(file: File): Promise<WorksheetResult> {
  const analysis = await analyzeWorksheetFile(file);
  return generateWorksheetPdf(file, analysis.problemDrafts);
}

export function revokeWorksheetResult(result: WorksheetResult) {
  URL.revokeObjectURL(result.pdfUrl);
}

export const __testing = {
  getPromptSourceRects,
  measureProblemCrop,
};

export function selectProblemCandidates(drafts: readonly ProblemDraft[]): ProblemDraft[] {
  return drafts
    .filter(isUsableSelectedProblem)
    .sort((left, right) => left.orderIndex - right.orderIndex)
    .slice(0, MAX_PROBLEM_SELECTION);
}

function isUsableSelectedProblem(draft: ProblemDraft) {
  return draft.included && draft.unionBounds.width > 0 && draft.unionBounds.height > 0;
}

function assertUpload(file: File) {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WebP image.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Keep uploads under 12 MB for this first version.");
  }
}

async function loadWorksheetSource(file: File): Promise<WorksheetSource> {
  const bitmap = await createImageBitmap(file);
  const scale = bitmap.width > 1800 ? 1800 / bitmap.width : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("Canvas is not available in this browser.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);

  const imageData = context.getImageData(0, 0, width, height);
  const grayscale = extractGrayscale(imageData);

  return {
    canvas,
    grayscale,
    imageData,
    metadata: {
      width,
      height,
      mimeType: file.type,
      sizeBytes: file.size,
    },
  };
}

function extractGrayscale(imageData: ImageData) {
  const grayscale = new Uint8Array(imageData.width * imageData.height);

  for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
    const red = imageData.data[offset];
    const green = imageData.data[offset + 1];
    const blue = imageData.data[offset + 2];
    grayscale[pixel] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  return grayscale;
}

function toProblemRegions(problemDrafts: ProblemDraft[]): InputProblemRegion[] {
  return problemDrafts
    .map((draft, index) => ({
      ...draft,
      orderIndex: index,
      problemNumber: null,
    }))
    .sort((left, right) => left.orderIndex - right.orderIndex);
}

async function buildCropAssets(
  sourceCanvas: HTMLCanvasElement,
  problemRegions: InputProblemRegion[],
) {
  return Promise.all(
    problemRegions.map(async (region) => {
      const metric = measureProblemCrop(region);
      const renderedCanvas = composeProblemPrompt(sourceCanvas, region);
      const blob = await canvasToBlob(renderedCanvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const sectionHeaderAssets = await Promise.all(
        metric.sectionHeaders.map(async (header) => {
          const headerCanvas = cropUnionRegion(sourceCanvas, header.sourceRect);
          const headerBlob = await canvasToBlob(headerCanvas);
          return {
            ...header,
            bytes: new Uint8Array(await headerBlob.arrayBuffer()),
            width: headerCanvas.width,
            height: headerCanvas.height,
          } satisfies SectionHeaderAsset;
        }),
      );

      return {
        ...metric,
        bytes,
        width: renderedCanvas.width,
        height: renderedCanvas.height,
        sectionHeaderAssets,
      } satisfies CropAsset;
    }),
  );
}

function measureProblemCrop(region: InputProblemRegion): CropMetric {
  const classification = classifyProblem(region);
  const sectionHeaders = measureSectionHeaders(region);

  if (region.compositionMode === "union-fallback") {
    return {
      regionId: region.id,
      width: Math.max(1, Math.round(region.unionBounds.width)),
      height: Math.max(1, Math.round(region.unionBounds.height)),
      classification,
      sourceLabel: region.sourceLabel,
      problemNumber: region.problemNumber,
      compositionMode: region.compositionMode,
      sectionHeaders,
    };
  }

  const rects = getPromptSourceRects(region);
  const gap = 8;
  const width = Math.max(1, Math.round(Math.max(...rects.map((rect) => rect.width))));
  const height = Math.max(
    1,
    Math.round(
      rects.reduce((sum, rect) => sum + rect.height, 0) +
        Math.max(0, rects.length - 1) * gap,
    ),
  );

  return {
    regionId: region.id,
    width,
    height,
    classification,
    sourceLabel: region.sourceLabel,
    problemNumber: region.problemNumber,
    compositionMode: region.compositionMode,
    sectionHeaders,
  };
}

function measureSectionHeaders(region: InputProblemRegion): SectionHeaderMetric[] {
  return region.sectionHeaderRects.map((sourceRect, index) => ({
    id: `${region.id}-section-header-${index + 1}`,
    sourceRect,
    width: Math.max(1, Math.round(sourceRect.width)),
    height: Math.max(1, Math.round(sourceRect.height)),
  }));
}

function classifyProblem(region: InputProblemRegion) {
  const diagramLike = region.fragments.some((fragment) => fragment.kind === "diagram");
  if (diagramLike || region.unionBounds.height > 250 || region.contentRects.length > 6) {
    return "complex" as const;
  }

  if (region.unionBounds.height < 92 && region.contentRects.length <= 3) {
    return "simple" as const;
  }

  return "standard" as const;
}

function cropUnionRegion(sourceCanvas: HTMLCanvasElement, bounds: Rect) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bounds.width));
  canvas.height = Math.max(1, Math.round(bounds.height));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas cropping is not available in this browser.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(
    sourceCanvas,
    Math.round(bounds.left),
    Math.round(bounds.top),
    Math.round(bounds.width),
    Math.round(bounds.height),
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return canvas;
}

function composeProblemPrompt(sourceCanvas: HTMLCanvasElement, region: InputProblemRegion) {
  if (region.compositionMode === "union-fallback") {
    return cropUnionRegion(sourceCanvas, region.unionBounds);
  }

  const rects = getPromptSourceRects(region).map((rect) => ({ rect }));
  const gap = 8;
  const width = Math.max(...rects.map((item) => item.rect.width));
  const height =
    rects.reduce((sum, item) => sum + item.rect.height, 0) +
    Math.max(0, rects.length - 1) * gap;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const context = canvas.getContext("2d");

  if (!context) {
    throw new Error("Canvas composition is not available in this browser.");
  }

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);

  let cursorY = 0;
  for (const item of rects) {
    context.drawImage(
      sourceCanvas,
      Math.round(item.rect.left),
      Math.round(item.rect.top),
      Math.round(item.rect.width),
      Math.round(item.rect.height),
      0,
      Math.round(cursorY),
      Math.round(item.rect.width),
      Math.round(item.rect.height),
    );
    cursorY += item.rect.height + gap;
  }

  return canvas;
}

function getPromptSourceRects(
  region: Pick<InputProblemRegion, "anchorRect" | "compositionMode" | "contentRects" | "unionBounds">,
) {
  if (region.compositionMode === "union-fallback") {
    return [region.unionBounds];
  }

  const firstContent = region.contentRects[0] ?? null;
  if (!firstContent) {
    return [region.anchorRect];
  }

  return [unionRects([region.anchorRect, firstContent]), ...region.contentRects.slice(1)];
}

async function buildWorksheetPdf(crops: CropAsset[]) {
  const pdf = await PDFDocument.create();
  const layout = measureWorksheetLayout(crops);
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36;
  const pages: PDFPage[] = layout.pages.map(() => pdf.addPage([pageWidth, pageHeight]));

  for (const previewPage of layout.pages) {
    const page = pages[previewPage.pageIndex];

    for (const placement of previewPage.placements) {
      if (placement.type === "section-header") {
        const crop = crops.find((candidate) => candidate.regionId === placement.regionId);
        const header = crop?.sectionHeaderAssets.find(
          (candidate) => candidate.id === placement.id,
        );
        if (!header) {
          continue;
        }

        const image = await pdf.embedPng(header.bytes);
        drawImageRect(page, image, placement.rect, pageHeight);
        continue;
      }

      const crop = crops.find((candidate) => candidate.regionId === placement.regionId);
      if (!crop) {
        continue;
      }

      const image = await pdf.embedPng(crop.bytes);
      drawImageRect(page, image, placement.prompt, pageHeight);
      // The answer area is intentionally left blank. Teachers can print over
      // graph/grid paper, and the whitespace alone keeps photocopies clean.
    }
  }

  return {
    bytes: await pdf.save(),
    pageCount: 1,
    items: layout.worksheetItems,
    margin,
  };
}

function measureWorksheetLayout(crops: CropMetric[]): WorksheetLayoutPreview {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36;
  const selection = crops.slice(0, MAX_PROBLEM_SELECTION);
  const items: WorksheetItem[] = [];
  const pages = [createPreviewPage(0, pageWidth, pageHeight)];
  const arrangement = getHandoutArrangement(selection.length, pageWidth, pageHeight, margin);
  const renderedHeaderRects = new Set<string>();

  selection.forEach((crop, index) => {
    const slot = arrangement.slots[index];
    if (!slot) return;
    const itemId = `item-${index + 1}`;
    const { problem, headers } = measureHandoutSlot(itemId, crop, slot, renderedHeaderRects);
    pages[0].placements.push(...headers, problem);
    items.push({
      id: itemId,
      regionId: crop.regionId,
      pageIndex: 0,
      layoutMode: "below",
      compositionMode: crop.compositionMode,
      problemNumber: crop.problemNumber,
      sourceLabel: crop.sourceLabel,
      columnSpan: arrangement.columns === 1 ? 3 : 2,
      promptSize: { width: Math.round(problem.prompt.width), height: Math.round(problem.prompt.height) },
      answerArea: { width: Math.round(problem.answerArea.width), height: Math.round(problem.answerArea.height) },
    });
  });

  return { pageCount: 1, worksheetItems: items, pages };
}

function createPreviewPage(pageIndex: number, width: number, height: number): WorksheetPreviewPage {
  return { pageIndex, width, height, placements: [] };
}

type HandoutSlot = Rect;

function getHandoutArrangement(count: number, pageWidth: number, pageHeight: number, margin: number) {
  const columns = count <= 2 ? 1 : 2;
  const rows = count <= 2 ? Math.max(1, count) : Math.ceil(count / 2);
  const gutter = 18;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const slotWidth = (contentWidth - gutter * (columns - 1)) / columns;
  const slotHeight = (contentHeight - gutter * (rows - 1)) / rows;
  const slots: HandoutSlot[] = [];
  for (let index = 0; index < count; index += 1) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    slots.push({
      left: margin + column * (slotWidth + gutter),
      top: margin + row * (slotHeight + gutter),
      width: slotWidth,
      height: slotHeight,
    });
  }
  return { columns, slots };
}

function measureHandoutSlot(
  itemId: string,
  crop: CropMetric,
  slot: HandoutSlot,
  renderedHeaderRects: Set<string>,
): {
  problem: Extract<WorksheetPagePlacement, { type: "problem" }>;
  headers: Extract<WorksheetPagePlacement, { type: "section-header" }>[];
} {
  const headers: Extract<WorksheetPagePlacement, { type: "section-header" }>[] = [];
  let cursorTop = slot.top;
  for (const header of crop.sectionHeaders) {
    const key = rectKey(header.sourceRect);
    if (renderedHeaderRects.has(key)) {
      continue;
    }
    renderedHeaderRects.add(key);
    const headerBudget = (slot.height * 0.2) / Math.max(1, crop.sectionHeaders.length);
    const scale = Math.min(0.46, slot.width / header.width, headerBudget / header.height);
    const height = Math.max(1, header.height * scale);
    headers.push({
      id: header.id,
      type: "section-header",
      regionId: crop.regionId,
      pageIndex: 0,
      sourceRect: header.sourceRect,
      rect: { left: slot.left, top: cursorTop, width: header.width * scale, height },
    });
    cursorTop += height + 6;
  }
  const availableHeight = Math.max(1, slot.top + slot.height - cursorTop);
  const promptScale = Math.min(0.52, slot.width / crop.width, (availableHeight * 0.42) / crop.height);
  const prompt = { left: slot.left, top: cursorTop, width: crop.width * promptScale, height: crop.height * promptScale };
  const answerTop = prompt.top + prompt.height + 10;
  const answerArea = {
    left: slot.left,
    top: answerTop,
    width: slot.width,
    height: Math.max(1, slot.top + slot.height - answerTop),
  };
  return {
    headers,
    problem: {
      id: itemId,
      type: "problem",
      regionId: crop.regionId,
      pageIndex: 0,
      sourceLabel: crop.sourceLabel,
      rect: unionRects([prompt, answerArea]),
      prompt,
      answerArea,
    },
  };
}

function rectKey(rect: Rect) {
  return [rect.left, rect.top, rect.width, rect.height].map(Math.round).join(":");
}

function drawImageRect(page: PDFPage, image: PDFImage, rect: Rect, pageHeight: number) {
  page.drawImage(image, {
    x: rect.left,
    y: pageHeight - rect.top - rect.height,
    width: rect.width,
    height: rect.height,
  });
}

function unionRects(rects: Rect[]) {
  const safeRects = rects.length > 0 ? rects : [{ left: 0, top: 0, width: 1, height: 1 }];
  const left = Math.min(...safeRects.map((rect) => rect.left));
  const top = Math.min(...safeRects.map((rect) => rect.top));
  const right = Math.max(...safeRects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...safeRects.map((rect) => rect.top + rect.height));

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Unable to create an image crop."));
        return;
      }

      resolve(blob);
    }, "image/png");
  });
}
