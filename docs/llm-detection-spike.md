# LLM Detection Spike

## What a Multimodal LLM Could Improve

- Interpret worksheet structure directly: exercise numbers, section headers, graph callouts, and multi-column reading order.
- Return semantic groupings such as "problem 23 includes the graph and formula label below it" without relying only on pixel adjacency.
- Distinguish problem numbers from graph axis labels, example references, answer callouts, and decorative textbook elements.
- Estimate per-problem workspace needs from prompt type: short algebra, graph interpretation, error analysis, geometry, or multi-step word problem.

## Possible JSON Shape

```json
{
  "page": { "width": 1698, "height": 1398 },
  "problems": [
    {
      "sourceLabel": "23",
      "bounds": { "left": 907, "top": 44, "width": 350, "height": 420 },
      "promptBounds": [{ "left": 907, "top": 44, "width": 41, "height": 25 }],
      "attachedBounds": [{ "left": 965, "top": 49, "width": 291, "height": 365 }],
      "workspaceNeed": "medium",
      "confidence": 0.92
    }
  ],
  "warnings": ["Problem 37 includes a large worked-error panel."]
}
```

## Risks

- Privacy: teacher-uploaded worksheets may include copyrighted textbook content, student names, or district-specific materials.
- Cost and latency: multimodal calls would make GitHub Pages-only hosting impractical and could be expensive for batch use.
- Reliability: model output can drift, hallucinate labels, or return boxes that look plausible but miss print-critical details.
- Product fit: teachers need fast correction tools regardless of detector type, so manual review remains valuable.

## How It Could Inform a Vercel Path

- Keep the current CV detector as the local default.
- Add an optional server-backed "assist detection" path only after the review UI and page-budget controls are stable.
- Use a multimodal model to propose regions, then run local geometric validation against the image before showing boxes.
- Preserve the same `ProblemDraft` shape so CV, OCR, and LLM proposals can be compared or merged without changing PDF layout.

## Offline Annotation Workflow

The current implementation uses Anthropic only as a dev-time labeling assistant. It does not add a production LLM path.

1. Pick only worksheet images that are safe to send to a third-party API.
2. Run a Claude draft annotation from the repository root:

   ```powershell
   npm.cmd run annotate:detector:claude -- --dir public/fixtures --dir "more sample photos" --dry-run
   npm.cmd run annotate:detector:claude -- --dir public/fixtures --dir "more sample photos"
   ```

3. Keep `ANTHROPIC_API_KEY=...` in `.env` or set it in the shell. Do not commit `.env`.
4. Only run the non-dry-run command for images that are safe to upload to Anthropic.
5. Review the draft JSON written under `.worksheet-data/llm-annotations`.
6. Copy only human-checked anchor labels, section headers, and notes into `public/fixtures/llm-assisted-annotations.json`.
7. Run:

   ```powershell
   npm.cmd run compare:detector:annotations
   npm.cmd run test:detector
   ```

Claude drafts are treated as suggestions. The committed JSON fixture is the oracle, and the production detector remains deterministic and browser-local.

## Regression Conversion Rule

When several reviewed annotations expose the same detector miss, convert the pattern into deterministic code and tests rather than increasing LLM usage. Prefer changes in this order:

- tune anchor proposal geometry and scoring;
- improve numeric sequence repair or repeated-label handling;
- refine section-header exclusion;
- broaden fallback block construction only when OCR-free behavior is still reviewable.
