import type { SupabaseClient } from "@supabase/supabase-js";
import { getPartyById } from "../../repositories/parties.js";
import {
  listEffectiveAvailability,
  listProviderProfilesForCity,
} from "../../repositories/provider-enrichment.js";
import {
  deleteProposedPackagesForParty,
  insertPackages,
} from "../../repositories/package-requests.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import { buildPackageCandidates } from "./build-packages.js";
import { budgetCapFromParty, calculateScore } from "./score-packages.js";
import { resolveTargetDate, resolveTargetSlot } from "./resolve-target-date.js";

export async function createRecommendationsForParty(
  supabase: SupabaseClient,
  partyId: string,
  userId: string,
): Promise<PackageRecommendationDto[]> {
  const party = await getPartyById(supabase, userId, partyId);
  if (!party) {
    throw new Error("Party not found");
  }

  const date = resolveTargetDate(party);
  const slot = resolveTargetSlot();
  const profiles = await listProviderProfilesForCity(supabase, party.city);
  const availability = await listEffectiveAvailability(supabase, {
    providerIds: profiles.map((profile) => profile.providerId),
    date,
  });

  const budgetCap = budgetCapFromParty(party);
  const candidates = buildPackageCandidates({
    party,
    providers: profiles,
    availability,
    date,
    slot,
  })
    .filter((pkg) => pkg.estimatedPrice.min <= budgetCap)
    .map((pkg) => {
      const { score, breakdown, reasons } = calculateScore(party, pkg);
      return {
        ...pkg,
        score,
        scoreBreakdown: breakdown,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  await deleteProposedPackagesForParty(supabase, partyId);

  return insertPackages(
    supabase,
    candidates.map((pkg) => ({
      partyId: pkg.partyId,
      userId,
      status: pkg.status,
      bookingKind: pkg.bookingKind,
      targetDate: pkg.targetDate,
      targetSlot: pkg.targetSlot,
      estimatedPriceMin: pkg.estimatedPrice.min,
      estimatedPriceMax: pkg.estimatedPrice.max,
      score: pkg.score,
      scoreBreakdown: pkg.scoreBreakdown,
      reasons: pkg.reasons,
      items: pkg.items.map((item) => ({
        providerId: item.providerId,
        role: item.role,
        date: item.date,
        slot: item.slot,
        priceEstimate: item.priceEstimate,
        bookingMode: item.bookingMode,
        itemStatus: "proposed",
      })),
    })),
  );
}
