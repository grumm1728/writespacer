"use client";

// PROTOTYPE ONLY: Three review-workflow variants on `/prototype/review`,
// switchable with `?variant=A|B|C`.

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type PrototypeItem = {
  id: number;
  label: string;
  kind: "problem" | "header";
  included: boolean;
  hasDiagram: boolean;
  warning?: string;
  rect: { left: number; top: number; width: number; height: number };
};

const INITIAL_ITEMS: PrototypeItem[] = [
  { id: 1, label: "3", kind: "problem", included: true, hasDiagram: false, rect: { left: 7, top: 10, width: 39, height: 10 } },
  { id: 2, label: "4", kind: "problem", included: true, hasDiagram: true, warning: "Diagram may be detached", rect: { left: 7, top: 23, width: 39, height: 19 } },
  { id: 3, label: "Practice", kind: "header", included: true, hasDiagram: false, rect: { left: 5, top: 46, width: 88, height: 7 } },
  { id: 4, label: "5", kind: "problem", included: true, hasDiagram: false, warning: "Two prompts may be merged", rect: { left: 7, top: 57, width: 39, height: 22 } },
  { id: 5, label: "6", kind: "problem", included: true, hasDiagram: false, rect: { left: 54, top: 10, width: 39, height: 12 } },
  { id: 6, label: "7", kind: "problem", included: false, hasDiagram: false, warning: "Possible extra item", rect: { left: 54, top: 27, width: 39, height: 12 } },
  { id: 7, label: "8", kind: "problem", included: true, hasDiagram: false, rect: { left: 54, top: 57, width: 39, height: 11 } },
];

const VARIANTS = [
  { key: "A", name: "One-page preview" },
  { key: "B", name: "Triage queue" },
  { key: "C", name: "Focused review" },
] as const;

export function ReviewWorkflowPrototype() {
  const router = useRouter();
  const [variant, setVariant] = useState<"A" | "B" | "C">("A");
  const [items, setItems] = useState(INITIAL_ITEMS);
  const [selectedId, setSelectedId] = useState(2);
  const [history, setHistory] = useState<PrototypeItem[][]>([]);
  const [notice, setNotice] = useState("Detection draft ready: 2 items need review");

  const selected = items.find((item) => item.id === selectedId) ?? items[0];
  const includedCount = items.filter((item) => item.included && item.kind === "problem").length;
  const warnings = items.filter((item) => item.warning && item.included);

  function commit(message: string, update: (current: PrototypeItem[]) => PrototypeItem[]) {
    setHistory((current) => [...current, items]);
    setItems(update);
    setNotice(message);
  }

  function patchSelected(patch: Partial<PrototypeItem>, message: string) {
    commit(message, (current) =>
      current.map((item) => (item.id === selectedId ? { ...item, ...patch } : item)),
    );
  }

  function resolveSelected(patch: Partial<PrototypeItem>, message: string) {
    const nextQuestion = warnings.find((item) => item.id !== selectedId);
    patchSelected({ ...patch, warning: undefined }, message);
    if (nextQuestion) {
      setSelectedId(nextQuestion.id);
    }
  }

  function undo() {
    const previous = history.at(-1);
    if (!previous) return;
    setItems(previous);
    setHistory((current) => current.slice(0, -1));
    setNotice("Undid last correction");
  }

  function reset() {
    setHistory((current) => [...current, items]);
    setItems(INITIAL_ITEMS);
    setSelectedId(2);
    setNotice("Restored detector draft");
  }

  function cycle(delta: number) {
    const index = VARIANTS.findIndex((entry) => entry.key === variant);
    const next = VARIANTS[(index + delta + VARIANTS.length) % VARIANTS.length];
    setVariant(next.key);
    router.replace(`/prototype/review?variant=${next.key}`);
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setVariant(normalizeVariant(new URLSearchParams(window.location.search).get("variant") ?? "A"));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable]")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  const model = { items, selected, includedCount, warnings, history, notice, setNotice, setSelectedId, commit, patchSelected, resolveSelected, undo, reset };

  return (
    <main className="review-prototype-shell">
      {variant === "A" ? <VariantA model={model} /> : null}
      {variant === "B" ? <VariantB model={model} /> : null}
      {variant === "C" ? <VariantC model={model} /> : null}
      <PrototypeState model={model} variant={variant} />
      {process.env.NODE_ENV !== "production" ? (
        <div className="prototype-switcher" aria-label="Prototype variant switcher">
          <button onClick={() => cycle(-1)} type="button" aria-label="Previous variant">←</button>
          <strong>{variant} — {VARIANTS.find((entry) => entry.key === variant)?.name}</strong>
          <button onClick={() => cycle(1)} type="button" aria-label="Next variant">→</button>
        </div>
      ) : null}
    </main>
  );
}

