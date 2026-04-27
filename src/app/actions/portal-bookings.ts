"use server";

import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { ensureCustomer } from "@/lib/customer-contacts";
import { sendNotification } from "@/lib/email/notifications";
import { bookingReceivedEmail } from "@/lib/email/templates";

export interface PortalBookingInput {
  customer: string;
  service: string;
  customerRef: string;
  pickupPostcode: string;
  pickupSiteName: string;
  pickupDate: string; // YYYY-MM-DD
  pickupTime: string; // HH:MM
  deliveryPostcode: string;
  deliverySiteName: string;
  deliveryDate: string; // YYYY-MM-DD
  deliveryTime: string; // HH:MM
  pallets: number;
  weightTonnes: number;
  notes: string;
}

export interface PortalBookingResult {
  success?: true;
  bookingId?: string;
  error?: string;
}

const REQUIRED_FIELDS: Array<keyof PortalBookingInput> = [
  "customer",
  "pickupPostcode",
  "deliveryPostcode",
  "pickupDate",
];

/**
 * Insert a customer-portal booking into the `loads` table with no vehicle
 * assigned. The booking is tagged in `raw_text` so the operator can see at a
 * glance it came from the portal. The dispatch planner (`runs`) is left
 * untouched — once dispatch confirms a load, they create a corresponding
 * planner row themselves.
 */
export async function createPortalBooking(
  input: PortalBookingInput,
): Promise<PortalBookingResult> {
  for (const f of REQUIRED_FIELDS) {
    if (!String(input[f] ?? "").trim()) {
      return { error: `Missing required field: ${f}` };
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Not authenticated" };

  const id = `portal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const loadRef = input.customerRef.trim() || `PORTAL-${id.slice(-6).toUpperCase()}`;

  const rawText = [
    `# Portal booking — submitted ${new Date().toISOString()}`,
    `# Service: ${input.service || "unspecified"}`,
    `# Pallets: ${input.pallets} · Weight: ${input.weightTonnes.toFixed(1)} t`,
    input.notes ? `# Notes: ${input.notes}` : "",
    "",
    `${input.pickupPostcode.toUpperCase()} ${input.pickupSiteName} ${input.pickupTime}`.trim(),
    `${input.deliveryPostcode.toUpperCase()} ${input.deliverySiteName} ${input.deliveryTime}`.trim(),
  ]
    .filter(Boolean)
    .join("\n");

  const row = {
    id,
    job_number: "",
    load_ref: loadRef,
    date: input.pickupDate,
    customer: input.customer,
    vehicle: "",
    from_postcode: input.pickupPostcode.toUpperCase(),
    to_postcode: input.deliveryPostcode.toUpperCase(),
    return_to_base: true,
    start_time: input.pickupTime || "08:00",
    service_mins: 25,
    include_breaks: true,
    raw_text: rawText,
    completed_stop_indexes: [],
    completed_meta: {},
    progress: {
      completedIdx: [],
      onSiteIdx: null,
      onSiteSinceMs: null,
      lastInside: false,
    },
    created_by: user.id,
    run_type: "regular",
    run_order: null,
    collection_time: input.pickupTime || null,
    collection_date: input.pickupDate || null,
  };

  const { error } = await supabase.from("loads").insert(row);
  if (error) return { error: error.message };

  // Side-effects: customer profile + confirmation email. We never fail the
  // booking on these — they're best-effort and logged on error.
  void afterBookingCreated({
    customer: input.customer,
    bookingId: id,
    loadRef,
    pickupPostcode: row.from_postcode,
    pickupDate: input.pickupDate,
    pickupTime: input.pickupTime,
    deliveryPostcode: row.to_postcode,
    pallets: Number(input.pallets) || 0,
    weightTonnes: Number(input.weightTonnes) || 0,
    submitterEmail: user.email ?? "",
    submitterName: (user.user_metadata?.full_name as string | undefined) ?? null,
  });

  return { success: true, bookingId: id };
}

interface AfterBookingArgs {
  customer: string;
  bookingId: string;
  loadRef: string;
  pickupPostcode: string;
  pickupDate: string;
  pickupTime: string;
  deliveryPostcode: string;
  pallets: number;
  weightTonnes: number;
  submitterEmail: string;
  submitterName: string | null;
}

async function afterBookingCreated(args: AfterBookingArgs): Promise<void> {
  try {
    const admin = getSupabaseAdmin();
    const customer = await ensureCustomer(admin, args.customer, {
      contactEmail: args.submitterEmail,
      contactName: args.submitterName ?? undefined,
      basePostcode: args.pickupPostcode,
    });

    const recipients = new Set<string>();
    if (args.submitterEmail) recipients.add(args.submitterEmail.toLowerCase());
    for (const e of customer?.notification_emails ?? []) {
      if (e) recipients.add(e.toLowerCase());
    }
    if (recipients.size === 0) return;

    const baseUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
    const internalUrl = baseUrl ? `${baseUrl}/portal/loads/${args.bookingId}` : undefined;

    const { subject, html, text } = bookingReceivedEmail({
      customer: args.customer,
      contactName: customer?.primary_contact_name ?? args.submitterName,
      loadRef: args.loadRef,
      pickupPostcode: args.pickupPostcode,
      pickupDate: args.pickupDate,
      pickupTime: args.pickupTime,
      deliveryPostcode: args.deliveryPostcode,
      pallets: args.pallets,
      weightTonnes: args.weightTonnes,
      shareUrl: internalUrl,
    });
    await sendNotification({
      to: Array.from(recipients),
      subject,
      html,
      text,
      tag: "booking-received",
    });
  } catch (err: unknown) {
    console.error("[portal-bookings] afterBookingCreated failed", err);
  }
}
