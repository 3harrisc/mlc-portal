interface BookingReceivedInput {
  customer: string;
  contactName?: string | null;
  loadRef: string;
  pickupPostcode: string;
  pickupDate: string; // YYYY-MM-DD
  pickupTime: string;
  deliveryPostcode: string;
  pallets: number;
  weightTonnes: number;
  shareUrl?: string;
}

interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const BRAND_BG = "#0B2A6B";
const ACCENT = "#D81E2A";

function shellHtml(title: string, bodyHtml: string, footerHtml = ""): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#F6F7F9;font-family:Inter,Helvetica,Arial,sans-serif;color:#0E1320;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;background:#fff;border-radius:10px;border:1px solid #E7E9EE;overflow:hidden;">
        <tr><td style="background:${BRAND_BG};padding:18px 24px;color:#fff;">
          <div style="font-size:13px;font-weight:700;letter-spacing:0.04em;">MLC TRANSPORT</div>
          <div style="font-size:11px;opacity:0.7;margin-top:2px;">${escapeHtml(title)}</div>
        </td></tr>
        <tr><td style="padding:24px;font-size:14px;line-height:1.5;">${bodyHtml}</td></tr>
        <tr><td style="padding:14px 24px;background:#FAFBFC;border-top:1px solid #E7E9EE;font-size:11px;color:#5C6478;">
          ${footerHtml || "MLC Transport · Cheltenham, UK"}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function kvRow(k: string, v: string): string {
  return `<tr>
    <td style="padding:6px 12px 6px 0;color:#5C6478;font-size:12px;">${escapeHtml(k)}</td>
    <td style="padding:6px 0;font-size:13px;">${escapeHtml(v)}</td>
  </tr>`;
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function bookingReceivedEmail(input: BookingReceivedInput): RenderedEmail {
  const greeting = input.contactName
    ? `Hi ${input.contactName.split(" ")[0]},`
    : "Hi,";
  const body = `
    <p style="margin:0 0 12px 0;">${escapeHtml(greeting)}</p>
    <p style="margin:0 0 16px 0;">
      We've received a new booking from <strong>${escapeHtml(input.customer)}</strong>.
      Dispatch will confirm a vehicle and ETA within the hour.
    </p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border-collapse:collapse;">
      ${kvRow("Reference", input.loadRef || "—")}
      ${kvRow("Collection", `${input.pickupPostcode} on ${input.pickupDate} at ${input.pickupTime}`)}
      ${kvRow("Delivery", input.deliveryPostcode || "—")}
      ${kvRow("Goods", `${input.pallets} pallet${input.pallets === 1 ? "" : "s"} · ${input.weightTonnes.toFixed(1)} t`)}
    </table>
    ${
      input.shareUrl
        ? `<p style="margin:16px 0;">
        <a href="${escapeHtml(input.shareUrl)}"
           style="display:inline-block;background:${ACCENT};color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;font-weight:600;font-size:13px;">
          Track this load →
        </a>
      </p>`
        : ""
    }
    <p style="margin:16px 0 0 0;font-size:12px;color:#5C6478;">
      Reply to this email if anything looks wrong, or call dispatch on
      <a href="tel:01452739001" style="color:${BRAND_BG};">01452 739 001</a>.
    </p>
  `;
  const text = [
    greeting,
    "",
    `We've received a new booking from ${input.customer}.`,
    `Reference: ${input.loadRef || "—"}`,
    `Collection: ${input.pickupPostcode} on ${input.pickupDate} at ${input.pickupTime}`,
    `Delivery: ${input.deliveryPostcode || "—"}`,
    `Goods: ${input.pallets} pallets, ${input.weightTonnes.toFixed(1)} t`,
    input.shareUrl ? `\nTrack this load: ${input.shareUrl}` : "",
    "",
    "Reply to this email if anything looks wrong, or call dispatch on 01452 739 001.",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    subject: `Booking received · ${input.loadRef || input.customer}`,
    html: shellHtml("Booking received", body),
    text,
  };
}
