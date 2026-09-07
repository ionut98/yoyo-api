import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageRecommendationDto } from "../schemas/orchestrator.js";
import { formatBucharestDate } from "../lib/time-intervals.js";

const PACKAGE_SELECT = `
  id, party_id, status, booking_kind, target_date, target_starts_at, target_ends_at,
  estimated_price_min, estimated_price_max, score, score_breakdown, reasons,
  requested_at, expires_at, created_at, updated_at,
  party_package_items(
    id, provider_id, role, date, starts_at, ends_at, price_estimate, booking_mode, item_status,
    provider:providers(
      name, categories, address, website, rating, review_count, maps_url,
      city:cities(name),
      provider_photos(id, public_url, width_px, height_px)
    )
  )
`;

export type PackageInsert = {
  partyId: string;
  userId: string;
  status: string;
  bookingKind: "fully_instant" | "mixed" | "fully_request";
  targetDate: string;
  targetStartsAt: string;
  targetEndsAt: string;
  estimatedPriceMin: number;
  estimatedPriceMax: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  reasons: string[];
  items: Array<{
    providerId: string;
    role: "space" | "entertainment" | "balloons" | "cakes";
    date: string;
    startsAt: string;
    endsAt: string;
    priceEstimate: number;
    bookingMode: "instant" | "request";
    itemStatus: "proposed" | "held" | "confirmed";
  }>;
};

const VALID_CATEGORIES = new Set(["venue", "entertainment", "balloons", "cakes"]);

function firstPhotoUrl(
  photos: Array<{ public_url?: string | null }> | null | undefined,
): string | null {
  const url = photos?.find((photo) => Boolean(photo.public_url))?.public_url;
  return url ?? null;
}

function mapProviderCard(provider: any) {
  const row = Array.isArray(provider) ? provider[0] : provider;
  const cityRelation = row?.city as { name?: string } | Array<{ name?: string }> | null | undefined;
  const city = Array.isArray(cityRelation)
    ? (cityRelation[0]?.name ?? null)
    : (cityRelation?.name ?? null);
  const categories = ((row?.categories as string[] | null) ?? []).filter((value) =>
    VALID_CATEGORIES.has(value),
  ) as Array<"venue" | "entertainment" | "balloons" | "cakes">;

  return {
    providerName: (row?.name as string | undefined) ?? "Provider",
    categories,
    address: (row?.address as string | null | undefined) ?? null,
    city,
    photoUrl: firstPhotoUrl(row?.provider_photos),
    rating: row?.rating === null || row?.rating === undefined ? null : Number(row.rating),
    reviewCount:
      row?.review_count === null || row?.review_count === undefined
        ? null
        : Number(row.review_count),
    website: (row?.website as string | null | undefined) ?? null,
    mapsUrl: (row?.maps_url as string | null | undefined) ?? null,
  };
}

function mapPackageRow(row: any): PackageRecommendationDto {
  return {
    id: row.id,
    partyId: row.party_id,
    status: row.status,
    bookingKind: row.booking_kind,
    targetDate: row.target_date,
    targetStartsAt: row.target_starts_at,
    targetEndsAt: row.target_ends_at,
    estimatedPrice: {
      min: Number(row.estimated_price_min),
      max: Number(row.estimated_price_max),
    },
    score: Number(row.score ?? 0),
    scoreBreakdown: (row.score_breakdown as Record<string, number> | null) ?? {},
    reasons: (row.reasons as string[] | null) ?? [],
    requestedAt: (row.requested_at as string | null | undefined) ?? null,
    expiresAt: (row.expires_at as string | null | undefined) ?? null,
    party: null,
    items: (row.party_package_items ?? []).map((item: any) => {
      const providerCard = mapProviderCard(item.provider);
      const startsAt = item.starts_at as string;
      return {
        id: item.id,
        providerId: item.provider_id,
        providerName: providerCard.providerName,
        role: item.role,
        date: (item.date as string) ?? formatBucharestDate(new Date(startsAt)),
        startsAt,
        endsAt: item.ends_at as string,
        priceEstimate: Number(item.price_estimate),
        bookingMode: item.booking_mode,
        itemStatus: item.item_status,
        categories: providerCard.categories,
        address: providerCard.address,
        city: providerCard.city,
        photoUrl: providerCard.photoUrl,
        rating: providerCard.rating,
        reviewCount: providerCard.reviewCount,
        website: providerCard.website,
        mapsUrl: providerCard.mapsUrl,
        availableWindows: [],
      };
    }),
  };
}

