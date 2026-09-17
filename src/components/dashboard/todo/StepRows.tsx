import { useState } from "react";
import { Check, Plus, X } from "lucide-react";
import type { StepDraft } from "./types";
import { newKey } from "./utils";

export function StepRows({ steps, setSteps, onToggle }: {
  steps: StepDraft[];
  setSteps: (next: StepDraft[]) => void;
  onToggle: (index: number) => void;
}) {
  const [draft, setDraft] = useState("");

  const commitDraft = () => {
    const text = draft.trim();
    if (!text) return;
    setSteps([...steps, { key: newKey(), text, done: false }]);
    setDraft("");
  };

  return (
    <div className="todo-step-list">
      {steps.map((step, index) => (
        <div key={step.key} className={`todo-step-row ${step.done ? "is-done" : ""}`}>
          <button
            className="todo-step-check"
            onClick={() => onToggle(index)}
            aria-label={step.done ? `Reopen ${step.text}` : `Complete ${step.text}`}
          >
            {step.done ? <Check /> : null}
          </button>
          <input
            value={step.text}
            aria-label="Checklist item"
            onChange={(event) => setSteps(steps.map((entry, position) => position === index
              ? { ...entry, text: event.target.value }
              : entry))}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              setSteps([
                ...steps.slice(0, index + 1),
                { key: newKey(), text: "", done: false },
                ...steps.slice(index + 1),
              ]);
            }}
          />
          <button
            className="todo-step-remove"
            onClick={() => setSteps(steps.filter((_, position) => position !== index))}
            aria-label={`Remove ${step.text}`}
          >
            <X />
          </button>
        </div>
      ))}
      <div className="todo-step-row is-draft">
        <span className="todo-step-check"><Plus /></span>
        <input
          value={draft}
          placeholder="Add a checklist item"
          aria-label="New checklist item"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commitDraft(); } }}
          onBlur={commitDraft}
        />
      </div>
    </div>
  );
}
