import { redirect } from "next/navigation";

/** /portal/planner → today's transport sheet. */
export default function PlannerIndex() {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  redirect(`/portal/planner/${yyyy}-${mm}-${dd}`);
}
