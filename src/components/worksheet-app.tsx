"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import type { JobRecord, JobStatus } from "@/lib/types";

const ACCEPT = "image/png,image/jpeg,image/webp";

const statusCopy: Record<JobStatus, string> = {
  queued: "Waiting to process",
  processing: "Detecting prompts and building PDF",
  complete: "Worksheet ready",
  failed: "Processing failed",
};

export function WorksheetApp() {
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<JobRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const pollerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (pollerRef.current) {
        window.clearTimeout(pollerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!job || job.status === "complete" || job.status === "failed") {
      return;
    }

    pollerRef.current = window.setTimeout(async () => {
      const response = await fetch(`/api/jobs/${job.id}`, { cache: "no-store" });

      if (!response.ok) {
        setError("The job status could not be refreshed.");
        return;
      }

      const nextJob = (await response.json()) as JobRecord;
      setJob(nextJob);
    }, 1200);

    return () => {
      if (pollerRef.current) {
        window.clearTimeout(pollerRef.current);
      }
    };
  }, [job]);

  async function handleSubmit() {
    if (!file) {
      setError("Choose an image before generating a worksheet.");
      return;
    }

    setError(null);
    setJob(null);

    startTransition(async () => {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/jobs", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(payload?.error ?? "The upload could not be processed.");
        return;
      }

      const createdJob = (await response.json()) as JobRecord;
      setJob(createdJob);
    });
  }

  function resetFlow() {
    setFile(null);
    setJob(null);
    setError(null);
  }

  const confidencePct = job?.confidenceSummary
    ? Math.round(job.confidenceSummary.averageConfidence * 100)
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
              automatically isolates each prompt, keeps diagrams attached, and
              lays everything out on a printable PDF with generous answer space.
            </p>
            <div className="hero-notes">
              <div className="hero-note">
                <strong>Built for classroom handouts</strong>
                <span>
                  Keeps the original math notation as image crops so radicals,
                  fractions, graphs, and geometry figures stay intact.
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
              V1 accepts one image at a time and uses a server-side segmentation
              pass. The output is tuned for US Letter printing and anonymous
              use, with no review step required.
            </p>
          </div>
          {job ? (
            <span
              className={`status-pill ${
                job.status === "complete"
                  ? "complete"
                  : job.status === "failed"
                    ? "failed"
                    : ""
              }`}
            >
              {statusCopy[job.status]}
            </span>
          ) : null}
        </div>

        <div className="steps">
          <div className="step-card">
            <strong>1</strong>
            <h3>Normalize the page</h3>
            <p>
              The server rotates, resizes, and cleans contrast so dense text and
              math clusters are easier to separate.
            </p>
          </div>
          <div className="step-card">
            <strong>2</strong>
            <h3>Detect problem regions</h3>
            <p>
              Heuristics group text lines into prompt blocks and attach nearby
              orphan diagrams to the closest matching problem.
            </p>
          </div>
          <div className="step-card">
            <strong>3</strong>
            <h3>Lay out worksheet pages</h3>
            <p>
              Prompt crops are placed beside or above answer space and exported
              as a print-ready PDF.
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
                  {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB
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
                  disabled={!file || isPending}
                  onClick={handleSubmit}
                  type="button"
                >
                  {isPending ? "Uploading..." : "Generate worksheet PDF"}
                </button>
                <button
                  className="button-secondary"
                  disabled={isPending && !job}
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
              <h3>What the system returns</h3>
              <p className="meta-text">
                Each job exposes a typed status endpoint, a PDF download route,
                and summary metadata about detection confidence and page count.
              </p>
            </div>
            <div className="status-grid">
              <div className="item-card">
                <h4>POST /api/jobs</h4>
                <p>Accepts the upload and returns a queued job record.</p>
              </div>
              <div className="item-card">
                <h4>GET /api/jobs/:jobId</h4>
                <p>Polls job state and triggers server-side processing on demand.</p>
              </div>
              <div className="item-card">
                <h4>GET /api/jobs/:jobId/pdf</h4>
                <p>Returns the finished PDF when generation completes.</p>
              </div>
            </div>
          </aside>
        </div>

        {job ? (
          <>
            <div className="results-grid">
              <div className="stat-card">
                <h3>Status</h3>
                <strong>{statusCopy[job.status]}</strong>
              </div>
              <div className="stat-card">
                <h3>Detected prompts</h3>
                <strong>{job.itemCount}</strong>
              </div>
              <div className="stat-card">
                <h3>PDF pages</h3>
                <strong>{job.pageCount}</strong>
              </div>
            </div>

            <div className="summary-grid">
              <div className="item-card">
                <h4>Detection confidence</h4>
                <p>
                  {confidencePct !== null
                    ? `${confidencePct}% average confidence with ${job.confidenceSummary.lowConfidenceCount} low-confidence regions.`
                    : "Confidence is calculated when processing finishes."}
                </p>
              </div>
              <div className="item-card">
                <h4>Source image</h4>
                <p>
                  {job.sourceImage
                    ? `${job.sourceImage.width} × ${job.sourceImage.height} ${job.sourceImage.mimeType}`
                    : "Waiting for image metadata."}
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
                  {job.status === "complete" ? (
                    <a className="button" href={`/api/jobs/${job.id}/pdf`}>
                      Download PDF
                    </a>
                  ) : job.status === "failed" ? (
                    job.error ?? "Processing failed."
                  ) : (
                    "The PDF link will appear automatically when generation finishes."
                  )}
                </p>
              </div>
            </div>
          </>
        ) : null}
      </section>

      <p className="footer-note">
        This first version is tuned for one-page math handouts. The data model
        and job API are structured so manual review, OCR, and multi-page input
        can be added later without breaking the core flow.
      </p>
    </main>
  );
}
