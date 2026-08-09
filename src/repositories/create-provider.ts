import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreateProviderBody, ProviderProfileDto } from "../schemas/orchestrator.js";
import { ensureAccountRole } from "./accounts.js";
import { getProviderProfileForMember } from "./provider-enrichment.js";

const CATEGORY_TO_SERVICE: Record<
  CreateProviderBody["category"],
  "space" | "entertainment" | "balloons" | "cakes"
> = {
  venue: "space",
  entertainment: "entertainment",
  balloons: "balloons",
  cakes: "cakes",
};

function parseSectorFromAddress(address: string): string | null {
  const match = address.match(/sector\s*([1-6])/i);
  return match?.[1] ? `s${match[1]}` : null;
}

export async function createManualProvider(
  supabase: SupabaseClient,
  userId: string,
  input: CreateProviderBody,
): Promise<ProviderProfileDto> {
  await ensureAccountRole(supabase, userId, "provider");

  const { data: cityRow, error: cityError } = await supabase
    .from("cities")
    .select("id")
    .eq("name", input.city)
    .maybeSingle();

  if (cityError) {
    throw new Error(`Failed to resolve city: ${cityError.message}`);
  }
  if (!cityRow?.id) {
    throw new Error(`City not found: ${input.city}`);
  }

  const providerId = crypto.randomUUID();
  const placeId = `manual:${providerId}`;
  const offeredServices =
    input.offeredServices && input.offeredServices.length > 0
      ? input.offeredServices
      : [CATEGORY_TO_SERVICE[input.category]];
  const homeSector = input.homeSector ?? parseSectorFromAddress(input.address);

  const { error: providerError } = await supabase.from("providers").insert({
    id: providerId,
    place_id: placeId,
    name: input.name,
    description: input.description ?? null,
    address: input.address,
    phone: input.phone ?? null,
    website: input.website ?? null,
    categories: [input.category],
    city_id: cityRow.id,
    home_sector: homeSector,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
    rating: null,
    review_count: null,
    types: [],
  });

  if (providerError) {
    throw new Error(`Failed to create provider: ${providerError.message}`);
  }

  const { error: membershipError } = await supabase.from("provider_memberships").insert({
    user_id: userId,
    provider_id: providerId,
    role: "owner",
    updated_at: new Date().toISOString(),
  });

  if (membershipError) {
    throw new Error(`Failed to create membership: ${membershipError.message}`);
  }

  const { error: profileError } = await supabase.from("provider_service_profiles").insert({
    provider_id: providerId,
    source_type: "manual",
    source_version: "provider_create_v1",
    booking_mode: input.bookingMode,
    offered_services: offeredServices,
    animator_types: input.animatorTypes,
    themes: input.themes,
    activities: input.activities,
    age_ranges: input.ageRanges,
    service_area_sectors:
      input.serviceAreaSectors.length > 0
        ? input.serviceAreaSectors
        : homeSector
          ? [homeSector]
          : [],
    price_min: input.priceMin,
    price_max: input.priceMax,
    generated_at: new Date().toISOString(),
  });

  if (profileError) {
    throw new Error(`Failed to create service profile: ${profileError.message}`);
  }

  const profile = await getProviderProfileForMember(supabase, providerId);
  if (!profile) {
    throw new Error("Provider created but profile could not be loaded");
  }

  return {
    providerId: profile.providerId,
    providerName: profile.providerName,
    placeId: profile.placeId,
    isManual: profile.isManual,
    description: profile.description,
    address: profile.address,
    phone: profile.phone,
    website: profile.website,
    lat: profile.lat,
    lng: profile.lng,
    categories: profile.categories,
    homeSector: profile.homeSector,
    rating: profile.rating,
    reviewCount: profile.reviewCount,
    bookingMode: profile.bookingMode,
    offeredServices: profile.offeredServices,
    animatorTypes: profile.animatorTypes,
    themes: profile.themes,
    activities: profile.activities,
    ageRanges: profile.ageRanges,
    serviceAreaSectors: profile.serviceAreaSectors,
    priceMin: profile.priceMin,
    priceMax: profile.priceMax,
    photos: [],
  };
}
