import type { SupabaseClient } from "@supabase/supabase-js";

export interface CustomerContactRow {
  id: string;
  name: string;
  base_postcode: string;
  open_time: string;
  close_time: string;
  notification_emails: string[];
  primary_contact_name: string | null;
  auto_created: boolean;
}

interface EnsureCustomerDefaults {
  /** Email to seed notification_emails with on first sight. */
  contactEmail?: string;
  /** Display name of the contact person (e.g. the booking submitter). */
  contactName?: string;
  /** Base postcode if we can guess one — used only on first creation. */
  basePostcode?: string;
}

const DEFAULT_OPEN = "08:00";
const DEFAULT_CLOSE = "17:00";
const DEFAULT_BASE = "GL2 7ND";

/**
 * Idempotently ensure a customers row exists for the given name. On first
 * sight we create it with `auto_created=true` and seed notification_emails
 * with whoever triggered the touch (booking submitter / inbound email sender).
 *
 * Existing rows are NEVER overwritten — admin-managed records stay intact.
 * Pass an admin-scoped Supabase client (service-role key); the regular RLS
 * client typically can't read customers it doesn't own.
 *
 * Returns the existing or newly-created row.
 */
export async function ensureCustomer(
  supabase: SupabaseClient,
  name: string,
  defaults: EnsureCustomerDefaults = {},
): Promise<CustomerContactRow | null> {
  const cleanName = name.trim();
  if (!cleanName) return null;

  const { data: existing } = await supabase
    .from("customers")
    .select(
      "id, name, base_postcode, open_time, close_time, notification_emails, primary_contact_name, auto_created",
    )
    .ilike("name", cleanName)
    .maybeSingle();
  if (existing) return existing as CustomerContactRow;

  const seedEmails = defaults.contactEmail
    ? [defaults.contactEmail.trim().toLowerCase()]
    : [];

  const { data: inserted } = await supabase
    .from("customers")
    .insert({
      name: cleanName,
      base_postcode: defaults.basePostcode ?? DEFAULT_BASE,
      open_time: DEFAULT_OPEN,
      close_time: DEFAULT_CLOSE,
      notification_emails: seedEmails,
      primary_contact_name: defaults.contactName ?? null,
      auto_created: true,
    })
    .select(
      "id, name, base_postcode, open_time, close_time, notification_emails, primary_contact_name, auto_created",
    )
    .single();

  return (inserted as CustomerContactRow | null) ?? null;
}

/** Fetch a customer's contact info — null if no row exists. */
export async function getCustomerContacts(
  supabase: SupabaseClient,
  name: string,
): Promise<CustomerContactRow | null> {
  const cleanName = name.trim();
  if (!cleanName) return null;
  const { data } = await supabase
    .from("customers")
    .select(
      "id, name, base_postcode, open_time, close_time, notification_emails, primary_contact_name, auto_created",
    )
    .ilike("name", cleanName)
    .maybeSingle();
  return (data as CustomerContactRow | null) ?? null;
}
