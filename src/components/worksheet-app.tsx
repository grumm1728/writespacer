"use client";

import { useEffect, useState } from "react";

import { processWorksheetFile, revokeWorksheetResult } from "@/lib/client-processing";
import type { WorksheetResult, WorksheetStatus } from "@/lib/types";

const ACCEPT = "image/png,image/jpeg,image/webp";

const statusCopy: Record<WorksheetStatus, string> = {
  idle: "Ready",
  processing: "Detecting prompts and building PDF",
  complete: "Worksheet ready",
  failed: "Processing failed",
};

export function WorksheetApp() {
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<WorksheetResult | null>(null);
  const [status, setStatus] = useState<WorksheetStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (result) {
        revokeWorksheetResult(result);
      }
    };
  }, [result]);

  async function handleSubmit() {
    if (!file) {
      setError("Choose an image before generating a worksheet.");
      return;
    }

    if (result) {
      revokeWorksheetResult(result);
      setResult(null);
    }

    setStatus("processing");
    setError(null);

    try {
      const nextResult = await processWorksheetFile(file);
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

  function resetFlow() {
    if (result) {
      revokeWorksheetResult(result);
    }

    setFile(null);
    setResult(null);
    setError(null);
    setStatus("idle");
  }

  const confidencePct = result
    ? Math.round(result.confidenceSummary.averageConfidence * 100)
    : null;

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <span className="eyebrow">Printable worksheet generator</span>
            <h1 className="hero-title">Give students room to show the work.</h1>
            <p className="hero-copy">
              Upload a screenshot or photo of a dense math page. WriteSpacer
              isolates each prompt, keeps diagrams attached, and lays everything
              out on a printable PDF with generous answer space, directly in the
              browser.
            </p>
            <div className="hero-notes">
              <div className="hero-note">
                <strong>GitHub Pages friendly</strong>
                <span>
                  All image analysis and PDF generation run client-side, so the
                  app can deploy as a static site with no backend server.
                </span>
              </div>
              <div className="hero-note">
                <strong>Adaptive layout</strong>
                <span>
                  Short prompts get workspace beside them. Larger prompts shift
                  to a below-the-problem layout automatically.
                </span>
              </div>
            </div>
          </div>

          <div className="paper-stack" aria-hidden="true">
            <div className="paper-shadow" />
            <div className="paper-sheet">
              <div className="paper-header">
                <span>Math Practice</span>
                <span>Name</span>
              </div>
              <div className="paper-problem">
                <div className="prompt" />
                <div className="workspace" />
              </div>
              <div className="paper-problem">
                <div className="prompt" />
                <div className="workspace" />
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="section-header">
          <div>
            <h2>Upload a single page and export a PDF</h2>
            <p>
              V1 now runs entirely in the browser so it can deploy to GitHub
              Pages. Your upload never leaves the tab. The output is tuned for
              US Letter printing and one-page source images.
            </p>
          </div>
          <span
            className={`status-pill ${
              status === "complete" ? "complete" : status === "failed" ? "failed" : ""
            }`}
          >
            {statusCopy[status]}
          </span>
        </div>

        <div className="steps">
          <div className="step-card">
            <strong>1</strong>
            <h3>Normalize the page</h3>
            <p>
              The browser scales the page, samples grayscale values, and trims
              the active content area before segmentation.
            </p>
          </div>
          <div className="step-card">
            <strong>2</strong>
            <h3>Detect problem regions</h3>
            <p>
              Heuristics group dense line bands into prompt blocks and attach
              likely diagrams to the closest matching problem.
            </p>
          </div>
          <div className="step-card">
            <strong>3</strong>
            <h3>Lay out worksheet pages</h3>
            <p>
              Prompt crops are placed beside or above answer space and exported
              as a PDF that downloads directly to the device.
            </p>
          </div>
        </div>

        <div className="upload-layout">
          <div className="upload-dropzone">
            <input
              accept={ACCEPT}
              type="file"
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                setError(null);
              }}
            />
            <div className="dropzone-copy">
              <span className="eyebrow">Input</span>
              <h3>Drop a worksheet photo or screenshot here</h3>
              <p>
                Supported formats: PNG, JPEG, or WebP. Clear, high-contrast
                source pages work best. Multi-page packets are out of scope for
                this first version.
              </p>
              {file ? (
                <span className="file-pill">
                  {file.name} | {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              ) : (
                <span className="helper-text">
                  Tip: a cropped screenshot usually yields cleaner prompt
                  grouping than a wide classroom photo.
                </span>
              )}
              <div className="controls">
                <button
                  className="button"
                  disabled={!file || status === "processing"}
                  onClick={handleSubmit}
                  type="button"
                >
                  {status === "processing" ? "Generating..." : "Generate worksheet PDF"}
                </button>
                <button
                  className="button-secondary"
                  disabled={status === "processing" && !result}
                  onClick={resetFlow}
                  type="button"
                >
                  Reset
                </button>
              </div>
              {error ? <p style={{ color: "var(--error)" }}>{error}</p> : null}
            </div>
          </div>

          <aside className="status-card">
            <div>
              <h3>Static deployment shape</h3>
              <p className="meta-text">
                The GitHub Pages build exports plain HTML, CSS, and JavaScript.
                No API routes or upload server are required.
              </p>
            </div>
            <div className="status-grid">
              <div className="item-card">
                <h4>Client-side processing</h4>
                <p>The browser analyzes the image and builds the worksheet locally.</p>
              </div>
              <div className="item-card">
                <h4>Download-only output</h4>
                <p>The finished PDF is held as an in-memory blob and downloaded directly.</p>
              </div>
              <div className="item-card">
                <h4>Repo-site safe</h4>
                <p>The app is configured to run under the `/writespacer` GitHub Pages path.</p>
              </div>
            </div>
          </aside>
        </div>

        {result ? (
          <>
            <div className="results-grid">
              <div className="stat-card">
                <h3>Status</h3>
                <strong>{statusCopy[status]}</strong>
              </div>
              <div className="stat-card">
                <h3>Detected prompts</h3>
                <strong>{result.itemCount}</strong>
              </div>
              <div className="stat-card">
                <h3>PDF pages</h3>
                <strong>{result.pageCount}</strong>
              </div>
            </div>

            <div className="summary-grid">
              <div className="item-card">
                <h4>Detection confidence</h4>
                <p>
                  {confidencePct !== null
                    ? `${confidencePct}% average confidence with ${result.confidenceSummary.lowConfidenceCount} low-confidence regions.`
                    : "Confidence is calculated when processing finishes."}
                </p>
              </div>
              <div className="item-card">
                <h4>Source image</h4>
                <p>
                  {result.sourceImage.width} x {result.sourceImage.height}{" "}
                  {result.sourceImage.mimeType}
                </p>
              </div>
              <div className="item-card">
                <h4>Layout behavior</h4>
                <p>
                  The PDF uses US Letter portrait pages, print-safe margins,
                  and adaptive answer areas beside or below each prompt crop.
                </p>
              </div>
              <div className="item-card">
                <h4>Download</h4>
                <p>
                  <a className="button" download="worksheet.pdf" href={result.pdfUrl}>
                    Download PDF
                  </a>
                </p>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <p className="footer-note">
        This version is optimized for GitHub Pages deployment and one-page math
        handouts. Manual review, OCR, and multi-page support can still be added
        later if we move back to a richer runtime.
      </p>
    </main>
  );
}
