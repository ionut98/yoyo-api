import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBucharestDate } from "../lib/time-intervals.js";

export async function expireStaleSlotHolds(supabase: SupabaseClient): Promise<void> {
  // SECURITY DEFINER: must clear other users' stale active holds too —
  // the EXCLUDE constraint only checks status='active', not expires_at.
  const { error } = await supabase.rpc("expire_stale_slot_holds");
  if (error) {
    throw new Error(`Failed to expire stale slot holds: ${error.message}`);
  }
}

export async function insertSlotHolds(
  supabase: SupabaseClient,
  rows: Array<{
    packageId: string;
    packageItemId: string;
    providerId: string;
    startsAt: string;
    endsAt: string;
    expiresAt: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase.from("slot_holds").insert(
    rows.map((row) => ({
      package_id: row.packageId,
      package_item_id: row.packageItemId,
      provider_id: row.providerId,
      date: formatBucharestDate(new Date(row.startsAt)),
      starts_at: row.startsAt,
      ends_at: row.endsAt,
      expires_at: row.expiresAt,
    })),
  );

  if (error) {
    throw new Error(`Failed to insert slot holds: ${error.message}`);
  }
}

export async function releaseSlotHoldsForPackage(
  supabase: SupabaseClient,
  packageId: string,
  status: "released" | "converted" | "expired",
): Promise<void> {
  const { error } = await supabase
    .from("slot_holds")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("package_id", packageId)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to release slot holds: ${error.message}`);
  }
}
