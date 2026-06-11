import type {
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
  segment: RowSegment;
  score: number;
  accepted: boolean;
  reason: string;
};

type PageColumn = {
  id: string;
  rect: Rect;
};

type OwnershipZone = {
  id: string;
  anchor: AnchorCandidate;
  rect: Rect;
  columnIndex: number;
  orderIndex: number;
};

const TEXT_THRESHOLD = 145;
const CONTENT_THRESHOLD = 205;

export function analyzeWorksheetImage({
  grayscale,
  height,
  rgba,
  width,
}: AnalyzeImageInput) {
  const textMask = buildMask(grayscale, width, height, TEXT_THRESHOLD, rgba, true);
  const contentMask = buildMask(grayscale, width, height, CONTENT_THRESHOLD, rgba, false);
  const contentBounds = detectContentBounds(contentMask, width, height);
  const contentComponents = detectConnectedComponents(contentMask, width, height, contentBounds, {
    minArea: 8,
  });
  const textComponents = detectConnectedComponents(textMask, width, height, contentBounds, {
    minArea: 6,
  }).filter((component) => isTextLikeComponent(component, width, height));
  const rows = buildTextRows(textComponents, width, height);
  const segments = buildRowSegments(rows, width, height);
  const candidateResult = detectAnchorCandidates(
    rows,
    segments,
    contentComponents,
    contentBounds,
  );
  const acceptedAnchors = candidateResult.candidates.filter((candidate) => candidate.accepted);
  const columns = buildPageColumns(acceptedAnchors, contentBounds, width, height);
  const sortedAnchors = sortAnchorsByColumns(acceptedAnchors, columns);
  const sectionHeaders = detectSectionHeaders(
    rows,
    segments,
    sortedAnchors,
    contentBounds,
    width,
    height,
  );
  const zones = buildOwnershipZones(sortedAnchors, columns, contentBounds, width, height);
  const problemDrafts = assignSourceLabels(
    buildProblemDrafts(
    contentComponents,
    segments,
    sectionHeaders,
    zones,
    candidateResult.candidates,
    width,
    height,
    ),
    zones,
  );
  const failureReason =
    problemDrafts.length === 0
      ? "No numbered problem anchors were accepted. Review the debug rows and candidates, or draw regions manually."
      : null;
  const labelWarning =
    problemDrafts.length > 0 && problemDrafts[0].sourceLabel === "1"
      ? null
      : "Problem labels were inferred from the first visible anchor; review labels before printing.";

  return {
    problemDrafts,
    sectionHeaders,
    debug: {
      contentBounds,
      rows: rows.map((row) => ({ id: row.id, rect: row.rect })),
      segments: segments.map((segment) => ({ id: segment.id, rect: segment.rect })),
      columns: columns.map((column) => ({ id: column.id, rect: column.rect })),
      zones: zones.map((zone) => ({ id: zone.id, rect: zone.rect })),
      anchorCandidates: candidateResult.candidates.map((candidate) => ({
        id: candidate.id,
        rect: candidate.rect,
        rowId: candidate.row.id,
        score: candidate.score,
        accepted: candidate.accepted,
        reason: candidate.reason,
      })),
      rejectedAnchorReasons: candidateResult.rejectedReasons,
      sectionHeaders,
      warnings: [
        ...(problemDrafts.length === 0
          ? ["No accepted anchors; manual region drawing is available in review."]
          : []),
        ...(labelWarning ? [labelWarning] : []),
      ],
      failureReason,
    } satisfies DetectionDebugSnapshot,
  };
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

function buildMask(
  grayscale: Uint8Array,
  width: number,
  height: number,
  threshold: number,
  rgba: Uint8Array | Uint8ClampedArray | undefined,
  suppressBlueGuidePixels: boolean,
) {
  const mask = new Uint8Array(width * height);

  for (let index = 0; index < grayscale.length; index += 1) {
    if (grayscale[index] >= threshold) {
      continue;
    }

    if (suppressBlueGuidePixels && rgba) {
      const offset = index * 4;
      const red = rgba[offset];
      const green = rgba[offset + 1];
      const blue = rgba[offset + 2];
      if (blue > 120 && green > 80 && red < 100) {
        continue;
      }
    }

    mask[index] = 1;
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
  const minCol = Math.max(3, Math.floor(height * 0.01));
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
  options: { minArea: number },
) {
  const visited = new Uint8Array(width * height);
  const components: ConnectedComponent[] = [];
  let nextId = 1;

  const left = Math.max(0, Math.round(bounds.left));
  const right = Math.min(width, Math.round(bounds.left + bounds.width));
  const top = Math.max(0, Math.round(bounds.top));
  const bottom = Math.min(height, Math.round(bounds.top + bounds.height));

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const offset = y * width + x;
      if (!mask[offset] || visited[offset]) {
        continue;
      }

      const component = floodFill(mask, visited, width, height, x, y);
      if (
        component.area < options.minArea ||
        component.width < 2 ||
        component.height < 2
      ) {
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

function isTextLikeComponent(component: ConnectedComponent, width: number, height: number) {
  const maxTextHeight = Math.max(50, height * 0.045);
  const maxTextWidth = Math.max(180, width * 0.14);
  return (
    component.height <= maxTextHeight &&
    component.width <= maxTextWidth &&
    component.area <= 3000 &&
    component.density > 0.045
  );
}

function buildTextRows(components: ConnectedComponent[], width: number, height: number) {
  const sorted = [...components].sort((left, right) => {
    if (Math.abs(left.top - right.top) < 3) {
      return left.left - right.left;
    }
    return left.top - right.top;
  });
  const rows: TextRow[] = [];
  let nextId = 1;

  for (const component of sorted) {
    const current = rows.at(-1);
    if (!current) {
      rows.push(makeRow(nextId, component));
      nextId += 1;
      continue;
    }

    const currentMid = current.rect.top + current.rect.height / 2;
    const componentMid = component.top + component.height / 2;
    const sameBaseline =
      Math.abs(componentMid - currentMid) <
      Math.max(10, Math.max(component.height, current.rect.height) * 0.62);

    if (sameBaseline) {
      current.components.push(component);
      current.rect = padRect(unionRects([current.rect, component]), width, height, 0);
      current.density =
        current.components.reduce((sum, item) => sum + item.density, 0) /
        current.components.length;
    } else {
      rows.push(makeRow(nextId, component));
      nextId += 1;
    }
  }

  return rows.filter((row) => row.rect.width > 20 && row.rect.height < height * 0.12);
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
    const splitGap = Math.max(12, row.rect.height * 0.32);

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
      0,
    ),
    components,
  };
}

function detectAnchorCandidates(
  rows: TextRow[],
  rowSegments: RowSegment[],
  contentComponents: ConnectedComponent[],
  contentBounds: Rect,
) {
  const candidates: AnchorCandidate[] = [];
  const rejectedReasons: string[] = [];

  for (const row of rows) {
    const segments = rowSegments
      .filter((segment) => segment.rowId === row.id)
      .sort((left, right) => left.rect.left - right.rect.left);

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index];
      const detachedDot = findDetachedDot(segment, rowSegments);
      const anchorSegment = detachedDot
        ? {
            ...segment,
            rect: unionRects([segment.rect, detachedDot.rect]),
            components: [...segment.components, ...detachedDot.components],
          }
        : segment;
      const shape = evaluateAnchorShape(anchorSegment);
      if (!shape.accepted) {
        if (shape.reason !== "not compact") {
          rejectedReasons.push(shape.reason);
        }
        continue;
      }

      const contentAfter = hasSubstantialContentAfter(anchorSegment, segments, index);
      const diagramBelow = hasDiagramBelow(anchorSegment.rect, contentComponents, contentBounds);
      const score =
        0.42 +
        shape.score +
        (contentAfter ? 0.18 : 0) +
        (diagramBelow ? 0.22 : 0) +
        (segment.rect.left < contentBounds.left + contentBounds.width * 0.92 ? 0.05 : 0);
      const accepted = score >= 0.84 || (score >= 0.62 && (contentAfter || diagramBelow));
      const reason = accepted
        ? contentAfter
          ? "numbered anchor with neighboring content"
          : diagramBelow
            ? "numbered anchor with diagram below"
            : "standalone numbered anchor"
        : "compact number-like segment lacked nearby content";

      candidates.push({
        id: `anchor-${candidates.length + 1}`,
        rect: padRect(anchorSegment.rect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 2),
        row,
        segment: anchorSegment,
        score: clamp(score, 0, 1),
        accepted,
        reason,
      });
    }
  }

  return {
    candidates: dedupeAnchorCandidates(candidates),
    rejectedReasons: [...new Set(rejectedReasons)].slice(0, 8),
  };
}

