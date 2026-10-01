"use server";

import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase";
import { HR_BUCKET, errorMessage, requireAdmin } from "@/lib/hr/server";
import { renderMarkdownPdf } from "@/lib/hr/markdown-pdf";
import { openPlaceholders, titleFromMarkdown } from "@/lib/hr/markdown";
import { finalizeDocument } from "@/app/actions/hr";
import type { HrAudience, HrCategory } from "@/types/hr";

export interface CreateFromDraftInput {
  markdown: string;
  title: string;
  category: HrCategory;
  audience: HrAudience;
  resignMonths: number | null;
  requiresCountersign: boolean;
}

/**
 * Approve an HR-assistant draft: render it as an MLC PDF and save it as a
 * DRAFT document. It only reaches drivers when an admin presses "Send" on the
 * HR documents page, so there are two human approvals before anyone sees it.
 */
export async function createDocumentFromDraft(input: CreateFromDraftInput): Promise<{ id?: string; error?: string }> {
  try {
    await requireAdmin();
    const markdown = (input.markdown ?? "").trim();
    if (markdown.length < 50) return { error: "The draft is empty." };
    const gaps = openPlaceholders(markdown);
    if (gaps.length) {
      return { error: `Fill in the gaps first: ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? "…" : ""}` };
    }
    const title = (input.title || titleFromMarkdown(markdown) || "").trim();
    if (!title) return { error: "Give the document a title." };

    const pdf = await renderMarkdownPdf(markdown, title);
    const path = `documents/${randomUUID()}.pdf`;
    const { error } = await getSupabaseAdmin()
      .storage.from(HR_BUCKET)
      .upload(path, pdf, { contentType: "application/pdf" });
    if (error) return { error: `Couldn't save the PDF: ${error.message}` };

    // finalizeDocument re-checks admin, validates, hashes the file, and
    // removes it from storage again if anything fails.
    return finalizeDocument({
      path,
      fileName: `${title.replace(/[^\w\s-]/g, "").trim() || "document"}.pdf`,
      title,
      category: input.category,
      description: "",
      audience: input.audience,
      driverIds: [],
      resignMonths: input.resignMonths,
      requiresCountersign: input.requiresCountersign,
      collectsParticulars: false,
      publish: false,
    });
  } catch (e) {
    return { error: errorMessage(e) };
  }
}
