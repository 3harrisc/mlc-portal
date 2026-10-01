"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getHrTodos } from "@/app/actions/hr-todos";
import { todoCounts, type HrTodo } from "@/lib/hr/todos";

const COLOUR = { danger: "var(--err)", warn: "var(--warn)", info: "var(--ink-500)" } as const;
const ICON = { danger: "⚠", warn: "•", info: "·" } as const;

interface Props {
  /** Show only the first N items with a "view all" link (dashboard card). */
  limit?: number;
  title?: string;
}

/** HR to-do list across all drivers. Admin only. */
export default function HrTodoList({ limit, title = "HR to-do" }: Props) {
  const [todos, setTodos] = useState<HrTodo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getHrTodos().then((res) => {
      if (res.error) setError(res.error);
      setTodos(res.todos ?? []);
    });
  }, []);

  if (error) return null; // e.g. not an admin, or HR tables not set up yet
  if (!todos) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header"><h3>{title}</h3></div>
        <div className="card-body muted" style={{ fontSize: 12.5 }}>Checking…</div>
      </div>
    );
  }

  const counts = todoCounts(todos);
  const shown = limit ? todos.slice(0, limit) : todos;

  return (
    <div className="card" style={{ marginBottom: 16, borderColor: counts.danger ? "var(--err)" : undefined }}>
      <div className="card-header">
        <h3>{title}</h3>
        <div className="actions" style={{ fontSize: 11.5 }}>
          {counts.danger > 0 && <span style={{ color: COLOUR.danger }}>{counts.danger} urgent</span>}
          {counts.warn > 0 && <span style={{ color: COLOUR.warn }}>{counts.warn} to do</span>}
          {counts.info > 0 && <span className="muted">{counts.info} minor</span>}
        </div>
      </div>
      <div className="card-body" style={{ display: "grid", gap: 6 }}>
        {todos.length === 0 && <div style={{ fontSize: 12.5, color: "var(--ok)" }}>✓ Nothing outstanding. Every driver is up to date.</div>}
        {shown.map((t, i) => (
          <Link key={i} href={t.href} className="row gap-8" style={{ fontSize: 12.5, textDecoration: "none", color: "inherit", alignItems: "flex-start" }}>
            <span style={{ width: 14, color: COLOUR[t.level] }}>{ICON[t.level]}</span>
            <span style={{ flex: 1 }}>
              {t.who && <b>{t.who}: </b>}
              <span style={{ color: t.level === "info" ? "var(--ink-500)" : undefined }}>{t.message}</span>
            </span>
          </Link>
        ))}
        {limit && todos.length > limit && (
          <Link href="/admin/hr/drivers" style={{ fontSize: 12, color: "var(--mlc-blue)" }}>
            View all {todos.length} →
          </Link>
        )}
      </div>
    </div>
  );
}
