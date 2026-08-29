import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";

import { parseAnsi, splitUrls, stripAnsi } from "../../lib/ansi";
import { api } from "../../lib/api";
import { outputStore } from "../../lib/outputStore";
import type { OutputLine, Run } from "../../lib/types";
import { StatusDot } from "../common/StatusDot";
import { Button } from "../ui/button";

const STICK_THRESHOLD = 40;

export function Terminal({
  run,
  onStop,
  onRestart,
  onReport,
}: {
  run: Run;
  onStop: (runId: string) => void;
  onRestart: (runId: string) => void;
  onReport: (err: unknown) => void;
}) {
  const lines = useSyncExternalStore(
    (listener) => outputStore.subscribe(run.runId, listener),
    () => outputStore.get(run.runId),
  );

  const bodyRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  useEffect(() => {
    if (outputStore.has(run.runId)) return;
    let cancelled = false;
    api
      .getRunOutput(run.runId)
      .then((history: OutputLine[]) => {
        if (!cancelled && !outputStore.has(run.runId)) {
          outputStore.replace(run.runId, history);
        }
      })
      .catch(onReport);
    return () => {
      cancelled = true;
    };
  }, [run.runId, onReport]);

  useLayoutEffect(() => {
    const body = bodyRef.current;
    if (body && stickToBottom.current) body.scrollTop = body.scrollHeight;
  }, [lines]);

  const handleScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const distanceFromBottom = body.scrollHeight - body.scrollTop - body.clientHeight;
    stickToBottom.current = distanceFromBottom <= STICK_THRESHOLD;
  };

  const running = run.status === "running";

  const copyAll = () => {
    const text = lines.map((line) => stripAnsi(line.text)).join("\n");
    navigator.clipboard.writeText(text).catch(onReport);
  };

  return (
    <>
      <div className="terminal-toolbar">
        <span className="terminal-title">
          {run.projectName} <span style={{ color: "var(--text-faint)" }}>/</span> {run.commandId}
        </span>
        <span className="terminal-command">{run.displayCommand}</span>
        <StatusDot run={run} />
        <span className="spacer" />
        {running ? (
          <Button variant="outline" size="xs" onClick={() => onStop(run.runId)}>
            Stop
          </Button>
        ) : null}
        <Button variant="outline" size="xs" onClick={() => onRestart(run.runId)}>
          {running ? "Restart" : "Run again"}
        </Button>
        <Button size="xs" variant="ghost" onClick={copyAll} disabled={lines.length === 0}>
          Copy
        </Button>
        <Button
          size="xs"
          variant="ghost"
          onClick={() => outputStore.replace(run.runId, [])}
          disabled={lines.length === 0}
        >
          Clear
        </Button>
      </div>

      <div className="terminal-body" ref={bodyRef} onScroll={handleScroll}>
        {lines.length === 0 ? (
          <div className="terminal-empty">
            {running ? "Waiting for output…" : "No output captured."}
          </div>
        ) : (
          lines.map((line) => <Line key={line.seq} line={line} onReport={onReport} />)
        )}
      </div>
    </>
  );
}

function Line({ line, onReport }: { line: OutputLine; onReport: (err: unknown) => void }) {
  if (line.text.trim() === "") {
    return <div className={`terminal-line ${line.stream}`}>&nbsp;</div>;
  }

  return (
    <div className={`terminal-line ${line.stream}`}>
      {parseAnsi(line.text).map((span, spanIndex) => {
        const style: React.CSSProperties = {
          color: span.color,
          background: span.background,
          fontWeight: span.bold ? 600 : undefined,
          opacity: span.dim ? 0.62 : undefined,
          fontStyle: span.italic ? "italic" : undefined,
          textDecoration: span.underline ? "underline" : undefined,
        };
        return (
          <span key={spanIndex} style={style}>
            {splitUrls(span.text).map((part, partIndex) =>
              part.url ? (
                <a
                  key={partIndex}
                  href={part.url}
                  onClick={(event) => {
                    event.preventDefault();
                    openUrl(part.url!).catch(onReport);
                  }}
                >
                  {part.text}
                </a>
              ) : (
                <span key={partIndex}>{part.text}</span>
              ),
            )}
          </span>
        );
      })}
    </div>
  );
}
