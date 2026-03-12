import { PDFDocument, PDFImage, PDFPage, rgb } from "pdf-lib";

import type {
  CompositionMode,
  ConfidenceSummary,
  InputProblemFragment,
  InputProblemRegion,
  LayoutMode,
  Rect,
  SectionHeader,
  SourceImageMetadata,
  WorksheetItem,
  WorksheetResult,
} from "@/lib/types";

const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const ACCEPTED_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type ConnectedComponent = Rect & {
  id: string;
  area: number;
  density: number;
  centerX: number;
  centerY: number;
};

type TextRow = {
  id: string;
  rect: Rect;
  components: ConnectedComponent[];
  density: number;
};

type RowSegment = {
  id: string;
  rowId: string;
  rect: Rect;
  components: ConnectedComponent[];
};

type AnchorCandidate = {
  id: string;
  rect: Rect;
  row: TextRow;
  score: number;
  inferredNumber: number | null;
};

type OwnershipZone = {
  anchor: AnchorCandidate;
  rect: Rect;
  columnIndex: number;
  orderIndex: number;
};

type CropAsset = {
  regionId: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  classification: "simple" | "standard" | "complex";
  problemNumber: number | null;
  compositionMode: CompositionMode;
};

export async function processWorksheetFile(file: File): Promise<WorksheetResult> {
  assertUpload(file);

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

  const grayscale = extractGrayscale(context, width, height);
  const mask = buildDarkMask(grayscale);
  const contentBounds = detectContentBounds(mask, width, height);
  const components = detectConnectedComponents(mask, width, height, contentBounds);
  const textRows = buildTextRows(components, contentBounds, width, height);
  const rowSegments = buildRowSegments(textRows, width, height);
  const anchors = detectAnchorCandidates(textRows, rowSegments, contentBounds);
  const sectionHeaders = detectSectionHeaders(textRows, anchors, contentBounds, width, height);
  const zones = buildOwnershipZones(anchors, contentBounds, width, height);
  const problemRegions = buildProblemRegions(
    components,
    rowSegments,
    sectionHeaders,
    zones,
    width,
    height,
  );
  const crops = await buildCropAssets(canvas, problemRegions);
  const pdf = await buildWorksheetPdf(crops);

  const pdfBytes = new Uint8Array(pdf.bytes.byteLength);
  pdfBytes.set(pdf.bytes);

  return {
    sourceImage: {
      width,
      height,
      mimeType: file.type,
      sizeBytes: file.size,
    } satisfies SourceImageMetadata,
    problemRegions,
    worksheetItems: pdf.items,
    sectionHeaders,
    confidenceSummary: summarizeConfidence(problemRegions),
    pageCount: pdf.pageCount,
    itemCount: problemRegions.length,
    pdfUrl: URL.createObjectURL(new Blob([pdfBytes], { type: "application/pdf" })),
  };
}

export function revokeWorksheetResult(result: WorksheetResult) {
  URL.revokeObjectURL(result.pdfUrl);
}

function assertUpload(file: File) {
  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    throw new Error("Upload a PNG, JPEG, or WebP image.");
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Keep uploads under 12 MB for this first version.");
  }
}

function extractGrayscale(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) {
  const imageData = context.getImageData(0, 0, width, height);
  const grayscale = new Uint8Array(width * height);

  for (let offset = 0, pixel = 0; offset < imageData.data.length; offset += 4, pixel += 1) {
    const red = imageData.data[offset];
    const green = imageData.data[offset + 1];
    const blue = imageData.data[offset + 2];
    grayscale[pixel] = Math.round(red * 0.299 + green * 0.587 + blue * 0.114);
  }

  return grayscale;
}

