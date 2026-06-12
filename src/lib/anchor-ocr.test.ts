import { afterEach, describe, expect, it, vi } from "vitest";

const tesseract = vi.hoisted(() => ({
  createWorker: vi.fn(),
  recognize: vi.fn(),
  setParameters: vi.fn(),
  terminate: vi.fn(),
}));

vi.mock("tesseract.js", () => ({
  createWorker: tesseract.createWorker,
  OEM: { LSTM_ONLY: 1 },
  PSM: { SINGLE_BLOCK: 6 },
}));

import {
  recognizeAnchorProposals,
  terminateAnchorOcrWorker,
} from "@/lib/anchor-ocr";
import type { WorksheetAnchorProposal } from "@/lib/detection";

describe("anchor OCR adapter", () => {
  afterEach(async () => {
    await terminateAnchorOcrWorker();
    vi.restoreAllMocks();
  });

  it("reuses one worker and builds one contact sheet per analysis", async () => {
    const canvases: FakeCanvas[] = [];
    const originalDocument = globalThis.document;
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        baseURI: "http://localhost:3000/",
        createElement: () => {
          const canvas = makeCanvas();
          canvases.push(canvas);
          return canvas;
        },
        querySelector: () => ({ src: "http://localhost:3000/_next/static/chunks/app.js" }),
      },
    });

    tesseract.recognize.mockResolvedValue({ data: { blocks: [] } });
    tesseract.createWorker.mockResolvedValue({
      recognize: tesseract.recognize,
      setParameters: tesseract.setParameters,
      terminate: tesseract.terminate,
    });
    const source = makeCanvas(400, 300) as unknown as HTMLCanvasElement;
    const proposals = [proposal("a", 10), proposal("b", 60)];

    await recognizeAnchorProposals(source, proposals);
    await recognizeAnchorProposals(source, proposals);

    expect(tesseract.createWorker).toHaveBeenCalledTimes(1);
    expect(tesseract.setParameters).toHaveBeenCalledTimes(1);
    expect(tesseract.recognize).toHaveBeenCalledTimes(2);
    const contactSheets = canvases.filter((canvas) => canvas.width === 720);
    expect(contactSheets).toHaveLength(2);
    expect(contactSheets[0]).not.toBe(contactSheets[1]);

    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument,
    });
  });
});

type FakeCanvas = {
  width: number;
  height: number;
  getContext: () => FakeContext;
};

type FakeContext = {
  fillStyle: string;
  imageSmoothingEnabled: boolean;
  imageSmoothingQuality: string;
  drawImage: () => void;
  fillRect: () => void;
  getImageData: () => ImageData;
  putImageData: () => void;
};

function makeCanvas(width = 0, height = 0): FakeCanvas {
  const canvas = {
    width,
    height,
    getContext: () => context,
  } as FakeCanvas;
  const context: FakeContext = {
    fillStyle: "#ffffff",
    imageSmoothingEnabled: true,
    imageSmoothingQuality: "high",
    drawImage: () => undefined,
    fillRect: () => undefined,
    getImageData: () => ({
      data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(255),
      width: canvas.width,
      height: canvas.height,
      colorSpace: "srgb",
    }),
    putImageData: () => undefined,
  };
  return canvas;
}

function proposal(id: string, top: number): WorksheetAnchorProposal {
  return {
    id,
    rect: { left: 10, top, width: 20, height: 18 },
    rowId: `row-${id}`,
    segmentId: `segment-${id}`,
    score: 0.9,
    reason: "test anchor",
  };
}
