import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderCategory } from "../schemas/providers.js";

export type ProviderProfileRow = {
  providerId: string;
  providerName: string;
  categories: ProviderCategory[];
  city: string | null;
  rating: number | null;
  reviewCount: number | null;
  recommendationScore: number | null;
  profileId: string;
  bookingMode: "instant" | "request";
  offeredServices: Array<"space" | "entertainment" | "balloons" | "cakes">;
  animatorTypes: string[];
  themes: string[];
  activities: string[];
  ageRanges: string[];
  serviceAreaSectors: string[];
  priceMin: number;
  priceMax: number;
};

export type EffectiveAvailabilityRow = {
  providerId: string;
  date: string;
  slot: "morning" | "afternoon";
  status: "available" | "limited" | "booked";
};

function normalizeCategory(value: string): ProviderCategory | null {
  if (value === "venue" || value === "entertainment" || value === "balloons" || value === "cakes") {
    return value;
  }
  return null;
}

export async function listProviderProfilesForCity(
  supabase: SupabaseClient,
  city: string,
): Promise<ProviderProfileRow[]> {
  const { data: cityRow, error: cityError } = await supabase
    .from("cities")
    .select("id, name")
    .eq("name", city)
    .maybeSingle();

  if (cityError) {
    throw new Error(`Failed to resolve city: ${cityError.message}`);
  }
  if (!cityRow?.id) {
    return [];
  }

  const { data, error } = await supabase
    .from("provider_service_profiles")
    .select(
      `
      id,
      booking_mode,
      offered_services,
      animator_types,
      themes,
      activities,
      age_ranges,
      service_area_sectors,
      price_min,
      price_max,
      provider:providers!inner(
        id,
        name,
        categories,
        rating,
        review_count,
        recommendation_score,
        city:cities(name)
      )
    `,
    )
    .eq("provider.city_id", cityRow.id)
    .order("price_min", { ascending: true });

  if (error) {
    throw new Error(`Failed to load provider profiles: ${error.message}`);
  }

  return (data ?? [])
    .map((row) => {
      const provider = Array.isArray(row.provider) ? row.provider[0] : row.provider;
      if (!provider?.id) return null;
      const categories = ((provider.categories as string[] | null) ?? [])
        .map(normalizeCategory)
        .filter((value): value is ProviderCategory => value !== null);

      const cityRelation = provider.city as { name?: string } | Array<{ name?: string }> | null | undefined;

      return {
        providerId: provider.id as string,
        providerName: provider.name as string,
        categories,
        city: Array.isArray(cityRelation)
          ? (cityRelation[0]?.name ?? null)
          : (cityRelation?.name ?? null),
        rating:
          provider.rating === null || provider.rating === undefined ? null : Number(provider.rating),
        reviewCount:
          provider.review_count === null || provider.review_count === undefined
            ? null
            : Number(provider.review_count),
        recommendationScore:
          provider.recommendation_score === null || provider.recommendation_score === undefined
            ? null
            : Number(provider.recommendation_score),
        profileId: row.id as string,
        bookingMode: (row.booking_mode as "instant" | "request") ?? "request",
        offeredServices: ((row.offered_services as string[] | null) ?? []).filter(
          (value): value is "space" | "entertainment" | "balloons" | "cakes" =>
            value === "space" || value === "entertainment" || value === "balloons" || value === "cakes",
        ),
        animatorTypes: (row.animator_types as string[] | null) ?? [],
        themes: (row.themes as string[] | null) ?? [],
        activities: (row.activities as string[] | null) ?? [],
        ageRanges: (row.age_ranges as string[] | null) ?? [],
        serviceAreaSectors: (row.service_area_sectors as string[] | null) ?? [],
        priceMin: Number(row.price_min),
        priceMax: Number(row.price_max),
      };
    })
    .filter((row): row is ProviderProfileRow => Boolean(row));
}

export async function listEffectiveAvailability(
  supabase: SupabaseClient,
  options: { providerIds: string[]; date: string },
): Promise<EffectiveAvailabilityRow[]> {
  return listEffectiveAvailabilityRange(supabase, {
    providerIds: options.providerIds,
    startDate: options.date,
    endDate: options.date,
  });
}