async function attachPartyContext(
  supabase: SupabaseClient,
  packages: PackageRecommendationDto[],
): Promise<PackageRecommendationDto[]> {
  if (packages.length === 0) return packages;

  const { data, error } = await supabase.rpc("get_packages_party_context", {
    p_package_ids: packages.map((pkg) => pkg.id),
  });

  if (error) {
    throw new Error(`Failed to load party context: ${error.message}`);
  }

  type PartyContext = {
    parentName: string | null;
    parentEmail: string | null;
    parentPhone: string | null;
    sector: string | null;
    ageRange: string | null;
    budget: string | null;
    guestCount: string | null;
    themeId: string | null;
    themeCustom: string | null;
    activities: string[];
    city: string | null;
    preferredDate: string | null;
    requestedAt: string | null;
    expiresAt: string | null;
  };

  const byPackageId = new Map<string, PartyContext>();
  for (const row of data ?? []) {
    byPackageId.set(row.package_id as string, {
      parentName: (row.parent_name as string | null) ?? null,
      parentEmail: (row.parent_email as string | null) ?? null,
      parentPhone: (row.parent_phone as string | null) ?? null,
      sector: (row.sector as string | null) ?? null,
      ageRange: (row.age_range as string | null) ?? null,
      budget: (row.budget as string | null) ?? null,
      guestCount: (row.guest_count as string | null) ?? null,
      themeId: (row.theme_id as string | null) ?? null,
      themeCustom: (row.theme_custom as string | null) ?? null,
      activities: (row.activities as string[] | null) ?? [],
      city: (row.city as string | null) ?? null,
      preferredDate: row.preferred_date ? String(row.preferred_date) : null,
      requestedAt: (row.requested_at as string | null) ?? null,
      expiresAt: (row.expires_at as string | null) ?? null,
    });
  }

  return packages.map((pkg) => {
    const context = byPackageId.get(pkg.id);
    if (!context) return pkg;
    return {
      ...pkg,
      requestedAt: pkg.requestedAt ?? context.requestedAt,
      expiresAt: pkg.expiresAt ?? context.expiresAt,
      party: {
        parentName: context.parentName,
        parentEmail: context.parentEmail,
        parentPhone: context.parentPhone,
        sector: context.sector,
        ageRange: context.ageRange,
        budget: context.budget,
        guestCount: context.guestCount,
        themeId: context.themeId,
        themeCustom: context.themeCustom,
        activities: context.activities,
        city: context.city,
        preferredDate: context.preferredDate,
      },
    };
  });
}

export async function deleteProposedPackagesForParty(
  supabase: SupabaseClient,
  partyId: string,
): Promise<void> {
  const { error } = await supabase
    .from("party_packages")
    .delete()
    .eq("party_id", partyId)
    .eq("status", "proposed");

  if (error) {
    throw new Error(`Failed to delete previous proposed packages: ${error.message}`);
  }
}

/** Active bookings that block regenerating recommendations. */
export async function listCommittedPackagesForParty(
  supabase: SupabaseClient,
  partyId: string,
): Promise<PackageRecommendationDto[]> {
  const { data, error } = await supabase
    .from("party_packages")
    .select(PACKAGE_SELECT)
    .eq("party_id", partyId)
    .in("status", ["requested", "partially_confirmed", "confirmed"])
    .order("requested_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list committed packages: ${error.message}`);
  }
  return (data ?? []).map(mapPackageRow);
}

/** Expired/failed near-bookings shown until parent dismisses or regenerates. */
export async function listTerminalPackagesForParty(
  supabase: SupabaseClient,
  partyId: string,
): Promise<PackageRecommendationDto[]> {
  const { data, error } = await supabase
    .from("party_packages")
    .select(PACKAGE_SELECT)
    .eq("party_id", partyId)
    .in("status", ["expired", "failed"])
    .order("requested_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list terminal packages: ${error.message}`);
  }
  return (data ?? []).map(mapPackageRow);
}

