import { PDFDocument, PDFImage, PDFPage } from "pdf-lib";

import { analyzeWorksheetImage, summarizeConfidence } from "@/lib/detection";
import type {
  CompositionMode,
  InputProblemRegion,
  LayoutDensity,
  LayoutMode,
  PromptScale,
  ProblemDraft,
  Rect,
  SourceImageMetadata,
  WorksheetAnalysis,
  WorksheetItem,
  WorksheetLayoutOptions,
  WorksheetPagePlacement,
  WorksheetPreviewPage,
  WorksheetLayoutPreview,
  WorksheetResult,
} from "@/lib/types";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export const DEFAULT_LAYOUT_OPTIONS: WorksheetLayoutOptions = {
  density: "compact",
  promptScale: "small",
};

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

type Placement = ReturnType<typeof measureItem>;

export async function analyzeWorksheetFile(file: File): Promise<WorksheetAnalysis> {
  assertUpload(file);

  const source = await loadWorksheetSource(file);
  const analysis = analyzeWorksheetImage({
    grayscale: source.grayscale,
    height: source.metadata.height,
    rgba: source.imageData.data,
    width: source.metadata.width,
  });

  return {
    sourceImage: source.metadata,
    problemDrafts: analysis.problemDrafts,
    sectionHeaders: analysis.sectionHeaders,
    debug: analysis.debug,
    confidenceSummary: summarizeConfidence(analysis.problemDrafts),
    itemCount: analysis.problemDrafts.filter((draft) => draft.included).length,
  };
}

export async function generateWorksheetPdf(
  file: File,
  reviewedProblems: ProblemDraft[],
  layoutOptions: WorksheetLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): Promise<WorksheetResult> {
  assertUpload(file);

  const source = await loadWorksheetSource(file);
  const problemRegions = toProblemRegions(reviewedProblems.filter((draft) => draft.included));

  if (problemRegions.length === 0) {
    throw new Error("Include at least one problem region before generating the PDF.");
  }

  const crops = await buildCropAssets(source.canvas, problemRegions);
  const pdf = await buildWorksheetPdf(crops, layoutOptions);
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
    layoutOptions,
    pdfUrl: URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" })),
  };
}

export function previewWorksheetLayout(
  reviewedProblems: ProblemDraft[],
  layoutOptions: WorksheetLayoutOptions = DEFAULT_LAYOUT_OPTIONS,
): WorksheetLayoutPreview {
  const metrics = toProblemRegions(reviewedProblems.filter((draft) => draft.included)).map(
    measureProblemCrop,
  );
  return measureWorksheetLayout(metrics, layoutOptions);
}

export async function processWorksheetFile(file: File): Promise<WorksheetResult> {
  const analysis = await analyzeWorksheetFile(file);
  return generateWorksheetPdf(file, analysis.problemDrafts, DEFAULT_LAYOUT_OPTIONS);
}

export function revokeWorksheetResult(result: WorksheetResult) {
  URL.revokeObjectURL(result.pdfUrl);
}

export const __testing = {
  getPromptSourceRects,
  measureProblemCrop,
};

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

async function buildWorksheetPdf(crops: CropAsset[], layoutOptions: WorksheetLayoutOptions) {
  const pdf = await PDFDocument.create();
  const layout = measureWorksheetLayout(crops, layoutOptions);
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
    pageCount: Math.max(1, layout.pageCount),
    items: layout.worksheetItems,
    margin,
  };
}