function findDetachedDot(segment: RowSegment, rowSegments: RowSegment[]) {
  if (segment.components.length > 3 || segment.rect.width > 48 || segment.rect.height > 32) {
    return null;
  }

  const right = segment.rect.left + segment.rect.width;
  const bottom = segment.rect.top + segment.rect.height;

  return (
    rowSegments.find((candidate) => {
      if (candidate.id === segment.id || candidate.components.length > 1) {
        return false;
      }

      const rect = candidate.rect;
      return (
        rect.width <= 8 &&
        rect.height <= 8 &&
        rect.left >= right - 3 &&
        rect.left <= right + 12 &&
        rect.top >= segment.rect.top + segment.rect.height * 0.62 &&
        rect.top <= bottom + 8
      );
    }) ?? null
  );
}

function evaluateAnchorShape(segment: RowSegment) {
  const rect = segment.rect;
  const compact =
    rect.width >= 14 &&
    rect.width <= 60 &&
    rect.height >= 14 &&
    rect.height <= 38 &&
    segment.components.length >= 2 &&
    segment.components.length <= 5;

  if (!compact) {
    return { accepted: false, score: 0, reason: "not compact" };
  }

  const dot = segment.components.find(
    (component) =>
      component.width <= 6 &&
      component.height <= 6 &&
      component.area <= 30 &&
      component.top >= rect.top + rect.height * 0.58 &&
      component.left >= rect.left + rect.width * 0.52,
  );

  if (!dot) {
    return { accepted: false, score: 0, reason: "compact segment had no period dot" };
  }

  const digitLike = segment.components.filter((component) => component !== dot);
  const digitScore =
    digitLike.length >= 1 && digitLike.length <= 3
      ? 0.16
      : digitLike.length === 4
        ? 0.08
        : 0;
  const dotScore = dot.width <= 5 && dot.height <= 5 ? 0.14 : 0.08;
  const shapeScore = rect.width <= 42 ? 0.1 : 0.04;

  return {
    accepted: true,
    score: digitScore + dotScore + shapeScore,
    reason: "period-like compact segment",
  };
}

