import type { ReactNode } from "react";
import { PortalShell } from "@/components/portal/PortalShell";

export default function ReportsLayout({ children }: { children: ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
