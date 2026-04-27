/**
 * Build the Xero invoice CSV.
 *
 * Ported from `XeroExport_FinalLogic.bas#Export_Invoicing_Sheet` — minus the
 * Excel-specific bits (sheet renaming, message boxes, file-system writes).
 * This module is pure: in → grouped runs and a config; out → a CSV string and
 * a list of (runId → invoiceNumber) assignments.
 *
 * Two layouts are supported, controlled by `config.layout`:
 *   - 'lite'     : 10 columns. Quick / minimal Xero import.
 *   - 'template' : 29 columns. Matches Xero's full invoice template — what
 *                  the spreadsheet uses by default.
 *
 * Pure, side-effect-free, fully tested in `build-csv.test.ts`.
 */

import type {
  InvoiceGroup,
  XeroExportConfig,
  CustomerXeroMap,
} from "@/types/invoicing";
import { resolveCustomer } from "./resolve-customer";
import { calculateDueDate, toXeroDate } from "./due-date";
import { csvQuote, formatCsvAmount, sanitizeForCsv } from "./sanitize";
import { isoWeekReference } from "@/lib/iso-week";

const LITE_HEADER =
  "ContactName,InvoiceNumber,Reference,InvoiceDate,DueDate,Description,Quantity,UnitAmount,AccountCode,TaxType";

const TEMPLATE_HEADER =
  "ContactName,EmailAddress,POAddressLine1,POAddressLine2,POAddressLine3,POAddressLine4,POCity,PORegion,POPostalCode,POCountry," +
  "InvoiceNumber,Reference,InvoiceDate,DueDate,Total,InventoryItemCode,Description,Quantity,UnitAmount,Discount,AccountCode,TaxType," +
  "TrackingName1,TrackingOption1,TrackingName2,TrackingOption2,Currency,BrandingTheme,Status";

export interface BuildCsvInput {
  groups: ReadonlyArray<InvoiceGroup>;
  customerMap: ReadonlyArray<CustomerXeroMap>;
  /** First invoice number to assign (e.g. 99450). Each group consumes one. */
  startInvoiceNumber: number;
  config: XeroExportConfig;
}

export interface InvoiceAssignment {
  /** The group this assignment refers to. */
  groupKey: string;
  /** Final invoice number, e.g. 'INV-99450'. */
  invoiceNumber: string;
  /** All `runs.id` values that belong to this invoice. */
  runIds: ReadonlyArray<string>;
  customer: string;
  xeroContactName: string;
  invoiceDate: string;   // yyyy-MM-dd
  dueDate: string;       // yyyy-MM-dd
  totalAmount: number;
}

export interface BuildCsvResult {
  csv: string;
  assignments: ReadonlyArray<InvoiceAssignment>;
}

/**
 * Build the Xero invoice CSV.
 *
 * Caller is responsible for atomically reserving `groups.length` invoice
 * numbers from the database BEFORE calling this function, and passing the
 * starting number in `startInvoiceNumber`. Numbers are assigned in
 * ascending order of the `groups` array.
 */
