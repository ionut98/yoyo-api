import type { SupabaseClient } from "@supabase/supabase-js";
import {
  deleteProposedPackagesForParty,
  getPackageById,
  updatePackageItemState,
  updatePackageItemTimes,
  updatePackageRequestState,
} from "../../repositories/package-requests.js";
import { expireStaleSlotHolds, insertSlotHolds, releaseSlotHoldsForPackage } from "../../repositories/slot-holds.js";
import { listEffectiveAvailabilityRange } from "../../repositories/provider-enrichment.js";
import { formatBucharestDate } from "../../lib/time-intervals.js";
import { availableOnInterval } from "../orchestrator/build-packages.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";

export type PackageItemTimeInput = {
  itemId: string;
  startsAt: string;
  endsAt: string;
};

const HOLD_TTL_MS = 1000 * 60 * 60 * 2;

const ACTIVE_PACKAGE_STATUSES = ["requested", "partially_confirmed", "confirmed"] as const;
const TERMINAL_PACKAGE_STATUSES = ["expired", "failed"] as const;

function derivePackageStatus(
  itemStates: string[],
): "requested" | "partially_confirmed" | "confirmed" | "failed" | "expired" | "cancelled" {
  if (itemStates.every((state) => state === "confirmed")) return "confirmed";
  if (itemStates.some((state) => state === "declined")) return "failed";
  if (itemStates.some((state) => state === "confirmed")) return "partially_confirmed";
  if (itemStates.every((state) => state === "cancelled")) return "cancelled";
  if (itemStates.every((state) => state === "expired" || state === "cancelled")) return "expired";
  return "requested";
}

async function recomputePackageStatus(supabase: SupabaseClient, packageId: string): Promise<string> {
  const { data, error } = await supabase
    .from("party_package_items")
    .select("item_status")
    .eq("package_id", packageId)
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) {
    throw new Error(`Failed to recompute package state: ${error?.message ?? "missing package items"}`);
  }

  const nextStatus = derivePackageStatus(data.map((row) => row.item_status as string));
  await updatePackageRequestState(supabase, packageId, { status: nextStatus });
  return nextStatus;
}

async function unlockItemFromCalendar(
  supabase: SupabaseClient,
  item: { providerId: string; startsAt: string; endsAt: string },
): Promise<void> {
  const { error } = await supabase.rpc("unlock_provider_availability_for_booking", {
    p_provider_id: item.providerId,
    p_starts_at: item.startsAt,
    p_ends_at: item.endsAt,
  });
  if (error) {
    throw new Error(`Failed to unlock provider availability: ${error.message}`);
  }
}

