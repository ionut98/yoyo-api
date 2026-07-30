import { describe, expect, it } from "vitest";
import { buildPackageCandidates } from "../src/services/orchestrator/build-packages.js";
import { resolveTargetDate, resolveTargetSlot } from "../src/services/orchestrator/resolve-target-date.js";
import { budgetCapFromParty, calculateScore } from "../src/services/orchestrator/score-packages.js";
import { sectorFitScore } from "../src/services/orchestrator/sector-fit.js";
import type { ProviderProfileRow } from "../src/repositories/provider-enrichment.js";

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

function baseProfile(overrides: Partial<ProviderProfileRow>): ProviderProfileRow {
  return {
    providerId: "20000000-0000-4000-8000-000000000001",
    providerName: "Provider",
    categories: ["venue"],
    city: "București",
    homeSector: "s3",
    rating: 4.5,
    reviewCount: 20,
    recommendationScore: 5,
    profileId: "30000000-0000-4000-8000-000000000001",
    bookingMode: "instant",
    offeredServices: ["space"],
    animatorTypes: [],
    themes: ["minecraft"],
    activities: ["free-play"],
    ageRanges: ["6-8"],
    serviceAreaSectors: ["s3"],
    priceMin: 1500,
    priceMax: 2200,
    ...overrides,
  };
}

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

describe("sectorFitScore", () => {
  it("scores exact, neighbor, and far sectors", () => {
    expect(sectorFitScore("s3", ["s3"], null)).toBe(1);
    expect(sectorFitScore("s3", ["s2"], null)).toBe(0.65);
    expect(sectorFitScore("s3", ["s6"], null)).toBe(0.2);
    expect(sectorFitScore("orice", ["s6"], null)).toBe(1);
  });
});

describe("buildPackageCandidates", () => {
  const profiles = [
    baseProfile({
      providerId: "20000000-0000-4000-8000-000000000099",
      providerName: "Far Venue",
      homeSector: "s6",
      serviceAreaSectors: ["s6"],
      priceMin: 1000,
      offeredServices: ["space", "entertainment"],
    }),
    baseProfile({
      providerId: "20000000-0000-4000-8000-000000000001",
      providerName: "Joy Venue",
      homeSector: "s3",
      serviceAreaSectors: ["s3"],
      priceMin: 1800,
      offeredServices: ["space", "entertainment"],
      bookingMode: "instant",
    }),
    baseProfile({
      providerId: "20000000-0000-4000-8000-000000000002",
      providerName: "Cake Lab",
      categories: ["cakes"],
      homeSector: "s3",
      serviceAreaSectors: ["s3"],
      offeredServices: ["cakes"],
      bookingMode: "request",
      priceMin: 350,
    }),
    baseProfile({
      providerId: "20000000-0000-4000-8000-000000000003",
      providerName: "Balloon Pop",
      categories: ["balloons"],
      homeSector: "s3",
      serviceAreaSectors: ["s3"],
      offeredServices: ["balloons"],
      bookingMode: "instant",
      priceMin: 300,
    }),
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
      providers: profiles,
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

  it("prefers same-sector venues before cheaper far venues", () => {
    const candidates = buildPackageCandidates({
      party,
      providers: profiles,
      availability,
      date: "2026-08-15",
      slot: "afternoon",
    });

    const firstVenue = candidates[0]?.items.find((item) => item.role === "space");
    expect(firstVenue?.providerName).toBe("Joy Venue");
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

  it("rewards same-sector venue packages over far-sector ones", () => {
    const nearProfile = baseProfile({
      providerId: "20000000-0000-4000-8000-000000000010",
      homeSector: "s3",
      serviceAreaSectors: ["s3"],
    });
    const farProfile = baseProfile({
      providerId: "20000000-0000-4000-8000-000000000011",
      homeSector: "s6",
      serviceAreaSectors: ["s6"],
    });
    const profilesById = new Map([
      [nearProfile.providerId, nearProfile],
      [farProfile.providerId, farProfile],
    ]);

    const near = calculateScore(
      party,
      {
        id: "40000000-0000-4000-8000-000000000020",
        partyId: party.id,
        status: "proposed",
        bookingKind: "mixed",
        targetDate: "2026-08-15",
        targetSlot: "afternoon",
        estimatedPrice: { min: 2200, max: 2800 },
        items: [
          {
            id: "50000000-0000-4000-8000-000000000001",
            providerId: nearProfile.providerId,
            providerName: "Near",
            role: "space",
            date: "2026-08-15",
            slot: "afternoon",
            priceEstimate: 1500,
            bookingMode: "instant",
            itemStatus: "proposed",
            categories: ["venue"],
            address: null,
            city: "București",
            photoUrl: null,
            rating: 4.5,
            reviewCount: 10,
            website: null,
            mapsUrl: null,
          },
        ],
      },
      profilesById,
    );

    const far = calculateScore(
      party,
      {
        id: "40000000-0000-4000-8000-000000000021",
        partyId: party.id,
        status: "proposed",
        bookingKind: "mixed",
        targetDate: "2026-08-15",
        targetSlot: "afternoon",
        estimatedPrice: { min: 2200, max: 2800 },
        items: [
          {
            id: "50000000-0000-4000-8000-000000000002",
            providerId: farProfile.providerId,
            providerName: "Far",
            role: "space",
            date: "2026-08-15",
            slot: "afternoon",
            priceEstimate: 1500,
            bookingMode: "instant",
            itemStatus: "proposed",
            categories: ["venue"],
            address: null,
            city: "București",
            photoUrl: null,
            rating: 4.5,
            reviewCount: 10,
            website: null,
            mapsUrl: null,
          },
        ],
      },
      profilesById,
    );

    expect(near.score).toBeGreaterThan(far.score);
    expect(near.reasons).toContain("În sectorul ales");
  });
});
