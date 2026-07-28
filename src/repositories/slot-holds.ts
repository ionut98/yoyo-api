import type { SupabaseClient } from "@supabase/supabase-js";

export async function expireStaleSlotHolds(supabase: SupabaseClient): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("slot_holds")
    .update({ status: "expired", updated_at: now })
    .eq("status", "active")
    .lt("expires_at", now);

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
    date: string;
    slot: "morning" | "afternoon";
    expiresAt: string;
  }>,
): Promise<void> {
  if (rows.length === 0) return;

  const { error } = await supabase.from("slot_holds").insert(
    rows.map((row) => ({
      package_id: row.packageId,
      package_item_id: row.packageItemId,
      provider_id: row.providerId,
      date: row.date,
      slot: row.slot,
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
