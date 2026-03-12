export type LayoutMode = "side" | "below";

export type WorksheetStatus = "idle" | "processing" | "complete" | "failed";

export type CompositionMode = "composite-stack" | "union-fallback";

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type InputProblemFragmentKind =
  | "anchor"
  | "content"
  | "diagram"
  | "section-header";

export type InputProblemFragment = {
  id: string;
  kind: InputProblemFragmentKind;
  rect: Rect;
  confidence: number;
};

export type SectionHeader = {
  id: string;
  rects: Rect[];
  unionBounds: Rect;
  confidence: number;
};

export type InputProblemRegion = {
  id: string;
  problemNumber: number | null;
  orderIndex: number;
  anchorRect: Rect;
  contentRects: Rect[];
  sectionHeaderRects: Rect[];
  unionBounds: Rect;
  confidence: number;
  fragments: InputProblemFragment[];
  compositionMode: CompositionMode;
  columnHint: number;
};

export type WorksheetItem = {
  id: string;
  regionId: string;
  pageIndex: number;
  layoutMode: LayoutMode;
  compositionMode: CompositionMode;
  problemNumber: number | null;
  columnSpan: 1 | 2 | 3;
  promptSize: {
    width: number;
    height: number;
  };
  answerArea: {
    width: number;
    height: number;
  };
};

export type SourceImageMetadata = {
  width: number;
  height: number;
  mimeType: string;
  sizeBytes: number;
};

export type ConfidenceSummary = {
  averageConfidence: number;
  lowConfidenceCount: number;
};

export type WorksheetResult = {
  sourceImage: SourceImageMetadata;
  problemRegions: InputProblemRegion[];
  worksheetItems: WorksheetItem[];
  sectionHeaders: SectionHeader[];
  confidenceSummary: ConfidenceSummary;
  pageCount: number;
  itemCount: number;
  pdfUrl: string;
};
