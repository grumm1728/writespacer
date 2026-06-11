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
