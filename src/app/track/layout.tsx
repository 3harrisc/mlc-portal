import type { ReactNode } from "react";
import "../portal/portal.css";

export const metadata = {
  title: "MLC Transport — Live tracking",
  description: "Track your shipment in real time",
};

export default function TrackLayout({ children }: { children: ReactNode }) {
  return (
    <div className="portal-shell">
      <div style={{ minHeight: "100vh" }}>{children}</div>
    </div>
  );
}
