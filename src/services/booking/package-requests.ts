import type { SupabaseClient } from "@supabase/supabase-js";
import { getPackageById, updatePackageItemState, updatePackageRequestState } from "../../repositories/package-requests.js";
import { expireStaleSlotHolds, insertSlotHolds, releaseSlotHoldsForPackage } from "../../repositories/slot-holds.js";
import { upsertProviderAvailability } from "../../repositories/provider-enrichment.js";

const HOLD_TTL_MS = 1000 * 60 * 60 * 2;

function derivePackageStatus(itemStates: string[]): "requested" | "partially_confirmed" | "confirmed" | "failed" | "cancelled" {
  if (itemStates.every((state) => state === "confirmed")) return "confirmed";
  if (itemStates.some((state) => state === "declined")) return "failed";
  if (itemStates.some((state) => state === "confirmed")) return "partially_confirmed";
  if (itemStates.every((state) => state === "cancelled")) return "cancelled";
  return "requested";
}

async function markItemBookedOnCalendar(
  supabase: SupabaseClient,
  item: { providerId: string; startsAt: string; endsAt: string },
): Promise<void> {
  await upsertProviderAvailability(supabase, item.providerId, {
    startsAt: item.startsAt,
    endsAt: item.endsAt,
    status: "booked",
  });
}

export async function requestPackageBooking(
  supabase: SupabaseClient,
  packageId: string,
) {
  await expireStaleSlotHolds(supabase);
  const pkg = await getPackageById(supabase, packageId);
  if (!pkg) {
    throw new Error("Package not found");
  }
  if (pkg.status !== "proposed") {
    return pkg;
  }

  const expiresAt = new Date(Date.now() + HOLD_TTL_MS).toISOString();

  await insertSlotHolds(
    supabase,
    pkg.items.map((item) => ({
      packageId: pkg.id,
      packageItemId: item.id,
      providerId: item.providerId,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      expiresAt,
    })),
  );

  for (const item of pkg.items) {
    const nextStatus = item.bookingMode === "instant" ? "confirmed" : "held";
    await updatePackageItemState(supabase, item.id, nextStatus);
    if (nextStatus === "confirmed") {
      await markItemBookedOnCalendar(supabase, {
        providerId: item.providerId,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      });
    }
  }

  const nextStatus =
    pkg.items.every((item) => item.bookingMode === "instant") ? "confirmed" : "requested";

  await updatePackageRequestState(supabase, packageId, {
    status: nextStatus,
    requestedAt: new Date().toISOString(),
    expiresAt,
  });

  return getPackageById(supabase, packageId);
}

export async function cancelPackageBooking(supabase: SupabaseClient, packageId: string) {
  await releaseSlotHoldsForPackage(supabase, packageId, "released");
  await updatePackageRequestState(supabase, packageId, {
    status: "cancelled",
    expiresAt: new Date().toISOString(),
  });
  return getPackageById(supabase, packageId);
}

export async function providerRespondToItem(
  supabase: SupabaseClient,
  itemId: string,
  action: "accept" | "decline",
) {
  const { data: itemRow, error: itemError } = await supabase
    .from("party_package_items")
    .select("id, package_id, provider_id, starts_at, ends_at, item_status")
    .eq("id", itemId)
    .single();

  if (itemError || !itemRow) {
    throw new Error(`Package item not found: ${itemError?.message ?? itemId}`);
  }

  await updatePackageItemState(supabase, itemId, action === "accept" ? "confirmed" : "declined");

  if (action === "accept") {
    await markItemBookedOnCalendar(supabase, {
      providerId: itemRow.provider_id as string,
      startsAt: itemRow.starts_at as string,
      endsAt: itemRow.ends_at as string,
    });
  }

  const packageId = itemRow.package_id as string;
  const { data, error } = await supabase
    .from("party_package_items")
    .select("package_id, item_status")
    .eq("package_id", packageId)
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    throw new Error(`Failed to recompute package state: ${error?.message ?? "missing package items"}`);
  }

  const nextStatus = derivePackageStatus(data.map((row) => row.item_status as string));
  await updatePackageRequestState(supabase, packageId, { status: nextStatus });
  if (action === "decline") {
    await releaseSlotHoldsForPackage(supabase, packageId, "released");
  } else if (nextStatus === "confirmed") {
    await releaseSlotHoldsForPackage(supabase, packageId, "converted");
  }

  return getPackageById(supabase, packageId);
}