function hasSubstantialContentAfter(
  segment: RowSegment,
  rowSegments: RowSegment[],
  segmentIndex: number,
) {
  const right = segment.rect.left + segment.rect.width;
  const next = rowSegments.slice(segmentIndex + 1).find((candidate) => {
    const gap = candidate.rect.left - right;
    return gap >= 8 && gap <= Math.max(120, segment.rect.height * 5.5);
  });

  if (!next) {
    return false;
  }

  const nextShape = evaluateAnchorShape(next);
  if (nextShape.accepted) {
    return false;
  }

  return (
    next.rect.width > Math.max(44, segment.rect.width * 1.35) ||
    next.components.length >= 4 ||
    next.rect.height > segment.rect.height * 1.15
  );
}

function hasDiagramBelow(
  rect: Rect,
  contentComponents: ConnectedComponent[],
  contentBounds: Rect,
) {
  const searchLeft = rect.left - 45;
  const searchRight = rect.left + Math.max(250, contentBounds.width * 0.16);
  const searchTop = rect.top + rect.height + 8;
  const searchBottom = rect.top + Math.max(260, contentBounds.height * 0.34);

  return contentComponents.some(
    (component) =>
      component.width > 70 &&
      component.height > 45 &&
      component.area > 140 &&
      component.centerX >= searchLeft &&
      component.centerX <= searchRight &&
      component.top >= searchTop &&
      component.top <= searchBottom,
  );
}