type Model = {
  items: PrototypeItem[];
  selected: PrototypeItem;
  includedCount: number;
  warnings: PrototypeItem[];
  history: PrototypeItem[][];
  notice: string;
  setNotice: (message: string) => void;
  setSelectedId: (id: number) => void;
  commit: (message: string, update: (current: PrototypeItem[]) => PrototypeItem[]) => void;
  patchSelected: (patch: Partial<PrototypeItem>, message: string) => void;
  resolveSelected: (patch: Partial<PrototypeItem>, message: string) => void;
  undo: () => void;
  reset: () => void;
};

function VariantA({ model }: { model: Model }) {
  const selectedProblems = model.items
    .filter((item) => item.kind === "problem" && item.included)
    .slice(0, 8);
  const slotCount = selectedProblems.length <= 2 ? 2 : selectedProblems.length <= 4 ? 4 : selectedProblems.length <= 6 ? 6 : 8;
  const slots = Array.from({ length: slotCount }, (_, index) => selectedProblems[index] ?? null);
  return (
    <div className="prototype-frame variant-a one-page-variant">
      <header className="one-page-header">
        <div><span className="prototype-kicker">WriteSpacer</span><h1>Your worksheet is ready</h1><p>One page side with room to work.</p></div>
        <div className="source-summary"><span>Source</span><strong>algebra-practice.jpg</strong></div>
      </header>
      <div className="one-page-workspace">
        <section className="one-page-preview-area">
          <div className="preview-stage-heading"><div><strong>Print preview</strong><span>Letter · 1 page side</span></div><button onClick={model.undo} disabled={!model.history.length} type="button">↶ Undo</button></div>
          <div className={`one-page-sheet slots-${slotCount}`}>
            <div className="worksheet-sheet-title">Name ____________________ <span>Practice</span></div>
            <div className="worksheet-slot-grid">
              {slots.map((item, index) => item ? (
                <button className={`worksheet-slot ${item.id === model.selected.id ? "selected" : ""}`} key={item.id} onClick={() => model.setSelectedId(item.id)} type="button">
                  {item.warning ? <span className="slot-check">Check crop</span> : null}
                  <span className={`prompt-crop crop-${index % 4}`}><strong>{item.label}.</strong><span /></span>
                  <span className="student-workspace">Student workspace</span>
                </button>
              ) : (
                <button className="worksheet-slot empty-slot" key={`empty-${index}`} onClick={() => model.setNotice("Choose another detected problem from the source")} type="button"><span>＋</span>Add problem</button>
              ))}
            </div>
          </div>
        </section>
        <aside className="one-page-sidebar">
          <div className="selection-summary"><span><strong>{selectedProblems.length}</strong> of 8 problems</span><span><strong>1</strong> page side</span></div>
          <button className="change-problems-button" onClick={() => model.setNotice("The source problem picker would open here")} type="button">Change problems</button>
          <div className="selected-problem-card">
            <span className="prototype-kicker">Selected</span>
            <h2>Problem {model.selected.label}</h2>
            {model.selected.warning ? <p className="prototype-warning">This crop may need a quick check.</p> : <p className="prototype-ready">Crop looks ready</p>}
            <button onClick={() => model.resolveSelected({}, `Fixed the crop for problem ${model.selected.label}`)} type="button">Fix crop</button>
            <button onClick={() => model.setNotice(`Choose a replacement for problem ${model.selected.label}`)} type="button">Replace problem</button>
            <button onClick={() => model.patchSelected({ included: false }, `Removed problem ${model.selected.label}`)} type="button">Remove</button>
          </div>
          <p className="one-page-promise">The arrangement updates automatically. This worksheet will always stay on one side.</p>
          <button className="download-worksheet-button" type="button">Download PDF</button>
        </aside>
      </div>
      <div className="one-page-status" aria-live="polite">{model.notice}</div>
    </div>
  );
}