function buildDarkMask(grayscale: Uint8Array) {
  const mask = new Uint8Array(grayscale.length);
  for (let index = 0; index < grayscale.length; index += 1) {
    mask[index] = grayscale[index] < 205 ? 1 : 0;
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

  const minRow = Math.max(3, Math.floor(width * 0.004));
  const minCol = Math.max(3, Math.floor(height * 0.012));
  const top = rows.findIndex((value) => value >= minRow);
  const bottom = findLastIndex(rows, (value) => value >= minRow);
  const left = cols.findIndex((value) => value >= minCol);
  const right = findLastIndex(cols, (value) => value >= minCol);

  if (top < 0 || left < 0 || right <= left || bottom <= top) {
    return { left: 0, top: 0, width, height };
  }

  return padRect(
    { left, top, width: right - left + 1, height: bottom - top + 1 },
    width,
    height,
    18,
  );
}

function detectConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: Rect,
) {
  const visited = new Uint8Array(width * height);
  const components: ConnectedComponent[] = [];
  let nextId = 1;

  const left = Math.round(bounds.left);
  const right = Math.min(width, Math.round(bounds.left + bounds.width));
  const top = Math.round(bounds.top);
  const bottom = Math.min(height, Math.round(bounds.top + bounds.height));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = y * width + x;
      if (!mask[offset] || visited[offset]) {
        continue;
      }

      const component = floodFill(mask, visited, width, height, x, y);
      if (component.area < 12 || component.width < 2 || component.height < 2) {
        continue;
      }

      components.push({
        id: `component-${nextId}`,
        left: component.left,
        top: component.top,
        width: component.width,
        height: component.height,
        area: component.area,
        density: component.area / Math.max(1, component.width * component.height),
        centerX: component.left + component.width / 2,
        centerY: component.top + component.height / 2,
      });

      nextId += 1;
    }
  }

  return components;
}

function buildTextRows(
  components: ConnectedComponent[],
  contentBounds: Rect,
  width: number,
  height: number,
) {
  const sorted = [...components].sort((left, right) => left.top - right.top);
  const rows: TextRow[] = [];
  const rowGap = Math.max(10, Math.round(contentBounds.height * 0.006));
  let nextId = 1;

  for (const component of sorted) {
    const current = rows.at(-1);
    if (!current) {
      rows.push(makeRow(nextId++, component));
      continue;
    }

    const rowBottom = current.rect.top + current.rect.height;
    const verticalGap = component.top - rowBottom;
    const overlapsVertically = component.top <= rowBottom;

    if (overlapsVertically || verticalGap <= rowGap) {
      current.components.push(component);
      current.rect = padRect(unionRects([current.rect, component]), width, height, 2);
      current.density =
        current.components.reduce((sum, item) => sum + item.density, 0) /
        current.components.length;
    } else {
      rows.push(makeRow(nextId++, component));
    }
  }

  return rows.filter((row) => row.rect.width > Math.max(26, contentBounds.width * 0.04));
}

function makeRow(id: number, component: ConnectedComponent): TextRow {
  return {
    id: `row-${id}`,
    rect: {
      left: component.left,
      top: component.top,
      width: component.width,
      height: component.height,
    },
    components: [component],
    density: component.density,
  };
}

function buildRowSegments(rows: TextRow[], width: number, height: number) {
  const segments: RowSegment[] = [];

  for (const row of rows) {
    const sorted = [...row.components].sort((left, right) => left.left - right.left);
    let group: ConnectedComponent[] = [];
    const splitGap = Math.max(8, row.rect.height * 0.32);

    for (const component of sorted) {
      const previous = group.at(-1);
      if (!previous) {
        group = [component];
        continue;
      }

      const gap = component.left - (previous.left + previous.width);
      if (gap > splitGap) {
        segments.push(makeSegment(row.id, segments.length + 1, group, width, height));
        group = [component];
      } else {
        group.push(component);
      }
    }

    if (group.length > 0) {
      segments.push(makeSegment(row.id, segments.length + 1, group, width, height));
    }
  }

  return segments;
}

function makeSegment(
  rowId: string,
  id: number,
  components: ConnectedComponent[],
  width: number,
  height: number,
): RowSegment {
  return {
    id: `segment-${id}`,
    rowId,
    rect: padRect(
      unionRects(
        components.map((component) => ({
          left: component.left,
          top: component.top,
          width: component.width,
          height: component.height,
        })),
      ),
      width,
      height,
      3,
    ),
    components,
  };
}

