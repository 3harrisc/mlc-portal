/** Server-side tidy-up and validation for driver record input. */
import type { DriverInput } from "@/types/hr-drivers";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const NI = /^[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z]\d{6}[A-D]$/;

function opt(v: unknown, max = 200): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s ? s.slice(0, max) : null;
}

function optDate(v: unknown, label: string): string | null {
  const s = opt(v);
  if (!s) return null;
  if (!ISO.test(s)) throw new Error(`${label} must be a valid date.`);
  return s;
}

/** Returns DB column values; throws a readable message on bad input. */
export function cleanDriverInput(input: Partial<DriverInput>) {
  const first = opt(input.firstNames, 100);
  const surname = opt(input.surname, 100);
  if (!first || !surname) throw new Error("First names and surname are required.");
  const status = input.status ?? "starter";
  if (!["starter", "active", "left"].includes(status)) throw new Error("Unknown status.");

  const ni = opt(input.niNumber)?.toUpperCase().replace(/\s/g, "") ?? null;
  if (ni && !NI.test(ni)) throw new Error("National Insurance number doesn't look right (e.g. AB123456C).");
  const email = opt(input.email, 200);
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Email address doesn't look right.");

  const start = optDate(input.startDate, "Start date");
  const continuous = optDate(input.continuousEmploymentDate, "Continuous employment date");
  if (start && continuous && continuous > start) throw new Error("Continuous employment date can't be after the start date.");

  return {
    profile_id: input.profileId || null,
    status,
    first_names: first,
    surname,
    date_of_birth: optDate(input.dateOfBirth, "Date of birth"),
    address: opt(input.address, 300),
    postcode: opt(input.postcode, 12)?.toUpperCase() ?? null,
    phone: opt(input.phone, 40),
    email,
    ni_number: ni,
    emergency_contact_name: opt(input.emergencyContactName, 120),
    emergency_contact_phone: opt(input.emergencyContactPhone, 40),
    start_date: start,
    continuous_employment_date: continuous,
    leave_date: optDate(input.leaveDate, "Leave date"),
    notes: opt(input.notes, 2000),
  };
}