export async function insertPackages(
  supabase: SupabaseClient,
  rows: PackageInsert[],
): Promise<PackageRecommendationDto[]> {
  if (rows.length === 0) {
    return [];
  }

  const packagesPayload = rows.map((row) => ({
    party_id: row.partyId,
    user_id: row.userId,
    status: row.status,
    booking_kind: row.bookingKind,
    target_date: row.targetDate,
    target_starts_at: row.targetStartsAt,
    target_ends_at: row.targetEndsAt,
    estimated_price_min: row.estimatedPriceMin,
    estimated_price_max: row.estimatedPriceMax,
    score: row.score,
    score_breakdown: row.scoreBreakdown,
    reasons: row.reasons,
  }));

  const { data: packageRows, error: packageError } = await supabase
    .from("party_packages")
    .insert(packagesPayload)
    .select("id")
    .order("id", { ascending: true });

  if (packageError) {
    throw new Error(`Failed to insert packages: ${packageError.message}`);
  }

  const itemsPayload = rows.flatMap((row, index) =>
    row.items.map((item) => ({
      package_id: packageRows?.[index]?.id,
      provider_id: item.providerId,
      role: item.role,
      date: item.date,
      starts_at: item.startsAt,
      ends_at: item.endsAt,
      price_estimate: item.priceEstimate,
      booking_mode: item.bookingMode,
      item_status: item.itemStatus,
    })),
  );

  if (itemsPayload.length > 0) {
    const { error: itemError } = await supabase.from("party_package_items").insert(itemsPayload);
    if (itemError) {
      throw new Error(`Failed to insert package items: ${itemError.message}`);
    }
  }

  const ids = (packageRows ?? []).map((row) => row.id as string);
  return listPackagesByIds(supabase, ids);
}

export async function listPackagesByIds(
  supabase: SupabaseClient,
  ids: string[],
): Promise<PackageRecommendationDto[]> {
  if (ids.length === 0) return [];
  const { data, error } = await supabase.from("party_packages").select(PACKAGE_SELECT).in("id", ids);
  if (error) {
    throw new Error(`Failed to list packages: ${error.message}`);
  }
  return (data ?? []).map(mapPackageRow);
}

export async function getPackageById(
  supabase: SupabaseClient,
  packageId: string,
): Promise<PackageRecommendationDto | null> {
  const { data, error } = await supabase
    .from("party_packages")
    .select(PACKAGE_SELECT)
    .eq("id", packageId)
    .maybeSingle();
  if (error) {
    throw new Error(`Failed to get package: ${error.message}`);
  }
  return data ? mapPackageRow(data) : null;
}

export async function updatePackageRequestState(
  supabase: SupabaseClient,
  packageId: string,
  state: {
    status?: string;
    requestedAt?: string | null;
    expiresAt?: string | null;
    targetStartsAt?: string;
    targetEndsAt?: string;
  },
): Promise<void> {
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (state.status !== undefined) patch.status = state.status;
  if (state.requestedAt !== undefined) patch.requested_at = state.requestedAt;
  if (state.expiresAt !== undefined) patch.expires_at = state.expiresAt;
  if (state.targetStartsAt !== undefined) patch.target_starts_at = state.targetStartsAt;
  if (state.targetEndsAt !== undefined) patch.target_ends_at = state.targetEndsAt;

  const { error } = await supabase.from("party_packages").update(patch).eq("id", packageId);

  if (error) {
    throw new Error(`Failed to update package state: ${error.message}`);
  }
}

export async function updatePackageItemState(
  supabase: SupabaseClient,
  itemId: string,
  itemStatus: string,
): Promise<void> {
  const { error } = await supabase
    .from("party_package_items")
    .update({ item_status: itemStatus, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) {
    throw new Error(`Failed to update package item state: ${error.message}`);
  }
}

export async function updatePackageItemTimes(
  supabase: SupabaseClient,
  itemId: string,
  times: { startsAt: string; endsAt: string; date: string },
): Promise<void> {
  const { error } = await supabase
    .from("party_package_items")
    .update({
      starts_at: times.startsAt,
      ends_at: times.endsAt,
      date: times.date,
      updated_at: new Date().toISOString(),
    })
    .eq("id", itemId);
  if (error) {
    throw new Error(`Failed to update package item times: ${error.message}`);
  }
}

const PROVIDER_INBOX_ITEM_STATUSES = new Set(["held", "confirmed", "declined", "expired"]);

export async function listProviderPackages(
  supabase: SupabaseClient,
  providerId: string,
): Promise<PackageRecommendationDto[]> {
  const { data, error } = await supabase
    .from("party_packages")
    .select(PACKAGE_SELECT)
    .neq("status", "proposed")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list provider packages: ${error.message}`);
  }

  // Only surface packages where this provider has a real request/response item —
  // bare orchestrator proposals (status=proposed / item=proposed) are not inbox requests.
  const packages = (data ?? [])
    .map(mapPackageRow)
    .filter((pkg) =>
      pkg.items.some(
        (item) =>
          item.providerId === providerId && PROVIDER_INBOX_ITEM_STATUSES.has(item.itemStatus),
      ),
    );

  return attachPartyContext(supabase, packages);
}
