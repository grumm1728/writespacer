import { describe, expect, it } from "vitest";

import { normalizeWorksheetPage } from "@/lib/detection/normalization";
import { extractVisualEvidence } from "@/lib/detection/visual-evidence";

describe("worksheet visual evidence", () => {
  it("collects geometric evidence without making final detection decisions", () => {
    const page = normalizeWorksheetPage({
      grayscale: new Uint8Array(240 * 160).fill(255),
      width: 240,
      height: 160,
    });
    const evidence = extractVisualEvidence(page);

    expect(evidence.page).toBe(page);
    expect(evidence.masks.initialText).toHaveLength(page.width * page.height);
    expect(evidence.masks.content).toHaveLength(page.width * page.height);
    expect(Array.isArray(evidence.contentComponents)).toBe(true);
    expect(Array.isArray(evidence.textComponents)).toBe(true);
    expect(Array.isArray(evidence.rows)).toBe(true);
    expect(Array.isArray(evidence.segments)).toBe(true);
    expect(Array.isArray(evidence.layoutRegions)).toBe(true);
    expect(Array.isArray(evidence.proposals)).toBe(true);
    expect(evidence).not.toHaveProperty("acceptedAnchors");
    expect(evidence).not.toHaveProperty("problemDrafts");
  });
});
