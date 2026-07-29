import type { SupabaseClient } from "@supabase/supabase-js";
import type { PackageRecommendationDto } from "../schemas/orchestrator.js";

const PACKAGE_SELECT = `
  id, party_id, status, booking_kind, target_date, target_slot,
  estimated_price_min, estimated_price_max, score, score_breakdown, reasons,
  requested_at, expires_at, created_at, updated_at,
  party_package_items(
    id, provider_id, role, date, slot, price_estimate, booking_mode, item_status,
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
  targetSlot: "morning" | "afternoon";
  estimatedPriceMin: number;
  estimatedPriceMax: number;
  score: number;
  scoreBreakdown: Record<string, number>;
  reasons: string[];
  items: Array<{
    providerId: string;
    role: "space" | "entertainment" | "balloons" | "cakes";
    date: string;
    slot: "morning" | "afternoon";
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
    rating:
      row?.rating === null || row?.rating === undefined ? null : Number(row.rating),
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
    targetSlot: row.target_slot,
    estimatedPrice: {
      min: Number(row.estimated_price_min),
      max: Number(row.estimated_price_max),
    },
    score: Number(row.score ?? 0),
    scoreBreakdown: (row.score_breakdown as Record<string, number> | null) ?? {},
    reasons: (row.reasons as string[] | null) ?? [],
    items: (row.party_package_items ?? []).map((item: any) => {
      const providerCard = mapProviderCard(item.provider);
      return {
        id: item.id,
        providerId: item.provider_id,
        providerName: providerCard.providerName,
        role: item.role,
        date: item.date,
        slot: item.slot,
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
      };
    }),
  };
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
    target_slot: row.targetSlot,
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
      slot: item.slot,
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
  state: { status: string; requestedAt?: string | null; expiresAt?: string | null },
): Promise<void> {
  const { error } = await supabase
    .from("party_packages")
    .update({
      status: state.status,
      requested_at: state.requestedAt ?? undefined,
      expires_at: state.expiresAt ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", packageId);

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

export async function listProviderPackages(
  supabase: SupabaseClient,
  providerId: string,
): Promise<PackageRecommendationDto[]> {
  const { data, error } = await supabase
    .from("party_packages")
    .select(PACKAGE_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list provider packages: ${error.message}`);
  }

  return (data ?? [])
    .map(mapPackageRow)
    .filter((pkg) => pkg.items.some((item) => item.providerId === providerId));
}