export async function listEffectiveAvailabilityRange(
  supabase: SupabaseClient,
  options: { providerIds: string[]; startDate: string; endDate: string },
): Promise<EffectiveAvailabilityRow[]> {
  if (options.providerIds.length === 0) {
    return [];
  }

  const { data: baseRows, error: baseError } = await supabase
    .from("provider_availability")
    .select("provider_id, date, slot, status")
    .in("provider_id", options.providerIds)
    .gte("date", options.startDate)
    .lte("date", options.endDate)
    .limit(5000);

  if (baseError) {
    throw new Error(`Failed to load provider availability: ${baseError.message}`);
  }

  const { data: activeHolds, error: holdsError } = await supabase
    .from("slot_holds")
    .select("provider_id, date, slot")
    .in("provider_id", options.providerIds)
    .gte("date", options.startDate)
    .lte("date", options.endDate)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .limit(5000);

  if (holdsError) {
    throw new Error(`Failed to load slot holds: ${holdsError.message}`);
  }

  const { data: confirmedItems, error: itemsError } = await supabase
    .from("party_package_items")
    .select("provider_id, date, slot")
    .in("provider_id", options.providerIds)
    .gte("date", options.startDate)
    .lte("date", options.endDate)
    .eq("item_status", "confirmed")
    .limit(5000);

  if (itemsError) {
    throw new Error(`Failed to load confirmed package items: ${itemsError.message}`);
  }

  const blocked = new Set<string>();
  for (const row of [...(activeHolds ?? []), ...(confirmedItems ?? [])]) {
    blocked.add(`${row.provider_id}:${row.date}:${row.slot}`);
  }

  return (baseRows ?? []).map((row) => ({
    providerId: row.provider_id as string,
    date: row.date as string,
    slot: row.slot as "morning" | "afternoon",
    status: blocked.has(`${row.provider_id}:${row.date}:${row.slot}`)
      ? "booked"
      : ((row.status as "available" | "limited" | "booked") ?? "booked"),
  }));
}

export async function getProviderProfileForMember(
  supabase: SupabaseClient,
  providerId: string,
): Promise<ProviderProfileRow | null> {
  const { data, error } = await supabase
    .from("provider_service_profiles")
    .select(
      `
      id,
      booking_mode,
      offered_services,
      animator_types,
      themes,
      activities,
      age_ranges,
      service_area_sectors,
      price_min,
      price_max,
      provider:providers!inner(id, name, categories, rating, review_count, recommendation_score)
    `,
    )
    .eq("provider_id", providerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load provider profile: ${error.message}`);
  }
  if (!data?.provider) {
    return null;
  }
  const provider = Array.isArray(data.provider) ? data.provider[0] : data.provider;
  const categories = ((provider.categories as string[] | null) ?? [])
    .map(normalizeCategory)
    .filter((value): value is ProviderCategory => value !== null);

  return {
    providerId: provider.id as string,
    providerName: provider.name as string,
    categories,
    city: null,
    rating: provider.rating === null || provider.rating === undefined ? null : Number(provider.rating),
    reviewCount:
      provider.review_count === null || provider.review_count === undefined
        ? null
        : Number(provider.review_count),
    recommendationScore:
      provider.recommendation_score === null || provider.recommendation_score === undefined
        ? null
        : Number(provider.recommendation_score),
    profileId: data.id as string,
    bookingMode: (data.booking_mode as "instant" | "request") ?? "request",
    offeredServices: ((data.offered_services as string[] | null) ?? []).filter(
      (value): value is "space" | "entertainment" | "balloons" | "cakes" =>
        value === "space" || value === "entertainment" || value === "balloons" || value === "cakes",
    ),
    animatorTypes: (data.animator_types as string[] | null) ?? [],
    themes: (data.themes as string[] | null) ?? [],
    activities: (data.activities as string[] | null) ?? [],
    ageRanges: (data.age_ranges as string[] | null) ?? [],
    serviceAreaSectors: (data.service_area_sectors as string[] | null) ?? [],
    priceMin: Number(data.price_min),
    priceMax: Number(data.price_max),
  };
}

export async function updateProviderProfile(
  supabase: SupabaseClient,
  providerId: string,
  input: {
    bookingMode: "instant" | "request";
    offeredServices: string[];
    animatorTypes: string[];
    themes: string[];
    activities: string[];
    ageRanges: string[];
    serviceAreaSectors: string[];
    priceMin: number;
    priceMax: number;
  },
): Promise<void> {
  const { error } = await supabase
    .from("provider_service_profiles")
    .update({
      booking_mode: input.bookingMode,
      offered_services: input.offeredServices,
      animator_types: input.animatorTypes,
      themes: input.themes,
      activities: input.activities,
      age_ranges: input.ageRanges,
      service_area_sectors: input.serviceAreaSectors,
      price_min: input.priceMin,
      price_max: input.priceMax,
      source_type: "manual",
      updated_at: new Date().toISOString(),
    })
    .eq("provider_id", providerId);

  if (error) {
    throw new Error(`Failed to update provider profile: ${error.message}`);
  }
}

export async function updateProviderAvailability(
  supabase: SupabaseClient,
  providerId: string,
  input: { date: string; slot: "morning" | "afternoon"; status: "available" | "limited" | "booked" },
): Promise<void> {
  const { error } = await supabase
    .from("provider_availability")
    .upsert(
      {
        provider_id: providerId,
        date: input.date,
        slot: input.slot,
        status: input.status,
        source_type: "manual",
        source_version: "provider_console_v1",
        generated_at: new Date().toISOString(),
      },
      { onConflict: "provider_id,date,slot,source_type" },
    );

  if (error) {
    throw new Error(`Failed to update provider availability: ${error.message}`);
  }
}
