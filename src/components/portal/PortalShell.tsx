import type { ReactNode } from "react";
import { PortalDataProvider } from "@/components/portal/PortalDataContext";
import { PortalSearchProvider } from "@/components/portal/PortalSearchContext";
import { ToastProvider } from "@/components/portal/ToastContext";
import Sidebar from "@/components/portal/Sidebar";
import Topbar from "@/components/portal/Topbar";
import "@/app/portal/portal.css";

/**
 * Shared shell used by every authenticated section of the app — portal,
 * admin, dispatch (runs / plan-route / reports / templates).
 *
 * Provides:
 *  - The portal-shell light theme (scopes the portal.css rules)
 *  - PortalData / PortalSearch / Toast providers
 *  - Sidebar + Topbar chrome
 *
 * Layouts that need the shell just import + render this component:
 *
 *   import { PortalShell } from '@/components/portal/PortalShell';
 *   export default function MyLayout({ children }) {
 *     return <PortalShell>{children}</PortalShell>;
 *   }
 */
export function PortalShell({ children }: { children: ReactNode }) {
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
