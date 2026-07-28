import type { PartyDto } from "../../schemas/parties.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";

export function budgetCapFromParty(party: PartyDto): number {
  switch (party.budget) {
    case "1500":
      return 1500;
    case "2500":
      return 2500;
    case "3500":
      return 3500;
    case "5000+":
      return 7000;
    default:
      return 2500;
  }
}

export function calculateScore(
  party: PartyDto,
  pkg: Omit<PackageRecommendationDto, "score" | "scoreBreakdown" | "reasons">,
): { score: number; breakdown: Record<string, number>; reasons: string[] } {
  const budgetCap = budgetCapFromParty(party);
  const budgetFit =
    pkg.estimatedPrice.max <= budgetCap
      ? 1
      : pkg.estimatedPrice.min <= budgetCap
        ? 0.7
        : 0;

  const bookingSpeed =
    pkg.bookingKind === "fully_instant" ? 1 : pkg.bookingKind === "mixed" ? 0.6 : 0.25;

  const sectorFit = party.sector === "orice" ? 1 : 0.9;
  const themeActivityFit = party.themeId && party.themeId !== "none" ? 0.9 : 0.65;
  const availabilityFit = 1;
  const quality = 0.6;

  const breakdown = {
    budgetFit,
    availabilityFit,
    themeActivityFit,
    sectorFit,
    bookingSpeed,
    quality,
  };

  const score =
    0.4 * budgetFit +
    0.2 * availabilityFit +
    0.15 * themeActivityFit +
    0.1 * sectorFit +
    0.1 * bookingSpeed +
    0.05 * quality;

  const reasons = ["În buget"];
  if (bookingSpeed >= 1) reasons.push("Confirmare instant");
  else if (bookingSpeed >= 0.6) reasons.push("Confirmare mixtă, rapidă");
  if (party.themeId && party.themeId !== "none") reasons.push("Temă potrivită");

  return { score, breakdown, reasons };
}
