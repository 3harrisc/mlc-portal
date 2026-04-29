"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Navigation from "@/components/Navigation";
import { useAuth } from "@/components/AuthProvider";
import { getYtdSummary, type YtdSummary } from "@/app/actions/dashboard";

export default function Home() {
  const { profile, loading } = useAuth();
  const router = useRouter();
  const [ytd, setYtd] = useState<YtdSummary | null>(null);

  useEffect(() => {
    if (loading) return;
    // Drivers go to their own simplified app; everyone else lands on the
    // new customer portal. The old "/" dashboard below still renders for
    // a frame before the redirect kicks in, but that's fine — the portal
    // shell takes over within ~50ms in practice and the user sees the
    // new UI as the first paint.
    if (profile?.role === "driver") {
      router.replace("/driver");
      return;
    }
    router.replace("/portal");
  }, [loading, profile, router]);

  useEffect(() => {
    if (profile?.role !== "admin") return;
    let cancelled = false;
    queueMicrotask(async () => {
      const res = await getYtdSummary();
      if (!cancelled && res.summary) setYtd(res.summary);
    });
    return () => { cancelled = true; };
  }, [profile]);

  const isAdmin = profile?.role === "admin";

  return (
    <div className="min-h-screen bg-black text-white">
      <Navigation />

      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <div className="flex flex-col items-center text-center mb-8">
          <Image
            src="/mlc-logo.jpg"
            alt="MLC Transport Limited"
            width={240}
            height={96}
            className="rounded-xl"
            priority
          />
          <p className="text-lg text-gray-300 mt-4">
            HGV Route Planning, Transport Sheets &amp; Real-Time Tracking
          </p>
        </div>

        {/* YTD strip — admin only */}
        {isAdmin && (
          <div className="mb-10">
            <div className="text-xs uppercase tracking-wide text-zinc-500 mb-2">
              Year to date{ytd ? ` · ${ytd.year}` : ""}
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <YtdCard
                label="Turnover"
                value={ytd ? `£${ytd.ytdTurnover.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}
                tone="emerald"
              />
              <YtdCard
                label="Profit / Loss"
                value={ytd ? `£${ytd.ytdProfitLoss.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}
                tone={ytd && ytd.ytdProfitLoss >= 0 ? "emerald" : "red"}
              />
              <YtdCard
                label="Costs (vehicle + extras)"
                value={
                  ytd
                    ? `£${(ytd.ytdVehicleCosts + ytd.ytdExtras).toLocaleString("en-GB", { maximumFractionDigits: 0 })}`
                    : "—"
                }
                tone="amber"
              />
              <YtdCard
                label="Last invoice #"
                value={ytd?.lastInvoiceNumber ? `INV-${ytd.lastInvoiceNumber}` : "—"}
                sublabel={ytd ? `${ytd.invoiceCount} invoiced this year` : undefined}
                tone="blue"
              />
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {isAdmin && (
            <QuickLink
              href="/portal/planner"
              icon="📒"
              title="Daily Transport Sheet"
              description="The Mon→Sun planner — replaces your spreadsheet's daily tabs."
              color="blue"
            />
          )}
          <QuickLink
            href="/runs"
            icon="🚛"
            title="Runs"
            description="Live run list grouped by vehicle, with drag-drop reordering and progress tracking."
            color="emerald"
          />
          {isAdmin && (
            <QuickLink
              href="/portal/figures"
              icon="📊"
              title="Figures"
              description="Weekly P/L: per-vehicle costs, fuel, tolls, wages, gross earnings."
              color="amber"
            />
          )}
          {isAdmin && (
            <QuickLink
              href="/portal/invoicing"
              icon="🧾"
              title="Invoicing"
              description="Mark legs billable, generate Xero CSV, track sent invoices."
              color="purple"
            />
          )}
          {isAdmin && (
            <QuickLink
              href="/plan-route"
              icon="📍"
              title="Plan Route"
              description="Build new routes with HGV-aware scheduling."
              color="cyan"
            />
          )}
          <QuickLink
            href="/reports"
            icon="📈"
            title="Reports"
            description="Run-level reports and exports."
            color="zinc"
          />
        </div>
      </div>
    </div>
  );
}

function YtdCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: string;
  sublabel?: string;
  tone: "emerald" | "amber" | "red" | "blue";
}) {
  const toneCls: Record<string, string> = {
    emerald: "border-emerald-400/20 bg-emerald-500/5 text-emerald-300",
    amber: "border-amber-400/20 bg-amber-500/5 text-amber-300",
    red: "border-red-400/20 bg-red-500/5 text-red-300",
    blue: "border-blue-400/20 bg-blue-500/5 text-blue-300",
  };
  return (
    <div className={`rounded-xl border p-4 ${toneCls[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-2xl font-semibold mt-1 tabular-nums">{value}</div>
      {sublabel && <div className="text-xs opacity-70 mt-1">{sublabel}</div>}
    </div>
  );
}

function QuickLink({
  href,
  icon,
  title,
  description,
  color,
}: {
  href: string;
  icon: string;
  title: string;
  description: string;
  color: "blue" | "emerald" | "amber" | "purple" | "cyan" | "zinc";
}) {
  const ringCls: Record<string, string> = {
    blue: "hover:border-blue-400/40 hover:bg-blue-500/5",
    emerald: "hover:border-emerald-400/40 hover:bg-emerald-500/5",
    amber: "hover:border-amber-400/40 hover:bg-amber-500/5",
    purple: "hover:border-purple-400/40 hover:bg-purple-500/5",
    cyan: "hover:border-cyan-400/40 hover:bg-cyan-500/5",
    zinc: "hover:border-zinc-400/40 hover:bg-zinc-500/5",
  };
  return (
    <Link
      href={href}
      className={`group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 transition-all ${ringCls[color]}`}
    >
      <div className="text-3xl mb-3">{icon}</div>
      <h2 className="text-xl font-semibold mb-2">{title}</h2>
      <p className="text-gray-400 text-sm">{description}</p>
    </Link>
  );
}
