import type {
  AnchorRecognition,
  ConfidenceSummary,
  DetectionDebugSnapshot,
  InputProblemFragment,
  ProblemDraft,
  Rect,
  SectionHeader,
} from "@/lib/types";

type AnalyzeImageInput = {
  grayscale: Uint8Array;
  width: number;
  height: number;
  rgba?: Uint8Array | Uint8ClampedArray;
};

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
  centerY: number;
};

type RowSegment = {
  id: string;
  rowId: string;
  rect: Rect;
  components: ConnectedComponent[];
};

type AnalysisRect = Rect & {
  analysisLeft?: never;
};

export type WorksheetAnchorProposal = {
  id: string;
  rect: Rect;
  rowId: string;
  segmentId: string;
  score: number;
  reason: string;
};

type InternalAnchorProposal = WorksheetAnchorProposal & {
  analysisRect: AnalysisRect;
  contentAfter: boolean;
  dotLike: boolean;
};

type LayoutRegion = {
  id: string;
  rect: Rect;
  analysisRect: Rect;
};

type AcceptedAnchor = InternalAnchorProposal & {
  sourceLabel: string | null;
  recognitionConfidence: number;
  clusterIndex: number;
  regionIndex: number;
};

type OwnershipZone = {
  id: string;
  anchor: AcceptedAnchor;
  rect: Rect;
  analysisRect: Rect;
  orderIndex: number;
};

type NormalizedImage = {
  grayscale: Uint8Array;
  rgba?: Uint8Array;
  width: number;
  height: number;
  scale: number;
  sourceWidth: number;
  sourceHeight: number;
};

export type WorksheetDetectionStructure = {
  sourceWidth: number;
  sourceHeight: number;
  analysisWidth: number;
  analysisHeight: number;
  normalizationScale: number;
  glyphHeight: number;
  contentBounds: Rect;
  analysisContentBounds: Rect;
  rows: Array<{ id: string; rect: Rect }>;
  segments: Array<{ id: string; rowId: string; rect: Rect }>;
  layoutRegions: Array<{ id: string; rect: Rect }>;
  proposals: WorksheetAnchorProposal[];
  internal: {
    contentComponents: ConnectedComponent[];
    rows: TextRow[];
    segments: RowSegment[];
    layoutRegions: LayoutRegion[];
    proposals: InternalAnchorProposal[];
  };
};

const TARGET_GLYPH_HEIGHT = 18;
const MAX_ANALYSIS_EDGE = 2200;

export function detectWorksheetStructure(input: AnalyzeImageInput): WorksheetDetectionStructure {
  assertImageInput(input);

  const normalized = normalizeImage(input);
  const initialTextMask = buildAdaptiveMask(normalized, 13, true);
  const contentMask = buildAdaptiveMask(normalized, 8, false);
  const analysisContentBounds = detectContentBounds(
    contentMask,
    normalized.width,
    normalized.height,
  );
  const contentComponents = detectConnectedComponents(
    contentMask,
    normalized.width,
    normalized.height,
    analysisContentBounds,
    4,
  );
  const initialComponents = detectConnectedComponents(
    initialTextMask,
    normalized.width,
    normalized.height,
    analysisContentBounds,
    3,
  );
  const glyphHeight = clamp(
    Math.max(TARGET_GLYPH_HEIGHT, estimateNormalizedGlyphHeight(initialComponents)),
    16,
    26,
  );
  const textComponents = initialComponents.filter((component) =>
    isTextLikeComponent(component, glyphHeight),
  );
  const rows = buildTextRows(textComponents, glyphHeight, normalized.width, normalized.height);
  const segments = buildRowSegments(rows, glyphHeight, normalized.width, normalized.height);
  const layoutRegions = detectLayoutRegions(
    contentMask,
    analysisContentBounds,
    glyphHeight,
    normalized,
  );
  const proposals = detectAnchorProposals(
    rows,
    segments,
    contentComponents,
    layoutRegions,
    glyphHeight,
    normalized,
  );

  return {
    sourceWidth: normalized.sourceWidth,
    sourceHeight: normalized.sourceHeight,
    analysisWidth: normalized.width,
    analysisHeight: normalized.height,
    normalizationScale: normalized.scale,
    glyphHeight,
    contentBounds: fromAnalysisRect(analysisContentBounds, normalized),
    analysisContentBounds,
    rows: rows.map((row) => ({ id: row.id, rect: fromAnalysisRect(row.rect, normalized) })),
    segments: segments.map((segment) => ({
      id: segment.id,
      rowId: segment.rowId,
      rect: fromAnalysisRect(segment.rect, normalized),
    })),
    layoutRegions: layoutRegions.map((region) => ({ id: region.id, rect: region.rect })),
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      rect: proposal.rect,
      rowId: proposal.rowId,
      segmentId: proposal.segmentId,
      score: proposal.score,
      reason: proposal.reason,
    })),
    internal: {
      contentComponents,
      rows,
      segments,
      layoutRegions,
      proposals,
    },
  };
}

export function finalizeWorksheetDetection(
  structure: WorksheetDetectionStructure,
  recognitions: AnchorRecognition[],
) {
  const recognitionByProposal = new Map(
    recognitions
      .map((recognition) => ({
        ...recognition,
        sourceLabel: normalizeSourceLabel(recognition.sourceLabel),
      }))
      .filter((recognition) => recognition.sourceLabel)
      .map((recognition) => [recognition.proposalId, recognition]),
  );
  const allRecognized = structure.internal.proposals
    .map((proposal) => {
      const recognition = recognitionByProposal.get(proposal.id);
      if (!recognition) {
        return null;
      }

      return {
        ...proposal,
        sourceLabel: recognition.sourceLabel,
        recognitionConfidence: clamp(recognition.confidence, 0, 1),
      };
    })
    .filter((proposal): proposal is InternalAnchorProposal & {
      sourceLabel: string;
      recognitionConfidence: number;
    } => Boolean(proposal));
  const recognized = allRecognized.filter(
    (proposal) => proposal.recognitionConfidence >= 0.18,
  );

  let anchors = selectRecognizedAnchors(structure, recognized);
  anchors = supplementGeometricRuns(structure, anchors, allRecognized);
  anchors = completeSameRowSequenceGaps(structure, anchors);
  anchors = dedupeExpandedAnchorsBySequence(structure, anchors);
  anchors = correctAlignedTrackSequences(structure, anchors);
  let fallbackUsed = false;

  if (anchors.length === 0) {
    anchors = selectGeometricAnchors(structure);
    fallbackUsed = true;
  }

  const sectionHeaders = detectSectionHeaders(structure, anchors);
  const zones = buildOwnershipZones(structure, anchors);
  let problemDrafts = buildProblemDrafts(structure, anchors, zones, sectionHeaders);

  if (problemDrafts.length === 0 && hasSubstantialContent(structure)) {
    problemDrafts = buildFallbackBlockDrafts(structure);
    fallbackUsed = true;
  }

  const failureReason =
    problemDrafts.length === 0
      ? "No worksheet content could be separated into problem regions. Draw regions manually."
      : null;
  const warnings = [
    ...(fallbackUsed && problemDrafts.length > 0
      ? ["Problem regions were inferred geometrically; review labels and boxes before printing."]
      : []),
    ...(problemDrafts.length === 0
      ? ["No reviewable regions were found; manual region drawing is available."]
      : []),
  ];
  const acceptedIds = new Set(anchors.map((anchor) => anchor.id));

  return {
    problemDrafts,
    sectionHeaders,
    debug: {
      contentBounds: structure.contentBounds,
      normalizationScale: structure.normalizationScale,
      rows: structure.rows.map(({ id, rect }) => ({ id, rect })),
      segments: structure.segments.map(({ id, rect }) => ({ id, rect })),
      columns: structure.layoutRegions.map(({ id, rect }) => ({ id, rect })),
      layoutTracks: buildTrackDebugRects(structure, anchors),
      zones: zones.map((zone) => ({ id: zone.id, rect: zone.rect })),
      anchorCandidates: structure.internal.proposals.map((proposal) => ({
        id: proposal.id,
        rect: proposal.rect,
        rowId: proposal.rowId,
        score: proposal.score,
        accepted: acceptedIds.has(proposal.id),
        reason: acceptedIds.has(proposal.id)
          ? recognitionByProposal.has(proposal.id)
            ? "recognized numbered anchor in an aligned track"
            : "geometrically inferred anchor in an aligned track"
          : proposal.reason,
      })),
      rejectedAnchorReasons: summarizeRejectedReasons(structure, recognitionByProposal, anchors),
      sectionHeaders,
      stageCounts: {
        components: structure.internal.contentComponents.length,
        textComponents: structure.internal.rows.reduce(
          (sum, row) => sum + row.components.length,
          0,
        ),
        rows: structure.rows.length,
        segments: structure.segments.length,
        proposals: structure.proposals.length,
        recognizedAnchors: recognized.length,
        acceptedAnchors: anchors.length,
      },
      fallbackUsed,
      warnings,
      failureReason,
    } satisfies DetectionDebugSnapshot,
  };
}

export function analyzeWorksheetImage(input: AnalyzeImageInput) {
  const structure = detectWorksheetStructure(input);
  const recognitions = inferDeterministicRecognitions(structure);
  return finalizeWorksheetDetection(structure, recognitions);
}

