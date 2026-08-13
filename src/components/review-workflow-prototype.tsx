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
  { key: "A", name: "Quick checks" },
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
  const questionCount = model.warnings.length;
  return (
    <div className="prototype-frame variant-a">
      <PrototypeHeader
        model={model}
        title={questionCount ? `${questionCount} quick check${questionCount === 1 ? "" : "s"}` : "Ready to preview"}
        subtitle="We only ask when the page needs your judgment."
      />
      <div className="prototype-three-pane quick-check-layout">
        <QuestionQueue model={model} />
        <SourceCanvas model={model} reviewOnly />
        <QuickCheckPanel model={model} />
      </div>
      <PrototypeFooter model={model} />
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

function QuestionQueue({ model }: { model: Model }) {
  return (
    <aside className="quick-check-queue">
      <div className="quick-check-heading">
        <span className="prototype-kicker">Needs your help</span>
        <strong>{model.warnings.length}</strong>
      </div>
      {model.warnings.map((item, index) => (
        <button
          className={item.id === model.selected.id ? "active" : ""}
          key={item.id}
          onClick={() => model.setSelectedId(item.id)}
          type="button"
        >
          <span>{index + 1}</span>
          <span><strong>Problem {item.label}</strong><small>{questionTopic(item)}</small></span>
        </button>
      ))}
      {model.warnings.length === 0 ? <p className="checks-complete">✓ All checks cleared</p> : null}
      <button className="advanced-review-link" onClick={() => model.setNotice("The full correction tools would open here")} type="button">
        Something else looks wrong
      </button>
      <button className="start-over-link" onClick={model.reset} type="button">Start over</button>
    </aside>
  );
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

function QuickCheckPanel({ model }: { model: Model }) {
  if (model.warnings.length === 0) {
    return (
      <aside className="quick-check-panel check-done">
        <span className="done-mark">✓</span>
        <h2>That’s everything</h2>
        <p>The other problems looked clear, so we left them alone.</p>
        <button className="preview-button" type="button">Preview handout →</button>
      </aside>
    );
  }

  const selected = model.selected;
  const isDiagram = selected.warning?.includes("Diagram");
  const isSplit = selected.warning?.includes("merged");

  return (
    <aside className="quick-check-panel">
      <span className="prototype-kicker">Problem {selected.label}</span>
      <h2>{isDiagram ? "Does this diagram belong with problem 4?" : isSplit ? "Is this one problem or two?" : "Is this a student problem?"}</h2>
      <p>Choose the answer that matches the source page.</p>
      <div className="quick-answer-list">
        {isDiagram ? (
          <>
            <button onClick={() => model.resolveSelected({ hasDiagram: true }, "Kept the diagram with problem 4")} type="button"><strong>Keep together</strong><span>Include the equation and diagram as one prompt</span></button>
            <button onClick={() => model.resolveSelected({ hasDiagram: false }, "Separated the diagram from problem 4")} type="button"><strong>Separate them</strong><span>The diagram belongs somewhere else</span></button>
          </>
        ) : isSplit ? (
          <>
            <button onClick={() => model.resolveSelected({}, "Kept problem 5 together")} type="button"><strong>One problem</strong><span>Keep this as a single prompt</span></button>
            <button onClick={() => model.resolveSelected({}, "Split problem 5 into two prompts")} type="button"><strong>Split into two</strong><span>Create two separate prompts</span></button>
          </>
        ) : (
          <>
            <button onClick={() => model.resolveSelected({ included: true }, `Kept problem ${selected.label}`)} type="button"><strong>Keep it</strong></button>
            <button onClick={() => model.resolveSelected({ included: false }, `Removed problem ${selected.label}`)} type="button"><strong>Remove it</strong></button>
          </>
        )}
      </div>
      <button className="not-sure-button" onClick={() => model.setNotice("This check was left for later")} type="button">Not sure — skip for now</button>
    </aside>
  );
}

function questionTopic(item: PrototypeItem) {
  if (item.warning?.includes("Diagram")) return "Diagram placement";
  if (item.warning?.includes("merged")) return "Problem boundary";
  return "Include or remove";
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