function dedupeAnchorCandidates(candidates: AnchorCandidate[]) {
  const sorted = [...candidates].sort((left, right) => {
    if (left.accepted !== right.accepted) {
      return left.accepted ? -1 : 1;
    }
    return right.score - left.score;
  });
  const kept: AnchorCandidate[] = [];

  for (const candidate of sorted) {
    const duplicate = kept.some((existing) =>
      intersects(padRect(existing.rect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 4), candidate.rect),
    );
    if (!duplicate) {
      kept.push(candidate);
    }
  }

  return kept.sort(compareReadingOrder);
}

function buildPageColumns(
  anchors: AnchorCandidate[],
  contentBounds: Rect,
  width: number,
  height: number,
): PageColumn[] {
  if (anchors.length < 6) {
    return [{ id: "column-1", rect: contentBounds }];
  }

  const centers = anchors
    .map((anchor) => anchor.rect.left + anchor.rect.width / 2)
    .sort((left, right) => left - right);
  let widestGap = 0;
  let split = contentBounds.left + contentBounds.width / 2;

  for (let index = 1; index < centers.length; index += 1) {
    const gap = centers[index] - centers[index - 1];
    if (gap > widestGap) {
      widestGap = gap;
      split = centers[index - 1] + gap / 2;
    }
  }

  if (widestGap < contentBounds.width * 0.18) {
    return [{ id: "column-1", rect: contentBounds }];
  }

  const leftRect = padRect(
    {
      left: contentBounds.left,
      top: contentBounds.top,
      width: split - contentBounds.left,
      height: contentBounds.height,
    },
    width,
    height,
    0,
  );
  const rightRect = padRect(
    {
      left: split,
      top: contentBounds.top,
      width: contentBounds.left + contentBounds.width - split,
      height: contentBounds.height,
    },
    width,
    height,
    0,
  );

  return [
    { id: "column-1", rect: leftRect },
    { id: "column-2", rect: rightRect },
  ];
}

function sortAnchorsByColumns(anchors: AnchorCandidate[], columns: PageColumn[]) {
  return [...anchors].sort((left, right) => {
    const leftColumn = columnIndexForRect(left.rect, columns);
    const rightColumn = columnIndexForRect(right.rect, columns);
    if (leftColumn !== rightColumn) {
      return leftColumn - rightColumn;
    }
    return compareReadingOrder(left, right);
  });
}

function detectSectionHeaders(
  rows: TextRow[],
  rowSegments: RowSegment[],
  anchors: AnchorCandidate[],
  contentBounds: Rect,
  width: number,
  height: number,
) {
  const headers: SectionHeader[] = [];

  for (const row of rows) {
    const segments = rowSegments.filter((segment) => segment.rowId === row.id);

    for (const segment of segments) {
      const intersectsAnchor = anchors.some((anchor) =>
        intersects(padRect(anchor.rect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 3), segment.rect),
      );
      if (intersectsAnchor) {
        continue;
      }

      const likelyHeader =
        segment.rect.width > Math.max(380, contentBounds.width * 0.24) &&
        segment.rect.height >= 20 &&
        segment.components.length > 20;

      if (!likelyHeader) {
        continue;
      }

      const hasNearbyAnchor = anchors.some(
        (anchor) =>
          anchor.rect.top > segment.rect.top &&
          anchor.rect.top - segment.rect.top < Math.max(250, contentBounds.height * 0.18) &&
          horizontalOverlapRatio(segment.rect, anchor.rect) > 0.05,
      );

      if (!hasNearbyAnchor) {
        continue;
      }

      const headerRect = buildHeaderRect(segment, segments, anchors, width, height);

      headers.push({
        id: `section-${headers.length + 1}`,
        rects: [padRect(headerRect, width, height, 6)],
        unionBounds: padRect(headerRect, width, height, 8),
        confidence: 0.7,
      });
    }
  }

  return headers;
}

