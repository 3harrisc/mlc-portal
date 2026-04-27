import { redirect } from "next/navigation";
import { isoWeekNum, isoYear } from "@/lib/iso-week";

/** /portal/planner/week → current ISO week. */
export default function PlannerWeekIndex() {
  const now = new Date();
  redirect(`/portal/planner/week/${isoWeekNum(now)}-${isoYear(now)}`);
}
