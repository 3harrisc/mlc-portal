import type { LicenceCheck } from "@/lib/hr/licence";

export type DriverStatus = "starter" | "active" | "left";
export type DriverFileKind = "licence_check" | "right_to_work" | "cpc_card" | "tacho_card" | "other";

export const DRIVER_FILE_KINDS: { value: DriverFileKind; label: string }[] = [
  { value: "licence_check", label: "AssetGo licence check" },
  { value: "right_to_work", label: "Right-to-work evidence" },
  { value: "cpc_card", label: "Driver CPC / DQC card" },
  { value: "tacho_card", label: "Tachograph card" },
  { value: "other", label: "Other" },
];

export interface DriverRecord {
  id: string;
  profileId: string | null;
  status: DriverStatus;
  firstNames: string;
  surname: string;
  dateOfBirth: string | null;
  address: string | null;
  postcode: string | null;
  phone: string | null;
  email: string | null;
  niNumber: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  startDate: string | null;
  continuousEmploymentDate: string | null;
  leaveDate: string | null;
  notes: string | null;
  licence: LicenceCheck | null;
  licenceCheckedOn: string | null;
}

export interface DriverFile {
  id: string;
  driverId: string;
  kind: DriverFileKind;
  title: string;
  uploadedAt: string;
}

/** Editable fields, as sent from the driver form. */
export type DriverInput = Omit<DriverRecord, "id" | "licence" | "licenceCheckedOn">;

/* eslint-disable @typescript-eslint/no-explicit-any */
export function rowToDriver(r: any): DriverRecord {
  return {
    id: r.id,
    profileId: r.profile_id ?? null,
    status: r.status,
    firstNames: r.first_names,
    surname: r.surname,
    dateOfBirth: r.date_of_birth ?? null,
    address: r.address ?? null,
    postcode: r.postcode ?? null,
    phone: r.phone ?? null,
    email: r.email ?? null,
    niNumber: r.ni_number ?? null,
    emergencyContactName: r.emergency_contact_name ?? null,
    emergencyContactPhone: r.emergency_contact_phone ?? null,
    startDate: r.start_date ?? null,
    continuousEmploymentDate: r.continuous_employment_date ?? null,
    leaveDate: r.leave_date ?? null,
    notes: r.notes ?? null,
    licence: r.licence ?? null,
    licenceCheckedOn: r.licence_checked_on ?? null,
  };
}

export function rowToDriverFile(r: any): DriverFile {
  return { id: r.id, driverId: r.driver_id, kind: r.kind, title: r.title, uploadedAt: r.uploaded_at };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export function driverName(d: Pick<DriverRecord, "firstNames" | "surname">): string {
  return `${d.firstNames} ${d.surname}`.trim();
}
