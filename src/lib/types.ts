export type LayoutMode = "side" | "below";

export type WorksheetStatus =
  | "idle"
  | "analyzing"
  | "reviewing"
  | "generating"
  | "complete"
  | "failed";

export type CompositionMode = "composite-stack" | "union-fallback";

export type LayoutDensity = "compact" | "balanced" | "spacious";

export type PromptScale = "small" | "medium" | "large";

export type WorksheetLayoutOptions = {
  density: LayoutDensity;
  promptScale: PromptScale;
};

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

export type ProblemDraft = {
  id: string;
  orderIndex: number;
  sourceLabel: string | null;
  anchorRect: Rect;
  contentRects: Rect[];
  sectionHeaderRects: Rect[];
  unionBounds: Rect;
  confidence: number;
  fragments: InputProblemFragment[];
  compositionMode: CompositionMode;
  columnHint: number;
  included: boolean;
};

export type InputProblemRegion = ProblemDraft & {
  problemNumber: number | null;
};

export type WorksheetItem = {
  id: string;
  regionId: string;
  pageIndex: number;
  layoutMode: LayoutMode;
  compositionMode: CompositionMode;
  problemNumber: number | null;
  sourceLabel: string | null;
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

export type WorksheetPagePlacement =
  | {
      id: string;
      type: "problem";
      regionId: string;
      pageIndex: number;
      sourceLabel: string | null;
      rect: Rect;
      prompt: Rect;
      answerArea: Rect;
    }
  | {
      id: string;
      type: "section-header";
      regionId: string;
      pageIndex: number;
      sourceRect: Rect;
      rect: Rect;
    };

export type WorksheetPreviewPage = {
  pageIndex: number;
  width: number;
  height: number;
  placements: WorksheetPagePlacement[];
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

export type DebugRect = {
  id: string;
  rect: Rect;
};

export type AnchorDebugCandidate = DebugRect & {
  rowId: string;
  score: number;
  accepted: boolean;
  reason: string;
};

export type AnchorRecognition = {
  proposalId: string;
  sourceLabel: string;
  confidence: number;
};

export type DetectionStageCounts = {
  components: number;
  textComponents: number;
  rows: number;
  segments: number;
  proposals: number;
  recognizedAnchors: number;
  acceptedAnchors: number;
};

export type DetectionDebugSnapshot = {
  contentBounds: Rect;
  normalizationScale: number;
  rows: DebugRect[];
  segments: DebugRect[];
  columns: DebugRect[];
  layoutTracks: DebugRect[];
  zones: DebugRect[];
  anchorCandidates: AnchorDebugCandidate[];
  rejectedAnchorReasons: string[];
  sectionHeaders: SectionHeader[];
  stageCounts: DetectionStageCounts;
  fallbackUsed: boolean;
  warnings: string[];
  failureReason: string | null;
};

export type WorksheetAnalysis = {
  sourceImage: SourceImageMetadata;
  problemDrafts: ProblemDraft[];
  sectionHeaders: SectionHeader[];
  debug: DetectionDebugSnapshot;
  confidenceSummary: ConfidenceSummary;
  itemCount: number;
};

export type WorksheetLayoutPreview = {
  pageCount: number;
  worksheetItems: WorksheetItem[];
  pages: WorksheetPreviewPage[];
};

export type WorksheetResult = {
  sourceImage: SourceImageMetadata;
  problemRegions: InputProblemRegion[];
  worksheetItems: WorksheetItem[];
  sectionHeaders: SectionHeader[];
  confidenceSummary: ConfidenceSummary;
  pageCount: number;
  itemCount: number;
  layoutOptions: WorksheetLayoutOptions;
  pdfUrl: string;
};
