import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { JobRecord } from "@/lib/types";

const DATA_ROOT =
  process.env.WORKSHEET_DATA_DIR || path.join(process.cwd(), ".worksheet-data");

type GlobalState = {
  jobs: Map<string, JobRecord>;
  activeJobs: Map<string, Promise<JobRecord>>;
};

declare global {
  var __worksheetState__: GlobalState | undefined;
}

const state =
  globalThis.__worksheetState__ ??
  (globalThis.__worksheetState__ = {
    jobs: new Map<string, JobRecord>(),
    activeJobs: new Map<string, Promise<JobRecord>>(),
  });

function metadataPath(jobId: string) {
  return path.join(DATA_ROOT, jobId, "job.json");
}

export function jobPath(jobId: string, ...parts: string[]) {
  return path.join(DATA_ROOT, jobId, ...parts);
}

export async function ensureJobDir(jobId: string) {
  await mkdir(jobPath(jobId), { recursive: true });
}

export async function createJobRecord(input: {
  id?: string;
  originalFilename: string;
  uploadPath: string;
}): Promise<JobRecord> {
  const id = input.id ?? crypto.randomUUID();
  const timestamp = new Date().toISOString();

  const job: JobRecord = {
    id,
    status: "queued",
    createdAt: timestamp,
    updatedAt: timestamp,
    originalFilename: input.originalFilename,
    uploadPath: input.uploadPath,
    problemRegions: [],
    worksheetItems: [],
    confidenceSummary: {
      averageConfidence: 0,
      lowConfidenceCount: 0,
    },
    pageCount: 0,
    itemCount: 0,
  };

  await persistJob(job);

  return job;
}

export async function persistJob(job: JobRecord) {
  job.updatedAt = new Date().toISOString();
  state.jobs.set(job.id, job);
  await ensureJobDir(job.id);
  await writeFile(metadataPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

export async function getJobRecord(jobId: string): Promise<JobRecord | null> {
  const cached = state.jobs.get(jobId);
  if (cached) {
    return cached;
  }

  try {
    const content = await readFile(metadataPath(jobId), "utf8");
    const job = JSON.parse(content) as JobRecord;
    state.jobs.set(jobId, job);
    return job;
  } catch {
    return null;
  }
}

export function getActiveJob(jobId: string) {
  return state.activeJobs.get(jobId);
}

export function setActiveJob(jobId: string, promise: Promise<JobRecord>) {
  state.activeJobs.set(jobId, promise);
}

export function clearActiveJob(jobId: string) {
  state.activeJobs.delete(jobId);
}