function VariantB({ model }: { model: Model }) {
  return (
    <div className="prototype-frame variant-b">
      <PrototypeHeader model={model} title="Fix two items, then print" subtitle="A short queue puts likely problems first; the full draft stays available below." />
      <div className="triage-layout">
        <section className="triage-queue">
          <span className="prototype-kicker">Needs attention</span>
          {model.warnings.map((item) => (
            <button className={item.id === model.selected.id ? "active" : ""} key={item.id} onClick={() => model.setSelectedId(item.id)} type="button">
              <strong>{item.kind === "header" ? item.label : `Problem ${item.label}`}</strong>
              <span>{item.warning}</span>
            </button>
          ))}
          <div className="queue-complete">✓ {model.includedCount - model.warnings.length} items look ready</div>
        </section>
        <div className="triage-stage">
          <SourceCanvas model={model} />
          <Inspector model={model} compact />
        </div>
      </div>
      <details className="all-items-drawer"><summary>All detected items ({model.items.length})</summary><ItemRail model={model} /></details>
      <PrototypeFooter model={model} />
    </div>
  );
}

function VariantC({ model }: { model: Model }) {
  const currentIndex = model.items.findIndex((item) => item.id === model.selected.id);
  const go = (delta: number) => model.setSelectedId(model.items[(currentIndex + delta + model.items.length) % model.items.length].id);
  return (
    <div className="prototype-frame variant-c">
      <PrototypeHeader model={model} title={`Check item ${currentIndex + 1} of ${model.items.length}`} subtitle="A focused pass for small screens and first-time use." />
      <div className="focus-progress"><span style={{ width: `${((currentIndex + 1) / model.items.length) * 100}%` }} /></div>
      <div className="focus-layout">
        <button className="focus-arrow" onClick={() => go(-1)} type="button" aria-label="Previous item">←</button>
        <div className="focus-source"><SourceCanvas model={model} focusOnly /></div>
        <button className="focus-arrow" onClick={() => go(1)} type="button" aria-label="Next item">→</button>
        <Inspector model={model} compact />
      </div>
      <div className="focus-actions"><button onClick={() => go(1)} type="button">Looks right — next</button><button onClick={() => model.patchSelected({ included: false }, "Excluded item")} type="button">Not a problem</button></div>
      <PrototypeFooter model={model} />
    </div>
  );
}

function PrototypeHeader({ model, title, subtitle }: { model: Model; title: string; subtitle: string }) {
  return <header className="prototype-header"><div><span className="prototype-kicker">WriteSpacer · Review</span><h1>{title}</h1><p>{subtitle}</p></div><div className="prototype-history"><button disabled={!model.history.length} onClick={model.undo} type="button">↶ Undo</button><button onClick={model.reset} type="button">Reset draft</button></div></header>;
}

function ItemRail({ model }: { model: Model }) {
  return <aside className="prototype-item-rail"><div className="rail-title"><strong>Reading order</strong><button onClick={() => model.commit("Added a problem box", (items) => [...items, { id: Date.now(), label: String(items.length + 2), kind: "problem", included: true, hasDiagram: false, rect: { left: 30, top: 82, width: 38, height: 10 } }])} type="button">+ Add</button></div>{model.items.map((item, index) => <button className={item.id === model.selected.id ? "active" : ""} key={item.id} onClick={() => model.setSelectedId(item.id)} type="button"><span className="drag-grip">⠿</span><strong>{item.kind === "header" ? item.label : `Problem ${item.label}`}</strong><small>{item.included ? (item.warning ? "Review" : "Ready") : "Excluded"}</small><span>{index + 1}</span></button>)}</aside>;
}

