import type { PartyDto } from "../../schemas/parties.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import type {
  EffectiveAvailabilityRow,
  ProviderProfileRow,
} from "../../repositories/provider-enrichment.js";
import { intervalsOverlap } from "../../lib/time-intervals.js";
import { sectorFitScore } from "./sector-fit.js";

type CandidateItem = PackageRecommendationDto["items"][number];

function hasService(
  profile: ProviderProfileRow,
  role: "space" | "entertainment" | "balloons" | "cakes",
): boolean {
  return profile.offeredServices.includes(role);
}

function availableOnInterval(
  availability: EffectiveAvailabilityRow[],
  providerId: string,
  startsAt: string,
  endsAt: string,
): boolean {
  return availability.some(
    (row) =>
      row.providerId === providerId &&
      row.status === "available" &&
      // Prefer covering the requested interval fully
      Date.parse(row.startsAt) <= Date.parse(startsAt) &&
      Date.parse(row.endsAt) >= Date.parse(endsAt),
  );
}

function profileSectorFit(partySector: string | null | undefined, profile: ProviderProfileRow): number {
  return sectorFitScore(partySector, profile.serviceAreaSectors, profile.homeSector);
}

function createItem(
  profile: ProviderProfileRow,
  role: "space" | "entertainment" | "balloons" | "cakes",
  date: string,
  startsAt: string,
  endsAt: string,
): CandidateItem {
  const priceEstimate =
    role === "space"
      ? Math.round(profile.priceMin * 0.7)
      : role === "entertainment"
        ? Math.round(profile.priceMin * 0.2)
        : Math.round(profile.priceMin * 0.1);

  return {
    id: crypto.randomUUID(),
    providerId: profile.providerId,
    providerName: profile.providerName,
    role,
    date,
    startsAt,
    endsAt,
    priceEstimate,
    bookingMode: profile.bookingMode,
    itemStatus: "proposed",
    categories: profile.categories,
    address: profile.address,
    city: profile.city,
    photoUrl: null,
    rating: profile.rating,
    reviewCount: profile.reviewCount,
    website: profile.website,
    mapsUrl: null,
  };
}

function bookingKindFromItems(items: CandidateItem[]): "fully_instant" | "mixed" | "fully_request" {
  const modes = new Set(items.map((item) => item.bookingMode));
  if (modes.size === 1 && modes.has("instant")) return "fully_instant";
  if (modes.size === 1 && modes.has("request")) return "fully_request";
  return "mixed";
}

function wantedRoles(party: PartyDto): Array<"space" | "entertainment" | "balloons" | "cakes"> {
  const roles: Array<"space" | "entertainment" | "balloons" | "cakes"> = ["space"];
  if (party.themeId !== "none") {
    roles.push("entertainment");
  }
  if (party.activities.includes("balloon-modelling")) {
    roles.push("balloons");
  }
  if (party.budget !== "1500") {
    roles.push("cakes");
  }
  return [...new Set(roles)];
}

export function buildPackageCandidates(options: {
  party: PartyDto;
  providers: ProviderProfileRow[];
  availability: EffectiveAvailabilityRow[];
  date: string;
  startsAt: string;
  endsAt: string;
}): Array<Omit<PackageRecommendationDto, "score" | "scoreBreakdown" | "reasons">> {
  const { party, providers, availability, date, startsAt, endsAt } = options;
  const roles = wantedRoles(party);
  const venues = providers
    .filter((provider) => hasService(provider, "space"))
    .sort((a, b) => {
      const fitDiff = profileSectorFit(party.sector, b) - profileSectorFit(party.sector, a);
      if (fitDiff !== 0) return fitDiff;
      return a.priceMin - b.priceMin;
    });
  const candidates: Array<Omit<PackageRecommendationDto, "score" | "scoreBreakdown" | "reasons">> =
    [];

  for (const venue of venues.slice(0, 12)) {
    if (!availableOnInterval(availability, venue.providerId, startsAt, endsAt)) continue;

    const items: CandidateItem[] = [createItem(venue, "space", date, startsAt, endsAt)];
    let valid = true;

    for (const role of roles) {
      if (role === "space") continue;

      if (hasService(venue, role)) {
        items.push(createItem(venue, role, date, startsAt, endsAt));
        continue;
      }

      const alternative = providers
        .filter(
          (provider) =>
            provider.providerId !== venue.providerId &&
            hasService(provider, role) &&
            availableOnInterval(availability, provider.providerId, startsAt, endsAt),
        )
        .sort((a, b) => {
          const fitDiff = profileSectorFit(party.sector, b) - profileSectorFit(party.sector, a);
          if (fitDiff !== 0) return fitDiff;
          return a.priceMin - b.priceMin;
        })[0];

      if (!alternative) {
        valid = false;
        break;
      }

      items.push(createItem(alternative, role, date, startsAt, endsAt));
    }

    if (!valid) continue;

    const estimatedPrice = items.reduce(
      (acc, item) => {
        acc.min += item.priceEstimate;
        acc.max += Math.round(item.priceEstimate * 1.25);
        return acc;
      },
      { min: 0, max: 0 },
    );

    candidates.push({
      id: crypto.randomUUID(),
      partyId: party.id,
      status: "proposed",
      bookingKind: bookingKindFromItems(items),
      targetDate: date,
      targetStartsAt: startsAt,
      targetEndsAt: endsAt,
      estimatedPrice,
      items,
    });
  }

  return candidates;
}

// Re-export for tests that may check overlap helpers indirectly
export { intervalsOverlap };