export function buildXeroCsv(input: BuildCsvInput): BuildCsvResult {
  const { groups, customerMap, startInvoiceNumber, config } = input;

  if (groups.length === 0) {
    return { csv: headerLine(config) + "\n", assignments: [] };
  }

  const lines: string[] = [headerLine(config)];
  const assignments: InvoiceAssignment[] = [];

  let nextNum = startInvoiceNumber;
  for (const group of groups) {
    const resolved = resolveCustomer(group.customer, customerMap);
    const invoiceNumber = config.invoicePrefix + nextNum;
    const accountCode = resolved.entry.accountCode || config.defaultAccountCode;
    const taxType = resolved.entry.taxType || config.defaultTaxType;
    const dueDate = calculateDueDate(group.invoiceDate, resolved.entry.dueDays);
    const groupReference = isoWeekReference(group.isoYear, group.isoWeek);

    let total = 0;
    const runIds: string[] = [];

    for (const line of group.lines) {
      runIds.push(line.id);
      total += line.amount;
      const lineRef =
        line.loadRef && line.loadRef.trim().length > 0 && line.loadRef !== "0"
          ? line.loadRef
          : groupReference;
      const desc = buildPrefixedDescription(line.description, line.date);
      lines.push(
        renderRow({
          layout: config.layout,
          contactName: resolved.xeroContactName,
          email: resolved.entry.emailAddress ?? "",
          invoiceNumber,
          reference: lineRef,
          invoiceDate: group.invoiceDate,
          dueDate: toXeroDateISO(dueDate),
          description: desc,
          unitAmount: line.amount,
          accountCode,
          taxType,
          brandingTheme: resolved.entry.brandingTheme ?? "",
        })
      );
    }

    assignments.push({
      groupKey: group.key,
      invoiceNumber,
      runIds,
      customer: group.customer,
      xeroContactName: resolved.xeroContactName,
      invoiceDate: group.invoiceDate,
      dueDate: toXeroDateISO(dueDate),
      totalAmount: total,
    });

    nextNum++;
  }

  // Trailing newline so consumers can `tail -n +2 | wc -l` cleanly.
  return { csv: lines.join("\n") + "\n", assignments };
}

function headerLine(config: XeroExportConfig): string {
  return config.layout === "template" ? TEMPLATE_HEADER : LITE_HEADER;
}

interface RenderRowInput {
  layout: "lite" | "template";
  contactName: string;
  email: string;
  invoiceNumber: string;
  reference: string;
  invoiceDate: string;     // yyyy-MM-dd
  dueDate: string;         // yyyy-MM-dd
  description: string;
  unitAmount: number;
  accountCode: string;
  taxType: string;
  brandingTheme: string;
}

function renderRow(r: RenderRowInput): string {
  const invDate = toXeroDate(r.invoiceDate);
  const dueDate = toXeroDate(r.dueDate);
  const amount = formatCsvAmount(r.unitAmount);

  if (r.layout === "lite") {
    return [
      csvQuote(r.contactName),
      csvQuote(r.invoiceNumber),
      csvQuote(r.reference),
      invDate,
      dueDate,
      csvQuote(r.description),
      "1",
      amount,
      sanitizeForCsv(r.accountCode),
      sanitizeForCsv(r.taxType),
    ].join(",");
  }

  // Template — 29 cols.
  return [
    csvQuote(r.contactName),
    csvQuote(r.email),     // EmailAddress
    "",                    // POAddressLine1
    "",                    // POAddressLine2
    "",                    // POAddressLine3
    "",                    // POAddressLine4
    "",                    // POCity
    "",                    // PORegion
    "",                    // POPostalCode
    "",                    // POCountry
    csvQuote(r.invoiceNumber),
    csvQuote(r.reference),
    invDate,
    dueDate,
    "",                    // Total — Xero computes it
    "",                    // InventoryItemCode
    csvQuote(r.description),
    "1",                   // Quantity
    amount,
    "",                    // Discount
    sanitizeForCsv(r.accountCode),
    sanitizeForCsv(r.taxType),
    "",                    // TrackingName1
    "",                    // TrackingOption1
    "",                    // TrackingName2
    "",                    // TrackingOption2
    "GBP",                 // Currency
    csvQuote(r.brandingTheme),
    "",                    // Status — leave blank to import as Draft
  ].join(",");
}

/**
 * Description prefix: 'dd/MM/yyyy - <baseDescription>'. Matches the legacy
 * VBA `BuildPrefixedDesc`. If the base description is empty, drop the
 * trailing ' - '.
 */
export function buildPrefixedDescription(
  baseDescription: string,
  isoDate: string
): string {
  const dateStr = toXeroDate(isoDate);
  const base = (baseDescription ?? "").trim();
  return base.length === 0 ? dateStr : `${dateStr} - ${base}`;
}

/** Convert a Date back to yyyy-MM-dd for round-tripping. */
function toXeroDateISO(d: Date): string {
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
