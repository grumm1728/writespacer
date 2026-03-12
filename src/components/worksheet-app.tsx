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
  const detectedProblems = result?.problemRegions
    .map((region) => region.problemNumber ?? region.orderIndex + 1)
    .slice(0, 12)
    .join(", ");

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="hero-grid">
          <div>
            <h1 className="hero-title">Give students room to show the work.</h1>
            <p className="hero-copy">
              Upload a screenshot or photo of a dense math page. WriteSpacer
              isolates each prompt, keeps diagrams attached, and lays everything
              out on a printable PDF with generous answer space, directly in the
              browser.
            </p>
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
          <h2>Input</h2>
          <span
            className={`status-pill ${
              status === "complete" ? "complete" : status === "failed" ? "failed" : ""
            }`}
          >
            {statusCopy[status]}
          </span>
        </div>

        <div className="upload-layout">
          <div className="upload-dropzone">
            <input
              id="worksheet-upload"
              accept={ACCEPT}
              className="sr-only"
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
              {file ? (
                <span className="file-pill">
                  {file.name} | {(file.size / 1024 / 1024).toFixed(2)} MB
                </span>
              ) : (
                <span className="helper-text">PNG, JPEG, or WebP</span>
              )}
              <div className="controls">
                <label className="button-secondary" htmlFor="worksheet-upload">
                  Choose file
                </label>
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
            <h3>Output</h3>
            <div className="status-grid compact">
              <div className="item-card">
                <h4>Detected prompts</h4>
                <p>{result ? result.itemCount : "0"}</p>
              </div>
              <div className="item-card">
                <h4>PDF pages</h4>
                <p>{result ? result.pageCount : "0"}</p>
              </div>
              <div className="item-card">
                <h4>Confidence</h4>
                <p>{confidencePct !== null ? `${confidencePct}%` : "Not ready"}</p>
              </div>
            </div>
            <div className="status-grid">
              <div className="item-card">
                <h4>Low-confidence regions</h4>
                <p>
                  {result
                    ? result.confidenceSummary.lowConfidenceCount
                    : "0"}
                </p>
              </div>
              <div className="item-card">
                <h4>Problem order</h4>
                <p>{detectedProblems || "Not ready"}</p>
              </div>
            </div>
            {result ? (
              <a className="button" download="worksheet.pdf" href={result.pdfUrl}>
                Download PDF
              </a>
            ) : (
              <p className="meta-text">Generate a worksheet to enable download.</p>
            )}
          </aside>
        </div>
      </section>
    </main>
  );
}
