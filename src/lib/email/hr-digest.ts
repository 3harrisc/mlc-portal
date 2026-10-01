import { escapeHtml, shellHtml } from "./templates";
import { todoCounts, type HrTodo, type TodoLevel } from "@/lib/hr/todos";

const SECTIONS: { level: TodoLevel; title: string; colour: string }[] = [
  { level: "danger", title: "Urgent", colour: "#B42318" },
  { level: "warn", title: "To do", colour: "#B54708" },
  { level: "info", title: "Minor", colour: "#5C6478" },
];

/** The fortnightly HR summary email. `priorities` is the assistant's short summary (may be empty). */
export function hrDigestEmail(todos: HrTodo[], priorities: string[], portalUrl: string) {
  const counts = todoCounts(todos);
  const subject = todos.length === 0
    ? "MLC HR summary: everything up to date"
    : `MLC HR summary: ${[counts.danger && `${counts.danger} urgent`, counts.warn && `${counts.warn} to do`, counts.info && `${counts.info} minor`].filter(Boolean).join(", ")}`;

  const prioritiesHtml = priorities.length
    ? `<div style="font-weight:700;margin-bottom:6px;">Priorities this fortnight</div>
       <ul style="margin:0 0 18px 18px;padding:0;">${priorities.map((p) => `<li style="margin-bottom:4px;">${escapeHtml(p)}</li>`).join("")}</ul>`
    : "";

  const sectionsHtml = SECTIONS.map(({ level, title, colour }) => {
    const items = todos.filter((t) => t.level === level);
    if (!items.length) return "";
    return `<div style="font-weight:700;color:${colour};margin:14px 0 6px;">${title} (${items.length})</div>
      ${items.map((t) => `<div style="font-size:13px;margin-bottom:4px;">${t.who ? `<b>${escapeHtml(t.who)}:</b> ` : ""}${escapeHtml(t.message)}</div>`).join("")}`;
  }).join("");

  const body = todos.length === 0
    ? `<p>Every driver is up to date: details complete, licence checks on file, right-to-work evidence held and all documents signed.</p>`
    : `${prioritiesHtml}${sectionsHtml}`;

  const html = shellHtml(
    "HR summary",
    `${body}<p style="margin-top:20px;"><a href="${escapeHtml(portalUrl)}/admin/hr/drivers" style="background:#0B2A6B;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-size:13px;">Open driver records</a></p>`,
    "Sent every other Monday by the MLC portal. The dashboard is always up to date.",
  );

  const text = [
    subject,
    "",
    ...(priorities.length ? ["Priorities this fortnight:", ...priorities.map((p) => `- ${p}`), ""] : []),
    ...SECTIONS.flatMap(({ level, title }) => {
      const items = todos.filter((t) => t.level === level);
      return items.length ? [`${title}:`, ...items.map((t) => `- ${t.who ? `${t.who}: ` : ""}${t.message}`), ""] : [];
    }),
    `Open driver records: ${portalUrl}/admin/hr/drivers`,
  ].join("\n");

  return { subject, html, text };
}
