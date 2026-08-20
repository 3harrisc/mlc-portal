import type { CSSProperties } from "react";
import { STATUS_LABEL, type LoadStatus } from "@/lib/portal/status";

// Re-exported so the many existing `from "@/components/portal/StatusPill"`
// import sites keep working now that the enum lives in lib/.
export { STATUS_LABEL };
export type { LoadStatus };

interface StatusPillProps {
  status: LoadStatus;
  size?: "sm" | "md";
}

export default function StatusPill({ status, size = "md" }: StatusPillProps) {
  const style: CSSProperties | undefined =
    size === "sm" ? { fontSize: 10, padding: "1px 6px" } : undefined;
  return (
    <span className={`pill ${status}`} style={style}>
      <span className="dot" />
      {STATUS_LABEL[status]}
    </span>
  );
}
