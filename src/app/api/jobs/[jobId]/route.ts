import { NextResponse } from "next/server";

import { getJobRecord } from "@/lib/jobs";
import { ensureJobProcessed } from "@/lib/worksheet-processing";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await context.params;
  const job = await getJobRecord(jobId);

  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const resolved = await ensureJobProcessed(jobId);
  return NextResponse.json(resolved);
}
