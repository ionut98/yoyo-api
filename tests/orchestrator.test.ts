import { describe, expect, it } from "vitest";
import { buildPackageCandidates } from "../src/services/orchestrator/build-packages.js";
import { resolveTargetDate, resolveTargetSlot } from "../src/services/orchestrator/resolve-target-date.js";
import { budgetCapFromParty, calculateScore } from "../src/services/orchestrator/score-packages.js";

const party = {
  id: "10000000-0000-4000-8000-000000000001",
  ageRange: "6-8",
  budget: "3500",
  guestCount: "15",
  datePreference: "pick_date",
  preferredDate: "2026-08-15",
  sector: "s3",
  themeId: "minecraft",
  themeCustom: null,
  activities: ["balloon-modelling"],
  status: "intake",
  city: "București",
  createdAt: "2026-07-28T10:00:00.000Z",
  updatedAt: "2026-07-28T10:00:00.000Z",
};

describe("resolveTargetDate", () => {
  it("uses explicit preferred date when present", () => {
    expect(resolveTargetDate(party)).toBe("2026-08-15");
    expect(resolveTargetSlot()).toBe("afternoon");
  });
});

describe("budgetCapFromParty", () => {
  it("maps bucketed budgets to numeric caps", () => {
    expect(budgetCapFromParty(party)).toBe(3500);
  });
});

describe("buildPackageCandidates", () => {
  const profiles = [
    {
      providerId: "20000000-0000-4000-8000-000000000001",
      providerName: "Joy Venue",
      categories: ["venue"] as const,
      city: "București",
      rating: 4.8,
      reviewCount: 80,
      recommendationScore: 9.4,
      profileId: "30000000-0000-4000-8000-000000000001",
      bookingMode: "instant" as const,
      offeredServices: ["space", "entertainment"] as const,
      animatorTypes: ["host"],
      themes: ["minecraft"],
      activities: ["interactive-games"],
      ageRanges: ["6-8"],
      serviceAreaSectors: ["s3"],
      priceMin: 1800,
      priceMax: 2600,
    },
    {
      providerId: "20000000-0000-4000-8000-000000000002",
      providerName: "Cake Lab",
      categories: ["cakes"] as const,
      city: "București",
      rating: 4.6,
      reviewCount: 40,
      recommendationScore: 7.1,
      profileId: "30000000-0000-4000-8000-000000000002",
      bookingMode: "request" as const,
      offeredServices: ["cakes"] as const,
      animatorTypes: [],
      themes: ["minecraft"],
      activities: ["free-play"],
      ageRanges: ["6-8"],
      serviceAreaSectors: ["s3"],
      priceMin: 350,
      priceMax: 600,
    },
    {
      providerId: "20000000-0000-4000-8000-000000000003",
      providerName: "Balloon Pop",
      categories: ["balloons"] as const,
      city: "București",
      rating: 4.4,
      reviewCount: 20,
      recommendationScore: 6.2,
      profileId: "30000000-0000-4000-8000-000000000003",
      bookingMode: "instant" as const,
      offeredServices: ["balloons"] as const,
      animatorTypes: [],
      themes: ["minecraft"],
      activities: ["balloon-modelling"],
      ageRanges: ["6-8"],
      serviceAreaSectors: ["s3"],
      priceMin: 300,
      priceMax: 500,
    },
  ];

  const availability = profiles.flatMap((profile) => [
    {
      providerId: profile.providerId,
      date: "2026-08-15",
      slot: "afternoon" as const,
      status: "available" as const,
    },
    {
      providerId: profile.providerId,
      date: "2026-08-15",
      slot: "morning" as const,
      status: "available" as const,
    },
  ]);

  it("builds hybrid packages when venue extras are missing", () => {
    const candidates = buildPackageCandidates({
      party,
      providers: profiles as any,
      availability,
      date: "2026-08-15",
      slot: "afternoon",
    });

    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates[0]?.items.map((item) => item.role)).toEqual(
      expect.arrayContaining(["space", "entertainment", "balloons", "cakes"]),
    );
    expect(candidates[0]?.bookingKind).toBe("mixed");
  });
});

describe("calculateScore", () => {
  it("rewards fully instant packages over fully request ones", () => {
    const instant = calculateScore(party, {
      id: "40000000-0000-4000-8000-000000000001",
      partyId: party.id,
      status: "proposed",
      bookingKind: "fully_instant",
      targetDate: "2026-08-15",
      targetSlot: "afternoon",
      estimatedPrice: { min: 2200, max: 2800 },
      items: [],
    });
    const request = calculateScore(party, {
      id: "40000000-0000-4000-8000-000000000002",
      partyId: party.id,
      status: "proposed",
      bookingKind: "fully_request",
      targetDate: "2026-08-15",
      targetSlot: "afternoon",
      estimatedPrice: { min: 2200, max: 2800 },
      items: [],
    });

    expect(instant.score).toBeGreaterThan(request.score);
  });
});
