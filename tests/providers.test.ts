import { describe, expect, it } from "vitest";
import { toProviderDto } from "../src/mappers/providers.js";
import { listProvidersQuerySchema } from "../src/schemas/providers.js";

describe("listProvidersQuerySchema", () => {
  it("applies defaults", () => {
    const result = listProvidersQuerySchema.parse({});
    expect(result).toEqual({
      sort: "rating",
      order: "desc",
      page: 1,
      limit: 20,
    });
  });

  it("parses valid filters", () => {
    const result = listProvidersQuerySchema.parse({
      city: "București",
      category: "venue",
      minRating: "4",
      page: "2",
      limit: "10",
    });

    expect(result).toEqual({
      city: "București",
      category: "venue",
      minRating: 4,
      sort: "rating",
      order: "desc",
      page: 2,
      limit: 10,
    });
  });

  it("rejects invalid category", () => {
    const result = listProvidersQuerySchema.safeParse({ category: "invalid" });
    expect(result.success).toBe(false);
  });
});

describe("toProviderDto", () => {
  it("maps snake_case DB row to camelCase DTO", () => {
    const dto = toProviderDto({
      id: "550e8400-e29b-41d4-a716-446655440000",
      place_id: "places/abc123",
      name: "Petreceri Kids",
      categories: ["venue", "entertainment"],
      address: "Str. Test 1",
      phone: "+40123456789",
      website: "https://example.com",
      rating: 4.5,
      review_count: 120,
      lat: 44.4268,
      lng: 26.1025,
      maps_url: "https://maps.google.com",
      city: { id: "660e8400-e29b-41d4-a716-446655440001", name: "București" },
      provider_photos: [
        { id: "770e8400-e29b-41d4-a716-446655440002", public_url: "https://cdn.example/photo.jpg", width_px: 800, height_px: 600 },
      ],
    });

    expect(dto).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      placeId: "places/abc123",
      name: "Petreceri Kids",
      categories: ["venue", "entertainment"],
      address: "Str. Test 1",
      phone: "+40123456789",
      website: "https://example.com",
      rating: 4.5,
      reviewCount: 120,
      lat: 44.4268,
      lng: 26.1025,
      mapsUrl: "https://maps.google.com",
      city: { id: "660e8400-e29b-41d4-a716-446655440001", name: "București" },
      photoUrl: "https://cdn.example/photo.jpg",
    });
  });

  it("filters unknown categories", () => {
    const dto = toProviderDto({
      id: "550e8400-e29b-41d4-a716-446655440000",
      place_id: "places/abc123",
      name: "Test",
      categories: ["venue", "unknown"],
      address: null,
      phone: null,
      website: null,
      rating: null,
      review_count: null,
      lat: null,
      lng: null,
      maps_url: null,
      city: null,
      provider_photos: [],
    });

    expect(dto.categories).toEqual(["venue"]);
    expect(dto.photoUrl).toBeNull();
  });
});
