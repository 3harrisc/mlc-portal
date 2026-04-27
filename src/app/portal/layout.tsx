import type { ReactNode } from "react";
import { PortalDataProvider } from "@/components/portal/PortalDataContext";
import { PortalSearchProvider } from "@/components/portal/PortalSearchContext";
import { ToastProvider } from "@/components/portal/ToastContext";
import Sidebar from "@/components/portal/Sidebar";
import Topbar from "@/components/portal/Topbar";
import "./portal.css";

export default function PortalLayout({ children }: { children: ReactNode }) {
  return (
    <PortalDataProvider>
      <PortalSearchProvider>
        <ToastProvider>
          <div className="portal-shell">
            <div className="app">
              <Sidebar />
              <main className="main">
                <Topbar />
                <div className="page">{children}</div>
              </main>
            </div>
          </div>
        </ToastProvider>
      </PortalSearchProvider>
    </PortalDataProvider>
  );
}