export function formatDuplicateSourceLabels(labels: Array<string | null>) {
  const seen = new Map<string, number>();

  return labels.map((label, index) => {
    const base = label?.trim() || String(index + 1);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}.${count}`;
  });
}

export function summarizeConfidence(problemDrafts: ProblemDraft[]): ConfidenceSummary {
  const included = problemDrafts.filter((draft) => draft.included);
  const averageConfidence =
    included.reduce((sum, region) => sum + region.confidence, 0) /
    Math.max(1, included.length);
  const lowConfidenceCount = included.filter((region) => region.confidence < 0.55).length;

  return {
    averageConfidence,
    lowConfidenceCount,
  };
}

function assertImageInput({ grayscale, height, width }: AnalyzeImageInput) {
  if (width <= 0 || height <= 0 || grayscale.length !== width * height) {
    throw new Error("Worksheet image data has invalid dimensions.");
  }
}

function normalizeImage(input: AnalyzeImageInput): NormalizedImage {
  const estimatedGlyphHeight = estimateSourceGlyphHeight(input.grayscale, input.width, input.height);
  const targetScale = TARGET_GLYPH_HEIGHT / Math.max(1, estimatedGlyphHeight);
  const edgeScale = MAX_ANALYSIS_EDGE / Math.max(input.width, input.height);
  const scale = clamp(Math.min(targetScale, edgeScale), 0.58, 3.2);
  const width = Math.max(1, Math.round(input.width * scale));
  const height = Math.max(1, Math.round(input.height * scale));

  if (width === input.width && height === input.height) {
    return {
      grayscale: input.grayscale,
      rgba: input.rgba ? new Uint8Array(input.rgba) : undefined,
      width,
      height,
      scale: 1,
      sourceWidth: input.width,
      sourceHeight: input.height,
    };
  }

  const grayscale = resizeGrayscale(input.grayscale, input.width, input.height, width, height);
  const rgba = input.rgba
    ? resizeRgba(input.rgba, input.width, input.height, width, height)
    : undefined;

  return {
    grayscale,
    rgba,
    width,
    height,
    scale: width / input.width,
    sourceWidth: input.width,
    sourceHeight: input.height,
  };
}

function estimateSourceGlyphHeight(grayscale: Uint8Array, width: number, height: number) {
  const sampleScale = Math.min(1, 900 / Math.max(width, height));
  const sampleWidth = Math.max(1, Math.round(width * sampleScale));
  const sampleHeight = Math.max(1, Math.round(height * sampleScale));
  const sample =
    sampleScale === 1
      ? grayscale
      : resizeGrayscale(grayscale, width, height, sampleWidth, sampleHeight);
  const mask = new Uint8Array(sample.length);

  for (let index = 0; index < sample.length; index += 1) {
    mask[index] = sample[index] < 190 ? 1 : 0;
  }

  const components = detectConnectedComponents(
    mask,
    sampleWidth,
    sampleHeight,
    { left: 0, top: 0, width: sampleWidth, height: sampleHeight },
    2,
  );
  const heights = components
    .filter(
      (component) =>
        component.height >= 3 &&
        component.height <= Math.max(45, sampleHeight * 0.07) &&
        component.width <= Math.max(90, component.height * 8) &&
        component.area <= 2200 &&
        component.density > 0.035,
    )
    .map((component) => component.height / sampleScale)
    .sort((left, right) => left - right);

  if (heights.length === 0) {
    return Math.max(8, Math.min(24, height * 0.018));
  }

  const lower = Math.floor(heights.length * 0.28);
  const upper = Math.max(lower + 1, Math.ceil(heights.length * 0.82));
  return median(heights.slice(lower, upper));
}

function resizeGrayscale(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  const output = new Uint8Array(width * height);
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    const y0 = clamp(Math.floor(sourceY), 0, sourceHeight - 1);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fy = sourceY - Math.floor(sourceY);

    for (let x = 0; x < width; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const x0 = clamp(Math.floor(sourceX), 0, sourceWidth - 1);
      const x1 = Math.min(sourceWidth - 1, x0 + 1);
      const fx = sourceX - Math.floor(sourceX);
      const top = source[y0 * sourceWidth + x0] * (1 - fx) + source[y0 * sourceWidth + x1] * fx;
      const bottom =
        source[y1 * sourceWidth + x0] * (1 - fx) + source[y1 * sourceWidth + x1] * fx;
      output[y * width + x] = Math.round(top * (1 - fy) + bottom * fy);
    }
  }

  return output;
}

function resizeRgba(
  source: Uint8Array | Uint8ClampedArray,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
) {
  const output = new Uint8Array(width * height * 4);
  const scaleX = sourceWidth / width;
  const scaleY = sourceHeight / height;

  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor(y * scaleY));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor(x * scaleX));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const outputOffset = (y * width + x) * 4;
      output[outputOffset] = source[sourceOffset];
      output[outputOffset + 1] = source[sourceOffset + 1];
      output[outputOffset + 2] = source[sourceOffset + 2];
      output[outputOffset + 3] = source[sourceOffset + 3];
    }
  }

  return output;
}

function buildAdaptiveMask(
  image: NormalizedImage,
  offset: number,
  suppressColoredGuides: boolean,
) {
  const { grayscale, height, rgba, width } = image;
  const integral = new Float64Array((width + 1) * (height + 1));

  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += grayscale[y * width + x];
      integral[(y + 1) * (width + 1) + x + 1] =
        integral[y * (width + 1) + x + 1] + rowSum;
    }
  }

  const radius = 24;
  const mask = new Uint8Array(width * height);

  for (let y = 0; y < height; y += 1) {
    const top = Math.max(0, y - radius);
    const bottom = Math.min(height, y + radius + 1);
    for (let x = 0; x < width; x += 1) {
      const left = Math.max(0, x - radius);
      const right = Math.min(width, x + radius + 1);
      const area = (right - left) * (bottom - top);
      const sum =
        integral[bottom * (width + 1) + right] -
        integral[top * (width + 1) + right] -
        integral[bottom * (width + 1) + left] +
        integral[top * (width + 1) + left];
      const localMean = sum / Math.max(1, area);
      const index = y * width + x;
      const value = grayscale[index];

      if (value >= Math.min(238, localMean - offset) && value >= 112) {
        continue;
      }

      if (suppressColoredGuides && rgba) {
        const rgbaOffset = index * 4;
        const red = rgba[rgbaOffset];
        const green = rgba[rgbaOffset + 1];
        const blue = rgba[rgbaOffset + 2];
        const maximum = Math.max(red, green, blue);
        const minimum = Math.min(red, green, blue);
        const saturated = maximum - minimum > 45;
        const blueGuide = saturated && blue > red * 1.28 && blue > green * 1.08;
        const redGuide = saturated && red > green * 1.45 && red > blue * 1.25;
        if (blueGuide || redGuide) {
          continue;
        }
      }

      mask[index] = 1;
    }
  }

  return cleanMask(mask, width, height);
}

function cleanMask(mask: Uint8Array, width: number, height: number) {
  const bridged = new Uint8Array(mask);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (mask[index]) {
        continue;
      }

      if (
        (mask[index - 1] && mask[index + 1]) ||
        (mask[index - width] && mask[index + width])
      ) {
        bridged[index] = 1;
      }
    }
  }

  const cleaned = new Uint8Array(bridged);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const index = y * width + x;
      if (!bridged[index]) {
        continue;
      }

      let neighbors = 0;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) {
            continue;
          }
          neighbors += bridged[(y + offsetY) * width + x + offsetX];
        }
      }
      if (neighbors === 0) {
        cleaned[index] = 0;
      }
    }
  }

  return cleaned;
}

function detectContentBounds(mask: Uint8Array, width: number, height: number): Rect {
  const rows = new Array<number>(height).fill(0);
  const columns = new Array<number>(width).fill(0);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dark = mask[y * width + x];
      rows[y] += dark;
      columns[x] += dark;
    }
  }

  const minRow = Math.max(3, Math.floor(width * 0.003));
  const minColumn = Math.max(3, Math.floor(height * 0.006));
  const top = rows.findIndex((value) => value >= minRow);
  const bottom = findLastIndex(rows, (value) => value >= minRow);
  const left = columns.findIndex((value) => value >= minColumn);
  const right = findLastIndex(columns, (value) => value >= minColumn);

  if (top < 0 || left < 0 || right <= left || bottom <= top) {
    return { left: 0, top: 0, width, height };
  }

  return padRect(
    { left, top, width: right - left + 1, height: bottom - top + 1 },
    width,
    height,
    12,
  );
}

function detectConnectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
  bounds: Rect,
  minArea: number,
) {
  const visited = new Uint8Array(width * height);
  const components: ConnectedComponent[] = [];
  const left = Math.max(0, Math.floor(bounds.left));
  const right = Math.min(width, Math.ceil(bounds.left + bounds.width));
  const top = Math.max(0, Math.floor(bounds.top));
  const bottom = Math.min(height, Math.ceil(bounds.top + bounds.height));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = y * width + x;
      if (!mask[index] || visited[index]) {
        continue;
      }

      const component = floodFill(mask, visited, width, height, x, y);
      if (component.area < minArea || component.width < 1 || component.height < 1) {
        continue;
      }

      components.push({
        id: `component-${components.length + 1}`,
        ...component,
        density: component.area / Math.max(1, component.width * component.height),
        centerX: component.left + component.width / 2,
        centerY: component.top + component.height / 2,
      });
    }
  }

  return components;
}

function estimateNormalizedGlyphHeight(components: ConnectedComponent[]) {
  const heights = components
    .filter(
      (component) =>
        component.height >= 5 &&
        component.height <= 42 &&
        component.width <= Math.max(80, component.height * 7) &&
        component.area <= 2400 &&
        component.density > 0.03,
    )
    .map((component) => component.height)
    .sort((left, right) => left - right);

  return heights.length > 0 ? clamp(median(heights), 10, 24) : TARGET_GLYPH_HEIGHT;
}

function isTextLikeComponent(component: ConnectedComponent, glyphHeight: number) {
  return (
    component.height <= glyphHeight * 3.1 &&
    component.width <= glyphHeight * 10 &&
    component.area <= glyphHeight * glyphHeight * 18 &&
    component.density > 0.025
  );
}

function buildTextRows(
  components: ConnectedComponent[],
  glyphHeight: number,
  width: number,
  height: number,
) {
  const sorted = [...components].sort((left, right) => {
    if (Math.abs(left.centerY - right.centerY) <= 1) {
      return left.left - right.left;
    }
    return left.centerY - right.centerY;
  });
  const rows: TextRow[] = [];

  for (const component of sorted) {
    const tolerance = Math.max(glyphHeight * 0.48, component.height * 0.58);
    const candidates = rows
      .map((row, index) => ({ index, distance: Math.abs(row.centerY - component.centerY) }))
      .filter(({ distance }) => distance <= tolerance)
      .sort((left, right) => left.distance - right.distance);
    const target = candidates[0] ? rows[candidates[0].index] : null;

    if (!target) {
      rows.push({
        id: `row-${rows.length + 1}`,
        rect: component,
        components: [component],
        centerY: component.centerY,
      });
      continue;
    }

    target.components.push(component);
    target.rect = unionRects([target.rect, component]);
    target.centerY = median(target.components.map((item) => item.centerY));
  }

  return rows
    .filter(
      (row) =>
        row.rect.width >= glyphHeight * 0.7 &&
        row.rect.height < Math.max(glyphHeight * 6, height * 0.16),
    )
    .sort((left, right) => left.centerY - right.centerY)
    .map((row, index) => ({
      ...row,
      id: `row-${index + 1}`,
      rect: padRect(row.rect, width, height, 0),
    }));
}

function buildRowSegments(
  rows: TextRow[],
  glyphHeight: number,
  width: number,
  height: number,
) {
  const segments: RowSegment[] = [];
  const splitGap = glyphHeight * 1.45;

  for (const row of rows) {
    const sorted = [...row.components].sort((left, right) => left.left - right.left);
    let group: ConnectedComponent[] = [];

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
  index: number,
  components: ConnectedComponent[],
  width: number,
  height: number,
): RowSegment {
  return {
    id: `segment-${index}`,
    rowId,
    rect: padRect(unionRects(components), width, height, 0),
    components,
  };
}

function detectLayoutRegions(
  mask: Uint8Array,
  contentBounds: Rect,
  glyphHeight: number,
  image: NormalizedImage,
) {
  const left = Math.max(0, Math.floor(contentBounds.left));
  const right = Math.min(image.width, Math.ceil(contentBounds.left + contentBounds.width));
  const top = Math.max(0, Math.floor(contentBounds.top));
  const bottom = Math.min(image.height, Math.ceil(contentBounds.top + contentBounds.height));
  const columns = new Array<number>(right - left).fill(0);

  for (let x = left; x < right; x += 1) {
    let ink = 0;
    for (let y = top; y < bottom; y += 1) {
      ink += mask[y * image.width + x];
    }
    columns[x - left] = ink;
  }

  const window = Math.max(3, Math.round(glyphHeight * 0.8));
  const smoothed = movingAverage(columns, window);
  const lowInk = Math.max(1.5, contentBounds.height * 0.0045);
  const gutters: Array<{ start: number; end: number }> = [];
  let gutterStart: number | null = null;

  for (let index = 0; index < smoothed.length; index += 1) {
    const insideEdge =
      index > contentBounds.width * 0.12 && index < contentBounds.width * 0.88;
    if (insideEdge && smoothed[index] <= lowInk) {
      gutterStart ??= index;
      continue;
    }

    if (gutterStart !== null) {
      if (index - gutterStart >= glyphHeight * 1.35) {
        gutters.push({ start: gutterStart, end: index - 1 });
      }
      gutterStart = null;
    }
  }

  const usefulGutters = gutters
    .sort((a, b) => b.end - b.start - (a.end - a.start))
    .filter((gutter, index, all) => {
      const center = left + (gutter.start + gutter.end) / 2;
      return !all.slice(0, index).some((other) => {
        const otherCenter = left + (other.start + other.end) / 2;
        return Math.abs(center - otherCenter) < contentBounds.width * 0.16;
      });
    })
    .slice(0, 2)
    .sort((a, b) => a.start - b.start);

  if (
    usefulGutters.length === 0 &&
    contentBounds.width / Math.max(1, contentBounds.height) > 1.2 &&
    contentBounds.height > contentBounds.width * 0.55
  ) {
    const center = contentBounds.width / 2;
    usefulGutters.push({ start: center - glyphHeight, end: center + glyphHeight });
  }
  const boundaries = [contentBounds.left];

  for (const gutter of usefulGutters) {
    boundaries.push(left + (gutter.start + gutter.end) / 2);
  }
  boundaries.push(contentBounds.left + contentBounds.width);

  const regions: LayoutRegion[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const regionLeft = boundaries[index];
    const regionRight = boundaries[index + 1];
    if (regionRight - regionLeft < glyphHeight * 8) {
      continue;
    }
    const analysisRect = {
      left: regionLeft,
      top: contentBounds.top,
      width: regionRight - regionLeft,
      height: contentBounds.height,
    };
    regions.push({
      id: `layout-${regions.length + 1}`,
      analysisRect,
      rect: fromAnalysisRect(analysisRect, image),
    });
  }

  if (regions.length === 0) {
    return [
      {
        id: "layout-1",
        analysisRect: contentBounds,
        rect: fromAnalysisRect(contentBounds, image),
      },
    ];
  }

  return regions;
}

function detectAnchorProposals(
  rows: TextRow[],
  segments: RowSegment[],
  contentComponents: ConnectedComponent[],
  layoutRegions: LayoutRegion[],
  glyphHeight: number,
  image: NormalizedImage,
) {
  const proposals: InternalAnchorProposal[] = [];

  for (const segment of segments) {
    const sorted = [...segment.components].sort((left, right) => left.left - right.left);
    const startIndices = findPrefixStartIndices(sorted, glyphHeight);

    for (const startIndex of startIndices) {
      const candidateComponents = sorted.slice(startIndex);
      const prefix = buildCompactPrefix(candidateComponents, glyphHeight);
      if (!prefix) {
        continue;
      }

      const remaining = candidateComponents.slice(prefix.consumedComponentCount);
      const nextComponent = remaining[0] ?? null;
      const prefixRight = prefix.rect.left + prefix.rect.width;
      const gapAfter = nextComponent ? nextComponent.left - prefixRight : Number.POSITIVE_INFINITY;
      const neighboringSegment = findNeighboringSegment(segment, segments, rows, glyphHeight);
      const contentAfter = Boolean(
        (nextComponent && gapAfter >= glyphHeight * 0.2) || neighboringSegment,
      );
      const diagramBelow = hasDiagramBelow(
        prefix.rect,
        contentComponents,
        layoutRegions,
        glyphHeight,
      );
      const compact =
        prefix.rect.width <= glyphHeight * 3.2 &&
        prefix.rect.height >= glyphHeight * 0.25 &&
        prefix.rect.height <= glyphHeight * 1.75 &&
        prefix.componentCount <= 20;

      if (!compact || (!contentAfter && !diagramBelow)) {
        continue;
      }

      const dotLike = prefix.components.some(
        (component) =>
          component.width <= glyphHeight * 0.38 &&
          component.height <= glyphHeight * 0.38 &&
          component.centerY >= prefix.rect.top + prefix.rect.height * 0.54,
      );
      const gapScore = Number.isFinite(gapAfter)
        ? clamp(gapAfter / Math.max(1, glyphHeight * 1.25), 0, 1) * 0.24
        : 0;
      const widthScore = prefix.rect.width <= glyphHeight * 1.8 ? 0.2 : 0.12;
      const score = clamp(
        0.24 +
          widthScore +
          gapScore +
          (contentAfter ? 0.22 : 0) +
          (diagramBelow ? 0.18 : 0) +
          (dotLike ? 0.08 : 0),
        0,
        1,
      );
      const analysisRect = padRect(prefix.rect, image.width, image.height, glyphHeight * 0.18);

      proposals.push({
        id: `proposal-${proposals.length + 1}`,
        rect: fromAnalysisRect(analysisRect, image),
        analysisRect,
        rowId: segment.rowId,
        segmentId: segment.id,
        score,
        contentAfter,
        dotLike,
        reason: "compact line-start mark awaiting numeric recognition",
      });
    }
  }

  return dedupeProposals(proposals)
    .sort((left, right) => compareRectsByReadingOrder(left.analysisRect, right.analysisRect))
    .map((proposal, index) => ({ ...proposal, id: `proposal-${index + 1}` }));
}

function buildCompactPrefix(components: ConnectedComponent[], glyphHeight: number) {
  const firstIndex = components.findIndex(
    (component) =>
      component.height >= glyphHeight * 0.25 &&
      component.area >= glyphHeight * 0.28,
  );
  if (firstIndex < 0) {
    return null;
  }
  const viableComponents = components.slice(firstIndex);
  const first = viableComponents[0];

  const limit = Math.min(viableComponents.length, 24);
  let bestEnd = 1;
  let bestGap = -1;
  let right = first.left + first.width;

  for (let index = 1; index < limit; index += 1) {
    const component = viableComponents[index];
    const proposedWidth = component.left + component.width - first.left;
    const gap = component.left - right;
    if (proposedWidth > glyphHeight * 3.2) {
      if (gap > bestGap) {
        bestGap = gap;
        bestEnd = index;
      }
      break;
    }
    if (gap > bestGap) {
      bestGap = gap;
      bestEnd = index;
    }
    right = Math.max(right, component.left + component.width);
  }

  if (bestGap < glyphHeight * 0.16) {
    bestEnd = Math.min(limit, 2);
  }
  const prefix = viableComponents.slice(0, Math.max(1, bestEnd));

  return {
    rect: unionRects(prefix),
    components: prefix,
    componentCount: prefix.length,
    consumedComponentCount: firstIndex + prefix.length,
  };
}

function findPrefixStartIndices(components: ConnectedComponent[], glyphHeight: number) {
  const indices = [0];
  for (let index = 1; index < components.length; index += 1) {
    const previous = components[index - 1];
    const gap = components[index].left - (previous.left + previous.width);
    if (gap >= glyphHeight * 0.42) {
      indices.push(index);
    }
  }
  return indices;
}

function findNeighboringSegment(
  segment: RowSegment,
  segments: RowSegment[],
  rows: TextRow[],
  glyphHeight: number,
) {
  const row = rows.find((candidate) => candidate.id === segment.rowId);
  if (!row) {
    return null;
  }
  const right = segment.rect.left + segment.rect.width;
  return (
    segments
      .filter((candidate) => candidate.rowId === segment.rowId && candidate.rect.left > right)
      .sort((left, rightCandidate) => left.rect.left - rightCandidate.rect.left)
      .find((candidate) => candidate.rect.left - right <= glyphHeight * 8) ?? null
  );
}

function hasDiagramBelow(
  rect: Rect,
  components: ConnectedComponent[],
  layoutRegions: LayoutRegion[],
  glyphHeight: number,
) {
  const region = layoutRegions.find((candidate) =>
    rectContains(candidate.analysisRect, rect.left + rect.width / 2, rect.top + rect.height / 2),
  );
  const right = region
    ? region.analysisRect.left + region.analysisRect.width
    : rect.left + glyphHeight * 18;

  return components.some(
    (component) =>
      component.top > rect.top &&
      component.top - rect.top < glyphHeight * 18 &&
      component.centerX >= rect.left - glyphHeight * 2 &&
      component.centerX <= right &&
      component.width > glyphHeight * 4 &&
      component.height > glyphHeight * 2.5 &&
      component.area > glyphHeight * glyphHeight * 1.4,
  );
}

function dedupeProposals(proposals: InternalAnchorProposal[]) {
  const sorted = [...proposals].sort((left, right) => right.score - left.score);
  const kept: InternalAnchorProposal[] = [];

  for (const proposal of sorted) {
    if (
      kept.some(
        (candidate) =>
          candidate.rowId === proposal.rowId &&
          intersects(padRect(candidate.analysisRect, Infinity, Infinity, 4), proposal.analysisRect),
      )
    ) {
      continue;
    }
    kept.push(proposal);
  }

  return kept;
}

function selectRecognizedAnchors(
  structure: WorksheetDetectionStructure,
  recognized: Array<
    InternalAnchorProposal & { sourceLabel: string; recognitionConfidence: number }
  >,
) {
  if (recognized.length === 0) {
    return [];
  }

  const clustered = clusterAnchorsByAlignment(structure, recognized);
  const seedAnchors: AcceptedAnchor[] = [];

  for (const cluster of clustered) {
    const strongClusterSupport = cluster.items.filter(
      (item) =>
        item.score >= 0.77 ||
        item.recognitionConfidence >= 0.85 ||
        (item.dotLike && item.recognitionConfidence >= 0.7),
    ).length;
    if (strongClusterSupport < 3) {
      continue;
    }
    for (const item of cluster.items) {
      if (isLikelyInstructionProposal(structure, item)) {
        continue;
      }
      const sequenceSupport = cluster.items.some(
        (candidate) => candidate.id !== item.id && supportsNumericSequence(item, candidate, structure),
      );

      if (!sequenceSupport) {
        continue;
      }

      seedAnchors.push({
        ...item,
        clusterIndex: cluster.index,
        regionIndex: cluster.regionIndex,
      });
    }
  }

  const dedupedSeeds = correctSameRowLabels(
    structure,
    dedupeAcceptedAnchors(structure, seedAnchors),
  );
  const completed = completeAnchorTracks(structure, dedupedSeeds, recognized);
  return sortAcceptedAnchors(structure, dedupeAcceptedAnchors(structure, completed));
}

function supplementGeometricRuns(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
  allRecognized: Array<
    InternalAnchorProposal & { sourceLabel: string; recognitionConfidence: number }
  >,
) {
  if (anchors.length === 0) {
    return anchors;
  }

  const completed = [...anchors];
  const acceptedIds = new Set(completed.map((anchor) => anchor.id));
  const recognitionById = new Map(allRecognized.map((item) => [item.id, item]));
  const clusters = clusterAnchorsByAlignment(
    structure,
    structure.internal.proposals.filter(
      (proposal) =>
        proposal.score >= 0.78 &&
        proposal.contentAfter &&
        proposal.analysisRect.width <= structure.glyphHeight * 3 &&
        !isLikelyInstructionProposal(structure, proposal),
    ),
  );
  const inferredRegions = new Set<number>();

  for (const cluster of clusters) {
    const acceptedInCluster = completed.some((anchor) => {
      const centerX = anchor.analysisRect.left + anchor.analysisRect.width / 2;
      return (
        anchor.regionIndex === cluster.regionIndex &&
        Math.abs(centerX - cluster.centerX) <= structure.glyphHeight * 1.3
      );
    });
    const candidates = dedupeTrackRows(cluster.items).sort(
      (left, right) => left.analysisRect.top - right.analysisRect.top,
    );
    const runs = splitRegularRuns(candidates, structure.glyphHeight);
    const unanchoredRuns: InternalAnchorProposal[][] = [];

    for (const run of runs) {
      const runIds = new Set(run.map((proposal) => proposal.id));
      const acceptedInRun = completed.filter((anchor) => runIds.has(anchor.id));

      if (acceptedInRun.length > 0) {
        let addedRawRecognition = false;
        if (acceptedInRun.length >= 2) {
          const indexed = acceptedInRun
            .map((anchor) => ({ anchor, index: run.findIndex((item) => item.id === anchor.id) }))
            .filter((item) => item.index >= 0)
            .sort((left, right) => left.index - right.index);
          const first = indexed[0];
          const last = indexed.at(-1);
          if (first && last && first.index !== last.index) {
            const step =
              (Number(last.anchor.sourceLabel) - Number(first.anchor.sourceLabel)) /
              (last.index - first.index);
            if (Math.abs(step) === 1) {
              run.forEach((proposal, index) => {
                if (acceptedIds.has(proposal.id)) {
                  return;
                }
                const label = Number(first.anchor.sourceLabel) + step * (index - first.index);
                const extendsBefore = index < first.index;
                const extendsAfter = index > last.index;
                const hasBoundaryNeighbor = completed.some((anchor) => {
                  const existingLabel = Number(anchor.sourceLabel);
                  return (
                    (extendsBefore && existingLabel === label - step) ||
                    (extendsAfter && existingLabel === label + step)
                  );
                });
                const duplicateLabel = completed.some(
                  (anchor) =>
                    anchor.regionIndex === cluster.regionIndex &&
                    Number(anchor.sourceLabel) === label,
                );
                if (
                  label < 1 ||
                  duplicateLabel ||
                  ((extendsBefore || extendsAfter) && !hasBoundaryNeighbor)
                ) {
                  return;
                }
                completed.push({
                  ...proposal,
                  sourceLabel: String(label),
                  recognitionConfidence: 0.42,
                  clusterIndex: cluster.index,
                  regionIndex: cluster.regionIndex,
                });
                acceptedIds.add(proposal.id);
              });
            }
          }
        }
        for (const proposal of run) {
          if (acceptedIds.has(proposal.id)) {
            continue;
          }
          const recognition = recognitionById.get(proposal.id);
          if (!recognition) {
            continue;
          }
          const label = Number(recognition.sourceLabel);
          const adjacent = acceptedInRun.some(
            (anchor) => Math.abs(Number(anchor.sourceLabel) - label) === 1,
          );
          if (!adjacent) {
            continue;
          }
          completed.push({
            ...proposal,
            sourceLabel: recognition.sourceLabel,
            recognitionConfidence: Math.max(0.32, recognition.recognitionConfidence),
            clusterIndex: cluster.index,
            regionIndex: cluster.regionIndex,
          });
          acceptedIds.add(proposal.id);
          addedRawRecognition = true;
        }
        if (acceptedInRun.length === 1 && run.length === 2 && !addedRawRecognition) {
          const accepted = acceptedInRun[0];
          const acceptedIndex = run.findIndex((proposal) => proposal.id === accepted.id);
          const missingIndex = acceptedIndex === 0 ? 1 : 0;
          const direction = acceptedIndex === 0 ? 1 : -1;
          const missingLabel = Number(accepted.sourceLabel) + direction;
          const boundaryLabel = Number(accepted.sourceLabel) + direction * 2;
          const boundaryExists = completed.some(
            (anchor) => Number(anchor.sourceLabel) === boundaryLabel,
          );
          const duplicateLabel = completed.some(
            (anchor) =>
              anchor.regionIndex === cluster.regionIndex &&
              Number(anchor.sourceLabel) === missingLabel,
          );
          if (boundaryExists && !duplicateLabel && missingLabel >= 1) {
            const proposal = run[missingIndex];
            completed.push({
              ...proposal,
              sourceLabel: String(missingLabel),
              recognitionConfidence: 0.42,
              clusterIndex: cluster.index,
              regionIndex: cluster.regionIndex,
            });
            acceptedIds.add(proposal.id);
          }
        }
        continue;
      }

      if (
        run.length < 3 ||
        run.length > 8 ||
        median(run.map((proposal) => proposal.score)) < 0.9
      ) {
        continue;
      }
      unanchoredRuns.push(run);
    }

    const region = structure.internal.layoutRegions[cluster.regionIndex];
    if (
      inferredRegions.has(cluster.regionIndex) ||
      acceptedInCluster ||
      structure.internal.layoutRegions.length < 2 ||
      structure.analysisWidth / Math.max(1, structure.analysisHeight) < 1.3 ||
      cluster.centerX > region.analysisRect.left + region.analysisRect.width * 0.14 ||
      unanchoredRuns.length === 0
    ) {
      continue;
    }
    const run = [...unanchoredRuns].sort((left, right) => {
      const scoreDifference =
        median(right.map((proposal) => proposal.score)) -
        median(left.map((proposal) => proposal.score));
      return scoreDifference || right.length - left.length;
    })[0];
    const rightLabels = completed
      .filter(
        (anchor) =>
          anchor.regionIndex === cluster.regionIndex &&
          anchor.analysisRect.left > cluster.centerX + structure.glyphHeight * 3,
      )
      .map((anchor) => Number(anchor.sourceLabel))
      .filter(Number.isFinite);
    if (rightLabels.length === 0) {
      continue;
    }
    const nextLabel = Math.min(...rightLabels);
    const startLabel = nextLabel - run.length;
    if (startLabel < 1) {
      continue;
    }
    run.forEach((proposal, index) => {
      completed.push({
        ...proposal,
        sourceLabel: String(startLabel + index),
        recognitionConfidence: 0.42,
        clusterIndex: cluster.index,
        regionIndex: cluster.regionIndex,
      });
      acceptedIds.add(proposal.id);
    });
    inferredRegions.add(cluster.regionIndex);
  }

  return sortAcceptedAnchors(structure, dedupeAcceptedAnchors(structure, completed));
}

function completeSameRowSequenceGaps(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const completed = sortAcceptedAnchors(
    structure,
    dedupeAcceptedAnchors(structure, anchors),
  );
  const acceptedIds = new Set(completed.map((anchor) => anchor.id));

  for (let index = 0; index < completed.length - 1; index += 1) {
    const before = completed[index];
    const after = completed[index + 1];
    const beforeLabel = Number(before.sourceLabel);
    const afterLabel = Number(after.sourceLabel);
    if (afterLabel - beforeLabel !== 2) {
      continue;
    }

    const inferredLabel = beforeLabel + 1;
    const candidates = structure.internal.proposals
      .filter((proposal) => {
        if (
          acceptedIds.has(proposal.id) ||
          proposal.rowId !== before.rowId ||
          proposal.analysisRect.left <= before.analysisRect.left + structure.glyphHeight * 4 ||
          !proposal.contentAfter ||
          proposal.score < 0.78 ||
          isLikelyInstructionProposal(structure, proposal)
        ) {
          return false;
        }
        return layoutRegionIndex(structure, proposal.analysisRect) === before.regionIndex;
      })
      .sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (Math.abs(scoreDifference) > 0.04) {
          return scoreDifference;
        }
        return left.analysisRect.left - right.analysisRect.left;
      });
    const candidate = candidates.find((proposal) =>
      hasRepeatedSameRowPairGeometry(structure, completed, before, proposal),
    );
    if (!candidate) {
      continue;
    }

    completed.push({
      ...candidate,
      sourceLabel: String(inferredLabel),
      recognitionConfidence: 0.46,
      clusterIndex: before.clusterIndex,
      regionIndex: before.regionIndex,
    });
    acceptedIds.add(candidate.id);
  }

  return sortAcceptedAnchors(structure, dedupeAcceptedAnchors(structure, completed));
}

function hasRepeatedSameRowPairGeometry(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
  leftAnchor: AcceptedAnchor,
  rightProposal: InternalAnchorProposal,
) {
  const leftCenter = leftAnchor.analysisRect.left + leftAnchor.analysisRect.width / 2;
  const rightCenter = rightProposal.analysisRect.left + rightProposal.analysisRect.width / 2;
  const rows = new Map<string, AcceptedAnchor[]>();
  for (const anchor of anchors) {
    rows.set(anchor.rowId, [...(rows.get(anchor.rowId) ?? []), anchor]);
  }

  let support = 0;
  for (const rowAnchors of rows.values()) {
    const left = rowAnchors.find((anchor) => {
      const center = anchor.analysisRect.left + anchor.analysisRect.width / 2;
      return (
        anchor.regionIndex === leftAnchor.regionIndex &&
        Math.abs(center - leftCenter) <= structure.glyphHeight * 1.6
      );
    });
    const right = rowAnchors.find((anchor) => {
      const center = anchor.analysisRect.left + anchor.analysisRect.width / 2;
      return (
        anchor.regionIndex === leftAnchor.regionIndex &&
        Math.abs(center - rightCenter) <= structure.glyphHeight * 1.6
      );
    });
    if (
      left &&
      right &&
      left.id !== right.id &&
      Number(right.sourceLabel) - Number(left.sourceLabel) === 1
    ) {
      support += 1;
      if (support >= 2) {
        return true;
      }
    }
  }
  return false;
}

function dedupeTrackRows(proposals: InternalAnchorProposal[]) {
  const byRow = new Map<string, InternalAnchorProposal>();
  for (const proposal of proposals) {
    const existing = byRow.get(proposal.rowId);
    if (!existing || proposal.score > existing.score) {
      byRow.set(proposal.rowId, proposal);
    }
  }
  return [...byRow.values()];
}

function splitRegularRuns(proposals: InternalAnchorProposal[], glyphHeight: number) {
  const runs: InternalAnchorProposal[][] = [];
  let run: InternalAnchorProposal[] = [];

  for (const proposal of proposals) {
    const previous = run.at(-1);
    if (previous) {
      const gap =
        proposal.analysisRect.top + proposal.analysisRect.height / 2 -
        (previous.analysisRect.top + previous.analysisRect.height / 2);
      if (gap < glyphHeight * 0.65 || gap > glyphHeight * 4) {
        if (run.length >= 2) {
          runs.push(run);
        }
        run = [];
      }
    }
    run.push(proposal);
  }
  if (run.length >= 2) {
    runs.push(run);
  }
  return runs;
}

function isLikelyInstructionProposal(
  structure: WorksheetDetectionStructure,
  proposal: InternalAnchorProposal,
) {
  const segment = structure.internal.segments.find(
    (candidate) => candidate.id === proposal.segmentId,
  );
  if (!segment) {
    return false;
  }
  const region = structure.internal.layoutRegions[layoutRegionIndex(structure, segment.rect)];
  const beginsSegment =
    proposal.analysisRect.left - segment.rect.left <= structure.glyphHeight * 0.35;
  return (
    beginsSegment &&
    proposal.score < 0.82 &&
    segment.components.length >= 12 &&
    segment.rect.width > Math.max(structure.glyphHeight * 14, region.analysisRect.width * 0.34) &&
    segment.rect.height <= structure.glyphHeight * 2.2
  );
}

function correctSameRowLabels(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const corrected = anchors.map((anchor) => ({ ...anchor }));
  const rows = new Map<string, AcceptedAnchor[]>();

  for (const anchor of corrected) {
    rows.set(anchor.rowId, [...(rows.get(anchor.rowId) ?? []), anchor]);
  }

  for (const rowAnchors of rows.values()) {
    const sorted = rowAnchors.sort(
      (left, right) => left.analysisRect.left - right.analysisRect.left,
    );
    for (let index = 0; index < sorted.length - 1; index += 1) {
      const left = sorted[index];
      const right = sorted[index + 1];
      const horizontalDistance = right.analysisRect.left - left.analysisRect.left;
      if (
        left.regionIndex !== right.regionIndex ||
        left.clusterIndex === right.clusterIndex ||
        horizontalDistance < structure.glyphHeight * 8
      ) {
        continue;
      }

      const leftLabel = Number(left.sourceLabel);
      const rightLabel = Number(right.sourceLabel);
      if (rightLabel === leftLabel + 1) {
        continue;
      }
      if (leftLabel < rightLabel) {
        left.sourceLabel = String(Math.max(1, rightLabel - 1));
        left.recognitionConfidence = Math.min(left.recognitionConfidence, 0.58);
      } else {
        right.sourceLabel = String(leftLabel + 1);
        right.recognitionConfidence = Math.min(right.recognitionConfidence, 0.58);
      }
    }
  }

  return corrected;
}

function supportsNumericSequence(
  left: InternalAnchorProposal & { sourceLabel: string; recognitionConfidence: number },
  right: InternalAnchorProposal & { sourceLabel: string; recognitionConfidence: number },
  structure: WorksheetDetectionStructure,
) {
  const labelDifference = Math.abs(Number(left.sourceLabel) - Number(right.sourceLabel));
  if (labelDifference < 1 || labelDifference > 16) {
    return false;
  }
  const verticalDistance = Math.abs(
    left.analysisRect.top + left.analysisRect.height / 2 -
      (right.analysisRect.top + right.analysisRect.height / 2),
  );
  if (verticalDistance < structure.glyphHeight * 0.8) {
    return false;
  }
  const distancePerNumber = verticalDistance / labelDifference;
  const highQualityNumbering =
    left.recognitionConfidence >= 0.7 &&
    right.recognitionConfidence >= 0.7 &&
    ((left.dotLike && right.dotLike) || (left.score >= 0.78 && right.score >= 0.78));
  return (
    distancePerNumber >= structure.glyphHeight * 0.72 &&
    distancePerNumber <= structure.glyphHeight * (highQualityNumbering ? 30 : 12)
  );
}

function completeAnchorTracks(
  structure: WorksheetDetectionStructure,
  seeds: AcceptedAnchor[],
  recognized: Array<
    InternalAnchorProposal & { sourceLabel: string; recognitionConfidence: number }
  >,
) {
  if (seeds.length === 0) {
    return [];
  }

  const completed = [...seeds];
  const recognizedById = new Map(recognized.map((item) => [item.id, item]));
  const grouped = new Map<string, AcceptedAnchor[]>();

  for (const seed of seeds) {
    const key = `${seed.regionIndex}:${seed.clusterIndex}`;
    grouped.set(key, [...(grouped.get(key) ?? []), seed]);
  }

  for (const group of grouped.values()) {
    const sortedSeeds = [...group].sort(
      (left, right) => left.analysisRect.top - right.analysisRect.top,
    );
    if (sortedSeeds.length < 2) {
      continue;
    }
    const centerX = median(
      sortedSeeds.map((seed) => seed.analysisRect.left + seed.analysisRect.width / 2),
    );
    const preferredStep = inferTrackStep(sortedSeeds);
    const trackCandidates = structure.internal.proposals
      .filter((proposal) => {
        const proposalCenter = proposal.analysisRect.left + proposal.analysisRect.width / 2;
        const recognition = recognizedById.get(proposal.id);
        const rejectedRecognition =
          recognition &&
          recognition.recognitionConfidence >= 0.75 &&
          !seeds.some((seed) => seed.id === proposal.id);
        return (
          layoutRegionIndex(structure, proposal.analysisRect) === sortedSeeds[0].regionIndex &&
          Math.abs(proposalCenter - centerX) <= structure.glyphHeight * 1.3 &&
          proposal.score >= 0.62 &&
          proposal.contentAfter &&
          !isLikelyInstructionProposal(structure, proposal) &&
          !rejectedRecognition
        );
      })
      .sort((left, right) => left.analysisRect.top - right.analysisRect.top);

    for (let index = 0; index < sortedSeeds.length - 1; index += 1) {
      const above = sortedSeeds[index];
      const below = sortedSeeds[index + 1];
      const aboveLabel = Number(above.sourceLabel);
      const belowLabel = Number(below.sourceLabel);
      const labelDifference = belowLabel - aboveLabel;
      if (labelDifference <= 1 || labelDifference > 16) {
        continue;
      }
      const verticalDistance =
        below.analysisRect.top + below.analysisRect.height / 2 -
        (above.analysisRect.top + above.analysisRect.height / 2);
      if (verticalDistance / labelDifference > structure.glyphHeight * 12) {
        continue;
      }

      const candidates = trackCandidates.filter(
        (candidate) =>
          candidate.analysisRect.top > above.analysisRect.top + structure.glyphHeight * 0.6 &&
          candidate.analysisRect.top < below.analysisRect.top - structure.glyphHeight * 0.6,
      );
      const step = chooseSequenceStep(labelDifference, candidates.length, preferredStep);
      if (!step) {
        continue;
      }
      const required = labelDifference / step - 1;
      const selected = chooseInterpolatedCandidates(candidates, required, above, below);

      selected.forEach((proposal, selectedIndex) => {
        const sourceLabel = String(aboveLabel + step * (selectedIndex + 1));
        const proposalY = proposal.analysisRect.top + proposal.analysisRect.height / 2;
        const nearbyDuplicate = completed.some(
          (anchor) =>
            anchor.sourceLabel === sourceLabel &&
            Math.abs(
              anchor.analysisRect.top + anchor.analysisRect.height / 2 - proposalY,
            ) < structure.glyphHeight * 6,
        );
        if (nearbyDuplicate) {
          return;
        }
        completed.push({
          ...proposal,
          sourceLabel,
          recognitionConfidence: 0.48,
          clusterIndex: above.clusterIndex,
          regionIndex: above.regionIndex,
        });
      });
    }
  }

  return completed;
}

function inferTrackStep(anchors: AcceptedAnchor[]) {
  let stepOne = 0;
  let stepTwo = 0;
  for (let index = 0; index < anchors.length - 1; index += 1) {
    const difference = Number(anchors[index + 1].sourceLabel) - Number(anchors[index].sourceLabel);
    if (difference === 1) {
      stepOne += 1;
    } else if (difference === 2) {
      stepTwo += 1;
    }
  }
  return stepTwo > stepOne ? 2 : 1;
}

function chooseSequenceStep(
  labelDifference: number,
  candidateCount: number,
  preferredStep: number,
) {
  const options = [1, 2]
    .filter((step) => labelDifference % step === 0)
    .map((step) => ({ step, required: labelDifference / step - 1 }))
    .filter(({ required }) => required >= 0 && required <= candidateCount)
    .sort((left, right) => {
      const leftPreferred = left.step === preferredStep ? 0 : 1;
      const rightPreferred = right.step === preferredStep ? 0 : 1;
      if (leftPreferred !== rightPreferred) {
        return leftPreferred - rightPreferred;
      }
      const leftUnused = candidateCount - left.required;
      const rightUnused = candidateCount - right.required;
      if (leftUnused !== rightUnused) {
        return leftUnused - rightUnused;
      }
      return right.step - left.step;
    });
  return options[0]?.step ?? null;
}

function chooseInterpolatedCandidates(
  candidates: InternalAnchorProposal[],
  count: number,
  above: AcceptedAnchor,
  below: AcceptedAnchor,
) {
  if (count <= 0) {
    return [];
  }
  const available = [...candidates];
  const selected: InternalAnchorProposal[] = [];
  const aboveY = above.analysisRect.top + above.analysisRect.height / 2;
  const belowY = below.analysisRect.top + below.analysisRect.height / 2;

  for (let index = 1; index <= count; index += 1) {
    const targetY = aboveY + ((belowY - aboveY) * index) / (count + 1);
    const best = available
      .map((candidate) => ({
        candidate,
        cost:
          Math.abs(candidate.analysisRect.top + candidate.analysisRect.height / 2 - targetY) -
          candidate.score * 8,
      }))
      .sort((left, right) => left.cost - right.cost)[0]?.candidate;
    if (!best) {
      break;
    }
    selected.push(best);
    available.splice(available.findIndex((candidate) => candidate.id === best.id), 1);
  }

  return selected.sort((left, right) => left.analysisRect.top - right.analysisRect.top);
}

function selectGeometricAnchors(structure: WorksheetDetectionStructure) {
  const candidates = structure.internal.proposals
    .filter((proposal) => proposal.score >= 0.67 && proposal.contentAfter)
    .map((proposal) => ({
      ...proposal,
      sourceLabel: null,
      recognitionConfidence: 0,
    }));
  const clusters = clusterAnchorsByAlignment(structure, candidates);
  const accepted: AcceptedAnchor[] = [];

  for (const cluster of clusters) {
    if (cluster.items.length < 2) {
      continue;
    }
    for (const item of cluster.items) {
      accepted.push({
        ...item,
        clusterIndex: cluster.index,
        regionIndex: cluster.regionIndex,
      });
    }
  }

  const deduped = dedupeAcceptedAnchors(structure, accepted);
  if (deduped.length > 80) {
    return [];
  }
  return sortAcceptedAnchors(structure, deduped);
}

function clusterAnchorsByAlignment<T extends InternalAnchorProposal>(
  structure: WorksheetDetectionStructure,
  anchors: T[],
) {
  const clusters: Array<{
    index: number;
    regionIndex: number;
    centerX: number;
    items: T[];
  }> = [];
  const tolerance = structure.glyphHeight * 1.3;

  for (const anchor of [...anchors].sort((left, right) => left.analysisRect.left - right.analysisRect.left)) {
    const centerX = anchor.analysisRect.left + anchor.analysisRect.width / 2;
    const regionIndex = layoutRegionIndex(structure, anchor.analysisRect);
    const target = clusters
      .filter((cluster) => cluster.regionIndex === regionIndex)
      .map((cluster) => ({ cluster, distance: Math.abs(cluster.centerX - centerX) }))
      .filter(({ distance }) => distance <= tolerance)
      .sort((left, right) => left.distance - right.distance)[0]?.cluster;

    if (!target) {
      clusters.push({
        index: clusters.length,
        regionIndex,
        centerX,
        items: [anchor],
      });
      continue;
    }

    target.items.push(anchor);
    target.centerX = median(
      target.items.map((item) => item.analysisRect.left + item.analysisRect.width / 2),
    );
  }

  return clusters.map((cluster, index) => ({ ...cluster, index }));
}

function dedupeAcceptedAnchors(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const sorted = [...anchors].sort((left, right) => {
    const leftScore = anchorDedupeQuality(structure, left);
    const rightScore = anchorDedupeQuality(structure, right);
    return rightScore - leftScore;
  });
  const kept: AcceptedAnchor[] = [];

  for (const anchor of sorted) {
    const duplicate = kept.some(
      (candidate) => {
        const horizontalDistance = Math.abs(
          candidate.analysisRect.left + candidate.analysisRect.width / 2 -
            (anchor.analysisRect.left + anchor.analysisRect.width / 2),
        );
        const verticalDistance = Math.abs(
          candidate.analysisRect.top + candidate.analysisRect.height / 2 -
            (anchor.analysisRect.top + anchor.analysisRect.height / 2),
        );
        const sourceGlyphHeight = structure.glyphHeight / structure.normalizationScale;
        const sourceVerticalDistance = Math.abs(
          candidate.rect.top + candidate.rect.height / 2 -
            (anchor.rect.top + anchor.rect.height / 2),
        );
        const sourceHorizontalGap = rectAxisGap(
          candidate.rect.left,
          candidate.rect.width,
          anchor.rect.left,
          anchor.rect.width,
        );
        return (
          (candidate.segmentId === anchor.segmentId &&
            horizontalDistance < TARGET_GLYPH_HEIGHT * 12) ||
          (candidate.rowId === anchor.rowId &&
            intersects(padRect(candidate.analysisRect, Infinity, Infinity, 5), anchor.analysisRect)) ||
          (horizontalDistance <= structure.glyphHeight * 1.6 &&
            verticalDistance <= structure.glyphHeight * 1.1) ||
          (sourceHorizontalGap <= sourceGlyphHeight * 0.55 &&
            sourceVerticalDistance <= sourceGlyphHeight * 1.15)
        );
      },
    );
    if (!duplicate) {
      kept.push(anchor);
    }
  }

  return kept;
}

function rectAxisGap(
  firstStart: number,
  firstLength: number,
  secondStart: number,
  secondLength: number,
) {
  const firstEnd = firstStart + firstLength;
  const secondEnd = secondStart + secondLength;
  return Math.max(0, Math.max(firstStart, secondStart) - Math.min(firstEnd, secondEnd));
}

function anchorDedupeQuality(
  structure: WorksheetDetectionStructure,
  anchor: AcceptedAnchor,
) {
  const widthSupport = clamp(anchor.analysisRect.width / structure.glyphHeight, 0, 1) * 0.12;
  const heightSupport = clamp(anchor.analysisRect.height / structure.glyphHeight, 0, 1) * 0.08;
  return anchor.score + anchor.recognitionConfidence * 0.15 + widthSupport + heightSupport;
}

function dedupeExpandedAnchorsBySequence(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const sorted = sortAcceptedAnchors(structure, anchors);
  const expanded = new Map(
    sorted.map((anchor) => [
      anchor.id,
      padRect(
        anchor.analysisRect,
        structure.analysisWidth,
        structure.analysisHeight,
        structure.glyphHeight * 0.3,
      ),
    ]),
  );
  const consumed = new Set<string>();
  const kept: AcceptedAnchor[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const anchor = sorted[index];
    if (consumed.has(anchor.id)) {
      continue;
    }
    const group = sorted.filter((candidate) => {
      if (consumed.has(candidate.id)) {
        return false;
      }
      const anchorRect = expanded.get(anchor.id);
      const candidateRect = expanded.get(candidate.id);
      const sourceGlyphHeight = structure.glyphHeight / structure.normalizationScale;
      const sourceVerticalDistance = Math.abs(
        anchor.rect.top + anchor.rect.height / 2 -
          (candidate.rect.top + candidate.rect.height / 2),
      );
      return Boolean(
        anchorRect &&
        candidateRect &&
        anchor.regionIndex === candidate.regionIndex &&
        sourceVerticalDistance <= sourceGlyphHeight * 1.6 &&
        intersects(anchorRect, candidateRect),
      );
    });
    group.forEach((candidate) => consumed.add(candidate.id));
    if (group.length === 1) {
      kept.push(anchor);
      continue;
    }

    const groupIds = new Set(group.map((candidate) => candidate.id));
    const previous = [...sorted.slice(0, index)]
      .reverse()
      .find((candidate) => !groupIds.has(candidate.id));
    const lastGroupIndex = Math.max(...group.map((candidate) => sorted.indexOf(candidate)));
    const next = sorted.slice(lastGroupIndex + 1)
      .find((candidate) => !groupIds.has(candidate.id));
    const best = [...group].sort((left, right) => {
      const leftScore = sequenceAwareAnchorQuality(structure, left, previous, next);
      const rightScore = sequenceAwareAnchorQuality(structure, right, previous, next);
      return rightScore - leftScore;
    })[0];
    kept.push(best);
  }

  return sortAcceptedAnchors(structure, kept);
}

function sequenceAwareAnchorQuality(
  structure: WorksheetDetectionStructure,
  anchor: AcceptedAnchor,
  previous?: AcceptedAnchor,
  next?: AcceptedAnchor,
) {
  const label = Number(anchor.sourceLabel);
  let sequenceSupport = 0;
  if (previous && Number(previous.sourceLabel) + 1 === label) {
    sequenceSupport += 0.55;
  }
  if (next && label + 1 === Number(next.sourceLabel)) {
    sequenceSupport += 0.55;
  }
  return anchorDedupeQuality(structure, anchor) + sequenceSupport;
}

function correctAlignedTrackSequences(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const corrected = anchors.map((anchor) => ({ ...anchor }));
  const clusters = clusterAnchorsByAlignment(structure, corrected);

  for (const cluster of clusters) {
    const items = [...cluster.items].sort(
      (left, right) => left.analysisRect.top - right.analysisRect.top,
    );
    if (items.length < 3) {
      continue;
    }
    const differences = items.slice(1).map(
      (item, index) => Number(item.sourceLabel) - Number(items[index].sourceLabel),
    );
    const stepOneSupport = differences.filter((difference) => difference === 1).length;
    const stepTwoSupport = differences.filter((difference) => difference === 2).length;
    if (stepOneSupport + stepTwoSupport < 2) {
      continue;
    }
    const step = stepTwoSupport > stepOneSupport ? 2 : 1;

    for (let index = 1; index < items.length - 1; index += 1) {
      const previous = items[index - 1];
      const current = items[index];
      const next = items[index + 1];
      const previousLabel = Number(previous.sourceLabel);
      const nextLabel = Number(next.sourceLabel);
      const expectedLabel = previousLabel + step;
      if (
        nextLabel !== previousLabel + step * 2 ||
        Number(current.sourceLabel) === expectedLabel
      ) {
        continue;
      }
      const previousY = previous.analysisRect.top + previous.analysisRect.height / 2;
      const currentY = current.analysisRect.top + current.analysisRect.height / 2;
      const nextY = next.analysisRect.top + next.analysisRect.height / 2;
      const gapAbove = currentY - previousY;
      const gapBelow = nextY - currentY;
      const gapRatio = Math.max(gapAbove, gapBelow) / Math.max(1, Math.min(gapAbove, gapBelow));
      if (
        gapAbove < structure.glyphHeight * 0.7 ||
        gapBelow < structure.glyphHeight * 0.7 ||
        gapRatio > 3
      ) {
        continue;
      }
      current.sourceLabel = String(expectedLabel);
      current.recognitionConfidence = Math.min(current.recognitionConfidence, 0.58);
    }
  }

  return sortAcceptedAnchors(structure, corrected);
}

function sortAcceptedAnchors(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const trackByAnchor = new Map<string, number>();
  const rowMajorRegions = new Set<number>();

  for (let regionIndex = 0; regionIndex < structure.internal.layoutRegions.length; regionIndex += 1) {
    const regionAnchors = anchors.filter((anchor) => anchor.regionIndex === regionIndex);
    const tracks = clusterAnchorsByAlignment(structure, regionAnchors);
    tracks.forEach((track, trackIndex) => {
      track.items.forEach((anchor) => trackByAnchor.set(anchor.id, trackIndex));
    });
    let alignedPairs = 0;
    for (let leftIndex = 0; leftIndex < tracks.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < tracks.length; rightIndex += 1) {
        for (const left of tracks[leftIndex].items) {
          const leftY = left.analysisRect.top + left.analysisRect.height / 2;
          if (
            tracks[rightIndex].items.some((right) => {
              const rightY = right.analysisRect.top + right.analysisRect.height / 2;
              return Math.abs(leftY - rightY) <= structure.glyphHeight * 1.2;
            })
          ) {
            alignedPairs += 1;
          }
        }
      }
    }
    if (alignedPairs >= 2) {
      rowMajorRegions.add(regionIndex);
    }
  }

  return [...anchors].sort((left, right) => {
    if (left.regionIndex !== right.regionIndex) {
      return left.regionIndex - right.regionIndex;
    }
    if (!rowMajorRegions.has(left.regionIndex)) {
      const trackDifference =
        (trackByAnchor.get(left.id) ?? 0) - (trackByAnchor.get(right.id) ?? 0);
      if (trackDifference !== 0) {
        return trackDifference;
      }
    }
    return compareRectsByReadingOrder(left.analysisRect, right.analysisRect);
  });
}

function layoutRegionIndex(structure: WorksheetDetectionStructure, rect: Rect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const index = structure.internal.layoutRegions.findIndex((region) =>
    rectContains(region.analysisRect, centerX, centerY),
  );
  return index >= 0 ? index : 0;
}

function detectSectionHeaders(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const headers: SectionHeader[] = [];

  for (const segment of structure.internal.segments) {
    if (
      anchors.some((anchor) =>
        intersects(padRect(anchor.analysisRect, Infinity, Infinity, 4), segment.rect),
      )
    ) {
      continue;
    }

    const regionIndex = layoutRegionIndex(structure, segment.rect);
    const region = structure.internal.layoutRegions[regionIndex];
    const likelyHeader =
      segment.rect.width > Math.max(structure.glyphHeight * 14, region.analysisRect.width * 0.34) &&
      segment.components.length >= 12 &&
      segment.rect.height <= structure.glyphHeight * 2.2;
    if (!likelyHeader) {
      continue;
    }

    const nextAnchor = anchors
      .filter(
        (anchor) =>
          anchor.regionIndex === regionIndex &&
          anchor.analysisRect.top >= segment.rect.top + segment.rect.height - structure.glyphHeight * 0.3 &&
          anchor.analysisRect.top - segment.rect.top < structure.glyphHeight * 8,
      )
      .sort((left, right) => left.analysisRect.top - right.analysisRect.top)[0];
    if (!nextAnchor) {
      continue;
    }

    const sourceRect = fromAnalysisRect(
      padRect(
        segment.rect,
        structure.analysisWidth,
        structure.analysisHeight,
        structure.glyphHeight * 0.35,
      ),
      structure,
    );
    headers.push({
      id: `section-${headers.length + 1}`,
      rects: [sourceRect],
      unionBounds: sourceRect,
      confidence: 0.68,
    });
  }

  return dedupeHeaders(headers);
}

function dedupeHeaders(headers: SectionHeader[]) {
  const kept: SectionHeader[] = [];
  for (const header of headers) {
    if (kept.some((candidate) => rectOverlapRatio(candidate.unionBounds, header.unionBounds) > 0.7)) {
      continue;
    }
    kept.push(header);
  }
  return kept;
}

function buildOwnershipZones(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const zones: OwnershipZone[] = [];
  const clustersByRegion = new Map<number, Array<{ clusterIndex: number; centerX: number }>>();

  for (const anchor of anchors) {
    const current = clustersByRegion.get(anchor.regionIndex) ?? [];
    if (!current.some((cluster) => cluster.clusterIndex === anchor.clusterIndex)) {
      current.push({
        clusterIndex: anchor.clusterIndex,
        centerX: anchor.analysisRect.left + anchor.analysisRect.width / 2,
      });
    }
    clustersByRegion.set(anchor.regionIndex, current);
  }

  anchors.forEach((anchor, orderIndex) => {
    const region = structure.internal.layoutRegions[anchor.regionIndex];
    const clusters = [...(clustersByRegion.get(anchor.regionIndex) ?? [])].sort(
      (left, right) => left.centerX - right.centerX,
    );
    const clusterPosition = clusters.findIndex(
      (cluster) => cluster.clusterIndex === anchor.clusterIndex,
    );
    const previous = clusters[clusterPosition - 1] ?? null;
    const next = clusters[clusterPosition + 1] ?? null;
    const left = previous
      ? (previous.centerX + clusters[clusterPosition].centerX) / 2
      : region.analysisRect.left;
    const right = next
      ? (clusters[clusterPosition].centerX + next.centerX) / 2
      : region.analysisRect.left + region.analysisRect.width;
    const nextBelow = anchors
      .filter(
        (candidate) =>
          candidate.clusterIndex === anchor.clusterIndex &&
          candidate.regionIndex === anchor.regionIndex &&
          candidate.analysisRect.top > anchor.analysisRect.top + structure.glyphHeight * 0.4,
      )
      .sort((leftAnchor, rightAnchor) => leftAnchor.analysisRect.top - rightAnchor.analysisRect.top)[0];
    const top = Math.max(
      region.analysisRect.top,
      anchor.analysisRect.top - structure.glyphHeight * 0.55,
    );
    const bottom = nextBelow
      ? Math.max(
          anchor.analysisRect.top + anchor.analysisRect.height + structure.glyphHeight,
          nextBelow.analysisRect.top - structure.glyphHeight * 0.42,
        )
      : region.analysisRect.top + region.analysisRect.height;
    const analysisRect = padRect(
      { left, top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) },
      structure.analysisWidth,
      structure.analysisHeight,
      structure.glyphHeight * 0.18,
    );

    zones.push({
      id: `zone-${orderIndex + 1}`,
      anchor,
      analysisRect,
      rect: fromAnalysisRect(analysisRect, structure),
      orderIndex,
    });
  });

  return zones;
}

function buildProblemDrafts(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
  zones: OwnershipZone[],
  sectionHeaders: SectionHeader[],
) {
  const headerAssignments = assignSectionHeadersToZones(sectionHeaders, zones);
  const anchorRects = anchors.map((anchor) => anchor.analysisRect);

  return zones.map((zone, index) => {
    const anchorRect = fromAnalysisRect(
      padRect(
        zone.anchor.analysisRect,
        structure.analysisWidth,
        structure.analysisHeight,
        structure.glyphHeight * 0.24,
      ),
      structure,
    );
    const attachedHeaders = headerAssignments.get(zone.id) ?? [];
    const allHeaderRects = sectionHeaders.map((header) => toAnalysisRect(header.unionBounds, structure));
    const textRects = mergeSegmentsByRow(
      structure.internal.segments.filter((segment) => {
        const centerX = segment.rect.left + segment.rect.width / 2;
        const centerY = segment.rect.top + segment.rect.height / 2;
        return (
          rectContains(zone.analysisRect, centerX, centerY) &&
          !intersects(
            padRect(zone.anchor.analysisRect, Infinity, Infinity, structure.glyphHeight * 0.25),
            segment.rect,
          ) &&
          !anchorRects.some((rect) =>
            intersects(padRect(rect, Infinity, Infinity, structure.glyphHeight * 0.2), segment.rect),
          ) &&
          !allHeaderRects.some((rect) => intersects(rect, segment.rect))
        );
      }),
      structure.glyphHeight,
      structure.analysisWidth,
      structure.analysisHeight,
    );
    const diagramRects = mergeDiagramRects(
      structure.internal.contentComponents.filter((component) => {
        if (!rectContains(zone.analysisRect, component.centerX, component.centerY)) {
          return false;
        }
        if (textRects.some((rect) => intersects(rect, component))) {
          return false;
        }
        if (anchorRects.some((rect) => intersects(rect, component))) {
          return false;
        }
        if (allHeaderRects.some((rect) => intersects(rect, component))) {
          return false;
        }
        return (
          component.width > structure.glyphHeight * 3.5 ||
          component.height > structure.glyphHeight * 3 ||
          component.area > structure.glyphHeight * structure.glyphHeight * 6
        );
      }),
      structure.glyphHeight,
      structure.analysisWidth,
      structure.analysisHeight,
    );
    const analysisContentRects = [...textRects, ...diagramRects]
      .map((rect) => intersectRects(rect, zone.analysisRect))
      .filter((rect): rect is Rect => Boolean(rect && rect.width > 0 && rect.height > 0))
      .map((rect) => trimRectAgainstHeaders(rect, allHeaderRects))
      .filter((rect): rect is Rect => Boolean(rect && rect.width > 0 && rect.height > 0))
      .sort(compareRectsByReadingOrder);
    const contentRects = analysisContentRects.map((rect) => fromAnalysisRect(rect, structure));
    const safeContentRects =
      contentRects.length > 0
        ? contentRects
        : [padRect(anchorRect, structure.sourceWidth, structure.sourceHeight, 5)];
    const sectionHeaderRects = attachedHeaders.flatMap((header) => header.rects);
    const unionBounds = padRect(
      unionRects([anchorRect, ...safeContentRects]),
      structure.sourceWidth,
      structure.sourceHeight,
      7,
    );
    const hasDiagram = analysisContentRects.some(
      (rect) =>
        rect.width > structure.glyphHeight * 4 && rect.height > structure.glyphHeight * 3,
    );
    const fragments: InputProblemFragment[] = [
      {
        id: `${zone.anchor.id}-anchor`,
        kind: "anchor",
        rect: anchorRect,
        confidence: clamp(zone.anchor.score + zone.anchor.recognitionConfidence * 0.2, 0, 1),
      },
      ...sectionHeaderRects.map((rect, headerIndex) => ({
        id: `${zone.anchor.id}-header-${headerIndex + 1}`,
        kind: "section-header" as const,
        rect,
        confidence: attachedHeaders[0]?.confidence ?? 0.62,
      })),
      ...safeContentRects.map((rect, rectIndex) => ({
        id: `${zone.anchor.id}-content-${rectIndex + 1}`,
        kind:
          hasDiagram && rect.height > unionBounds.height * 0.28
            ? ("diagram" as const)
            : ("content" as const),
        rect,
        confidence: zone.anchor.sourceLabel ? 0.76 : 0.58,
      })),
    ];

    return {
      id: `problem-${index + 1}`,
      orderIndex: index,
      sourceLabel: zone.anchor.sourceLabel,
      anchorRect,
      contentRects: safeContentRects,
      sectionHeaderRects,
      unionBounds,
      confidence: calculateProblemConfidence(zone.anchor, safeContentRects, hasDiagram),
      fragments,
      compositionMode:
        hasDiagram || safeContentRects.length > 8 ? "union-fallback" : "composite-stack",
      columnHint: zone.anchor.clusterIndex,
      included: true,
    } satisfies ProblemDraft;
  });
}

function assignSectionHeadersToZones(headers: SectionHeader[], zones: OwnershipZone[]) {
  const assignments = new Map<string, SectionHeader[]>();

  for (const header of headers) {
    const headerBottom = header.unionBounds.top + header.unionBounds.height;
    const target = zones
      .filter((zone) => {
        const distance = zone.anchor.rect.top - headerBottom;
        return (
          distance >= -4 &&
          distance < 360 &&
          horizontalOverlapRatio(header.unionBounds, zone.rect) > 0.06
        );
      })
      .sort((left, right) => left.anchor.rect.top - right.anchor.rect.top)[0];
    if (!target) {
      continue;
    }
    assignments.set(target.id, [...(assignments.get(target.id) ?? []), header]);
  }

  return assignments;
}

function mergeSegmentsByRow(
  segments: RowSegment[],
  glyphHeight: number,
  width: number,
  height: number,
) {
  const byRow = new Map<string, RowSegment[]>();
  for (const segment of segments) {
    byRow.set(segment.rowId, [...(byRow.get(segment.rowId) ?? []), segment]);
  }

  const merged: Rect[] = [];
  for (const rowSegments of byRow.values()) {
    const sorted = [...rowSegments].sort((left, right) => left.rect.left - right.rect.left);
    let current: Rect | null = null;
    for (const segment of sorted) {
      const rect = padRect(segment.rect, width, height, glyphHeight * 0.16);
      if (!current) {
        current = rect;
        continue;
      }
      const gap = rect.left - (current.left + current.width);
      if (gap <= glyphHeight * 1.25) {
        current = unionRects([current, rect]);
      } else {
        merged.push(current);
        current = rect;
      }
    }
    if (current) {
      merged.push(current);
    }
  }

  return merged.sort(compareRectsByReadingOrder);
}

function mergeDiagramRects(
  components: ConnectedComponent[],
  glyphHeight: number,
  width: number,
  height: number,
) {
  const merged: Rect[] = [];
  for (const component of components) {
    const rect = padRect(component, width, height, glyphHeight * 0.25);
    const existingIndex = merged.findIndex((candidate) =>
      intersects(padRect(candidate, Infinity, Infinity, glyphHeight * 0.7), rect),
    );
    if (existingIndex >= 0) {
      merged[existingIndex] = unionRects([merged[existingIndex], rect]);
    } else {
      merged.push(rect);
    }
  }
  return merged.sort(compareRectsByReadingOrder);
}

function calculateProblemConfidence(
  anchor: AcceptedAnchor,
  contentRects: Rect[],
  hasDiagram: boolean,
) {
  const recognition = anchor.sourceLabel ? anchor.recognitionConfidence * 0.22 : 0;
  const content = Math.min(0.16, contentRects.length * 0.025);
  return clamp(0.44 + anchor.score * 0.22 + recognition + content - (hasDiagram ? 0.04 : 0), 0.32, 0.97);
}

function hasSubstantialContent(structure: WorksheetDetectionStructure) {
  return (
    structure.internal.rows.length >= 2 &&
    structure.internal.contentComponents.reduce((sum, component) => sum + component.area, 0) >
      structure.glyphHeight * structure.glyphHeight * 2
  );
}

function buildFallbackBlockDrafts(structure: WorksheetDetectionStructure) {
  const blocks: Rect[] = [];

  for (const region of structure.internal.layoutRegions) {
    const segments = structure.internal.segments
      .filter((segment) => {
        const centerX = segment.rect.left + segment.rect.width / 2;
        const centerY = segment.rect.top + segment.rect.height / 2;
        return rectContains(region.analysisRect, centerX, centerY);
      })
      .sort((left, right) => compareRectsByReadingOrder(left.rect, right.rect));
    let current: Rect | null = null;

    for (const segment of segments) {
      if (!current) {
        current = segment.rect;
        continue;
      }
      const gap = segment.rect.top - (current.top + current.height);
      if (gap > structure.glyphHeight * 1.65) {
        blocks.push(current);
        current = segment.rect;
      } else {
        current = unionRects([current, segment.rect]);
      }
    }
    if (current) {
      blocks.push(current);
    }
  }

  return blocks
    .filter(
      (block) =>
        block.width > structure.glyphHeight * 3 && block.height > structure.glyphHeight * 0.6,
    )
    .slice(0, 24)
    .map((block, index) => {
      const unionBounds = fromAnalysisRect(
        padRect(
          block,
          structure.analysisWidth,
          structure.analysisHeight,
          structure.glyphHeight * 0.45,
        ),
        structure,
      );
      const anchorRect = {
        left: unionBounds.left,
        top: unionBounds.top,
        width: Math.min(unionBounds.width, Math.max(12, unionBounds.height)),
        height: Math.min(unionBounds.height, Math.max(12, unionBounds.height)),
      };

      return {
        id: `fallback-${index + 1}`,
        orderIndex: index,
        sourceLabel: null,
        anchorRect,
        contentRects: [unionBounds],
        sectionHeaderRects: [],
        unionBounds,
        confidence: 0.38,
        fragments: [
          {
            id: `fallback-${index + 1}-content`,
            kind: "content" as const,
            rect: unionBounds,
            confidence: 0.38,
          },
        ],
        compositionMode: "union-fallback" as const,
        columnHint: layoutRegionIndex(structure, block),
        included: true,
      } satisfies ProblemDraft;
    });
}

function inferDeterministicRecognitions(structure: WorksheetDetectionStructure) {
  const anchors = selectGeometricAnchors(structure);
  if (anchors.length === 0) {
    return [];
  }

  const first = anchors[0];
  const firstComponent = structure.internal.proposals.find((proposal) => proposal.id === first.id);
  const startsAtOne = firstComponent
    ? firstComponent.analysisRect.width / Math.max(1, firstComponent.analysisRect.height) < 0.62
    : true;
  const start = startsAtOne ? 1 : 3;

  return anchors.map((anchor, index) => ({
    proposalId: anchor.id,
    sourceLabel: String(start + index),
    confidence: 0.52,
  }));
}

function buildTrackDebugRects(
  structure: WorksheetDetectionStructure,
  anchors: AcceptedAnchor[],
) {
  const groups = new Map<string, AcceptedAnchor[]>();
  for (const anchor of anchors) {
    const key = `${anchor.regionIndex}:${anchor.clusterIndex}`;
    groups.set(key, [...(groups.get(key) ?? []), anchor]);
  }

  return [...groups.values()].map((group, index) => {
    const union = unionRects(group.map((anchor) => anchor.analysisRect));
    const rect = fromAnalysisRect(
      {
        left: union.left - structure.glyphHeight * 0.5,
        top: structure.analysisContentBounds.top,
        width: union.width + structure.glyphHeight,
        height: structure.analysisContentBounds.height,
      },
      structure,
    );
    return { id: `track-${index + 1}`, rect };
  });
}

function summarizeRejectedReasons(
  structure: WorksheetDetectionStructure,
  recognitions: Map<string, AnchorRecognition & { sourceLabel: string }>,
  anchors: AcceptedAnchor[],
) {
  const accepted = new Set(anchors.map((anchor) => anchor.id));
  const reasons = new Set<string>();
  for (const proposal of structure.internal.proposals) {
    if (accepted.has(proposal.id)) {
      continue;
    }
    if (!recognitions.has(proposal.id)) {
      reasons.add("compact line-start mark was not recognized as a problem number");
    } else {
      reasons.add("recognized number lacked a stable aligned track");
    }
  }
  return [...reasons];
}

function normalizeSourceLabel(value: string) {
  const match = value.trim().match(/\d{1,3}/);
  if (!match) {
    return "";
  }
  const numeric = Number(match[0]);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 999) {
    return "";
  }
  return String(numeric);
}

function fromAnalysisRect(
  rect: Rect,
  image: Pick<NormalizedImage, "scale" | "sourceHeight" | "sourceWidth"> | WorksheetDetectionStructure,
) {
  const scale = "scale" in image ? image.scale : image.normalizationScale;
  const sourceWidth = image.sourceWidth;
  const sourceHeight = image.sourceHeight;
  return padRect(
    {
      left: rect.left / scale,
      top: rect.top / scale,
      width: rect.width / scale,
      height: rect.height / scale,
    },
    sourceWidth,
    sourceHeight,
    0,
  );
}

function toAnalysisRect(rect: Rect, structure: WorksheetDetectionStructure) {
  return {
    left: rect.left * structure.normalizationScale,
    top: rect.top * structure.normalizationScale,
    width: rect.width * structure.normalizationScale,
    height: rect.height * structure.normalizationScale,
  };
}

function movingAverage(values: number[], radius: number) {
  const output = new Array<number>(values.length).fill(0);
  let sum = 0;
  let left = 0;
  let right = 0;

  while (right < values.length && right <= radius) {
    sum += values[right];
    right += 1;
  }

  for (let index = 0; index < values.length; index += 1) {
    output[index] = sum / Math.max(1, right - left);
    const nextLeft = index - radius;
    if (nextLeft >= 0) {
      sum -= values[nextLeft];
      left = nextLeft + 1;
    }
    const nextRight = index + radius + 1;
    if (nextRight < values.length) {
      sum += values[nextRight];
      right = nextRight + 1;
    }
  }

  return output;
}

function floodFill(
  mask: Uint8Array,
  visited: Uint8Array,
  width: number,
  height: number,
  startX: number,
  startY: number,
) {
  const queueX = [startX];
  const queueY = [startY];
  visited[startY * width + startX] = 1;
  let cursor = 0;
  let left = startX;
  let right = startX;
  let top = startY;
  let bottom = startY;
  let area = 0;

  while (cursor < queueX.length) {
    const x = queueX[cursor];
    const y = queueY[cursor];
    cursor += 1;
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
      queueX.push(nextX);
      queueY.push(nextY);
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
  const safeRects = rects.length > 0 ? rects : [{ left: 0, top: 0, width: 1, height: 1 }];
  const left = Math.min(...safeRects.map((rect) => rect.left));
  const top = Math.min(...safeRects.map((rect) => rect.top));
  const right = Math.max(...safeRects.map((rect) => rect.left + rect.width));
  const bottom = Math.max(...safeRects.map((rect) => rect.top + rect.height));
  return { left, top, width: right - left, height: bottom - top };
}

function intersects(a: Rect, b: Rect) {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

function intersectRects(left: Rect, right: Rect) {
  const intersectionLeft = Math.max(left.left, right.left);
  const intersectionTop = Math.max(left.top, right.top);
  const intersectionRight = Math.min(left.left + left.width, right.left + right.width);
  const intersectionBottom = Math.min(left.top + left.height, right.top + right.height);
  if (intersectionRight <= intersectionLeft || intersectionBottom <= intersectionTop) {
    return null;
  }
  return {
    left: intersectionLeft,
    top: intersectionTop,
    width: intersectionRight - intersectionLeft,
    height: intersectionBottom - intersectionTop,
  };
}

function trimRectAgainstHeaders(rect: Rect, headers: Rect[]) {
  let trimmed = { ...rect };
  for (const header of headers) {
    if (!intersects(trimmed, header)) {
      continue;
    }
    const upperHeight = Math.max(0, header.top - trimmed.top);
    const lowerTop = header.top + header.height;
    const lowerHeight = Math.max(0, trimmed.top + trimmed.height - lowerTop);
    if (upperHeight >= lowerHeight) {
      trimmed.height = upperHeight;
    } else {
      trimmed = {
        ...trimmed,
        top: lowerTop,
        height: lowerHeight,
      };
    }
  }
  return trimmed.width > 0 && trimmed.height > 0 ? trimmed : null;
}

function rectContains(rect: Rect, x: number, y: number) {
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
}

function rectOverlapRatio(a: Rect, b: Rect) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const overlap = Math.max(0, right - left) * Math.max(0, bottom - top);
  return overlap / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function horizontalOverlapRatio(a: Rect, b: Rect) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  return Math.max(0, right - left) / Math.max(1, Math.min(a.width, b.width));
}

function compareRectsByReadingOrder(left: Rect, right: Rect) {
  const sameRow = Math.abs(left.top - right.top) < Math.max(left.height, right.height) * 0.72;
  if (sameRow) {
    return left.left - right.left;
  }
  return left.top - right.top;
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
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
