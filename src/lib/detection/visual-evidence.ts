import {
  detectConnectedComponents,
  type ConnectedComponent,
} from "@/lib/detection/connected-components";
import {
  asAnalysisRect,
  toSourceRect,
  type AnalysisRect,
  type NormalizedPage,
} from "@/lib/detection/normalization";
import type { Rect } from "@/lib/types";

export type TextRow = {
  id: string;
  rect: AnalysisRect;
  components: ConnectedComponent[];
  centerY: number;
};

export type RowSegment = {
  id: string;
  rowId: string;
  rect: AnalysisRect;
  components: ConnectedComponent[];
};

export type WorksheetAnchorProposal = {
  id: string;
  rect: Rect;
  rowId: string;
  segmentId: string;
  score: number;
  reason: string;
};

export type InternalAnchorProposal = WorksheetAnchorProposal & {
  analysisRect: AnalysisRect;
  contentAfter: boolean;
  dotLike: boolean;
};

export type LayoutRegion = {
  id: string;
  rect: Rect;
  analysisRect: AnalysisRect;
};

export type PageEvidence = {
  readonly page: NormalizedPage;
  readonly masks: {
    readonly initialText: Uint8Array;
    readonly content: Uint8Array;
  };
  readonly glyphHeight: number;
  readonly contentBounds: AnalysisRect;
  readonly contentComponents: ConnectedComponent[];
  readonly textComponents: ConnectedComponent[];
  readonly rows: TextRow[];
  readonly segments: RowSegment[];
  readonly layoutRegions: LayoutRegion[];
  readonly proposals: InternalAnchorProposal[];
};

const TARGET_GLYPH_HEIGHT = 18;

export function extractVisualEvidence(page: NormalizedPage): PageEvidence {
  const initialTextMask = buildAdaptiveMask(page, 13, true);
  const contentMask = buildAdaptiveMask(page, 8, false);
  const contentBounds = detectContentBounds(contentMask, page.width, page.height);
  const contentComponents = detectConnectedComponents(
    contentMask,
    page.width,
    page.height,
    contentBounds,
    4,
  );
  const initialComponents = detectConnectedComponents(
    initialTextMask,
    page.width,
    page.height,
    contentBounds,
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
  const rows = buildTextRows(textComponents, glyphHeight, page.width, page.height);
  const segments = buildRowSegments(rows, glyphHeight, page.width, page.height);
  const layoutRegions = detectLayoutRegions(contentMask, contentBounds, glyphHeight, page);
  const proposals = detectAnchorProposals(
    rows,
    segments,
    contentComponents,
    layoutRegions,
    glyphHeight,
    page,
  );

  return {
    page,
    masks: {
      initialText: initialTextMask,
      content: contentMask,
    },
    glyphHeight,
    contentBounds,
    contentComponents,
    textComponents,
    rows,
    segments,
    layoutRegions,
    proposals,
  };
}

function buildAdaptiveMask(
  image: NormalizedPage,
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

function detectContentBounds(mask: Uint8Array, width: number, height: number): AnalysisRect {
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
    return asAnalysisRect({ left: 0, top: 0, width, height });
  }

  return asAnalysisRect(
    padRect(
      { left, top, width: right - left + 1, height: bottom - top + 1 },
      width,
      height,
      12,
    ),
  );
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
        rect: asAnalysisRect(component),
        components: [component],
        centerY: component.centerY,
      });
      continue;
    }

    target.components.push(component);
    target.rect = asAnalysisRect(unionRects([target.rect, component]));
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
      rect: asAnalysisRect(padRect(row.rect, width, height, 0)),
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
    rect: asAnalysisRect(padRect(unionRects(components), width, height, 0)),
    components,
  };
}

function detectLayoutRegions(
  mask: Uint8Array,
  contentBounds: AnalysisRect,
  glyphHeight: number,
  page: NormalizedPage,
) {
  const left = Math.max(0, Math.floor(contentBounds.left));
  const right = Math.min(page.width, Math.ceil(contentBounds.left + contentBounds.width));
  const top = Math.max(0, Math.floor(contentBounds.top));
  const bottom = Math.min(page.height, Math.ceil(contentBounds.top + contentBounds.height));
  const columns = new Array<number>(right - left).fill(0);

  for (let x = left; x < right; x += 1) {
    let ink = 0;
    for (let y = top; y < bottom; y += 1) {
      ink += mask[y * page.width + x];
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
    const analysisRect = asAnalysisRect({
      left: regionLeft,
      top: contentBounds.top,
      width: regionRight - regionLeft,
      height: contentBounds.height,
    });
    regions.push({
      id: `layout-${regions.length + 1}`,
      analysisRect,
      rect: toSourceRect(analysisRect, page),
    });
  }

  if (regions.length === 0) {
    return [
      {
        id: "layout-1",
        analysisRect: contentBounds,
        rect: toSourceRect(contentBounds, page),
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
  page: NormalizedPage,
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
      const analysisRect = asAnalysisRect(
        padRect(prefix.rect, page.width, page.height, glyphHeight * 0.18),
      );

      proposals.push({
        id: `proposal-${proposals.length + 1}`,
        rect: toSourceRect(analysisRect, page),
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

function rectContains(rect: Rect, x: number, y: number) {
  return (
    x >= rect.left &&
    x <= rect.left + rect.width &&
    y >= rect.top &&
    y <= rect.top + rect.height
  );
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
