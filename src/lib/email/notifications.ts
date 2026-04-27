import { Resend } from "resend";

interface NotificationInput {
  to: string[];
  subject: string;
  html: string;
  text?: string;
  /** Tag for Resend dashboard filtering */
  tag?: string;
}

interface NotificationResult {
  sent: boolean;
  skipped?: "no-key" | "no-recipients";
  error?: string;
  id?: string;
}

let _client: Resend | null = null;

function getClient(): Resend | null {
  if (_client) return _client;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  _client = new Resend(key);
  return _client;
}

function fromAddress(): string {
  return (
    process.env.MLC_NOTIFICATIONS_FROM ?? "MLC Transport <dispatch@mlctransport.app>"
  );
}

/**
 * Send a transactional notification email via Resend.
 * Skips silently (with a console log) if RESEND_API_KEY isn't set, so the
 * build/dev flow keeps working without it.
 */
export async function sendNotification(
  input: NotificationInput,
): Promise<NotificationResult> {
  const client = getClient();
  if (!client) {
    console.warn("[notifications] RESEND_API_KEY not set — skipping send", {
      to: input.to,
      subject: input.subject,
    });
    return { sent: false, skipped: "no-key" };
  }
  const recipients = input.to.map((e) => e.trim()).filter(Boolean);
  if (recipients.length === 0) {
    return { sent: false, skipped: "no-recipients" };
  }
  try {
    const { data, error } = await client.emails.send({
      from: fromAddress(),
      to: recipients,
      subject: input.subject,
      html: input.html,
      text: input.text,
      tags: input.tag ? [{ name: "type", value: input.tag }] : undefined,
    });
    if (error) {
      console.error("[notifications] Resend error", error);
      return { sent: false, error: error.message };
    }
    return { sent: true, id: data?.id };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[notifications] send failed", message);
    return { sent: false, error: message };
  }
}