function buildHeaderRect(
  seed: RowSegment,
  rowSegments: RowSegment[],
  anchors: AnchorCandidate[],
  width: number,
  height: number,
) {
  const anchorRects = anchors.map((anchor) =>
    padRect(anchor.rect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 3),
  );
  const merged: Rect[] = [seed.rect];
  let changed = true;

  while (changed) {
    changed = false;
    for (const segment of rowSegments) {
      if (merged.some((rect) => rect === segment.rect)) {
        continue;
      }

      if (anchorRects.some((rect) => intersects(rect, segment.rect))) {
        continue;
      }

      const nearExisting = merged.some((rect) => {
        const gap =
          segment.rect.left > rect.left
            ? segment.rect.left - (rect.left + rect.width)
            : rect.left - (segment.rect.left + segment.rect.width);
        return Math.abs(segment.rect.top - rect.top) < 12 && gap >= 0 && gap <= 32;
      });

      if (nearExisting) {
        merged.push(segment.rect);
        changed = true;
      }
    }
  }

  return padRect(unionRects(merged), width, height, 0);
}

function buildOwnershipZones(
  anchors: AnchorCandidate[],
  columns: PageColumn[],
  contentBounds: Rect,
  width: number,
  height: number,
) {
  const zones: OwnershipZone[] = [];

  anchors.forEach((anchor, anchorIndex) => {
    const columnIndex = columnIndexForRect(anchor.rect, columns);
    const column = columns[columnIndex] ?? { id: "column-1", rect: contentBounds };
    const sameRowAnchors = anchors
      .filter(
        (candidate) =>
          columnIndexForRect(candidate.rect, columns) === columnIndex &&
          candidate.row.id === anchor.row.id,
      )
      .sort((left, right) => left.rect.left - right.rect.left);
    const rowIndex = sameRowAnchors.findIndex((candidate) => candidate.id === anchor.id);
    const previousSameRow = sameRowAnchors[rowIndex - 1] ?? null;
    const nextSameRow = sameRowAnchors[rowIndex + 1] ?? null;
    const left = previousSameRow
      ? (previousSameRow.rect.left + previousSameRow.rect.width + anchor.rect.left) / 2
      : column.rect.left;
    const right = nextSameRow
      ? (anchor.rect.left + anchor.rect.width + nextSameRow.rect.left) / 2
      : column.rect.left + column.rect.width;
    const horizontalRect = {
      left,
      top: column.rect.top,
      width: Math.max(1, right - left),
      height: column.rect.height,
    };
    const nextBelow = anchors
      .filter(
        (candidate) =>
          candidate.id !== anchor.id &&
          columnIndexForRect(candidate.rect, columns) === columnIndex &&
          candidate.rect.top > anchor.rect.top + anchor.rect.height + 4 &&
          rectOverlapRatio(horizontalRect, candidate.rect) > 0.18,
      )
      .sort((leftCandidate, rightCandidate) => leftCandidate.rect.top - rightCandidate.rect.top)[0];
    const top = Math.max(
      column.rect.top,
      anchor.rect.top - Math.max(8, anchor.rect.height * 0.55),
    );
    const bottom = nextBelow
      ? Math.max(anchor.rect.top + anchor.rect.height + 16, nextBelow.rect.top - 8)
      : column.rect.top + column.rect.height;

    zones.push({
      id: `zone-${anchorIndex + 1}`,
      anchor,
      columnIndex,
      orderIndex: anchorIndex,
      rect: padRect(
        {
          left,
          top,
          width: Math.max(1, right - left),
          height: Math.max(1, bottom - top),
        },
        width,
        height,
        6,
      ),
    });
  });

  return zones;
}

