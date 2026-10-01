/**
 * A driver's onboarding / compliance checklist, built from their record,
 * files held and documents to sign. Pure, so the driver page and the
 * dashboard to-do list (Stage 3) show the same thing.
 */
import { awaitingCountersign } from "./status";
import type { DriverDocumentView } from "@/types/hr";
import type { DriverFile, DriverRecord } from "@/types/hr-drivers";

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** What to do next when not done. */
  hint?: string;
}

export function driverChecklist(
  driver: DriverRecord,
  files: Pick<DriverFile, "kind">[],
  views: DriverDocumentView[],
): ChecklistItem[] {
  const has = (kind: DriverFile["kind"]) => files.some((f) => f.kind === kind);
  const items: ChecklistItem[] = [
    { key: "login", label: "Portal login linked", done: !!driver.profileId, hint: "Create their login under Admin users, then link it under Employment" },
    { key: "start", label: "Start date set", done: !!driver.startDate, hint: "Add it under Employment" },
    { key: "ni", label: "National Insurance number recorded", done: !!driver.niNumber, hint: "Add it under Personal" },
    {
      key: "contacts",
      label: "Phone and emergency contact recorded",
      done: !!driver.phone && !!driver.emergencyContactName && !!driver.emergencyContactPhone,
      hint: "Add them under Personal",
    },
    { key: "licence", label: "AssetGo licence check on file", done: has("licence_check") && !!driver.licence, hint: "Drop their AssetGo check into the Licence box" },
    { key: "rtw", label: "Right-to-work evidence on file", done: has("right_to_work"), hint: "Upload it under Files held" },
  ];

  const contract = views.find((v) => v.document.collectsParticulars);
  if (!contract) {
    items.push({ key: "contract", label: "Contract sent", done: false, hint: "Use Send starter pack" });
  } else {
    const signed = contract.status === "signed" || contract.status === "due_soon";
    items.push({ key: "contract", label: "Contract signed by driver", done: signed, hint: "Waiting for the driver to sign" });
    if (contract.document.requiresCountersign) {
      items.push({
        key: "countersign",
        label: "Contract countersigned by MLC",
        done: signed && !awaitingCountersign(contract.document, contract.lastSignature),
        hint: "Countersign it on HR documents",
      });
    }
  }

  for (const v of views) {
    if (v.document.collectsParticulars) continue;
    items.push({
      key: `doc:${v.document.id}`,
      label: `${v.document.title} signed`,
      done: v.status === "signed" || v.status === "due_soon",
      hint: v.status === "expired" ? "Re-sign due" : "Waiting for the driver to sign",
    });
  }
  return items;
}
