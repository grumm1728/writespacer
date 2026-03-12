import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { createJobRecord, jobPath, persistJob } from "@/lib/jobs";
import { assertUpload } from "@/lib/worksheet-processing";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Attach an image file." }, { status: 400 });
    }

    assertUpload(file);

    const extension =
      file.type === "image/png"
        ? ".png"
        : file.type === "image/webp"
          ? ".webp"
          : ".jpg";

    const id = crypto.randomUUID();
    const safeStem = path
      .basename(file.name, path.extname(file.name))
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const filename = `${safeStem || "worksheet"}${extension}`;
    const uploadPath = jobPath(id, "upload", filename);

    const job = await createJobRecord({
      id,
      originalFilename: file.name,
      uploadPath,
    });

    await mkdir(jobPath(id, "upload"), { recursive: true });
    await writeFile(uploadPath, Buffer.from(await file.arrayBuffer()));
    await persistJob(job);

    return NextResponse.json(job, { status: 202 });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "The upload could not be stored.",
      },
      { status: 400 },
    );
  }
}
