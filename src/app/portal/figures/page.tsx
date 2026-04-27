import { redirect } from "next/navigation";
import { isoWeekNum, isoYear } from "@/lib/iso-week";

export default function FiguresIndex() {
  const now = new Date();
  redirect(`/portal/figures/${isoWeekNum(now)}-${isoYear(now)}`);
}
