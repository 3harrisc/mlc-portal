/**
 * The small Markdown subset the HR assistant writes (headings, paragraphs,
 * bullet and numbered lists, rules). Browser-safe: used by the on-screen
 * preview and by the PDF renderer, so both show the same structure.
 */

export type MdBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "li"; text: string; marker: string }
  | { type: "hr" };

/** Drop inline formatting the PDF can't show: bold/italic markers, code ticks, links -> "text (url)". */
export function stripInline(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, "$1 ($2)")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => a ?? b)
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

export function parseMarkdown(md: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) blocks.push({ type: "p", text: stripInline(para.join(" ")) });
    para = [];
  };

  for (const raw of md.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const level = Math.min(m[1].length, 3) as 1 | 2 | 3;
      blocks.push({ type: `h${level}`, text: stripInline(m[2].replace(/#+$/, "")) });
    } else if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      blocks.push({ type: "hr" });
    } else if ((m = line.match(/^[-*•]\s+(.*)$/))) {
      flush();
      blocks.push({ type: "li", text: stripInline(m[1]), marker: "•" });
    } else if ((m = line.match(/^(\d+)[.)]\s+(.*)$/))) {
      flush();
      blocks.push({ type: "li", text: stripInline(m[2]), marker: `${m[1]}.` });
    } else if (/^\|.*\|$/.test(line)) {
      // Tables aren't supported; keep the content readable as a line of text.
      flush();
      if (!/^\|[\s:|-]+\|$/.test(line)) {
        blocks.push({ type: "p", text: stripInline(line.slice(1, -1).split("|").map((c) => c.trim()).join("  ·  ")) });
      }
    } else {
      para.push(line);
    }
  }
  flush();
  return blocks;
}

/** The first level-1 heading, used as the document title. */
export function titleFromMarkdown(md: string): string | null {
  const h1 = parseMarkdown(md).find((b) => b.type === "h1");
  return h1 && "text" in h1 ? h1.text : null;
}

/** Any "[TO COMPLETE: ...]" gaps the assistant left for MLC to fill. */
export function openPlaceholders(md: string): string[] {
  return md.match(/\[TO COMPLETE[^\]]*\]/g) ?? [];
}
