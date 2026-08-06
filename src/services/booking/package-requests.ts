import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteProposedPackagesForParty,
  getPackageById,
  updatePackageItemState,
  updatePackageRequestState,
} from "../../repositories/package-requests.js";
import { expireStaleSlotHolds, insertSlotHolds, releaseSlotHoldsForPackage } from "../../repositories/slot-holds.js";
import { listEffectiveAvailabilityRange } from "../../repositories/provider-enrichment.js";
import { availableOnInterval } from "../orchestrator/build-packages.js";

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
  // SECURITY DEFINER: parents cannot write provider_availability under RLS.
  const { error } = await supabase.rpc("lock_provider_availability_for_booking", {
    p_provider_id: item.providerId,
    p_starts_at: item.startsAt,
    p_ends_at: item.endsAt,
  });
  if (error) {
    throw new Error(`Failed to lock provider availability: ${error.message}`);
  }
}

async function assertProvidersStillAvailable(
  supabase: SupabaseClient,
  items: Array<{ providerId: string; startsAt: string; endsAt: string }>,
): Promise<void> {
  if (items.length === 0) return;

  const starts = items.map((item) => Date.parse(item.startsAt));
  const ends = items.map((item) => Date.parse(item.endsAt));
  const startIso = new Date(Math.min(...starts)).toISOString();
  const endIso = new Date(Math.max(...ends)).toISOString();
  const providerIds = [...new Set(items.map((item) => item.providerId))];

  const availability = await listEffectiveAvailabilityRange(supabase, {
    providerIds,
    startIso,
    endIso,
  });

  for (const item of items) {
    if (!availableOnInterval(availability, item.providerId, item.startsAt, item.endsAt)) {
      throw new Error(
        `Provider ${item.providerId} is not available for ${item.startsAt}–${item.endsAt}`,
      );
    }
  }
}

async function ensureSlotHolds(
  supabase: SupabaseClient,
  pkg: {
    id: string;
    items: Array<{ id: string; providerId: string; startsAt: string; endsAt: string }>;
  },
  expiresAt: string,
): Promise<void> {
  const { data: existing, error } = await supabase
    .from("slot_holds")
    .select("package_item_id")
    .eq("package_id", pkg.id)
    .eq("status", "active");

  if (error) {
    throw new Error(`Failed to load existing slot holds: ${error.message}`);
  }

  const heldItemIds = new Set((existing ?? []).map((row) => row.package_item_id as string));
  const missing = pkg.items.filter((item) => !heldItemIds.has(item.id));
  if (missing.length === 0) return;

  await insertSlotHolds(
    supabase,
    missing.map((item) => ({
      packageId: pkg.id,
      packageItemId: item.id,
      providerId: item.providerId,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      expiresAt,
    })),
  );
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

  // Already committed for this party — return as-is (idempotent).
  if (pkg.status !== "proposed") {
    return pkg;
  }

  // Fresh request: verify availability. Resume after partial failure skips assert
  // for items already held/confirmed on this package.
  const needsAvailabilityCheck = pkg.items.every((item) => item.itemStatus === "proposed");
  if (needsAvailabilityCheck) {
    await assertProvidersStillAvailable(
      supabase,
      pkg.items.map((item) => ({
        providerId: item.providerId,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      })),
    );
  }

  const expiresAt = new Date(Date.now() + HOLD_TTL_MS).toISOString();
  await ensureSlotHolds(supabase, pkg, expiresAt);

  for (const item of pkg.items) {
    if (item.itemStatus === "declined") continue;

    const nextStatus = item.bookingMode === "instant" ? "confirmed" : "held";
    if (item.itemStatus !== nextStatus) {
      await updatePackageItemState(supabase, item.id, nextStatus);
    }
    if (nextStatus === "confirmed") {
      await markItemBookedOnCalendar(supabase, {
        providerId: item.providerId,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
      });
    }
  }

  const refreshed = await getPackageById(supabase, packageId);
  if (!refreshed) {
    throw new Error("Package not found after request");
  }

  const nextStatus =
    refreshed.items.every((item) => item.itemStatus === "confirmed")
      ? "confirmed"
      : refreshed.items.some((item) => item.itemStatus === "confirmed")
        ? "partially_confirmed"
        : "requested";

  await updatePackageRequestState(supabase, packageId, {
    status: nextStatus,
    requestedAt: new Date().toISOString(),
    expiresAt,
  });

  // One choice per party/slot: drop the other proposed variants.
  await deleteProposedPackagesForParty(supabase, refreshed.partyId);

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
