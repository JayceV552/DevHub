export interface AnsiSpan {
  text: string;
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

const PALETTE = Array.from({ length: 16 }, (_, index) => `var(--ansi-${index})`);

function xterm256(index: number): string {
  if (index < 16) return PALETTE[index];
  if (index < 232) {
    const n = index - 16;
    const level = (v: number) => (v === 0 ? 0 : 55 + v * 40);
    const r = level(Math.floor(n / 36));
    const g = level(Math.floor((n % 36) / 6));
    const b = level(n % 6);
    return `rgb(${r},${g},${b})`;
  }
  const grey = 8 + (index - 232) * 10;
  return `rgb(${grey},${grey},${grey})`;
}

interface Style {
  color?: string;
  background?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
}

function applySgr(style: Style, params: number[]): void {
  for (let i = 0; i < params.length; i++) {
    const code = params[i];

    if (code === 0) {
      style.color = undefined;
      style.background = undefined;
      style.bold = style.dim = style.italic = style.underline = false;
    } else if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 22) style.bold = style.dim = false;
    else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code >= 30 && code <= 37) style.color = PALETTE[code - 30];
    else if (code >= 90 && code <= 97) style.color = PALETTE[code - 90 + 8];
    else if (code === 39) style.color = undefined;
    else if (code >= 40 && code <= 47) style.background = PALETTE[code - 40];
    else if (code >= 100 && code <= 107) style.background = PALETTE[code - 100 + 8];
    else if (code === 49) style.background = undefined;
    else if (code === 38 || code === 48) {
      const target = code === 38 ? "color" : "background";
      if (params[i + 1] === 5) {
        style[target] = xterm256(params[i + 2] ?? 0);
        i += 2;
      } else if (params[i + 1] === 2) {
        const [r, g, b] = [params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0];
        style[target] = `rgb(${r},${g},${b})`;
        i += 4;
      }
    }
  }
}

const ESCAPE = /\x1b(?:\[([0-9;?]*)([A-Za-z])|\][^\x07\x1b]*(?:\x07|\x1b\\)|[()][A-Za-z0-9]|[A-Za-z=><])/g;
const CONTROL_CHARS = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function parseAnsi(input: string): AnsiSpan[] {
  const trimmedCr = input.replace(/\r+$/, "");
  const lastCr = trimmedCr.lastIndexOf("\r");
  const line = lastCr === -1 ? trimmedCr : trimmedCr.slice(lastCr + 1);

  const spans: AnsiSpan[] = [];
  const style: Style = {};
  let cursor = 0;

  const push = (text: string) => {
    const cleaned = text.replace(CONTROL_CHARS, "");
    if (!cleaned) return;
    const last = spans[spans.length - 1];
    if (last && sameStyle(last, style)) {
      last.text += cleaned;
      return;
    }
    spans.push({ text: cleaned, ...style });
  };

  ESCAPE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ESCAPE.exec(line)) !== null) {
    push(line.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const [, params, final] = match;
    if (final === "m") {
      const codes = (params ?? "")
        .split(";")
        .map((p) => (p === "" ? 0 : Number(p)))
        .filter((n) => Number.isFinite(n));
      applySgr(style, codes.length ? codes : [0]);
    }
  }
  push(line.slice(cursor));

  return spans.length ? spans : [{ text: "" }];
}

function sameStyle(a: AnsiSpan, b: Style): boolean {
  return (
    a.color === b.color &&
    a.background === b.background &&
    !!a.bold === !!b.bold &&
    !!a.dim === !!b.dim &&
    !!a.italic === !!b.italic &&
    !!a.underline === !!b.underline
  );
}

export function stripAnsi(input: string): string {
  return parseAnsi(input)
    .map((s) => s.text)
    .join("");
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

export function splitUrls(text: string): Array<{ text: string; url?: string }> {
  const parts: Array<{ text: string; url?: string }> = [];
  let cursor = 0;
  URL_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_PATTERN.exec(text)) !== null) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index) });
    const url = match[0].replace(/[.,;:!?]+$/, "");
    parts.push({ text: url, url });
    cursor = match.index + url.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor) });
  return parts;
}
