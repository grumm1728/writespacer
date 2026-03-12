import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { ensureJobProcessed } from "@/lib/worksheet-processing";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const { jobId } = await context.params;
    const job = await ensureJobProcessed(jobId);

    if (job.status !== "complete" || !job.pdfPath) {
      return NextResponse.json({ error: "PDF not ready." }, { status: 409 });
    }

    const pdf = await readFile(job.pdfPath);

    return new NextResponse(pdf, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="worksheet-${jobId}.pdf"`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "The PDF could not be loaded.",
      },
      { status: 400 },
    );
  }
}
