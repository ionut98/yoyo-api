import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderCategory } from "../schemas/providers.js";
import { formatBucharestDate, intervalsOverlap } from "../lib/time-intervals.js";

export type ProviderProfileRow = {
  providerId: string;
  providerName: string;
  placeId: string;
  isManual: boolean;
  address: string | null;
  phone: string | null;
  website: string | null;
  categories: ProviderCategory[];
  city: string | null;
  homeSector: string | null;
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
  id: string;
  providerId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  status: "available" | "booked";
  source?: "availability" | "booking" | "hold";
};

function normalizeCategory(value: string): ProviderCategory | null {
  if (value === "venue" || value === "entertainment" || value === "balloons" || value === "cakes") {
    return value;
  }
  return null;
}

function mapProfileRow(row: any, cityFallback: string | null = null): ProviderProfileRow | null {
  const provider = Array.isArray(row.provider) ? row.provider[0] : row.provider;
  if (!provider?.id) return null;
  const categories = ((provider.categories as string[] | null) ?? [])
    .map(normalizeCategory)
    .filter((value): value is ProviderCategory => value !== null);

  const cityRelation = provider.city as { name?: string } | Array<{ name?: string }> | null | undefined;
  const placeId = (provider.place_id as string | null | undefined) ?? "";

  return {
    providerId: provider.id as string,
    providerName: provider.name as string,
    placeId,
    isManual: placeId.startsWith("manual:"),
    address: (provider.address as string | null | undefined) ?? null,
    phone: (provider.phone as string | null | undefined) ?? null,
    website: (provider.website as string | null | undefined) ?? null,
    categories,
    city: Array.isArray(cityRelation)
      ? (cityRelation[0]?.name ?? cityFallback)
      : (cityRelation?.name ?? cityFallback),
    homeSector: (provider.home_sector as string | null | undefined) ?? null,
    rating: provider.rating === null || provider.rating === undefined ? null : Number(provider.rating),
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
        place_id,
        name,
        address,
        phone,
        website,
        categories,
        home_sector,
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
    .map((row) => mapProfileRow(row, cityRow.name as string))
    .filter((row): row is ProviderProfileRow => Boolean(row))
    .reduce<ProviderProfileRow[]>((acc, row) => {
      const existingIndex = acc.findIndex((item) => item.providerId === row.providerId);
      if (existingIndex < 0) {
        acc.push(row);
        return acc;
      }
      // Prefer already-mapped row; first wins after SQL order. Keep higher price-min order as-is.
      return acc;
    }, []);
}

export async function listEffectiveAvailability(
  supabase: SupabaseClient,
  options: { providerIds: string[]; date: string },
): Promise<EffectiveAvailabilityRow[]> {
  const dayStart = `${options.date}T00:00:00.000Z`;
  const next = new Date(`${options.date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + 2);
  return listEffectiveAvailabilityRange(supabase, {
    providerIds: options.providerIds,
    startIso: dayStart,
    endIso: next.toISOString(),
  }).then((rows) => rows.filter((row) => row.date === options.date));
}

export async function listEffectiveAvailabilityRange(
  supabase: SupabaseClient,
  options: { providerIds: string[]; startIso: string; endIso: string },
): Promise<EffectiveAvailabilityRow[]> {
  if (options.providerIds.length === 0) {
    return [];
  }

  const { data: baseRows, error: baseError } = await supabase
    .from("provider_availability")
    .select("id, provider_id, date, starts_at, ends_at, status")
    .in("provider_id", options.providerIds)
    .lt("starts_at", options.endIso)
    .gt("ends_at", options.startIso)
    .limit(5000);

  if (baseError) {
    throw new Error(`Failed to load provider availability: ${baseError.message}`);
  }

  const { data: activeHolds, error: holdsError } = await supabase
    .from("slot_holds")
    .select("provider_id, starts_at, ends_at")
    .in("provider_id", options.providerIds)
    .lt("starts_at", options.endIso)
    .gt("ends_at", options.startIso)
    .eq("status", "active")
    .gt("expires_at", new Date().toISOString())
    .limit(5000);

  if (holdsError) {
    throw new Error(`Failed to load slot holds: ${holdsError.message}`);
  }

  const { data: confirmedItems, error: itemsError } = await supabase
    .from("party_package_items")
    .select("provider_id, starts_at, ends_at")
    .in("provider_id", options.providerIds)
    .lt("starts_at", options.endIso)
    .gt("ends_at", options.startIso)
    .eq("item_status", "confirmed")
    .limit(5000);

  if (itemsError) {
    throw new Error(`Failed to load confirmed package items: ${itemsError.message}`);
  }

  const blockers = [...(activeHolds ?? []), ...(confirmedItems ?? [])].map((row) => ({
    providerId: row.provider_id as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
  }));

  const availabilityEvents: EffectiveAvailabilityRow[] = (baseRows ?? []).map((row) => {
    const startsAt = row.starts_at as string;
    const endsAt = row.ends_at as string;
    const providerId = row.provider_id as string;
    const blocked = blockers.some(
      (block) =>
        block.providerId === providerId &&
        intervalsOverlap(startsAt, endsAt, block.startsAt, block.endsAt),
    );
    return {
      id: row.id as string,
      providerId,
      date: (row.date as string) ?? formatBucharestDate(new Date(startsAt)),
      startsAt,
      endsAt,
      status: blocked || row.status === "booked" ? ("booked" as const) : ("available" as const),
      source: "availability" as const,
    };
  });

  const coveredKeys = new Set(
    availabilityEvents.map((row) => `${row.providerId}|${row.startsAt}|${row.endsAt}`),
  );

  // Surface confirmed bookings even when no matching availability row exists yet.
  const bookingEvents: EffectiveAvailabilityRow[] = [];
  for (const row of confirmedItems ?? []) {
    const providerId = row.provider_id as string;
    const startsAt = row.starts_at as string;
    const endsAt = row.ends_at as string;
    const key = `${providerId}|${startsAt}|${endsAt}`;
    if (coveredKeys.has(key)) continue;
    bookingEvents.push({
      id: `booking:${providerId}:${startsAt}:${endsAt}`,
      providerId,
      date: formatBucharestDate(new Date(startsAt)),
      startsAt,
      endsAt,
      status: "booked",
      source: "booking",
    });
  }

  return [...availabilityEvents, ...bookingEvents];
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
      source_type,
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
        id, place_id, name, address, phone, website, categories, home_sector,
        rating, review_count, recommendation_score
      )
    `,
    )
    .eq("provider_id", providerId)
    .order("source_type", { ascending: true });

  if (error) {
    throw new Error(`Failed to load provider profile: ${error.message}`);
  }

  const rows = data ?? [];
  const preferred =
    rows.find((row) => row.source_type === "real") ??
    rows.find((row) => row.source_type === "manual") ??
    rows[0];
  if (!preferred?.provider) {
    return null;
  }
  return mapProfileRow(preferred);
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
    providerName?: string;
    address?: string | null;
    phone?: string | null;
    website?: string | null;
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

  const identityPatch: Record<string, unknown> = {};
  if (input.providerName !== undefined) identityPatch.name = input.providerName;
  if (input.address !== undefined) identityPatch.address = input.address;
  if (input.phone !== undefined) identityPatch.phone = input.phone;
  if (input.website !== undefined) identityPatch.website = input.website;

  if (Object.keys(identityPatch).length > 0) {
    identityPatch.updated_at = new Date().toISOString();
    const { error: providerError } = await supabase
      .from("providers")
      .update(identityPatch)
      .eq("id", providerId)
      .like("place_id", "manual:%");

    if (providerError) {
      throw new Error(`Failed to update provider identity: ${providerError.message}`);
    }
  }
}

export async function upsertProviderAvailability(
  supabase: SupabaseClient,
  providerId: string,
  input: {
    id?: string;
    startsAt: string;
    endsAt: string;
    status: "available" | "booked";
  },
): Promise<{ id: string }> {
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new Error("endsAt must be after startsAt");
  }

  const date = formatBucharestDate(new Date(input.startsAt));
  const payload = {
    provider_id: providerId,
    date,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    status: input.status,
    source_type: "manual",
    source_version: "provider_console_v2",
    generated_at: new Date().toISOString(),
  };

  if (input.id) {
    const { data, error } = await supabase
      .from("provider_availability")
      .update(payload)
      .eq("id", input.id)
      .eq("provider_id", providerId)
      .select("id")
      .single();
    if (error) {
      throw new Error(`Failed to update provider availability: ${error.message}`);
    }
    return { id: data.id as string };
  }

  const { data, error } = await supabase
    .from("provider_availability")
    .upsert(payload, { onConflict: "provider_id,starts_at,ends_at,source_type" })
    .select("id")
    .single();

  if (error) {
    throw new Error(`Failed to upsert provider availability: ${error.message}`);
  }
  return { id: data.id as string };
}

export async function deleteProviderAvailability(
  supabase: SupabaseClient,
  providerId: string,
  id: string,
): Promise<void> {
  const { error } = await supabase
    .from("provider_availability")
    .delete()
    .eq("id", id)
    .eq("provider_id", providerId);

  if (error) {
    throw new Error(`Failed to delete provider availability: ${error.message}`);
  }
}

/** @deprecated use upsertProviderAvailability */
export async function updateProviderAvailability(
  supabase: SupabaseClient,
  providerId: string,
  input: {
    startsAt: string;
    endsAt: string;
    status: "available" | "booked";
    id?: string;
  },
): Promise<void> {
  await upsertProviderAvailability(supabase, providerId, input);
}
