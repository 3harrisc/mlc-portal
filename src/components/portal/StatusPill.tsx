import type { CSSProperties } from "react";

export type LoadStatus =
  | "in-transit"
  | "delivered"
  | "scheduled"
  | "exception"
  | "delayed"
  | "loading";

export const STATUS_LABEL: Record<LoadStatus, string> = {
  "in-transit": "In transit",
  delivered: "Delivered",
  scheduled: "Scheduled",
  exception: "Exception",
  delayed: "Delayed",
  loading: "Loading",
};

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
