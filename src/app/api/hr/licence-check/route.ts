import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { downloadHrFile, requireAdmin } from "@/lib/hr/server";
import { looksLikePdf } from "@/lib/hr/signature-image";
import { LicenceCheckSchema } from "@/lib/hr/licence";

export const runtime = "nodejs";
export const maxDuration = 120;

const PATH_RE = /^driver-files\/[0-9a-f-]{36}\.pdf$/i;

/**
 * Read an uploaded AssetGo licence check and return its details in a fixed
 * shape. Nothing is saved here - the admin checks the result on the driver
 * page and saves it from there.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return Response.json({ error: "Admin only" }, { status: 403 });
  }

  try {
    const { path } = (await req.json()) as { path?: string };
    if (!path || !PATH_RE.test(path)) return Response.json({ error: "Invalid file" }, { status: 400 });
    const pdf = await downloadHrFile(path);
    if (!looksLikePdf(pdf)) return Response.json({ error: "That file isn't a PDF." }, { status: 400 });

    const client = new Anthropic();
    const message = await client.beta.messages.parse({
      model: "claude-sonnet-5-5",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "low", format: betaZodOutputFormat(LicenceCheckSchema) },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system:
        "You extract data from AssetGo driver licence check PDFs for MLC Transport. Copy values exactly as " +
        "printed. Convert every date to YYYY-MM-DD (the PDF uses DD-MM-YYYY or DD/MM/YYYY). Use null for " +
        "blank fields or a '-' placeholder. Never guess a value that isn't on the page.",
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(pdf).toString("base64") } },
            { type: "text", text: "Extract this licence check." },
          ],
        },
      ],
    });

    if (message.stop_reason === "refusal") {
      return Response.json({ error: "The assistant couldn't read this document." }, { status: 422 });
    }
    if (!message.parsed_output) {
      return Response.json({ error: "Couldn't read this licence check. Is it an AssetGo licence check PDF?" }, { status: 422 });
    }
    return Response.json({ licence: message.parsed_output });
  } catch (e) {
    const msg =
      e instanceof Anthropic.APIError ? `The AI service had a problem (${e.status ?? "network"}). Try again.`
      : e instanceof Error ? e.message : String(e);
    return Response.json({ error: msg }, { status: 500 });
  }
}
