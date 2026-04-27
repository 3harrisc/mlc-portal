"use server";

import { createClient } from "@/lib/supabase/server";

export interface YtdSummary {
  year: number;
  ytdTurnover: number;
  ytdVehicleCosts: number;
  ytdExtras: number;
  ytdProfitLoss: number;
  lastInvoiceNumber: number | null;
  invoiceCount: number;
}

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase };
}

/**
 * Year-to-date totals for the home dashboard.
 *
 * - Turnover = SUM(runs.revenue) for runs in the current calendar year.
 * - VehicleCosts = SUM of every cost column on weekly_vehicle_costs for ISO
 *   weeks that fall in the current year.
 * - Extras = SUM(office + vans + bbl + subby_cost) + SUM(driver_wages.*).
 * - ProfitLoss = Turnover − VehicleCosts − Extras.
 * - LastInvoiceNumber = current invoice_counter value (next reserved is +1).
 */
export async function getYtdSummary(): Promise<{ summary?: YtdSummary; error?: string }> {
  const { supabase } = await getUser();
  const year = new Date().getUTCFullYear();
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const [runsRes, costsRes, extrasRes, counterRes, invoiceCountRes] = await Promise.all([
    supabase.from("runs").select("revenue").gte("date", start).lte("date", end),
    supabase
      .from("weekly_vehicle_costs")
      .select("running_cost,fuel_uk_amount,fuel_lux_amount,tolls_gbp,parking,adblue,other_cost")
      .eq("iso_year", year),
    supabase
      .from("weekly_extras")
      .select("office,vans,bbl,subby_cost,driver_wages")
      .eq("iso_year", year),
    supabase.from("invoice_counter").select("counter").eq("id", "xero").maybeSingle(),
    supabase.from("runs").select("id", { count: "exact", head: true }).eq("invoice_status", "sent").gte("date", start).lte("date", end),
  ]);

  const firstError = runsRes.error || costsRes.error || extrasRes.error || counterRes.error || invoiceCountRes.error;
  if (firstError) return { error: firstError.message };

  const ytdTurnover = (runsRes.data ?? []).reduce(
    (s: number, r: { revenue?: number | null }) => s + Number(r.revenue ?? 0),
    0
  );

  const ytdVehicleCosts = (costsRes.data ?? []).reduce(
    (
      s: number,
      r: {
        running_cost?: number | null;
        fuel_uk_amount?: number | null;
        fuel_lux_amount?: number | null;
        tolls_gbp?: number | null;
        parking?: number | null;
        adblue?: number | null;
        other_cost?: number | null;
      }
    ) =>
      s +
      Number(r.running_cost ?? 0) +
      Number(r.fuel_uk_amount ?? 0) +
      Number(r.fuel_lux_amount ?? 0) +
      Number(r.tolls_gbp ?? 0) +
      Number(r.parking ?? 0) +
      Number(r.adblue ?? 0) +
      Number(r.other_cost ?? 0),
    0
  );

  const ytdExtras = (extrasRes.data ?? []).reduce(
    (
      s: number,
      r: {
        office?: number | null;
        vans?: number | null;
        bbl?: number | null;
        subby_cost?: number | null;
        driver_wages?: Record<string, number> | null;
      }
    ) => {
      const wages = r.driver_wages ?? {};
      let wageSum = 0;
      for (const v of Object.values(wages)) {
        if (typeof v === "number" && Number.isFinite(v)) wageSum += v;
      }
      return s + Number(r.office ?? 0) + Number(r.vans ?? 0) + Number(r.bbl ?? 0) + Number(r.subby_cost ?? 0) + wageSum;
    },
    0
  );

  return {
    summary: {
      year,
      ytdTurnover,
      ytdVehicleCosts,
      ytdExtras,
      ytdProfitLoss: ytdTurnover - ytdVehicleCosts - ytdExtras,
      lastInvoiceNumber: counterRes.data?.counter ?? null,
      invoiceCount: invoiceCountRes.count ?? 0,
    },
  };
}