/** Mark incomplete packages past expires_at as expired and free calendar locks (variant 1). */
export async function expireStalePackageRequests(supabase: SupabaseClient): Promise<void> {
  await expireStaleSlotHolds(supabase);

  const nowIso = new Date().toISOString();
  const { data: stalePackages, error } = await supabase
    .from("party_packages")
    .select("id")
    .lt("expires_at", nowIso)
    .in("status", ["requested", "partially_confirmed"]);

  if (error) {
    throw new Error(`Failed to list stale package requests: ${error.message}`);
  }

  for (const row of stalePackages ?? []) {
    const packageId = row.id as string;
    const { data: items, error: itemsError } = await supabase
      .from("party_package_items")
      .select("id, provider_id, starts_at, ends_at, item_status")
      .eq("package_id", packageId);

    if (itemsError) {
      throw new Error(`Failed to load stale package items: ${itemsError.message}`);
    }

    for (const item of items ?? []) {
      const status = item.item_status as string;
      if (status === "confirmed") {
        await unlockItemFromCalendar(supabase, {
          providerId: item.provider_id as string,
          startsAt: item.starts_at as string,
          endsAt: item.ends_at as string,
        });
        await updatePackageItemState(supabase, item.id as string, "expired");
      } else if (status === "held") {
        await updatePackageItemState(supabase, item.id as string, "expired");
      }
    }

    await releaseSlotHoldsForPackage(supabase, packageId, "expired");
    await updatePackageRequestState(supabase, packageId, {
      status: "expired",
      expiresAt: nowIso,
    });
  }
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

async function applyProposedItemTimes(
  supabase: SupabaseClient,
  pkg: PackageRecommendationDto,
  itemTimes: PackageItemTimeInput[],
): Promise<PackageRecommendationDto> {
  if (itemTimes.length === 0) {
    throw new Error("ITEM_TIMES_REQUIRED");
  }

  const byId = new Map(pkg.items.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const targetDay = pkg.targetDate.slice(0, 10);

  for (const entry of itemTimes) {
    if (seen.has(entry.itemId)) {
      throw new Error("INVALID_ITEM_TIMES");
    }
    seen.add(entry.itemId);

    const item = byId.get(entry.itemId);
    if (!item) {
      throw new Error("INVALID_ITEM_TIMES");
    }
    if (item.itemStatus !== "proposed") {
      throw new Error("INVALID_ITEM_TIMES");
    }

    const startMs = Date.parse(entry.startsAt);
    const endMs = Date.parse(entry.endsAt);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      throw new Error("INVALID_ITEM_TIMES");
    }

    const startDay = formatBucharestDate(new Date(entry.startsAt));
    const endDay = formatBucharestDate(new Date(entry.endsAt));
    if (startDay !== targetDay || endDay !== targetDay) {
      throw new Error("ITEM_TIMES_WRONG_DAY");
    }

    await updatePackageItemTimes(supabase, entry.itemId, {
      startsAt: entry.startsAt,
      endsAt: entry.endsAt,
      date: targetDay,
    });
  }

  // Every package item must receive times when the parent customizes.
  if (seen.size !== pkg.items.length) {
    throw new Error("ITEM_TIMES_REQUIRED");
  }

  const starts = itemTimes.map((entry) => Date.parse(entry.startsAt));
  const ends = itemTimes.map((entry) => Date.parse(entry.endsAt));
  await updatePackageRequestState(supabase, pkg.id, {
    targetStartsAt: new Date(Math.min(...starts)).toISOString(),
    targetEndsAt: new Date(Math.max(...ends)).toISOString(),
  });

  const refreshed = await getPackageById(supabase, pkg.id);
  if (!refreshed) {
    throw new Error("Package not found");
  }
  return refreshed;
}

export async function requestPackageBooking(
  supabase: SupabaseClient,
  packageId: string,
  options: { itemTimes?: PackageItemTimeInput[] } = {},
) {
  await expireStaleSlotHolds(supabase);
  let pkg = await getPackageById(supabase, packageId);
  if (!pkg) {
    throw new Error("Package not found");
  }

  // Already committed for this party — return as-is (idempotent).
  if (pkg.status !== "proposed") {
    return pkg;
  }

  if (options.itemTimes && options.itemTimes.length > 0) {
    pkg = await applyProposedItemTimes(supabase, pkg, options.itemTimes);
  } else {
    throw new Error("ITEM_TIMES_REQUIRED");
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

export async function cancelPackageBooking(
  supabase: SupabaseClient,
  packageId: string,
  userId: string,
) {
  const { data: pkgRow, error: pkgError } = await supabase
    .from("party_packages")
    .select("id, user_id, status")
    .eq("id", packageId)
    .maybeSingle();

  if (pkgError) {
    throw new Error(`Failed to load package for cancel: ${pkgError.message}`);
  }
  if (!pkgRow) {
    throw new Error("Package not found");
  }
  if ((pkgRow.user_id as string) !== userId) {
    throw new Error("FORBIDDEN");
  }
  if ((pkgRow.status as string) === "confirmed") {
    throw new Error("Cannot cancel a fully confirmed package");
  }

  const { data: items, error: itemsError } = await supabase
    .from("party_package_items")
    .select("id, provider_id, starts_at, ends_at, item_status")
    .eq("package_id", packageId);

  if (itemsError) {
    throw new Error(`Failed to load package items for cancel: ${itemsError.message}`);
  }

  const nowIso = new Date().toISOString();

  for (const item of items ?? []) {
    const status = item.item_status as string;
    if (status === "confirmed") {
      await unlockItemFromCalendar(supabase, {
        providerId: item.provider_id as string,
        startsAt: item.starts_at as string,
        endsAt: item.ends_at as string,
      });
    }
    if (status === "proposed" || status === "held" || status === "confirmed" || status === "expired") {
      await updatePackageItemState(supabase, item.id as string, "cancelled");
    }
  }

  await releaseSlotHoldsForPackage(supabase, packageId, "released");
  await updatePackageRequestState(supabase, packageId, {
    status: "cancelled",
    expiresAt: nowIso,
  });
  return getPackageById(supabase, packageId);
}

/** Cancel expired/failed near-bookings so recommendations can rebuild. */
export async function cancelTerminalPackagesForParty(
  supabase: SupabaseClient,
  partyId: string,
  userId: string,
): Promise<void> {
  const { data, error } = await supabase
    .from("party_packages")
    .select("id")
    .eq("party_id", partyId)
    .eq("user_id", userId)
    .in("status", [...TERMINAL_PACKAGE_STATUSES]);

  if (error) {
    throw new Error(`Failed to list terminal packages: ${error.message}`);
  }

  for (const row of data ?? []) {
    await cancelPackageBooking(supabase, row.id as string, userId);
  }
}

export async function providerRespondToItem(
  supabase: SupabaseClient,
  itemId: string,
  action: "accept" | "decline",
) {
  await expireStalePackageRequests(supabase);

  const { data: itemRow, error: itemError } = await supabase
    .from("party_package_items")
    .select("id, package_id, provider_id, starts_at, ends_at, item_status")
    .eq("id", itemId)
    .single();

  if (itemError || !itemRow) {
    throw new Error(`Package item not found: ${itemError?.message ?? itemId}`);
  }

  if (itemRow.item_status !== "held") {
    throw new Error("REQUEST_EXPIRED_OR_CLOSED");
  }

  const packageId = itemRow.package_id as string;
  const { data: pkgRow, error: pkgError } = await supabase
    .from("party_packages")
    .select("expires_at")
    .eq("id", packageId)
    .single();

  if (pkgError) {
    throw new Error(`Package not found: ${pkgError.message}`);
  }

  const expiresAt = pkgRow?.expires_at as string | null | undefined;
  if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
    throw new Error("REQUEST_EXPIRED_OR_CLOSED");
  }

  await updatePackageItemState(supabase, itemId, action === "accept" ? "confirmed" : "declined");

  if (action === "accept") {
    await markItemBookedOnCalendar(supabase, {
      providerId: itemRow.provider_id as string,
      startsAt: itemRow.starts_at as string,
      endsAt: itemRow.ends_at as string,
    });
  }

  const nextStatus = await recomputePackageStatus(supabase, packageId);
  if (action === "decline") {
    await releaseSlotHoldsForPackage(supabase, packageId, "released");
  } else if (nextStatus === "confirmed") {
    await releaseSlotHoldsForPackage(supabase, packageId, "converted");
  }

  return getPackageById(supabase, packageId);
}

/** Remove an expired request from the provider inbox. */
export async function providerDismissExpiredItem(supabase: SupabaseClient, itemId: string) {
  await expireStalePackageRequests(supabase);

  const { data: itemRow, error: itemError } = await supabase
    .from("party_package_items")
    .select("id, package_id, item_status")
    .eq("id", itemId)
    .single();

  if (itemError || !itemRow) {
    throw new Error(`Package item not found: ${itemError?.message ?? itemId}`);
  }

  if (itemRow.item_status !== "expired") {
    throw new Error("REQUEST_NOT_EXPIRED");
  }

  await updatePackageItemState(supabase, itemId, "cancelled");
  await recomputePackageStatus(supabase, itemRow.package_id as string);
  return getPackageById(supabase, itemRow.package_id as string);
}

export { ACTIVE_PACKAGE_STATUSES, TERMINAL_PACKAGE_STATUSES };
