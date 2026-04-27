import { redirect } from "next/navigation";
import { isoWeekNum, isoYear } from "@/lib/iso-week";

/**
 * `/portal/invoicing` → redirects to the current ISO week.
 */
export default function InvoicingIndexPage() {
  const now = new Date();
  const year = isoYear(now);
  const week = isoWeekNum(now);
  redirect(`/portal/invoicing/${week}-${year}`);
}
