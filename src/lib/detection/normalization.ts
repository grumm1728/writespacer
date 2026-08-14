import { detectConnectedComponents } from "@/lib/detection/connected-components";
import type { Rect } from "@/lib/types";

export type WorksheetImageInput = {
  grayscale: Uint8Array;
  width: number;
  height: number;
  rgba?: Uint8Array | Uint8ClampedArray;
};

declare const analysisCoordinateSpace: unique symbol;

export type AnalysisRect = Rect & {
  readonly [analysisCoordinateSpace]: true;
};

export type NormalizedPage = {
  readonly grayscale: Uint8Array;
  readonly rgba?: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
  readonly sourceWidth: number;
  readonly sourceHeight: number;
};

const TARGET_GLYPH_HEIGHT = 18;
const MAX_ANALYSIS_EDGE = 2200;

export function normalizeWorksheetPage(input: WorksheetImageInput): NormalizedPage {
  assertImageInput(input);

  const estimatedGlyphHeight = estimateSourceGlyphHeight(
    input.grayscale,
    input.width,
    input.height,
  );
  const targetScale = TARGET_GLYPH_HEIGHT / Math.max(1, estimatedGlyphHeight);
  const edgeScale = MAX_ANALYSIS_EDGE / Math.max(input.width, input.height);
  const requestedScale = clamp(Math.min(targetScale, edgeScale), 0.58, 3.2);
  const width = Math.max(1, Math.round(input.width * requestedScale));
  const height = Math.max(1, Math.round(input.height * requestedScale));

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

  const grayscale = resizeGrayscale(
    input.grayscale,
    input.width,
    input.height,
    width,
    height,
  );
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

export function toSourceRect(rect: AnalysisRect, page: NormalizedPage): Rect {
  return clampRect(
    {
      left: rect.left / page.scale,
      top: rect.top / page.scale,
      width: rect.width / page.scale,
      height: rect.height / page.scale,
    },
    page.sourceWidth,
    page.sourceHeight,
  );
}

export function toAnalysisRect(rect: Rect, page: NormalizedPage): AnalysisRect {
  return asAnalysisRect({
    left: rect.left * page.scale,
    top: rect.top * page.scale,
    width: rect.width * page.scale,
    height: rect.height * page.scale,
  });
}

export function asAnalysisRect(rect: Rect): AnalysisRect {
  return rect as AnalysisRect;
}

function assertImageInput({ grayscale, height, rgba, width }: WorksheetImageInput) {
  const pixelCount = width * height;
  const validDimensions =
    Number.isSafeInteger(width) &&
    Number.isSafeInteger(height) &&
    width > 0 &&
    height > 0 &&
    Number.isSafeInteger(pixelCount);
  const validGrayscale = validDimensions && grayscale.length === pixelCount;
  const validRgba = !rgba || (validDimensions && rgba.length === pixelCount * 4);

  if (!validDimensions || !validGrayscale || !validRgba) {
    throw new Error("Worksheet image data has invalid dimensions.");
  }
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

function clampRect(rect: Rect, maxWidth: number, maxHeight: number): Rect {
  const left = Math.max(0, Math.floor(rect.left));
  const top = Math.max(0, Math.floor(rect.top));
  const right = Math.min(maxWidth, Math.ceil(rect.left + rect.width));
  const bottom = Math.min(maxHeight, Math.ceil(rect.top + rect.height));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
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
