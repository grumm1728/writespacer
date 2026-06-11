# Repository Instructions

## Project Purpose

WriteSpacer is a static Next.js app that turns a dense image of math problems into a printable worksheet PDF with room for students to show work. The core teacher workflow is: add a photographed or scanned problem page, review detected problem boxes, adjust spacing, preview the handout, and download the PDF.

## Tech Stack

- Next.js App Router with TypeScript.
- React for the browser UI.
- Browser canvas APIs for image normalization, segmentation, and crop extraction.
- `pdf-lib` for in-browser PDF generation.
- Vitest for detector and layout tests.
- ESLint with `eslint-config-next`.

## Key Commands

Run commands from this directory:

```powershell
C:\Users\scott\Cloned from GitHub\writespacer
```

Use PowerShell-friendly command names:

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run lint
npm.cmd run test:detector
npm.cmd run build
```

The local dev server is usually available at `http://localhost:3000` or `http://127.0.0.1:3000`. If that port is in use, start Next on another port with:

```powershell
npm.cmd run dev -- --hostname 127.0.0.1 --port 3001
```

## Product Constraints

- Keep the app focused on helping teachers create useful student handouts quickly.
- Prioritize screen real estate for reviewing the input image and previewing the output PDF.
- Do not expose internal confidence scores or detector implementation details as primary user-facing information.
- Preserve prompts as image crops rather than trying to re-typeset math.
- Keep controls understandable for a non-technical teacher: source, review, spacing, preview, download.
- Maintain responsive layouts for desktop and mobile; avoid horizontal overflow.

## Privacy Notes

- All worksheet processing should remain in the browser.
- Do not add server upload paths, analytics on worksheet content, or remote processing without an explicit product decision.
- Treat uploaded worksheet images as potentially private classroom material.

## Verification

For UI or workflow changes, run:

```powershell
npm.cmd run lint
npm.cmd run build
```

For detection, layout, or PDF-placement changes, also run:

```powershell
npm.cmd run test:detector
```

When changing the frontend, verify the flow manually in the browser with the built-in sample page: load the sample, analyze it, inspect the review boxes, adjust output settings, and confirm the PDF preview updates without layout overflow.