function detectAnchorCandidates(
  rows: TextRow[],
  rowSegments: RowSegment[],
  contentBounds: Rect,
) {
  const anchors: AnchorCandidate[] = [];

  for (const row of rows) {
    const segments = rowSegments
      .filter((segment) => segment.rowId === row.id)
      .sort((left, right) => left.rect.left - right.rect.left);

    if (segments.length < 2) {
      continue;
    }

    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index];
      const next = segments[index + 1];
      const segmentDensity =
        segment.components.reduce((sum, item) => sum + item.density, 0) / segment.components.length;
      const gapToNext = next.rect.left - (segment.rect.left + segment.rect.width);
      const likelyAnchor =
        segment.rect.width < Math.min(84, row.rect.width * 0.18) &&
        segment.rect.height <= row.rect.height * 1.4 &&
        next.rect.width > segment.rect.width * 1.05 &&
        gapToNext > Math.max(4, row.rect.height * 0.08);

      if (!likelyAnchor) {
        continue;
      }

      const score =
        (segment.rect.width < Math.min(64, row.rect.width * 0.16) ? 0.24 : 0.12) +
        (segmentDensity > 0.22 ? 0.18 : 0.08) +
        (next.rect.width > segment.rect.width * 1.6 ? 0.16 : 0.08) +
        (gapToNext > row.rect.height * 0.12 ? 0.12 : 0.08) +
        (segment.rect.left < contentBounds.left + contentBounds.width * 0.62 ? 0.1 : 0.05) +
        (segment.components.length <= 5 ? 0.12 : 0.04);

      if (score < 0.58) {
        continue;
      }

      anchors.push({
        id: `anchor-${anchors.length + 1}`,
        rect: segment.rect,
        row,
        score,
        inferredNumber: anchors.length + 1,
      });
    }
  }

  return dedupeAnchors(anchors)
    .sort(compareReadingOrder)
    .map((anchor, index) => ({ ...anchor, inferredNumber: index + 1 }));
}

function dedupeAnchors(anchors: AnchorCandidate[]) {
  const sorted = [...anchors].sort((left, right) => right.score - left.score);
  const kept: AnchorCandidate[] = [];

  for (const anchor of sorted) {
    const overlapsExisting = kept.some((candidate) =>
      intersects(padRect(candidate.rect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 6), anchor.rect),
    );
    if (!overlapsExisting) {
      kept.push(anchor);
    }
  }

  return kept;
}

function compareReadingOrder(left: { rect: Rect }, right: { rect: Rect }) {
  const sameRow =
    Math.abs(left.rect.top - right.rect.top) <
    Math.max(left.rect.height, right.rect.height) * 0.65;
  if (sameRow) {
    return left.rect.left - right.rect.left;
  }

  return left.rect.top - right.rect.top;
}

function detectSectionHeaders(
  rows: TextRow[],
  anchors: AnchorCandidate[],
  contentBounds: Rect,
  width: number,
  height: number,
) {
  const headers: SectionHeader[] = [];

  for (const row of rows) {
    const isAnchorRow = anchors.some((anchor) => intersects(anchor.row.rect, row.rect));
    if (isAnchorRow) {
      continue;
    }

    const likelyHeader =
      row.rect.width > contentBounds.width * 0.35 &&
      row.rect.height > 18 &&
      row.rect.left < contentBounds.left + contentBounds.width * 0.18;

    if (!likelyHeader) {
      continue;
    }

    const nearbyAnchors = anchors.filter(
      (anchor) => anchor.rect.top > row.rect.top && anchor.rect.top - row.rect.top < 180,
    );
    if (nearbyAnchors.length === 0) {
      continue;
    }

    headers.push({
      id: `section-${headers.length + 1}`,
      rects: [padRect(row.rect, width, height, 6)],
      unionBounds: padRect(row.rect, width, height, 8),
      confidence: 0.72,
    });
  }

  return headers;
}

