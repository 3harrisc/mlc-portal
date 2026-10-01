/**
 * Fortnightly HR summary email.
 *
 * Vercel cron runs this every Monday (vercel.json); it only sends on even
 * ISO weeks, so the email arrives every other Monday. ?force=1 sends
 * regardless (for testing). The dashboard to-do list is always live - this
 * email is just the reminder.
 *
 * Recipients: HR_DIGEST_TO (comma-separated) if set, otherwise every active
 * admin. Auth: Bearer CRON_SECRET (matches the other /api/cron/* routes).
 */
import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { isoWeekNum } from "@/lib/iso-week";
import { loadHrTodos } from "@/lib/hr/todos-server";
import type { HrTodo } from "@/lib/hr/todos";
import { hrDigestEmail } from "@/lib/email/hr-digest";
import { sendNotification } from "@/lib/email/notifications";

export const runtime = "nodejs";
export const maxDuration = 120;

function portalUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
  ).replace(/\/$/, "");
}

async function recipients(): Promise<string[]> {
  const configured = (process.env.HR_DIGEST_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length) return configured;
  const { data } = await getSupabaseAdmin().from("profiles").select("email").eq("role", "admin").eq("active", true);
  return (data ?? []).map((p) => p.email).filter(Boolean);
}

/** The HR assistant's 3-5 line "what matters most" summary. Empty on any failure - the list still sends. */
async function priorities(todos: HrTodo[]): Promise<string[]> {
  if (!todos.length || !process.env.ANTHROPIC_API_KEY) return [];
  try {
    const client = new Anthropic();
    const msg = await client.beta.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You are MLC Transport's HR assistant writing the top of a fortnightly summary email to the Transport " +
        "Manager. From the to-do list, write 3 to 5 short lines saying what to deal with first and why, most " +
        "important first. Legal risks (right to work, driving entitlement) come before admin gaps. Group items " +
        "for the same driver. British English, plain and direct. Output only the lines, each starting with '- '.",
      messages: [{ role: "user", content: todos.map((t) => `[${t.level}] ${t.who ? `${t.who}: ` : ""}${t.message}`).join("\n") }],
    });
    if (msg.stop_reason === "refusal") return [];
    const text = msg.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
    return text.split("\n").map((l) => l.replace(/^\s*[-•*]\s*/, "").trim()).filter(Boolean).slice(0, 5);
  } catch (e) {
    console.error("[hr-digest] priorities failed:", e instanceof Error ? e.message : e);
    return [];
  }
}

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const now = new Date();
  const force = new URL(req.url).searchParams.get("force") === "1";
  if (!force && isoWeekNum(now) % 2 !== 0) {
    return NextResponse.json({ skipped: "odd week - sends every other Monday" });
  }

  try {
    const todos = await loadHrTodos(now);
    const email = hrDigestEmail(todos, await priorities(todos), portalUrl());
    const to = await recipients();
    const result = await sendNotification({ to, subject: email.subject, html: email.html, text: email.text, tag: "hr-digest" });
    return NextResponse.json({ todos: todos.length, recipients: to.length, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