function measureWorksheetLayout(
  crops: CropMetric[],
  layoutOptions: WorksheetLayoutOptions,
): WorksheetLayoutPreview {
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36;
  const gutter = layoutOptions.density === "compact" ? 14 : 18;
  const rowGap = densityValue(layoutOptions.density, {
    compact: 12,
    balanced: 18,
    spacious: 24,
  });
  const contentWidth = pageWidth - margin * 2;
  const threeColumnWidth = (contentWidth - gutter * 2) / 3;
  const twoColumnWidth = (contentWidth - gutter) / 2;
  const rows = buildLayoutRows(crops, layoutOptions.density);
  const items: WorksheetItem[] = [];
  const pages = [createPreviewPage(0, pageWidth, pageHeight)];

  let pageIndex = 0;
  let cursorTop = margin;

  for (const row of rows) {
    const placements = row.map((crop, index) => {
      const slotWidth =
        row.length === 3 ? threeColumnWidth : row.length === 2 ? twoColumnWidth : contentWidth;
      const layoutMode = chooseLayoutMode(crop, slotWidth, layoutOptions.density);
      const placement = measureItem(
        layoutMode,
        crop.width,
        crop.height,
        slotWidth,
        crop.classification,
        layoutOptions.density,
        layoutOptions.promptScale,
      );
      return {
        crop,
        columnSpan: row.length === 3 ? (1 as const) : row.length === 2 ? (2 as const) : (3 as const),
        placement,
        x:
          row.length === 3
            ? margin + index * (threeColumnWidth + gutter)
            : row.length === 2
              ? margin + index * (twoColumnWidth + gutter)
              : margin,
      };
    });
    const headerPlacements = measureRowSectionHeaders(
      row,
      contentWidth,
      margin,
      layoutOptions.promptScale,
    );

    const rowHeight = Math.max(...placements.map((item) => item.placement.blockHeight));
    const headerHeight = headerPlacements.reduce((sum, header) => sum + header.rect.height, 0);
    const headerGap = headerPlacements.length > 0 ? 8 : 0;
    const headerInternalGap = Math.max(0, headerPlacements.length - 1) * 6;
    const blockHeight = headerHeight + headerInternalGap + headerGap + rowHeight;

    if (cursorTop + blockHeight > pageHeight - margin) {
      pageIndex += 1;
      pages.push(createPreviewPage(pageIndex, pageWidth, pageHeight));
      cursorTop = margin;
    }

    for (const header of headerPlacements) {
      const placement: WorksheetPagePlacement = {
        ...header,
        pageIndex,
        rect: { ...header.rect, top: cursorTop },
      };
      pages[pageIndex].placements.push(placement);
      cursorTop += placement.rect.height + 6;
    }

    if (headerPlacements.length > 0) {
      cursorTop += 2;
    }

    for (const placementInfo of placements) {
      const itemId = `item-${items.length + 1}`;
      const problemPlacement = makeProblemPlacement(
        itemId,
        placementInfo.crop,
        pageIndex,
        placementInfo.x,
        cursorTop,
        placementInfo.placement,
      );
      pages[pageIndex].placements.push(problemPlacement);
      items.push({
        id: itemId,
        regionId: placementInfo.crop.regionId,
        pageIndex,
        layoutMode: placementInfo.placement.layoutMode,
        compositionMode: placementInfo.crop.compositionMode,
        problemNumber: placementInfo.crop.problemNumber,
        sourceLabel: placementInfo.crop.sourceLabel,
        columnSpan: placementInfo.columnSpan,
        promptSize: {
          width: Math.round(problemPlacement.prompt.width),
          height: Math.round(problemPlacement.prompt.height),
        },
        answerArea: {
          width: Math.round(problemPlacement.answerArea.width),
          height: Math.round(problemPlacement.answerArea.height),
        },
      });
    }

    cursorTop += rowHeight + rowGap;
  }

  return {
    pageCount: Math.max(1, pageIndex + 1),
    worksheetItems: items,
    pages,
  };
}

type MeasuredSectionHeaderPlacement = Omit<
  Extract<WorksheetPagePlacement, { type: "section-header" }>,
  "pageIndex"
>;

function createPreviewPage(pageIndex: number, width: number, height: number): WorksheetPreviewPage {
  return {
    pageIndex,
    width,
    height,
    placements: [],
  };
}

function measureRowSectionHeaders(
  row: CropMetric[],
  contentWidth: number,
  margin: number,
  promptScale: PromptScale,
): MeasuredSectionHeaderPlacement[] {
  const seen = new Set<string>();
  const headers: MeasuredSectionHeaderPlacement[] = [];

  for (const crop of row) {
    for (const header of crop.sectionHeaders) {
      const dedupeKey = rectKey(header.sourceRect);
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);

      const scale = Math.min(promptScaleValue(promptScale), contentWidth / header.width);
      headers.push({
        id: header.id,
        type: "section-header",
        regionId: crop.regionId,
        sourceRect: header.sourceRect,
        rect: {
          left: margin,
          top: 0,
          width: header.width * scale,
          height: header.height * scale,
        },
      });
    }
  }

  return headers;
}

