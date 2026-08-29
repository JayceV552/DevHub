import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("python", python);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);

const LABELS: Record<string, string> = {
  bash: "sh",
  css: "css",
  javascript: "js",
  json: "json",
  python: "py",
  rust: "rs",
  sql: "sql",
  typescript: "ts",
  xml: "html",
};

export function highlightCode(code: string): { html: string; language: string } {
  const hintedLanguage = inferLanguage(code);
  const result = hintedLanguage
    ? hljs.highlight(code, { language: hintedLanguage, ignoreIllegals: true })
    : hljs.highlightAuto(code, Object.keys(LABELS));
  const language = result.language ?? hintedLanguage ?? "text";
  return { html: result.value, language: LABELS[language] ?? language };
}

function inferLanguage(code: string): string | null {
  const value = code.trim();
  if (/^(?:\$\s*)?(?:cd|ls|pwd|git|pnpm|npm|yarn|bun|cargo|docker|kubectl|curl|wget|grep|rg|find|lsof|chmod|mkdir|rm|mv|cp)\b/m.test(value)) return "bash";
  if (/^(?:SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|WITH)\b/i.test(value)) return "sql";
  if (/^(?:use\s+[\w:]+|fn\s+\w+|impl\s+\w+|pub\s+(?:struct|enum|fn))\b/m.test(value)) return "rust";
  if (/^(?:def|from|import|class)\s+\w+|\b(?:print|asyncio)\s*\(/m.test(value)) return "python";
  if (/^\s*[\[{][\s\S]*[\]}]\s*$/.test(value)) {
    try { JSON.parse(value); return "json"; } catch { /* keep detecting */ }
  }
  if (/<[a-z][\s\S]*>/i.test(value)) return "xml";
  if (/\b(?:interface|type|enum|namespace)\s+[A-Z\w]+|:\s*(?:string|number|boolean|unknown|never)(?:\[\])?\b/.test(value)) return "typescript";
  if (/\b(?:const|let|var|function|await|async|import|export|return|class|new)\b|=>/.test(value)) return "typescript";
  if (/\{[^}]*[\w-]+\s*:\s*[^}]+\}/s.test(value)) return "css";
  return null;
}
