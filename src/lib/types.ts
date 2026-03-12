export type JobStatus = "queued" | "processing" | "complete" | "failed";

export type LayoutMode = "side" | "below";

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
  cropFilename?: string;
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

export type JobRecord = {
  id: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
  originalFilename: string;
  uploadPath: string;
  pdfPath?: string;
  sourceImage?: SourceImageMetadata;
  problemRegions: ProblemRegion[];
  worksheetItems: WorksheetItem[];
  confidenceSummary: ConfidenceSummary;
  pageCount: number;
  itemCount: number;
  error?: string;
};
