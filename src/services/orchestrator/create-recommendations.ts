import type { SupabaseClient } from "@supabase/supabase-js";
import { getPartyById } from "../../repositories/parties.js";
import {
  listEffectiveAvailability,
  listProviderProfilesForCity,
} from "../../repositories/provider-enrichment.js";
import {
  deleteProposedPackagesForParty,
  insertPackages,
  listCommittedPackagesForParty,
  listTerminalPackagesForParty,
} from "../../repositories/package-requests.js";
import {
  cancelTerminalPackagesForParty,
  expireStalePackageRequests,
} from "../booking/package-requests.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import { buildPackageCandidates } from "./build-packages.js";
import { applyAvailableWindowsAndStagger, attachAvailableWindows } from "./available-windows.js";
import { budgetCapFromParty, calculateScore } from "./score-packages.js";
import { resolveTargetDate, resolveTargetSlotForDate } from "./resolve-target-date.js";

function localYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export async function createRecommendationsForParty(
  supabase: SupabaseClient,
  partyId: string,
  userId: string,
  options: { regenerate?: boolean; targetDate?: string } = {},
): Promise<PackageRecommendationDto[]> {
  let party = await getPartyById(supabase, userId, partyId);
  if (!party) {
    throw new Error("Party not found");
  }

  await expireStalePackageRequests(supabase);

  if (options.regenerate) {
    const targetDate = options.targetDate?.slice(0, 10);
    if (!targetDate || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
      throw new Error("TARGET_DATE_REQUIRED");
    }
    if (targetDate < localYmd()) {
      throw new Error("TARGET_DATE_IN_PAST");
    }

    const { data: priorRows, error: priorError } = await supabase
      .from("party_packages")
      .select("target_date")
      .eq("party_id", partyId)
      .in("status", ["expired", "failed", "cancelled"]);

    if (priorError) {
      throw new Error(`Failed to load prior package dates: ${priorError.message}`);
    }

    const blockedDates = new Set(
      (priorRows ?? [])
        .map((row) => String(row.target_date ?? "").slice(0, 10))
        .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)),
    );
    if (blockedDates.has(targetDate)) {
      throw new Error("TARGET_DATE_MUST_BE_NEW");
    }

    await cancelTerminalPackagesForParty(supabase, partyId, userId);

    const { error: partyUpdateError } = await supabase
      .from("parties")
      .update({
        preferred_date: targetDate,
        date_preference: "pick_date",
      })
      .eq("id", partyId)
      .eq("user_id", userId);

    if (partyUpdateError) {
      throw new Error(`Failed to update party date: ${partyUpdateError.message}`);
    }

    const refreshed = await getPartyById(supabase, userId, partyId);
    if (!refreshed) {
      throw new Error("Party not found");
    }
    party = refreshed;
  }

  // Party already has an active booking — don't regenerate competing variants.
  const committed = await listCommittedPackagesForParty(supabase, partyId);
  if (committed.length > 0) {
    return committed.slice(0, 1).map((pkg) => ({
      ...pkg,
      items: pkg.items.map((item) => ({ ...item, availableWindows: item.availableWindows ?? [] })),
    }));
  }

  // Surface expired/failed near-bookings until parent regenerates or dismisses.
  if (!options.regenerate) {
    const terminal = await listTerminalPackagesForParty(supabase, partyId);
    if (terminal.length > 0) {
      return terminal.slice(0, 1).map((pkg) => ({
        ...pkg,
        items: pkg.items.map((item) => ({ ...item, availableWindows: item.availableWindows ?? [] })),
      }));
    }
  }

  // Drop leftover proposed rows (incl. partial failed requests) before matching.
  await deleteProposedPackagesForParty(supabase, partyId);

  const date = resolveTargetDate(party);
  const { startsAt, endsAt } = resolveTargetSlotForDate(date);
  const profiles = await listProviderProfilesForCity(supabase, party.city);
  const availability = await listEffectiveAvailability(supabase, {
    providerIds: profiles.map((profile) => profile.providerId),
    date,
  });

  const budgetCap = budgetCapFromParty(party);
  const profilesById = new Map(profiles.map((profile) => [profile.providerId, profile]));
  const durationByProviderId = new Map(
    profiles.map((profile) => [profile.providerId, profile.defaultBookingDurationMinutes]),
  );
  const candidates = buildPackageCandidates({
    party,
    providers: profiles,
    availability,
    date,
    startsAt,
    endsAt,
  })
    .map((pkg) => applyAvailableWindowsAndStagger(pkg, availability, durationByProviderId))
    .filter((pkg) => pkg.estimatedPrice.min <= budgetCap)
    .map((pkg) => {
      const { score, breakdown, reasons } = calculateScore(party, pkg, profilesById);
      return {
        ...pkg,
        score,
        scoreBreakdown: breakdown,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const inserted = await insertPackages(
    supabase,
    candidates.map((pkg) => ({
      partyId: pkg.partyId,
      userId,
      status: pkg.status,
      bookingKind: pkg.bookingKind,
      targetDate: pkg.targetDate,
      targetStartsAt: pkg.targetStartsAt,
      targetEndsAt: pkg.targetEndsAt,
      estimatedPriceMin: pkg.estimatedPrice.min,
      estimatedPriceMax: pkg.estimatedPrice.max,
      score: pkg.score,
      scoreBreakdown: pkg.scoreBreakdown,
      reasons: pkg.reasons,
      items: pkg.items.map((item) => ({
        providerId: item.providerId,
        role: item.role,
        date: item.date,
        startsAt: item.startsAt,
        endsAt: item.endsAt,
        priceEstimate: item.priceEstimate,
        bookingMode: item.bookingMode,
        itemStatus: "proposed" as const,
      })),
    })),
  );

  return inserted.map((pkg) => attachAvailableWindows(pkg, availability, durationByProviderId));
}
