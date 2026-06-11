"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatDuplicateSourceLabels } from "@/lib/detection";
import {
  analyzeWorksheetFile,
  DEFAULT_LAYOUT_OPTIONS,
  generateWorksheetPdf,
  previewWorksheetLayout,
  revokeWorksheetResult,
} from "@/lib/client-processing";
import type {
  LayoutDensity,
  PromptScale,
  ProblemDraft,
  Rect,
  WorksheetAnalysis,
  WorksheetLayoutPreview,
  WorksheetResult,
  WorksheetStatus,
} from "@/lib/types";

const ACCEPT = "image/png,image/jpeg,image/webp";

const SAMPLE_WORKSHEETS = [
  {
    title: "Textbook equations",
    description: "Dense algebra page with equations and graphs.",
    filename: "pershan-problem-set-example.png",
    path: "./fixtures/pershan-problem-set-example.png",
  },
  {
    title: "Original sample",
    description: "Early worksheet sample used during development.",
    filename: "sample-input.png",
    path: "./fixtures/sample-input.png",
  },
  {
    title: "Sample 02",
    description: "Additional classroom worksheet sample.",
    filename: "sample-input-02.jpg",
    path: "./fixtures/sample-input-02.jpg",
  },
  {
    title: "Geometry sample",
    description: "Geometry worksheet with diagrams.",
    filename: "sample-input-03-geometry.jpg",
    path: "./fixtures/sample-input-03-geometry.jpg",
  },
  {
    title: "Calculus sample",
    description: "Calculus worksheet sample.",
    filename: "sample-input-04-calculus.png",
    path: "./fixtures/sample-input-04-calculus.png",
  },
] as const;

type SampleWorksheet = (typeof SAMPLE_WORKSHEETS)[number];

const statusCopy: Record<WorksheetStatus, string> = {
  idle: "Ready",
  analyzing: "Detecting prompts",
  reviewing: "Review boxes",
  generating: "Building PDF",
  complete: "Worksheet ready",
  failed: "Processing failed",
};

type InteractionState =
  | {
      type: "move" | "resize";
      draftId: string;
      start: { x: number; y: number };
      original: ProblemDraft;
    }
  | {
      type: "draw";
      start: { x: number; y: number };
    };

