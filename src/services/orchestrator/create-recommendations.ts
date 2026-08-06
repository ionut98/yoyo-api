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
} from "../../repositories/package-requests.js";
import { expireStaleSlotHolds } from "../../repositories/slot-holds.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import { buildPackageCandidates } from "./build-packages.js";
import { budgetCapFromParty, calculateScore } from "./score-packages.js";
import { resolveTargetDate, resolveTargetSlotForDate } from "./resolve-target-date.js";

export async function createRecommendationsForParty(
  supabase: SupabaseClient,
  partyId: string,
  userId: string,
): Promise<PackageRecommendationDto[]> {
  const party = await getPartyById(supabase, userId, partyId);
  if (!party) {
    throw new Error("Party not found");
  }

  await expireStaleSlotHolds(supabase);

  // Party already chose a package — don't regenerate competing variants.
  const committed = await listCommittedPackagesForParty(supabase, partyId);
  if (committed.length > 0) {
    return committed.slice(0, 1);
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
  const candidates = buildPackageCandidates({
    party,
    providers: profiles,
    availability,
    date,
    startsAt,
    endsAt,
  })
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

  return insertPackages(
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
        itemStatus: "proposed",
      })),
    })),
  );
}