function buildOwnershipZones(
  anchors: AnchorCandidate[],
  contentBounds: Rect,
  width: number,
  height: number,
) {
  if (anchors.length === 0) {
    return [];
  }

  const columnSplit = estimateColumnSplit(anchors, contentBounds);
  const columns = partitionAnchorsByColumn(anchors, columnSplit);
  const zones: OwnershipZone[] = [];

  columns.forEach((columnAnchors, columnIndex) => {
    const sorted = [...columnAnchors].sort((left, right) => left.rect.top - right.rect.top);
    const columnLeft = columnIndex === 0 ? contentBounds.left : columnSplit;
    const columnRight =
      columnIndex === columns.length - 1 ? contentBounds.left + contentBounds.width : columnSplit;

    for (let index = 0; index < sorted.length; index += 1) {
      const anchor = sorted[index];
      const previous = sorted[index - 1];
      const next = sorted[index + 1];
      const top = previous
        ? Math.round((previous.rect.top + previous.rect.height + anchor.rect.top) / 2)
        : Math.max(0, Math.round(anchor.rect.top - Math.min(80, anchor.rect.height * 2.4)));
      const bottom = next
        ? Math.round((anchor.rect.top + anchor.rect.height + next.rect.top) / 2)
        : Math.min(height, Math.round(anchor.rect.top + Math.max(150, contentBounds.height * 0.12)));

      zones.push({
        anchor,
        columnIndex,
        orderIndex: zones.length,
        rect: padRect(
          {
            left: columnLeft,
            top,
            width: Math.max(1, columnRight - columnLeft),
            height: Math.max(1, bottom - top),
          },
          width,
          height,
          8,
        ),
      });
    }
  });

  return zones.sort(
    (left, right) => (left.anchor.inferredNumber ?? left.orderIndex) - (right.anchor.inferredNumber ?? right.orderIndex),
  );
}

function estimateColumnSplit(anchors: AnchorCandidate[], contentBounds: Rect) {
  const centers = anchors
    .map((anchor) => anchor.rect.left + anchor.rect.width / 2)
    .sort((left, right) => left - right);
  if (centers.length < 4) {
    return contentBounds.left + contentBounds.width / 2;
  }

  let widestGap = 0;
  let split = contentBounds.left + contentBounds.width / 2;
  for (let index = 1; index < centers.length; index += 1) {
    const gap = centers[index] - centers[index - 1];
    if (gap > widestGap) {
      widestGap = gap;
      split = centers[index - 1] + gap / 2;
    }
  }

  if (widestGap < contentBounds.width * 0.12) {
    return contentBounds.left + contentBounds.width / 2;
  }

  return split;
}

function partitionAnchorsByColumn(anchors: AnchorCandidate[], split: number) {
  const left = anchors.filter((anchor) => anchor.rect.left + anchor.rect.width / 2 < split);
  const right = anchors.filter((anchor) => anchor.rect.left + anchor.rect.width / 2 >= split);

  if (left.length === 0 || right.length === 0) {
    return [anchors];
  }

  return [left, right];
}

function buildProblemRegions(
  components: ConnectedComponent[],
  rowSegments: RowSegment[],
  sectionHeaders: SectionHeader[],
  zones: OwnershipZone[],
  width: number,
  height: number,
) {
  if (zones.length === 0) {
    return [];
  }

  return zones.map((zone, index) => {
    const componentsInZone = components.filter((component) =>
      rectContains(zone.rect, component.centerX, component.centerY),
    );
    const segmentsInZone = rowSegments.filter((segment) =>
      rectContains(
        zone.rect,
        segment.rect.left + segment.rect.width / 2,
        segment.rect.top + segment.rect.height / 2,
      ),
    );
    const attachedHeader = sectionHeaders.find((header) => {
      if (index > 0) {
        const previous = zones[index - 1];
        if (
          header.unionBounds.top > previous.anchor.rect.top &&
          header.unionBounds.top < zone.anchor.rect.top
        ) {
          return false;
        }
      }

      return (
        header.unionBounds.top < zone.anchor.rect.top &&
        zone.anchor.rect.top - header.unionBounds.top < 180
      );
    });

    const contentRects = buildAssignedContentRects(
      segmentsInZone,
      zone.anchor.rect,
      componentsInZone,
      width,
      height,
    );
    const sectionHeaderRects = attachedHeader ? attachedHeader.rects : [];
    const anchorRect = padRect(zone.anchor.rect, width, height, 6);
    const allRects = [...sectionHeaderRects, anchorRect, ...contentRects];
    const unionBounds = padRect(unionRects(allRects), width, height, 10);
    const hasDiagram = componentsInZone.some(
      (component) =>
        component.width > Math.max(55, zone.rect.width * 0.18) &&
        component.height > Math.max(55, zone.rect.height * 0.12),
    );
    const compositionMode = chooseCompositionMode(contentRects, unionBounds, zone.rect);
    const fragments: InputProblemFragment[] = [
      {
        id: `${zone.anchor.id}-anchor`,
        kind: "anchor",
        rect: anchorRect,
        confidence: zone.anchor.score,
      },
      ...sectionHeaderRects.map((rect, headerIndex) => ({
        id: `${zone.anchor.id}-header-${headerIndex + 1}`,
        kind: "section-header" as const,
        rect,
        confidence: attachedHeader?.confidence ?? 0.6,
      })),
      ...contentRects.map((rect, rectIndex) => ({
        id: `${zone.anchor.id}-${hasDiagram && rect.height > unionBounds.height * 0.28 ? "diagram" : "content"}-${rectIndex + 1}`,
        kind:
          hasDiagram && rect.height > unionBounds.height * 0.28
            ? ("diagram" as const)
            : ("content" as const),
        rect,
        confidence: 0.72,
      })),
    ];

    return {
      id: `problem-${index + 1}`,
      problemNumber: zone.anchor.inferredNumber,
      orderIndex: index,
      anchorRect,
      contentRects,
      sectionHeaderRects,
      unionBounds,
      confidence: calculateProblemConfidence(zone, contentRects, hasDiagram),
      fragments,
      compositionMode,
      columnHint: zone.columnIndex,
    } satisfies InputProblemRegion;
  });
}

