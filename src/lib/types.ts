export type LayoutMode = "side" | "below";

export type WorksheetStatus = "idle" | "processing" | "complete" | "failed";

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type ProblemRegion = {
  id: string;
  bounds: Rect;
  confidence: number;
  associatedAuxiliaryIds: string[];
};

export type WorksheetItem = {
  id: string;
  regionId: string;
  pageIndex: number;
  layoutMode: LayoutMode;
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
  problemRegions: ProblemRegion[];
  worksheetItems: WorksheetItem[];
  confidenceSummary: ConfidenceSummary;
  pageCount: number;
  itemCount: number;
  pdfUrl: string;
};
