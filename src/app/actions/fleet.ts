"use server";

import { createClient } from "@/lib/supabase/server";
import {
  rowToDepot,
  rowToTrailer,
  rowToVehicle,
  type Depot,
  type Trailer,
  type Vehicle,
} from "@/types/invoicing";

async function getUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  return { supabase, user };
}

async function requireAdmin() {
  const { supabase, user } = await getUser();
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (profile?.role !== "admin") throw new Error("Admin role required");
  return { supabase, user };
}

// ────────────────────────────────────────────────────────────────────────────
// Trailers
// ────────────────────────────────────────────────────────────────────────────

export async function listTrailers(): Promise<{ trailers?: Trailer[]; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("trailers")
    .select("*")
    .order("id", { ascending: true });
  if (error) return { error: error.message };
  return { trailers: (data ?? []).map(rowToTrailer) };
}

export async function createTrailer(input: { id: string; description?: string; active?: boolean }) {
  const { supabase } = await requireAdmin();
  const id = input.id.trim().toUpperCase();
  if (!id) return { error: "id is required" };
  const { error } = await supabase.from("trailers").insert({
    id,
    description: input.description?.trim() ?? "",
    active: input.active ?? true,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateTrailer(
  id: string,
  fields: Partial<{ description: string; active: boolean }>
) {
  const { supabase } = await requireAdmin();
  const update: Record<string, unknown> = {};
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.active !== undefined) update.active = fields.active;
  const { error } = await supabase.from("trailers").update(update).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteTrailer(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("trailers").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Depots
// ────────────────────────────────────────────────────────────────────────────

export async function listDepots(): Promise<{ depots?: Depot[]; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("depots")
    .select("*")
    .order("name", { ascending: true });
  if (error) return { error: error.message };
  return { depots: (data ?? []).map(rowToDepot) };
}

export async function createDepot(input: {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radiusM?: number;
}) {
  const { supabase } = await requireAdmin();
  const id = input.id.trim().toLowerCase();
  if (!id || !input.name.trim()) return { error: "id and name are required" };
  if (!Number.isFinite(input.latitude) || !Number.isFinite(input.longitude)) {
    return { error: "valid lat/lon required" };
  }
  const { error } = await supabase.from("depots").insert({
    id,
    name: input.name.trim(),
    latitude: input.latitude,
    longitude: input.longitude,
    radius_m: input.radiusM ?? 200,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateDepot(
  id: string,
  fields: Partial<{ name: string; latitude: number; longitude: number; radiusM: number }>
) {
  const { supabase } = await requireAdmin();
  const update: Record<string, unknown> = {};
  if (fields.name !== undefined) update.name = fields.name;
  if (fields.latitude !== undefined) update.latitude = fields.latitude;
  if (fields.longitude !== undefined) update.longitude = fields.longitude;
  if (fields.radiusM !== undefined) update.radius_m = fields.radiusM;
  const { error } = await supabase.from("depots").update(update).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteDepot(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("depots").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

// ────────────────────────────────────────────────────────────────────────────
// Vehicles
// ────────────────────────────────────────────────────────────────────────────

export async function listVehicles(): Promise<{ vehicles?: Vehicle[]; error?: string }> {
  const { supabase } = await getUser();
  const { data, error } = await supabase
    .from("vehicles")
    .select("*")
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });
  if (error) return { error: error.message };
  return { vehicles: (data ?? []).map(rowToVehicle) };
}

export async function createVehicle(input: {
  id: string;
  description?: string;
  active?: boolean;
  sortOrder?: number;
}) {
  const { supabase } = await requireAdmin();
  const id = input.id.trim().toUpperCase();
  if (!id) return { error: "id is required" };
  const { error } = await supabase.from("vehicles").insert({
    id,
    description: input.description?.trim() ?? "",
    active: input.active ?? true,
    sort_order: input.sortOrder ?? 100,
  });
  if (error) return { error: error.message };
  return { success: true };
}

export async function updateVehicle(
  id: string,
  fields: Partial<{ description: string; active: boolean; sortOrder: number }>
) {
  const { supabase } = await requireAdmin();
  const update: Record<string, unknown> = {};
  if (fields.description !== undefined) update.description = fields.description;
  if (fields.active !== undefined) update.active = fields.active;
  if (fields.sortOrder !== undefined) update.sort_order = fields.sortOrder;
  const { error } = await supabase.from("vehicles").update(update).eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}

export async function deleteVehicle(id: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from("vehicles").delete().eq("id", id);
  if (error) return { error: error.message };
  return { success: true };
}