function buildAssignedContentRects(
  segmentsInZone: RowSegment[],
  anchorRect: Rect,
  componentsInZone: ConnectedComponent[],
  width: number,
  height: number,
) {
  const filteredSegments = segmentsInZone
    .filter(
      (segment) =>
        segment.rect.top >= anchorRect.top - 8 &&
        !intersects(
          padRect(anchorRect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 4),
          segment.rect,
        ),
    )
    .sort((left, right) => compareReadingOrder({ rect: left.rect }, { rect: right.rect }));
  const rects = mergeSegmentsByRow(filteredSegments, width, height);

  const diagramRects = mergeDiagramRects(
    componentsInZone.filter(
      (component) =>
        component.width > 48 &&
        component.height > 48 &&
        !rects.some((rect) => intersects(rect, component)),
    ),
    width,
    height,
  );

  const combined = [...rects, ...diagramRects].sort((left, right) =>
    compareReadingOrder({ rect: left }, { rect: right }),
  );

  return combined.length > 0 ? combined : [padRect(anchorRect, width, height, 8)];
}

function mergeSegmentsByRow(segments: RowSegment[], width: number, height: number) {
  const byRow = new Map<string, RowSegment[]>();

  for (const segment of segments) {
    const rowSegments = byRow.get(segment.rowId) ?? [];
    rowSegments.push(segment);
    byRow.set(segment.rowId, rowSegments);
  }

  const merged: Rect[] = [];

  for (const rowSegments of byRow.values()) {
    const sorted = [...rowSegments].sort((left, right) => left.rect.left - right.rect.left);
    let current: Rect | null = null;

    for (const segment of sorted) {
      const rect = padRect(segment.rect, width, height, 4);
      if (!current) {
        current = rect;
        continue;
      }

      const gap = rect.left - (current.left + current.width);
      if (gap <= Math.max(18, current.height * 0.9)) {
        current = padRect(unionRects([current, rect]), width, height, 2);
      } else {
        merged.push(current);
        current = rect;
      }
    }

    if (current) {
      merged.push(current);
    }
  }

  return merged.sort((left, right) => compareReadingOrder({ rect: left }, { rect: right }));
}

function mergeDiagramRects(
  components: ConnectedComponent[],
  width: number,
  height: number,
) {
  const merged: Rect[] = [];

  for (const component of components) {
    const rect = padRect(component, width, height, 6);
    const existingIndex = merged.findIndex((candidate) =>
      intersects(
        padRect(candidate, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 10),
        rect,
      ),
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = padRect(
        unionRects([merged[existingIndex], rect]),
        width,
        height,
        4,
      );
    } else {
      merged.push(rect);
    }
  }

  return merged;
}

function chooseCompositionMode(contentRects: Rect[], unionBounds: Rect, zoneRect: Rect): CompositionMode {
  if (contentRects.length > 8 || unionBounds.height > zoneRect.height * 0.92) {
    return "union-fallback";
  }

  return "composite-stack";
}