function buildProblemDrafts(
  contentComponents: ConnectedComponent[],
  rowSegments: RowSegment[],
  sectionHeaders: SectionHeader[],
  zones: OwnershipZone[],
  allCandidates: AnchorCandidate[],
  width: number,
  height: number,
) {
  const acceptedAnchorRects = allCandidates
    .filter((candidate) => candidate.accepted)
    .map((candidate) => candidate.rect);
  const allSectionHeaderRects = sectionHeaders.flatMap((header) => header.rects);
  const headerAssignments = assignSectionHeadersToZones(sectionHeaders, zones);

  return zones.map((zone, index) => {
    const componentsInZone = contentComponents.filter((component) =>
      rectContains(zone.rect, component.centerX, component.centerY),
    );
    const segmentsInZone = rowSegments.filter((segment) =>
      rectContains(
        zone.rect,
        segment.rect.left + segment.rect.width / 2,
        segment.rect.top + segment.rect.height / 2,
      ),
    );
    const attachedHeaders = headerAssignments.get(zone.id) ?? [];
    const anchorRect = padRect(zone.anchor.rect, width, height, 4);
    const sectionHeaderRects = attachedHeaders.flatMap((header) => header.rects);
    const contentRects = buildAssignedContentRects(
      segmentsInZone,
      componentsInZone,
      anchorRect,
      allSectionHeaderRects,
      acceptedAnchorRects,
      width,
      height,
    );
    const allRects = [anchorRect, ...contentRects];
    const unionBounds = padRect(unionRects(allRects), width, height, 8);
    const hasDiagram = contentRects.some(
      (rect) =>
        rect.width > Math.max(60, zone.rect.width * 0.32) &&
        rect.height > Math.max(52, zone.rect.height * 0.12),
    );
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
        confidence: attachedHeaders[0]?.confidence ?? 0.62,
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
      orderIndex: index,
      sourceLabel: null,
      anchorRect,
      contentRects,
      sectionHeaderRects,
      unionBounds,
      confidence: calculateProblemConfidence(zone, contentRects, hasDiagram),
      fragments,
      compositionMode:
        hasDiagram || contentRects.length > 8 ? "union-fallback" : "composite-stack",
      columnHint: zone.columnIndex,
      included: true,
    } satisfies ProblemDraft;
  });
}

function assignSourceLabels(problemDrafts: ProblemDraft[], zones: OwnershipZone[]) {
  const firstDetected = zones[0] ? recognizeAnchorStartNumber(zones[0].anchor) : null;
  const start = firstDetected ?? 1;
  return problemDrafts.map((draft, index) => ({
    ...draft,
    sourceLabel: String(start + index),
  }));
}

function recognizeAnchorStartNumber(anchor: AnchorCandidate) {
  const dot = findPeriodComponent(anchor.segment);
  const digits = anchor.segment.components.filter((component) => component !== dot);

  if (digits.length !== 1) {
    return null;
  }

  const digit = digits[0];
  const slender = digit.width / Math.max(1, digit.height) < 0.48;
  const tall = digit.height >= 25;
  if (slender && tall) {
    return 1;
  }

  return 3;
}

function assignSectionHeadersToZones(
  sectionHeaders: SectionHeader[],
  zones: OwnershipZone[],
) {
  const assignments = new Map<string, SectionHeader[]>();

  for (const header of sectionHeaders) {
    const headerBottom = header.unionBounds.top + header.unionBounds.height;
    const candidates = zones
      .filter((zone) => {
        const verticalDistance = zone.anchor.rect.top - headerBottom;
        const sameColumn =
          horizontalOverlapRatio(header.unionBounds, zone.rect) > 0.08 ||
          rectOverlapRatio(
            padRect(header.unionBounds, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 12),
            zone.rect,
          ) > 0.08;

        return verticalDistance >= -4 && verticalDistance < 420 && sameColumn;
      })
      .sort((left, right) => {
        const leftDistance = left.anchor.rect.top - headerBottom;
        const rightDistance = right.anchor.rect.top - headerBottom;
        if (Math.abs(leftDistance - rightDistance) > 16) {
          return leftDistance - rightDistance;
        }
        return left.orderIndex - right.orderIndex;
      });

    const target = candidates[0];
    if (!target) {
      continue;
    }

    const existing = assignments.get(target.id) ?? [];
    assignments.set(target.id, [...existing, header]);
  }

  return assignments;
}

