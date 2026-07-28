import type { PartyDto } from "../../schemas/parties.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import type {
  EffectiveAvailabilityRow,
  ProviderProfileRow,
} from "../../repositories/provider-enrichment.js";

type CandidateItem = PackageRecommendationDto["items"][number];

function hasService(
  profile: ProviderProfileRow,
  role: "space" | "entertainment" | "balloons" | "cakes",
): boolean {
  return profile.offeredServices.includes(role);
}

function availableOnSlot(
  availability: EffectiveAvailabilityRow[],
  providerId: string,
  date: string,
  slot: "morning" | "afternoon",
): boolean {
  return availability.some(
    (row) =>
      row.providerId === providerId &&
      row.date === date &&
      row.slot === slot &&
      (row.status === "available" || row.status === "limited"),
  );
}

function createItem(
  profile: ProviderProfileRow,
  role: "space" | "entertainment" | "balloons" | "cakes",
  date: string,
  slot: "morning" | "afternoon",
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
    slot,
    priceEstimate,
    bookingMode: profile.bookingMode,
    itemStatus: "proposed",
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
  slot: "morning" | "afternoon";
}): Array<Omit<PackageRecommendationDto, "score" | "scoreBreakdown" | "reasons">> {
  const { party, providers, availability, date, slot } = options;
  const roles = wantedRoles(party);
  const venues = providers.filter((provider) => hasService(provider, "space"));
  const candidates: Array<Omit<PackageRecommendationDto, "score" | "scoreBreakdown" | "reasons">> = [];

  for (const venue of venues.slice(0, 12)) {
    if (!availableOnSlot(availability, venue.providerId, date, slot)) continue;

    const items: CandidateItem[] = [createItem(venue, "space", date, slot)];
    let valid = true;

    for (const role of roles) {
      if (role === "space") continue;

      if (hasService(venue, role)) {
        items.push(createItem(venue, role, date, slot));
        continue;
      }

      const alternative = providers.find(
        (provider) =>
          provider.providerId !== venue.providerId &&
          hasService(provider, role) &&
          availableOnSlot(availability, provider.providerId, date, slot),
      );

      if (!alternative) {
        valid = false;
        break;
      }

      items.push(createItem(alternative, role, date, slot));
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
      targetSlot: slot,
      estimatedPrice,
      items,
    });
  }

  return candidates;
}