function calculateProblemConfidence(
  zone: OwnershipZone,
  contentRects: Rect[],
  hasDiagram: boolean,
) {
  const base = 0.45 + Math.min(0.22, zone.anchor.score * 0.22);
  const contentScore = Math.min(0.18, contentRects.length * 0.03);
  const complexityPenalty = hasDiagram ? 0.04 : 0;
  return clamp(base + contentScore - complexityPenalty, 0.28, 0.96);
}

async function buildCropAssets(
  sourceCanvas: HTMLCanvasElement,
  problemRegions: InputProblemRegion[],
) {
  return Promise.all(
    problemRegions.map(async (region) => {
      const classification = classifyProblem(region);
      const renderedCanvas =
        region.compositionMode === "union-fallback"
          ? cropUnionRegion(sourceCanvas, region.unionBounds)
          : composeRegionStack(sourceCanvas, region);
      const blob = await canvasToBlob(renderedCanvas);
      const bytes = new Uint8Array(await blob.arrayBuffer());

      return {
        regionId: region.id,
        bytes,
        width: renderedCanvas.width,
        height: renderedCanvas.height,
        classification,
        problemNumber: region.problemNumber,
        compositionMode: region.compositionMode,
      } satisfies CropAsset;
    }),
  );
}

function classifyProblem(region: InputProblemRegion) {
  const diagramLike = region.fragments.some((fragment) => fragment.kind === "diagram");
  if (diagramLike || region.unionBounds.height > 260 || region.contentRects.length > 5) {
    return "complex" as const;
  }

  if (region.unionBounds.height < 88 && region.contentRects.length <= 2) {
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

function composeRegionStack(sourceCanvas: HTMLCanvasElement, region: InputProblemRegion) {
  const rects = [
    ...region.sectionHeaderRects.map((rect) => ({ rect })),
    { rect: region.anchorRect },
    ...region.contentRects.map((rect) => ({ rect })),
  ];
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

async function buildWorksheetPdf(crops: CropAsset[]) {
  const pdf = await PDFDocument.create();
  const pageWidth = 612;
  const pageHeight = 792;
  const margin = 36;
  const gutter = 18;
  const contentWidth = pageWidth - margin * 2;
  const threeColumnWidth = (contentWidth - gutter * 2) / 3;
  const twoColumnWidth = (contentWidth - gutter) / 2;
  const rows = buildLayoutRows(crops);
  const items: WorksheetItem[] = [];

  let page = pdf.addPage([pageWidth, pageHeight]);
  let pageIndex = 0;
  let cursorY = pageHeight - margin;

  for (const row of rows) {
    const placements = row.map((crop, index) => {
      const columnSpan = chooseColumnSpan(crop);
      const slotWidth =
        row.length === 3 ? threeColumnWidth : row.length === 2 ? twoColumnWidth : contentWidth;
      const layoutMode = chooseLayoutMode(crop, slotWidth);
      const placement = measureItem(layoutMode, crop.width, crop.height, slotWidth, crop.classification);
      return {
        crop,
        columnSpan,
        placement,
        x:
          row.length === 3
            ? margin + index * (threeColumnWidth + gutter)
            : row.length === 2
              ? margin + index * (twoColumnWidth + gutter)
              : margin,
      };
    });

    const rowHeight = Math.max(...placements.map((item) => item.placement.blockHeight));
    if (cursorY - rowHeight < margin) {
      page = pdf.addPage([pageWidth, pageHeight]);
      pageIndex += 1;
      cursorY = pageHeight - margin;
    }

    for (const item of placements) {
      const image = await pdf.embedPng(item.crop.bytes);
      drawWorksheetItem(page, image, item.x, cursorY, item.placement);
      items.push({
        id: `item-${items.length + 1}`,
        regionId: item.crop.regionId,
        pageIndex,
        layoutMode: item.placement.layoutMode,
        compositionMode: item.crop.compositionMode,
        problemNumber: item.crop.problemNumber,
        columnSpan: item.columnSpan,
        promptSize: {
          width: Math.round(item.placement.prompt.width),
          height: Math.round(item.placement.prompt.height),
        },
        answerArea: {
          width: Math.round(item.placement.answer.width),
          height: Math.round(item.placement.answer.height),
        },
      });
    }

    cursorY -= rowHeight + 18;
  }

  return {
    bytes: await pdf.save(),
    pageCount: pdf.getPageCount(),
    items,
  };
}

function buildLayoutRows(crops: CropAsset[]) {
  const rows: CropAsset[][] = [];
  let index = 0;

  while (index < crops.length) {
    const current = crops[index];
    if (chooseColumnSpan(current) === 3) {
      rows.push([current]);
      index += 1;
      continue;
    }

    if (current.classification === "simple") {
      const simpleRow = [current];
      let lookahead = index + 1;
      while (
        simpleRow.length < 3 &&
        lookahead < crops.length &&
        crops[lookahead].classification === "simple"
      ) {
        simpleRow.push(crops[lookahead]);
        lookahead += 1;
      }

      rows.push(simpleRow);
      index += simpleRow.length;
      continue;
    }

    const pair = [current];
    if (index + 1 < crops.length && chooseColumnSpan(crops[index + 1]) !== 3) {
      pair.push(crops[index + 1]);
      index += 2;
    } else {
      index += 1;
    }

    rows.push(pair);
  }

  return rows;
}

function chooseColumnSpan(crop: CropAsset): 1 | 2 | 3 {
  if (crop.classification === "complex" || crop.height > 260) {
    return 3;
  }

  if (crop.classification === "standard") {
    return 2;
  }

  return 1;
}

function chooseLayoutMode(crop: CropAsset, slotWidth: number): LayoutMode {
  if (
    crop.classification === "complex" ||
    crop.height > 180 ||
    crop.width > slotWidth * 0.82
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
) {
  if (layoutMode === "side") {
    const promptTargetWidth =
      classification === "simple" ? slotWidth * 0.42 : slotWidth * 0.46;
    const promptScale = Math.min(promptTargetWidth / width, 120 / height, 1.65);
    const promptWidth = width * promptScale;
    const promptHeight = height * promptScale;
    const answerWidth = Math.max(110, slotWidth - promptWidth - 16);
    const answerHeight = Math.max(classification === "simple" ? 94 : 118, promptHeight + 8);

    return {
      layoutMode,
      blockHeight: Math.max(promptHeight, answerHeight) + 16,
      prompt: { width: promptWidth, height: promptHeight },
      answer: { width: answerWidth, height: answerHeight },
      gap: 16,
      stack: false,
    };
  }

  const promptScale = Math.min(
    slotWidth / width,
    classification === "complex" ? 0.95 : 1.2,
    180 / height,
  );
  const promptWidth = width * promptScale;
  const promptHeight = height * promptScale;
  const answerHeight =
    classification === "complex"
      ? Math.max(150, Math.min(210, promptHeight * 0.9))
      : Math.max(128, Math.min(176, promptHeight * 0.85));

  return {
    layoutMode,
    blockHeight: promptHeight + answerHeight + 24,
    prompt: { width: promptWidth, height: promptHeight },
    answer: { width: slotWidth, height: answerHeight },
    gap: 10,
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
      start: { x: x + 10, y: lineY },
      end: { x: x + width - 10, y: lineY },
      thickness: 0.75,
      color: rgb(0.9, 0.78, 0.72),
      opacity: 0.92,
    });
  }
}

function summarizeConfidence(problemRegions: InputProblemRegion[]): ConfidenceSummary {
  const averageConfidence =
    problemRegions.reduce((sum, region) => sum + region.confidence, 0) /
    Math.max(1, problemRegions.length);
  const lowConfidenceCount = problemRegions.filter((region) => region.confidence < 0.55).length;

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
  const finiteWidth = Number.isFinite(maxWidth)
    ? maxWidth
    : rect.left + rect.width + padding * 4;
  const finiteHeight = Number.isFinite(maxHeight)
    ? maxHeight
    : rect.top + rect.height + padding * 4;
  const left = Math.max(0, Math.floor(rect.left - padding));
  const top = Math.max(0, Math.floor(rect.top - padding));
  const right = Math.min(finiteWidth, Math.ceil(rect.left + rect.width + padding));
  const bottom = Math.min(finiteHeight, Math.ceil(rect.top + rect.height + padding));

  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

function unionRects(rects: Rect[]) {
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

function intersects(a: Rect, b: Rect) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function rectContains(rect: Rect, x: number, y: number) {
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
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