function findPeriodComponent(segment: RowSegment) {
  return segment.components.find(
    (component) =>
      component.width <= 6 &&
      component.height <= 6 &&
      component.area <= 30 &&
      component.top >= segment.rect.top + segment.rect.height * 0.58 &&
      component.left >= segment.rect.left + segment.rect.width * 0.52,
  );
}

function buildAssignedContentRects(
  segmentsInZone: RowSegment[],
  componentsInZone: ConnectedComponent[],
  anchorRect: Rect,
  sectionHeaderRects: Rect[],
  acceptedAnchorRects: Rect[],
  width: number,
  height: number,
) {
  const isAnchor = (rect: Rect) =>
    acceptedAnchorRects.some((candidate) =>
      intersects(padRect(candidate, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 5), rect),
    );
  const textRects = mergeSegmentsByRow(
    segmentsInZone.filter(
      (segment) =>
        !intersects(padRect(anchorRect, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 4), segment.rect) &&
        !sectionHeaderRects.some((rect) => intersects(rect, segment.rect)) &&
        !isAnchor(segment.rect),
    ),
    width,
    height,
  );
  const diagramRects = mergeDiagramRects(
    componentsInZone.filter(
      (component) =>
        !isAnchor(component) &&
        !sectionHeaderRects.some((rect) => intersects(rect, component)) &&
        !textRects.some((rect) => intersects(rect, component)) &&
        (component.width > 48 || component.height > 48 || component.area > 900),
    ),
    width,
    height,
  );
  const combined = [...textRects, ...diagramRects].sort(compareRectsByReadingOrder);

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
      const rect = padRect(segment.rect, width, height, 3);
      if (!current) {
        current = rect;
        continue;
      }

      const gap = rect.left - (current.left + current.width);
      if (gap <= Math.max(22, current.height * 1.1)) {
        current = padRect(unionRects([current, rect]), width, height, 1);
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
  width: number,
  height: number,
) {
  const merged: Rect[] = [];

  for (const component of components) {
    const rect = padRect(component, width, height, 5);
    const existingIndex = merged.findIndex((candidate) =>
      intersects(
        padRect(candidate, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 12),
        rect,
      ),
    );

    if (existingIndex >= 0) {
      merged[existingIndex] = padRect(unionRects([merged[existingIndex], rect]), width, height, 3);
    } else {
      merged.push(rect);
    }
  }

  return merged.sort(compareRectsByReadingOrder);
}

function calculateProblemConfidence(
  zone: OwnershipZone,
  contentRects: Rect[],
  hasDiagram: boolean,
) {
  const base = 0.48 + Math.min(0.24, zone.anchor.score * 0.24);
  const contentScore = Math.min(0.18, contentRects.length * 0.025);
  const complexityPenalty = hasDiagram ? 0.05 : 0;
  return clamp(base + contentScore - complexityPenalty, 0.3, 0.96);
}

function columnIndexForRect(rect: Rect, columns: PageColumn[]) {
  const centerX = rect.left + rect.width / 2;
  const index = columns.findIndex((column) =>
    rectContains(column.rect, centerX, rect.top + rect.height / 2),
  );
  return index >= 0 ? index : 0;
}

function compareReadingOrder(left: { rect: Rect }, right: { rect: Rect }) {
  return compareRectsByReadingOrder(left.rect, right.rect);
}

function compareRectsByReadingOrder(left: Rect, right: Rect) {
  const sameRow =
    Math.abs(left.top - right.top) < Math.max(left.height, right.height) * 0.72;
  if (sameRow) {
    return left.left - right.left;
  }

  return left.top - right.top;
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

function rectOverlapRatio(a: Rect, b: Rect) {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  const overlap = width * height;
  return overlap / Math.max(1, Math.min(a.width * a.height, b.width * b.height));
}

function horizontalOverlapRatio(a: Rect, b: Rect) {
  const left = Math.max(a.left, b.left);
  const right = Math.min(a.left + a.width, b.left + b.width);
  return Math.max(0, right - left) / Math.max(1, Math.min(a.width, b.width));
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
