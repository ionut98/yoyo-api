import { describe, expect, it } from "vitest";

// Mirror the photo selection used by listClaimCandidates without DB.
function firstPhotoUrl(
  photos: Array<{ public_url: string | null; sort_order?: number | null; is_cover?: boolean | null }> | null | undefined,
): string | null {
  const ordered = [...(photos ?? [])].sort((a, b) => {
    const coverDelta = Number(Boolean(b.is_cover)) - Number(Boolean(a.is_cover));
    if (coverDelta !== 0) return coverDelta;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const cover = ordered.find((photo) => photo.is_cover && photo.public_url) ?? ordered[0];
  return cover?.public_url ?? null;
}

describe("claim candidate photo selection", () => {
  it("prefers cover photo", () => {
    expect(
      firstPhotoUrl([
        { public_url: "https://cdn.example/a.jpg", sort_order: 0, is_cover: false },
        { public_url: "https://cdn.example/cover.jpg", sort_order: 2, is_cover: true },
      ]),
    ).toBe("https://cdn.example/cover.jpg");
  });

  it("falls back to first by sort_order", () => {
    expect(
      firstPhotoUrl([
        { public_url: "https://cdn.example/b.jpg", sort_order: 2, is_cover: false },
        { public_url: "https://cdn.example/a.jpg", sort_order: 1, is_cover: false },
      ]),
    ).toBe("https://cdn.example/a.jpg");
  });

  it("returns null when missing", () => {
    expect(firstPhotoUrl([])).toBeNull();
    expect(firstPhotoUrl(null)).toBeNull();
  });
});

describe("claim candidates pagination math", () => {
  it("computes totalPages", () => {
    const limit = 12;
    expect(Math.ceil(0 / limit) || 0).toBe(0);
    expect(Math.ceil(12 / limit)).toBe(1);
    expect(Math.ceil(13 / limit)).toBe(2);
  });
});
