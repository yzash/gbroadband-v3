"use client";

import React from "react";

/** Tiny markdown: **bold**, `code`, > blockquote, pipe tables, line breaks. */
export function MiniMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    // Table block
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*-{2,}/.test(lines[i + 1])) {
      const header = splitRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      out.push(
        <div key={key++} className="my-1 overflow-x-auto">
          <table className="w-full text-2xs">
            <thead className="text-ink-3">
              <tr>{header.map((h, j) => <th key={j} className="border-b border-line px-2 py-1 text-left">{h}</th>)}</tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="border-b border-line/40">
                  {r.map((c, ci) => <td key={ci} className="px-2 py-1 font-mono text-ink-2">{c}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }
    if (line.startsWith(">")) {
      out.push(
        <blockquote key={key++} className="my-1 border-l-2 border-doctrine/50 bg-surface-2 px-3 py-1.5 text-xs italic text-ink-2">
          {inline(line.replace(/^>\s?/, ""))}
        </blockquote>
      );
      i++;
      continue;
    }
    if (line.trim() === "") {
      out.push(<div key={key++} className="h-1.5" />);
      i++;
      continue;
    }
    out.push(<p key={key++} className="text-sm text-ink-2">{inline(line)}</p>);
    i++;
  }
  return <div className="flex flex-col">{out}</div>;
}

function splitRow(line: string): string[] {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((s) => s.trim());
}

function inline(s: string): React.ReactNode {
  // Split on **bold** and `code`.
  const parts = s.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="font-semibold text-ink">{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} className="rounded bg-surface-3 px-1 font-mono text-doctrine">{p.slice(1, -1)}</code>;
    return <React.Fragment key={i}>{p}</React.Fragment>;
  });
}
