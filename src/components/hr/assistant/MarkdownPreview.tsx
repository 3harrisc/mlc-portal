"use client";

import { Fragment, useMemo } from "react";
import { parseMarkdown } from "@/lib/hr/markdown";

/** Highlight [TO COMPLETE: ...] gaps so they can't be missed. */
function withGaps(text: string) {
  return text.split(/(\[TO COMPLETE[^\]]*\])/g).map((part, i) =>
    part.startsWith("[TO COMPLETE") ? (
      <mark key={i} style={{ background: "#FEF08A", fontWeight: 600, padding: "0 2px" }}>
        {part}
      </mark>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

/** Renders the assistant's Markdown subset the same way the PDF lays it out. */
export default function MarkdownPreview({ markdown }: { markdown: string }) {
  const blocks = useMemo(() => parseMarkdown(markdown), [markdown]);
  return (
    <div style={{ fontSize: 13, lineHeight: 1.55, color: "var(--ink-900, #111827)" }}>
      {blocks.map((b, i) => {
        switch (b.type) {
          case "h1":
            return <h2 key={i} style={{ fontSize: 20, fontWeight: 700, margin: "4px 0 10px" }}>{withGaps(b.text)}</h2>;
          case "h2":
            return <h3 key={i} style={{ fontSize: 15, fontWeight: 700, margin: "16px 0 6px" }}>{withGaps(b.text)}</h3>;
          case "h3":
            return <h4 key={i} style={{ fontSize: 13.5, fontWeight: 700, margin: "12px 0 4px" }}>{withGaps(b.text)}</h4>;
          case "p":
            return <p key={i} style={{ margin: "0 0 8px" }}>{withGaps(b.text)}</p>;
          case "li":
            return (
              <div key={i} style={{ display: "flex", gap: 8, margin: "0 0 4px 4px" }}>
                <span style={{ minWidth: 14, color: "var(--ink-500)" }}>{b.marker}</span>
                <span>{withGaps(b.text)}</span>
              </div>
            );
          case "hr":
            return <hr key={i} style={{ border: 0, borderTop: "1px solid var(--line, #e5e7eb)", margin: "12px 0" }} />;
        }
      })}
    </div>
  );
}