export function WorksheetApp() {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<WorksheetAnalysis | null>(null);
  const [drafts, setDrafts] = useState<ProblemDraft[]>([]);
  const [result, setResult] = useState<WorksheetResult | null>(null);
  const [status, setStatus] = useState<WorksheetStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showSampleModal, setShowSampleModal] = useState(false);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [density, setDensity] = useState<LayoutDensity>(DEFAULT_LAYOUT_OPTIONS.density);
  const [promptScale, setPromptScale] = useState<PromptScale>(
    DEFAULT_LAYOUT_OPTIONS.promptScale,
  );
  const [editMode, setEditMode] = useState<"select" | "draw">("select");
  const [interaction, setInteraction] = useState<InteractionState | null>(null);
  const [drawPreview, setDrawPreview] = useState<Rect | null>(null);

  useEffect(() => {
    return () => {
      if (result) {
        revokeWorksheetResult(result);
      }
    };
  }, [result]);

  useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const includedDrafts = drafts.filter((draft) => draft.included);
  const displayLabels = useMemo(
    () => formatDuplicateSourceLabels(drafts.map((draft) => draft.sourceLabel)),
    [drafts],
  );
  const layoutPreview = useMemo(
    () => previewWorksheetLayout(drafts, { density, promptScale }),
    [density, drafts, promptScale],
  );
  const canGenerate = Boolean(file) && includedDrafts.length > 0;

  function clearCurrentResult() {
    if (result) {
      revokeWorksheetResult(result);
      setResult(null);
      if (analysis) {
        setStatus("reviewing");
      }
    }
  }

  function replacePreview(nextPreviewUrl: string | null) {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(nextPreviewUrl);
  }

  function applySelectedFile(nextFile: File | null, nextPreviewUrl: string | null) {
    clearCurrentResult();
    setAnalysis(null);
    setDrafts([]);
    setSelectedDraftId(null);
    setFile(nextFile);
    replacePreview(nextPreviewUrl);
    setError(null);
    setEditMode("select");
    setDensity(DEFAULT_LAYOUT_OPTIONS.density);
    setPromptScale(DEFAULT_LAYOUT_OPTIONS.promptScale);
    setStatus("idle");
  }

  async function handleAnalyze() {
    if (!file) {
      setError("Choose an image before analyzing the worksheet.");
      return;
    }

    clearCurrentResult();
    setStatus("analyzing");
    setError(null);

    try {
      const nextAnalysis = await analyzeWorksheetFile(file);
      setAnalysis(nextAnalysis);
      setDrafts(nextAnalysis.problemDrafts);
      setSelectedDraftId(nextAnalysis.problemDrafts[0]?.id ?? null);
      setStatus("reviewing");
      setError(nextAnalysis.debug.failureReason);
    } catch (processingError) {
      setStatus("failed");
      setError(
        processingError instanceof Error
          ? processingError.message
          : "The worksheet could not be analyzed.",
      );
    }
  }

  async function handleGenerate() {
    if (!file) {
      setError("Choose an image before generating a worksheet.");
      return;
    }

    if (includedDrafts.length === 0) {
      setError("Include or draw at least one problem box before generating.");
      return;
    }

    clearCurrentResult();
    setStatus("generating");
    setError(null);

    try {
      const nextResult = await generateWorksheetPdf(file, drafts, { density, promptScale });
      setResult(nextResult);
      setStatus("complete");
    } catch (processingError) {
      setStatus("failed");
      setError(
        processingError instanceof Error
          ? processingError.message
          : "The worksheet could not be generated.",
      );
    }
  }

  async function loadSampleWorksheet(sample: SampleWorksheet) {
    try {
      const response = await fetch(sample.path);
      if (!response.ok) {
        throw new Error("The sample image could not be loaded.");
      }

      const blob = await response.blob();
      const sampleFile = new File([blob], sample.filename, {
        type: blob.type || "image/png",
      });
      applySelectedFile(sampleFile, URL.createObjectURL(blob));
      setShowSampleModal(false);
    } catch (sampleError) {
      setStatus("failed");
      setError(
        sampleError instanceof Error
          ? sampleError.message
          : "The sample image could not be loaded.",
      );
    }
  }

  function resetFlow() {
    clearCurrentResult();
    replacePreview(null);
    setAnalysis(null);
    setDrafts([]);
    setSelectedDraftId(null);
    setFile(null);
    setError(null);
    setEditMode("select");
    setStatus("idle");
  }

  function toggleIncluded(draftId: string) {
    clearCurrentResult();
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId ? { ...draft, included: !draft.included } : draft,
      ),
    );
  }

  function updateDraftLabel(draftId: string, nextLabel: string) {
    clearCurrentResult();
    setDrafts((current) =>
      current.map((draft) =>
        draft.id === draftId
          ? { ...draft, sourceLabel: nextLabel.trim() || null }
          : draft,
      ),
    );
  }

  function updateDraft(draftId: string, nextDraft: ProblemDraft) {
    clearCurrentResult();
    setDrafts((current) =>
      reindexDrafts(current.map((draft) => (draft.id === draftId ? nextDraft : draft))),
    );
  }

  function clearAllBoxes() {
    clearCurrentResult();
    setDrafts([]);
    setSelectedDraftId(null);
    setEditMode("select");
    setDrawPreview(null);
  }

  function toggleDrawMode() {
    if (!analysis) {
      return;
    }

    setEditMode((current) => (current === "draw" ? "select" : "draw"));
  }

  function startDraftInteraction(
    event: React.PointerEvent,
    draft: ProblemDraft,
    type: "move" | "resize",
  ) {
    if (!analysis) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    canvasRef.current?.setPointerCapture(event.pointerId);
    setSelectedDraftId(draft.id);
    setEditMode("select");
    setInteraction({
      type,
      draftId: draft.id,
      start: imagePointFromEvent(event, analysis.sourceImage.width, analysis.sourceImage.height),
      original: draft,
    });
  }

  function startDraw(event: React.PointerEvent) {
    if (!analysis || editMode !== "draw") {
      return;
    }

    event.preventDefault();
    const start = imagePointFromEvent(event, analysis.sourceImage.width, analysis.sourceImage.height);
    canvasRef.current?.setPointerCapture(event.pointerId);
    setInteraction({ type: "draw", start });
    setDrawPreview({ left: start.x, top: start.y, width: 1, height: 1 });
  }

  function handlePointerMove(event: React.PointerEvent) {
    if (!analysis || !interaction) {
      return;
    }

    const point = imagePointFromEvent(event, analysis.sourceImage.width, analysis.sourceImage.height);

    if (interaction.type === "draw") {
      setDrawPreview(normalizeRect(interaction.start, point, analysis));
      return;
    }

    const deltaX = point.x - interaction.start.x;
    const deltaY = point.y - interaction.start.y;
    const original = interaction.original;

    if (interaction.type === "move") {
      updateDraft(interaction.draftId, shiftDraft(original, deltaX, deltaY, analysis));
      return;
    }

    const nextBounds = padBounds(
      {
        left: original.unionBounds.left,
        top: original.unionBounds.top,
        width: Math.max(24, original.unionBounds.width + deltaX),
        height: Math.max(24, original.unionBounds.height + deltaY),
      },
      analysis,
    );
    updateDraft(interaction.draftId, makeEditedDraft(original, nextBounds, original.orderIndex));
  }

  function handlePointerUp(event: React.PointerEvent) {
    if (!analysis || !interaction) {
      return;
    }

    canvasRef.current?.releasePointerCapture(event.pointerId);

    if (interaction.type === "draw" && drawPreview && drawPreview.width > 18 && drawPreview.height > 18) {
      clearCurrentResult();
      const manualDraft = makeManualDraft(drawPreview, drafts.length);
      setDrafts((current) => reindexDrafts([...current, manualDraft]));
      setSelectedDraftId(manualDraft.id);
      setEditMode("select");
    }

    setInteraction(null);
    setDrawPreview(null);
  }

  const imageWidth = analysis?.sourceImage.width ?? result?.sourceImage.width ?? 1;
  const imageHeight = analysis?.sourceImage.height ?? result?.sourceImage.height ?? 1;

  return (
    <main className="app-shell">
      <section className="panel app-workspace">
        <header className="app-header">
          <div>
            <span className="eyebrow">WriteSpacer</span>
            <h1>Dense page in. Spacious handout out.</h1>
            <p>
              For turning photographed or scanned problem sets into printable
              student workspace.
            </p>
          </div>

          <div className="workflow-steps" aria-label="Workflow status">
            <div className={`workflow-step ${file ? "complete" : "active"}`}>
              <span>1</span>
              <strong>Source</strong>
              <small>{file ? "Loaded" : "Needed"}</small>
            </div>
            <div
              className={`workflow-step ${
                analysis ? "complete" : file ? "active" : ""
              }`}
            >
              <span>2</span>
              <strong>Review</strong>
              <small>{analysis ? `${includedDrafts.length} boxes` : "Waiting"}</small>
            </div>
            <div className={`workflow-step ${result ? "complete" : analysis ? "active" : ""}`}>
              <span>3</span>
              <strong>Handout</strong>
              <small>{result ? "Ready" : `${layoutPreview.pageCount} pages`}</small>
            </div>
          </div>
        </header>

        <div className="source-bar">
          <span
            className={`status-pill ${
              status === "complete" || status === "reviewing"
                ? "complete"
                : status === "failed"
                  ? "failed"
                  : ""
            }`}
          >
            {statusCopy[status]}
          </span>

          <div className="workflow-control-stack">
            <div className="workflow-control-grid">
              <section className="control-card">
                <input
                  id="worksheet-upload"
                  accept={ACCEPT}
                  className="sr-only"
                  type="file"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0] ?? null;
                    applySelectedFile(nextFile, nextFile ? URL.createObjectURL(nextFile) : null);
                  }}
                />
                <div className="control-card-copy">
                  <h2>Source</h2>
                  {file ? (
                    <span className="file-pill">
                      {file.name} | {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  ) : (
                    <span className="helper-text">
                      Add a dense worksheet photo, screenshot, or sample.
                    </span>
                  )}
                </div>

                <div className="controls">
                  <label
                    className={file ? "button-secondary" : "button"}
                    htmlFor="worksheet-upload"
                  >
                    Choose file
                  </label>
                  <button
                    className="button-secondary"
                    disabled={status === "analyzing" || status === "generating"}
                    onClick={() => setShowSampleModal(true)}
                    type="button"
                  >
                    Use sample
                  </button>
                  <button
                    className="button-secondary"
                    disabled={status === "analyzing" || status === "generating"}
                    onClick={resetFlow}
                    type="button"
                  >
                    Reset
                  </button>
                </div>
              </section>

              <section className="control-card">
                <div className="control-card-copy">
                  <h2>Review</h2>
                  <span className="helper-text">
                    {analysis
                      ? `${includedDrafts.length} boxes included`
                      : file
                        ? "Ready to detect problem boxes."
                        : "Add a source page first."}
                  </span>
                </div>

                <div className="controls">
                  <button
                    className={file ? "button" : "button-secondary"}
                    disabled={!file || status === "analyzing" || status === "generating"}
                    onClick={handleAnalyze}
                    type="button"
                  >
                    {status === "analyzing" ? "Auto analyzing..." : "Auto Analyze"}
                  </button>
                  <button
                    className={editMode === "draw" ? "button-secondary active" : "button-secondary"}
                    disabled={!analysis || status === "analyzing" || status === "generating"}
                    onClick={toggleDrawMode}
                    type="button"
                  >
                    Manual Box
                  </button>
                  <button
                    className="button-secondary"
                    disabled={drafts.length === 0 || status === "analyzing" || status === "generating"}
                    onClick={clearAllBoxes}
                    type="button"
                  >
                    Clear all boxes
                  </button>
                </div>
              </section>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        </div>

        <div className="upload-layout">
          <div className="workspace-column">
            <section className="debug-panel review-canvas-panel">
              {previewUrl ? (
                <>
                <div className="debug-header">
                  <div>
                    <h3>Review input</h3>
                    <span className="meta-text">
                      {analysis ? `${includedDrafts.length} boxes included` : "Source loaded"}
                    </span>
                  </div>
                </div>
                  {analysis ? (
                    <div
                      ref={canvasRef}
                      className={`debug-canvas ${editMode === "draw" ? "drawing" : ""}`}
                      onPointerDown={startDraw}
                      onPointerMove={handlePointerMove}
                      onPointerUp={handlePointerUp}
                      style={
                        {
                          "--image-width": imageWidth,
                          "--image-height": imageHeight,
                        } as React.CSSProperties
                      }
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="Uploaded worksheet preview" src={previewUrl} />
                      {drafts.map((draft, index) => (
                        <OverlayRect
                          key={draft.id}
                          imageHeight={imageHeight}
                          imageWidth={imageWidth}
                          isSelected={draft.id === selectedDraftId}
                          label={displayLabels[index]}
                          onPointerDown={(event) => startDraftInteraction(event, draft, "move")}
                          onResizePointerDown={(event) => startDraftInteraction(event, draft, "resize")}
                          rect={draft.unionBounds}
                          tone={draft.included ? "region" : "muted"}
                        />
                      ))}
                      {drawPreview ? (
                        <OverlayRect
                          imageHeight={imageHeight}
                          imageWidth={imageWidth}
                          label=""
                          rect={drawPreview}
                          tone="draw"
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="source-preview">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt="Uploaded worksheet preview" src={previewUrl} />
                    </div>
                  )}
                </>
              ) : (
                <div className="empty-workspace">
                  <h3>Review input</h3>
                  <p>Load a problem page to inspect the source here.</p>
                </div>
              )}
            </section>

            {drafts.length > 0 ? (
              <div className="review-panel">
                <div className="debug-header">
                  <h3>Problem boxes</h3>
                  <span className="meta-text">{includedDrafts.length} included</span>
                </div>
                <div className="review-list">
                  {drafts.map((draft, index) => {
                    const baseLabel = draft.sourceLabel ?? String(draft.orderIndex + 1);
                    return (
                    <div
                      key={draft.id}
                      className={`review-row ${draft.id === selectedDraftId ? "selected" : ""}`}
                      onClick={() => setSelectedDraftId(draft.id)}
                    >
                      <input
                        checked={draft.included}
                        onChange={() => toggleIncluded(draft.id)}
                        onClick={(event) => event.stopPropagation()}
                        type="checkbox"
                      />
                      <input
                        aria-label={`Problem label ${baseLabel}`}
                        className="label-input"
                        onChange={(event) => updateDraftLabel(draft.id, event.target.value)}
                        onClick={(event) => event.stopPropagation()}
                        value={baseLabel}
                      />
                      <span className="label-preview">{displayLabels[index]}</span>
                    </div>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <aside className="status-card">
            <div className="output-title">
              <h3>Handout</h3>
              <span className="meta-text">
                {result ? "PDF ready" : `${layoutPreview.pageCount} page preview`}
              </span>
            </div>
            <div className="handout-actions">
              {result ? (
                <a className="button-danger" download="worksheet.pdf" href={result.pdfUrl}>
                  Generate PDF
                </a>
              ) : (
                <button
                  className="button-danger"
                  disabled={!canGenerate || status === "generating"}
                  onClick={handleGenerate}
                  type="button"
                >
                  {status === "generating" ? "Generating..." : "Generate PDF"}
                </button>
              )}
            </div>
            <div className="density-control" role="group" aria-label="Worksheet density">
              {(["compact", "balanced", "spacious"] as const).map((option) => (
                <button
                  key={option}
                  className={density === option ? "active" : ""}
                  onClick={() => {
                    clearCurrentResult();
                    setDensity(option);
                  }}
                  type="button"
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="density-control" role="group" aria-label="Prompt size">
              {(["small", "medium", "large"] as const).map((option) => (
                <button
                  key={option}
                  className={promptScale === option ? "active" : ""}
                  onClick={() => {
                    clearCurrentResult();
                    setPromptScale(option);
                  }}
                  type="button"
                >
                  {option === "medium" ? "Med" : option}
                </button>
              ))}
            </div>
            <div className="status-grid compact">
              <div className="item-card">
                <h4>Detected prompts</h4>
                <p>{drafts.length > 0 ? includedDrafts.length : "0"}</p>
              </div>
              <div className="item-card">
                <h4>PDF pages</h4>
                <p>{result ? result.pageCount : layoutPreview.pageCount}</p>
              </div>
              <div className="item-card">
                <h4>Spacing</h4>
                <p>{density}</p>
              </div>
            </div>
            {previewUrl && analysis ? (
              <PdfLayoutPreview
                displayLabels={displayLabels}
                drafts={drafts}
                imageHeight={analysis.sourceImage.height}
                imageWidth={analysis.sourceImage.width}
                preview={layoutPreview}
                sourceUrl={previewUrl}
              />
            ) : null}
          </aside>
        </div>
      </section>

      {showSampleModal ? (
        <div
          aria-labelledby="sample-modal-title"
          aria-modal="true"
          className="modal-backdrop"
          role="dialog"
        >
          <div className="sample-modal">
            <div className="modal-header">
              <div>
                <h2 id="sample-modal-title">Choose a sample</h2>
                <p className="meta-text">Load one of the sample worksheets to try the flow.</p>
              </div>
              <button
                aria-label="Close sample chooser"
                className="button-secondary"
                onClick={() => setShowSampleModal(false)}
                type="button"
              >
                Close
              </button>
            </div>

            <div className="sample-grid">
              {SAMPLE_WORKSHEETS.map((sample) => (
                <button
                  key={sample.filename}
                  className="sample-option"
                  onClick={() => loadSampleWorksheet(sample)}
                  type="button"
                >
                  <span className="sample-thumbnail">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img alt="" aria-hidden="true" src={sample.path} />
                  </span>
                  <span className="sample-copy">
                    <strong>{sample.title}</strong>
                    <span>{sample.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}

function PdfLayoutPreview({
  displayLabels,
  drafts,
  imageHeight,
  imageWidth,
  preview,
  sourceUrl,
}: {
  displayLabels: string[];
  drafts: ProblemDraft[];
  imageHeight: number;
  imageWidth: number;
  preview: WorksheetLayoutPreview;
  sourceUrl: string;
}) {
  const draftMap = new Map(
    drafts.map((draft, index) => [draft.id, { draft, label: displayLabels[index] }] as const),
  );

  return (
    <div className="pdf-preview-panel">
      <div className="preview-header">
        <h4>Preview</h4>
        <span>{preview.pageCount} page{preview.pageCount === 1 ? "" : "s"}</span>
      </div>
      <div className="pdf-preview-scroll">
        {preview.pages.map((page) => (
          <div
            key={page.pageIndex}
            className="preview-page"
            style={{ aspectRatio: `${page.width} / ${page.height}` }}
          >
            {page.placements.map((placement) => {
              if (placement.type === "section-header") {
                return (
                  <div
                    key={placement.id}
                    className="preview-placement preview-section-header"
                    style={rectStyle(placement.rect, page.width, page.height)}
                  >
                    <SourceCrop
                      imageHeight={imageHeight}
                      imageWidth={imageWidth}
                      sourceRect={placement.sourceRect}
                      sourceUrl={sourceUrl}
                    />
                  </div>
                );
              }

              const draftInfo = draftMap.get(placement.regionId);
              if (!draftInfo) {
                return null;
              }

              return (
                <div key={placement.id} className="preview-problem-layer">
                  <div
                    aria-label={`Problem ${draftInfo.label} prompt preview`}
                    className="preview-placement preview-prompt-placement"
                    style={rectStyle(placement.prompt, page.width, page.height)}
                  >
                    <PromptPreview
                      draft={draftInfo.draft}
                      imageHeight={imageHeight}
                      imageWidth={imageWidth}
                      sourceUrl={sourceUrl}
                    />
                  </div>
                  <div
                    aria-hidden="true"
                    className="preview-answer-area"
                    style={rectStyle(placement.answerArea, page.width, page.height)}
                  />
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function PromptPreview({
  draft,
  imageHeight,
  imageWidth,
  sourceUrl,
}: {
  draft: ProblemDraft;
  imageHeight: number;
  imageWidth: number;
  sourceUrl: string;
}) {
  const promptRects = getPreviewPromptRects(draft);
  const promptMetric = measurePreviewPrompt(promptRects);
  const promptRows = promptRects.map((rect, index) => ({
    rect,
    index,
    top: promptRects
      .slice(0, index)
      .reduce((sum, previousRect) => sum + previousRect.height + 8, 0),
  }));

  return (
    <div className="prompt-preview-stack">
      {promptRows.map(({ index, rect, top }) => (
        <div
          key={`${rect.left}-${rect.top}-${index}`}
          className="prompt-preview-row"
          style={{
            left: 0,
            top: `${(top / promptMetric.height) * 100}%`,
            width: `${(rect.width / promptMetric.width) * 100}%`,
            height: `${(rect.height / promptMetric.height) * 100}%`,
          }}
        >
          <SourceCrop
            imageHeight={imageHeight}
            imageWidth={imageWidth}
            sourceRect={rect}
            sourceUrl={sourceUrl}
          />
        </div>
      ))}
    </div>
  );
}

function SourceCrop({
  imageHeight,
  imageWidth,
  sourceRect,
  sourceUrl,
}: {
  imageHeight: number;
  imageWidth: number;
  sourceRect: Rect;
  sourceUrl: string;
}) {
  return (
    <div className="source-crop">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        alt=""
        aria-hidden="true"
        src={sourceUrl}
        style={{
          left: `${(-sourceRect.left / sourceRect.width) * 100}%`,
          top: `${(-sourceRect.top / sourceRect.height) * 100}%`,
          width: `${(imageWidth / sourceRect.width) * 100}%`,
          height: `${(imageHeight / sourceRect.height) * 100}%`,
        }}
      />
    </div>
  );
}

function OverlayRect({
  imageHeight,
  imageWidth,
  isSelected = false,
  label,
  onPointerDown,
  onResizePointerDown,
  rect,
  tone,
}: {
  imageHeight: number;
  imageWidth: number;
  isSelected?: boolean;
  label: string;
  onPointerDown?: (event: React.PointerEvent) => void;
  onResizePointerDown?: (event: React.PointerEvent) => void;
  rect: Rect;
  tone: "region" | "anchor" | "content" | "header" | "column" | "rejected" | "muted" | "draw";
}) {
  return (
    <div
      className={`overlay-rect ${tone} ${isSelected ? "selected" : ""}`}
      onPointerDown={onPointerDown}
      style={
        {
          left: `${(rect.left / imageWidth) * 100}%`,
          top: `${(rect.top / imageHeight) * 100}%`,
          width: `${(rect.width / imageWidth) * 100}%`,
          height: `${(rect.height / imageHeight) * 100}%`,
        } as React.CSSProperties
      }
    >
      {label ? <span>{label}</span> : null}
      {isSelected && onResizePointerDown ? (
        <button
          aria-label="Resize selected box"
          className="resize-handle"
          onPointerDown={onResizePointerDown}
          type="button"
        />
      ) : null}
    </div>
  );
}

function getPreviewPromptRects(draft: ProblemDraft) {
  if (draft.compositionMode === "union-fallback") {
    return [draft.unionBounds];
  }

  const firstContent = draft.contentRects[0] ?? null;
  if (!firstContent) {
    return [draft.anchorRect];
  }

  return [unionRects([draft.anchorRect, firstContent]), ...draft.contentRects.slice(1)];
}

function measurePreviewPrompt(rects: Rect[]) {
  const safeRects = rects.length > 0 ? rects : [{ left: 0, top: 0, width: 1, height: 1 }];
  return {
    width: Math.max(...safeRects.map((rect) => rect.width)),
    height:
      safeRects.reduce((sum, rect) => sum + rect.height, 0) +
      Math.max(0, safeRects.length - 1) * 8,
  };
}

function rectStyle(rect: Rect, pageWidth: number, pageHeight: number) {
  return {
    left: `${(rect.left / pageWidth) * 100}%`,
    top: `${(rect.top / pageHeight) * 100}%`,
    width: `${(rect.width / pageWidth) * 100}%`,
    height: `${(rect.height / pageHeight) * 100}%`,
  } as React.CSSProperties;
}

function imagePointFromEvent(
  event: React.PointerEvent,
  imageWidth: number,
  imageHeight: number,
) {
  const element = event.currentTarget instanceof HTMLElement
    ? event.currentTarget
    : (event.target as HTMLElement);
  const canvas = element.closest(".debug-canvas") as HTMLElement | null;
  const bounds = (canvas ?? element).getBoundingClientRect();
  return {
    x: clamp(((event.clientX - bounds.left) / bounds.width) * imageWidth, 0, imageWidth),
    y: clamp(((event.clientY - bounds.top) / bounds.height) * imageHeight, 0, imageHeight),
  };
}

function shiftDraft(
  draft: ProblemDraft,
  deltaX: number,
  deltaY: number,
  analysis: WorksheetAnalysis,
) {
  const shift = (rect: Rect) =>
    padBounds(
      {
        left: rect.left + deltaX,
        top: rect.top + deltaY,
        width: rect.width,
        height: rect.height,
      },
      analysis,
    );

  return {
    ...draft,
    anchorRect: shift(draft.anchorRect),
    contentRects: draft.contentRects.map(shift),
    sectionHeaderRects: draft.sectionHeaderRects.map(shift),
    unionBounds: shift(draft.unionBounds),
    fragments: draft.fragments.map((fragment) => ({
      ...fragment,
      rect: shift(fragment.rect),
    })),
  };
}

function makeEditedDraft(draft: ProblemDraft, bounds: Rect, orderIndex: number): ProblemDraft {
  return {
    ...draft,
    orderIndex,
    anchorRect: {
      left: bounds.left,
      top: bounds.top,
      width: Math.min(48, bounds.width),
      height: Math.min(28, bounds.height),
    },
    contentRects: [bounds],
    sectionHeaderRects: [],
    unionBounds: bounds,
    confidence: Math.min(draft.confidence, 0.62),
    fragments: [
      {
        id: `${draft.id}-edited-content`,
        kind: "content",
        rect: bounds,
        confidence: 0.62,
      },
    ],
    compositionMode: "union-fallback",
  };
}

function makeManualDraft(bounds: Rect, orderIndex: number): ProblemDraft {
  const id = `manual-${Date.now()}`;
  return {
    id,
    orderIndex,
    sourceLabel: null,
    anchorRect: {
      left: bounds.left,
      top: bounds.top,
      width: Math.min(48, bounds.width),
      height: Math.min(28, bounds.height),
    },
    contentRects: [bounds],
    sectionHeaderRects: [],
    unionBounds: bounds,
    confidence: 0.5,
    fragments: [
      {
        id: `${id}-content`,
        kind: "content",
        rect: bounds,
        confidence: 0.5,
      },
    ],
    compositionMode: "union-fallback",
    columnHint: 0,
    included: true,
  };
}

function normalizeRect(
  start: { x: number; y: number },
  end: { x: number; y: number },
  analysis: WorksheetAnalysis,
) {
  return padBounds(
    {
      left: Math.min(start.x, end.x),
      top: Math.min(start.y, end.y),
      width: Math.abs(end.x - start.x),
      height: Math.abs(end.y - start.y),
    },
    analysis,
  );
}

function padBounds(rect: Rect, analysis: WorksheetAnalysis | null) {
  if (!analysis) {
    return rect;
  }

  const maxWidth = analysis.sourceImage.width;
  const maxHeight = analysis.sourceImage.height;
  const left = clamp(rect.left, 0, maxWidth - 1);
  const top = clamp(rect.top, 0, maxHeight - 1);
  const right = clamp(rect.left + rect.width, left + 1, maxWidth);
  const bottom = clamp(rect.top + rect.height, top + 1, maxHeight);

  return {
    left,
    top,
    width: right - left,
    height: bottom - top,
  };
}

function reindexDrafts(drafts: ProblemDraft[]) {
  return drafts.map((draft, index) => ({ ...draft, orderIndex: index }));
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

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
