---
status: accepted
---

# Keep production worksheet processing browser-local

The reliability cleanup will keep production detection, review, preview, and PDF generation entirely in the browser. An optional server-backed or production LLM detector is deferred until the browser-local workflow is measured against the representative fixture scorecard and local correction tools prove insufficient to meet the teacher-success target; this preserves static GitHub Pages deployment, avoids transmitting potentially private or copyrighted classroom material, and keeps latency, cost, availability, and provider drift out of the core workflow. The opt-in Claude fixture-annotation workflow remains development-only, uses only material approved for third-party processing, and does not establish a production upload path.

## Consequences

- The cleanup plan must improve and score the CV-first detector, recovery tools, and preview/PDF parity before reconsidering remote assistance.
- Missing the detector target does not automatically authorize remote processing; a later decision must show the remaining fixture families, expected teacher benefit, consent and retention policy, hosting model, cost and latency budget, and a browser-local fallback.
- Production LLM and remote worksheet processing are out of scope for this cleanup, deferred rather than permanently ruled out.