function SourceCanvas({ model, focusOnly = false, reviewOnly = false }: { model: Model; focusOnly?: boolean; reviewOnly?: boolean }) {
  const shownItems = focusOnly
    ? model.items.filter((item) => item.id === model.selected.id)
    : reviewOnly
      ? model.warnings
      : model.items;
  return <section className="prototype-source"><div className="canvas-toolbar"><span>Source page</span><div><button type="button">−</button><strong>85%</strong><button type="button">+</button></div></div><div className="prototype-paper">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img alt="Sample algebra worksheet" src="/fixtures/pershan-problem-set-example.png" />{shownItems.map((item) => <button aria-label={`Select ${item.kind} ${item.label}`} className={`prototype-box ${item.id === model.selected.id ? "selected" : ""} ${!item.included ? "excluded" : ""} ${item.kind}`} key={item.id} onClick={() => model.setSelectedId(item.id)} style={item.rect} type="button"><span>{item.label}</span></button>)}</div><p className="canvas-hint">{reviewOnly ? "Zoom and pan to inspect" : "Drag to move · handles resize · Space + drag pans"}</p></section>;
}

function Inspector({ model, compact = false }: { model: Model; compact?: boolean }) {
  const selected = model.selected;
  return <aside className={`prototype-inspector ${compact ? "compact" : ""}`}><div><span className="prototype-kicker">Selected</span><h2>{selected.kind === "header" ? "Section header" : `Problem ${selected.label}`}</h2>{selected.warning ? <p className="prototype-warning">{selected.warning}</p> : <p className="prototype-ready">Looks ready</p>}</div><label>Label<input value={selected.label} onChange={(event) => model.patchSelected({ label: event.target.value }, "Changed source label")} /></label><div className="segmented"><button className={selected.kind === "problem" ? "active" : ""} onClick={() => model.patchSelected({ kind: "problem" }, "Marked as problem")} type="button">Problem</button><button className={selected.kind === "header" ? "active" : ""} onClick={() => model.patchSelected({ kind: "header" }, "Marked as section header")} type="button">Header</button></div><div className="inspector-actions"><button onClick={() => model.patchSelected({ warning: undefined }, "Split into two problems")} type="button">Split</button><button type="button">Merge with…</button><button className={selected.hasDiagram ? "active" : ""} onClick={() => model.patchSelected({ hasDiagram: !selected.hasDiagram, warning: undefined }, selected.hasDiagram ? "Detached diagram" : "Attached diagram")} type="button">{selected.hasDiagram ? "Detach diagram" : "Attach diagram"}</button><button onClick={() => model.patchSelected({ included: !selected.included }, selected.included ? "Excluded item" : "Restored item")} type="button">{selected.included ? "Exclude" : "Restore"}</button></div><p className="inspector-note">Changes update the handout preview immediately.</p></aside>;
}

function PrototypeFooter({ model }: { model: Model }) {
  const pageCount = model.includedCount > 5 ? 3 : 2;
  return <footer className="prototype-footer"><div aria-live="polite"><strong>{model.notice}</strong><span>{model.includedCount} problems · {pageCount} page sides</span>{pageCount >= 3 ? <em>Longer than preferred</em> : null}</div><div className="mini-preview" aria-label="Handout preview"><span>1</span><span>2</span>{pageCount >= 3 ? <span>3</span> : null}</div><button className="preview-button" type="button">Preview handout →</button></footer>;
}

function PrototypeState({ model, variant }: { model: Model; variant: string }) {
  const state = useMemo(() => ({ variant, selectedItemId: model.selected.id, includedProblemCount: model.includedCount, unresolvedWarnings: model.warnings.map((item) => item.id), undoDepth: model.history.length }), [model, variant]);
  return <details className="prototype-state"><summary>Prototype state</summary><pre>{JSON.stringify(state, null, 2)}</pre></details>;
}

function normalizeVariant(value: string): "A" | "B" | "C" {
  return value === "B" || value === "C" ? value : "A";
}