function makeProblemPlacement(
  itemId: string,
  crop: CropMetric,
  pageIndex: number,
  x: number,
  top: number,
  placement: Placement,
): Extract<WorksheetPagePlacement, { type: "problem" }> {
  const prompt = {
    left: x,
    top,
    width: placement.prompt.width,
    height: placement.prompt.height,
  };
  const answerArea = placement.stack
    ? {
        left: x,
        top: top + placement.prompt.height + placement.gap,
        width: placement.answer.width,
        height: placement.answer.height,
      }
    : {
        left: x + placement.prompt.width + placement.gap,
        top,
        width: placement.answer.width,
        height: placement.answer.height,
      };

  return {
    id: itemId,
    type: "problem",
    regionId: crop.regionId,
    pageIndex,
    sourceLabel: crop.sourceLabel,
    rect: unionRects([prompt, answerArea]),
    prompt,
    answerArea,
  };
}

function buildLayoutRows(crops: CropMetric[], density: LayoutDensity) {
  const rows: CropMetric[][] = [];
  let index = 0;

  while (index < crops.length) {
    const current = crops[index];
    if (current.classification === "complex") {
      rows.push([current]);
      index += 1;
      continue;
    }

    const maxRowItems =
      density === "compact" && current.classification === "simple"
        ? 3
        : density === "spacious" || current.classification === "standard"
          ? 1
          : 2;
    const row = [current];
    let lookahead = index + 1;

    while (
      row.length < maxRowItems &&
      lookahead < crops.length &&
      crops[lookahead].classification !== "complex" &&
      (density === "compact" || crops[lookahead].classification === current.classification)
    ) {
      row.push(crops[lookahead]);
      lookahead += 1;
    }

    rows.push(row);
    index += row.length;
  }

  return rows;
}

function chooseLayoutMode(crop: CropMetric, slotWidth: number, density: LayoutDensity): LayoutMode {
  if (
    crop.classification === "complex" ||
    crop.height > densityValue(density, { compact: 180, balanced: 170, spacious: 150 }) ||
    crop.width > slotWidth * densityValue(density, { compact: 0.9, balanced: 0.84, spacious: 0.74 })
  ) {
    return "below";
  }

  return "side";
}

function measureItem(
  layoutMode: LayoutMode,
  width: number,
  height: number,
  slotWidth: number,
  classification: "simple" | "standard" | "complex",
  density: LayoutDensity,
  promptScale: PromptScale,
) {
  const targetPromptScale = promptScaleValue(promptScale);
  const densityScale = densityValue(density, {
    compact: 0.74,
    balanced: 1,
    spacious: 1.28,
  });

  if (layoutMode === "side") {
    const scaledPrompt = Math.min(targetPromptScale, (slotWidth * 0.56) / width, 116 / height);
    const promptWidth = width * scaledPrompt;
    const promptHeight = height * scaledPrompt;
    const gap = 12;
    const answerWidth = Math.max(88, slotWidth - promptWidth - gap);
    const answerHeight =
      Math.max(classification === "simple" ? 78 : 104, promptHeight + 6) * densityScale;

    return {
      layoutMode,
      blockHeight: Math.max(promptHeight, answerHeight),
      prompt: { width: promptWidth, height: promptHeight },
      answer: { width: answerWidth, height: answerHeight },
      gap,
      stack: false,
    };
  }

  const scaledPrompt = Math.min(
    targetPromptScale,
    slotWidth / width,
    densityValue(density, { compact: 154, balanced: 176, spacious: 190 }) / height,
  );
  const promptWidth = width * scaledPrompt;
  const promptHeight = height * scaledPrompt;
  const gap = 10;
  const answerHeight =
    classification === "complex"
      ? Math.max(104, Math.min(210, promptHeight * 0.72)) * densityScale
      : Math.max(104, Math.min(176, promptHeight * 0.78)) * densityScale;

  return {
    layoutMode,
    blockHeight: promptHeight + gap + answerHeight,
    prompt: { width: promptWidth, height: promptHeight },
    answer: { width: slotWidth, height: answerHeight },
    gap,
    stack: true,
  };
}

function promptScaleValue(promptScale: PromptScale) {
  return ({
    small: 0.42,
    medium: 0.54,
    large: 0.66,
  } satisfies Record<PromptScale, number>)[promptScale];
}

function densityValue<T>(density: LayoutDensity, values: Record<LayoutDensity, T>) {
  return values[density];
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

function rectKey(rect: Rect) {
  return [
    Math.round(rect.left),
    Math.round(rect.top),
    Math.round(rect.width),
    Math.round(rect.height),
  ].join(":");
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
