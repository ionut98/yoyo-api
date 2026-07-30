export const SECTOR_NEIGHBORS: Record<string, readonly string[]> = {
  s1: ["s2", "s6"],
  s2: ["s1", "s3"],
  s3: ["s2", "s4"],
  s4: ["s3", "s5"],
  s5: ["s4", "s6"],
  s6: ["s5", "s1"],
};

/** Soft sector fit using stored provider sectors (no geo at request time). */
export function sectorFitScore(
  partySector: string | null | undefined,
  providerSectors: string[],
  homeSector?: string | null,
): number {
  if (!partySector || partySector === "orice") return 1;

  const sectors = new Set(
    [...providerSectors, homeSector].filter((value): value is string => Boolean(value)),
  );

  if (sectors.size === 0) return 0.35;
  if (sectors.has(partySector)) return 1;

  const neighbors = SECTOR_NEIGHBORS[partySector] ?? [];
  if (neighbors.some((sector) => sectors.has(sector))) return 0.65;

  return 0.2;
}
