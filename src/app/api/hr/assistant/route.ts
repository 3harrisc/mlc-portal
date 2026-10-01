import Anthropic from "@anthropic-ai/sdk";
import { getSupabaseAdmin } from "@/lib/supabase";
import { downloadHrFile, requireAdmin } from "@/lib/hr/server";
import { systemBlocks } from "@/lib/hr/assistant/prompt";
import type { AssistantMode } from "@/lib/hr/assistant/notes";

// Drafting a full policy with web checks can take a few minutes.
export const runtime = "nodejs";
export const maxDuration = 300;

// Sonnet for everyday drafting; Opus for the "is this legally right?" review,
// where catching a subtle problem matters most.
const MODELS: Record<AssistantMode, string> = {
  draft: "claude-sonnet-5-5",
  revise: "claude-sonnet-5-5",
  review: "claude-opus-5-5",
};
const MAX_CONTINUATIONS = 4;
const OFFICIAL_SOURCES = ["gov.uk", "legislation.gov.uk", "hse.gov.uk", "acas.org.uk", "ico.org.uk"];

/** One NDJSON line per event, read by useHrAssistant on the client. */
type StreamEvent =
  | { t: "status"; m: string }
  | { t: "text"; d: string }
  | { t: "warn"; m: string }
  | { t: "error"; m: string }
  | { t: "done" };

interface Body {
  mode: AssistantMode;
  request: string;
  currentDraft?: string;
  documentId?: string;
}

function parseBody(raw: unknown): Body {
  const b = (raw ?? {}) as Partial<Body>;
  if (b.mode !== "draft" && b.mode !== "revise" && b.mode !== "review") throw new Error("Unknown mode");
  const request = String(b.request ?? "").trim();
  if (b.mode !== "review" && request.length < 3) throw new Error("Say what you need.");
  if (request.length > 4000) throw new Error("Keep the request under 4,000 characters.");
  if (b.mode === "revise" && !String(b.currentDraft ?? "").trim()) throw new Error("Nothing to revise yet.");
  if (b.mode === "review" && !b.documentId) throw new Error("Choose a document to review.");
  return { mode: b.mode, request, currentDraft: b.currentDraft?.slice(0, 200_000), documentId: b.documentId };
}

async function firstMessage(body: Body): Promise<{ content: Anthropic.Beta.BetaContentBlockParam[]; documentId: string | null }> {
  if (body.mode === "draft") {
    return { content: [{ type: "text", text: body.request }], documentId: null };
  }
  if (body.mode === "revise") {
    return {
      content: [
        {
          type: "text",
          text: `Current draft:\n<draft>\n${body.currentDraft}\n</draft>\n\nChanges requested: ${body.request}`,
        },
      ],
      documentId: null,
    };
  }
  const { data: doc } = await getSupabaseAdmin()
    .from("hr_documents")
    .select("id, title, storage_path")
    .eq("id", body.documentId!)
    .single();
  if (!doc) throw new Error("Document not found");
  const pdf = await downloadHrFile(doc.storage_path);
  return {
    documentId: doc.id,
    content: [
      {
        type: "document",
        title: doc.title,
        source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") },
      },
      {
        type: "text",
        text: `Review this MLC document: "${doc.title}".${body.request ? ` Focus especially on: ${body.request}` : ""}`,
      },
    ],
  };
}

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return "The AI service key isn't working. Check ANTHROPIC_API_KEY in Vercel.";
  if (e instanceof Anthropic.RateLimitError) return "The AI service is busy. Wait a minute and try again.";
  if (e instanceof Anthropic.BadRequestError) return `The AI service rejected the request: ${e.message}`;
  if (e instanceof Anthropic.APIError) return `The AI service had a problem (${e.status ?? "network"}). Try again.`;
  return e instanceof Error ? e.message : String(e);
}

export async function POST(req: Request) {
  let admin: Awaited<ReturnType<typeof requireAdmin>>;
  let body: Body;
  try {
    admin = await requireAdmin();
    body = parseBody(await req.json());
  } catch (e) {
    const status = e instanceof Error && /Admin|authenticated|active/.test(e.message) ? 403 : 400;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
      const client = new Anthropic();
      let output = "";
      let stopReason: string | null = null;
      let inputTokens = 0;
      let outputTokens = 0;
      let documentId: string | null = null;

      try {
        send({ t: "status", m: body.mode === "review" ? "Reading the document…" : "Thinking…" });
        const first = await firstMessage(body);
        documentId = first.documentId;
        const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: "user", content: first.content }];
        const webSearch = process.env.HR_ASSISTANT_WEB_SEARCH !== "off";

        for (let turn = 0; turn <= MAX_CONTINUATIONS; turn++) {
          const run = client.beta.messages.stream({
            model: MODELS[body.mode],
            max_tokens: 64000,
            thinking: { type: "adaptive" },
            output_config: { effort: "high" },
            // On a safety decline, retry on Anthropic's recommended fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            system: systemBlocks(body.mode),
            tools: webSearch
              ? [{ type: "web_search_20260209", name: "web_search", max_uses: 6, allowed_domains: OFFICIAL_SOURCES }]
              : undefined,
            messages,
          });

          for await (const event of run) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "server_tool_use") {
                send({ t: "status", m: "Checking official guidance (GOV.UK, HSE, ACAS)…" });
              } else if (event.content_block.type === "text") {
                send({ t: "status", m: body.mode === "review" ? "Writing the review…" : "Writing…" });
              }
            } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
              output += event.delta.text;
              send({ t: "text", d: event.delta.text });
            }
          }

          const final = await run.finalMessage();
          stopReason = final.stop_reason;
          inputTokens += final.usage.input_tokens + (final.usage.cache_read_input_tokens ?? 0);
          outputTokens += final.usage.output_tokens;
          // Long server-tool turns can pause; resume by sending the turn back as-is.
          if (final.stop_reason !== "pause_turn") break;
          messages.push({ role: "assistant", content: final.content });
        }

        if (stopReason === "refusal") {
          send({ t: "error", m: "The assistant declined this request. Try rewording it." });
        } else if (stopReason === "max_tokens") {
          send({ t: "warn", m: "The output was cut off because it was too long. Ask for a shorter version." });
        } else if (stopReason === "pause_turn") {
          send({ t: "warn", m: "The assistant stopped part-way through its checks. Try again." });
        }
      } catch (e) {
        send({ t: "error", m: friendlyError(e) });
      } finally {
        await getSupabaseAdmin()
          .from("hr_ai_requests")
          .insert({
            mode: body.mode,
            request: body.request || "(review)",
            document_id: documentId,
            output,
            model: MODELS[body.mode],
            stop_reason: stopReason,
            input_tokens: inputTokens,
            output_tokens: outputTokens,
            created_by: admin.id,
          })
          .then(({ error }) => error && console.error("hr_ai_requests insert failed:", error.message));
        send({ t: "done" });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
