import type { SupabaseClient } from "@supabase/supabase-js";
import { formatBucharestDate } from "../lib/time-intervals.js";

export type ProviderReservationDto = {
  id: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
  origin: "manual";
  parentName: string;
  parentPhone: string | null;
  parentEmail: string | null;
  ageRange: string | null;
  guestCount: string | null;
  budget: string | null;
  sector: string | null;
  city: string | null;
  themeLabel: string | null;
  activities: string[];
  notes: string | null;
  status: "confirmed" | "cancelled";
  createdAt: string;
  updatedAt: string;
};

export type ProviderReservationInput = {
  startsAt: string;
  endsAt: string;
  parentName: string;
  parentPhone?: string | null;
  parentEmail?: string | null;
  ageRange?: string | null;
  guestCount?: string | null;
  budget?: string | null;
  sector?: string | null;
  city?: string | null;
  themeLabel?: string | null;
  activities?: string[];
  notes?: string | null;
};

function mapReservationRow(row: Record<string, unknown>): ProviderReservationDto {
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    startsAt: row.starts_at as string,
    endsAt: row.ends_at as string,
    origin: "manual",
    parentName: row.parent_name as string,
    parentPhone: (row.parent_phone as string | null) ?? null,
    parentEmail: (row.parent_email as string | null) ?? null,
    ageRange: (row.age_range as string | null) ?? null,
    guestCount: (row.guest_count as string | null) ?? null,
    budget: (row.budget as string | null) ?? null,
    sector: (row.sector as string | null) ?? null,
    city: (row.city as string | null) ?? null,
    themeLabel: (row.theme_label as string | null) ?? null,
    activities: (row.activities as string[] | null) ?? [],
    notes: (row.notes as string | null) ?? null,
    status: row.status as "confirmed" | "cancelled",
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const RESERVATION_SELECT = `
  id, provider_id, starts_at, ends_at, origin,
  parent_name, parent_phone, parent_email,
  age_range, guest_count, budget, sector, city,
  theme_label, activities, notes, status,
  created_at, updated_at
`;

async function lockAvailability(
  supabase: SupabaseClient,
  providerId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  const { error } = await supabase.rpc("lock_provider_availability_for_booking", {
    p_provider_id: providerId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  if (error) {
    throw new Error(`Failed to lock availability for reservation: ${error.message}`);
  }
}

async function releaseAvailabilityIfUnused(
  supabase: SupabaseClient,
  providerId: string,
  startsAt: string,
  endsAt: string,
): Promise<void> {
  const { data: holds } = await supabase.rpc("list_active_slot_hold_blockers", {
    p_provider_ids: [providerId],
    p_start_iso: startsAt,
    p_end_iso: endsAt,
  });
  const { data: bookings } = await supabase.rpc("list_confirmed_package_item_blockers", {
    p_provider_ids: [providerId],
    p_start_iso: startsAt,
    p_end_iso: endsAt,
  });
  const { data: manuals } = await supabase.rpc("list_confirmed_manual_reservation_blockers", {
    p_provider_ids: [providerId],
    p_start_iso: startsAt,
    p_end_iso: endsAt,
  });

  const stillBlocked =
    (holds ?? []).length > 0 || (bookings ?? []).length > 0 || (manuals ?? []).length > 0;
  if (stillBlocked) return;

  const date = formatBucharestDate(new Date(startsAt));
  await supabase
    .from("provider_availability")
    .delete()
    .eq("provider_id", providerId)
    .eq("starts_at", startsAt)
    .eq("ends_at", endsAt)
    .eq("source_type", "manual")
    .eq("status", "booked");

  // Also clear any overlapping booked mirrors that only existed for this slot.
  void date;
}

export async function listProviderReservations(
  supabase: SupabaseClient,
  providerId: string,
  options?: { includeCancelled?: boolean },
): Promise<ProviderReservationDto[]> {
  let query = supabase
    .from("provider_reservations")
    .select(RESERVATION_SELECT)
    .eq("provider_id", providerId)
    .order("starts_at", { ascending: false });

  if (!options?.includeCancelled) {
    query = query.eq("status", "confirmed");
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to list provider reservations: ${error.message}`);
  }
  return (data ?? []).map((row) => mapReservationRow(row as Record<string, unknown>));
}

export async function getProviderReservation(
  supabase: SupabaseClient,
  reservationId: string,
): Promise<ProviderReservationDto | null> {
  const { data, error } = await supabase
    .from("provider_reservations")
    .select(RESERVATION_SELECT)
    .eq("id", reservationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load provider reservation: ${error.message}`);
  }
  return data ? mapReservationRow(data as Record<string, unknown>) : null;
}

export async function createProviderReservation(
  supabase: SupabaseClient,
  providerId: string,
  userId: string,
  input: ProviderReservationInput,
): Promise<ProviderReservationDto> {
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new Error("endsAt must be after startsAt");
  }
  const parentName = input.parentName.trim();
  if (!parentName) {
    throw new Error("parentName is required");
  }

  const { data, error } = await supabase
    .from("provider_reservations")
    .insert({
      provider_id: providerId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      origin: "manual",
      parent_name: parentName,
      parent_phone: input.parentPhone?.trim() || null,
      parent_email: input.parentEmail?.trim() || null,
      age_range: input.ageRange || null,
      guest_count: input.guestCount || null,
      budget: input.budget || null,
      sector: input.sector || null,
      city: input.city?.trim() || "București",
      theme_label: input.themeLabel?.trim() || null,
      activities: input.activities ?? [],
      notes: input.notes?.trim() || null,
      status: "confirmed",
      created_by: userId,
    })
    .select(RESERVATION_SELECT)
    .single();

  if (error) {
    throw new Error(`Failed to create provider reservation: ${error.message}`);
  }

  await lockAvailability(supabase, providerId, input.startsAt, input.endsAt);
  return mapReservationRow(data as Record<string, unknown>);
}

export async function updateProviderReservation(
  supabase: SupabaseClient,
  providerId: string,
  reservationId: string,
  input: ProviderReservationInput,
): Promise<ProviderReservationDto> {
  if (Date.parse(input.endsAt) <= Date.parse(input.startsAt)) {
    throw new Error("endsAt must be after startsAt");
  }
  const parentName = input.parentName.trim();
  if (!parentName) {
    throw new Error("parentName is required");
  }

  const existing = await getProviderReservation(supabase, reservationId);
  if (!existing || existing.providerId !== providerId) {
    throw new Error("Reservation not found");
  }
  if (existing.status === "cancelled") {
    throw new Error("RESERVATION_CANCELLED");
  }

  const { data, error } = await supabase
    .from("provider_reservations")
    .update({
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      parent_name: parentName,
      parent_phone: input.parentPhone?.trim() || null,
      parent_email: input.parentEmail?.trim() || null,
      age_range: input.ageRange || null,
      guest_count: input.guestCount || null,
      budget: input.budget || null,
      sector: input.sector || null,
      city: input.city?.trim() || "București",
      theme_label: input.themeLabel?.trim() || null,
      activities: input.activities ?? [],
      notes: input.notes?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId)
    .eq("provider_id", providerId)
    .select(RESERVATION_SELECT)
    .single();

  if (error) {
    throw new Error(`Failed to update provider reservation: ${error.message}`);
  }

  const intervalChanged =
    existing.startsAt !== input.startsAt || existing.endsAt !== input.endsAt;
  if (intervalChanged) {
    await releaseAvailabilityIfUnused(supabase, providerId, existing.startsAt, existing.endsAt);
  }
  await lockAvailability(supabase, providerId, input.startsAt, input.endsAt);
  return mapReservationRow(data as Record<string, unknown>);
}

export async function cancelProviderReservation(
  supabase: SupabaseClient,
  providerId: string,
  reservationId: string,
): Promise<ProviderReservationDto> {
  const existing = await getProviderReservation(supabase, reservationId);
  if (!existing || existing.providerId !== providerId) {
    throw new Error("Reservation not found");
  }

  const { data, error } = await supabase
    .from("provider_reservations")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", reservationId)
    .eq("provider_id", providerId)
    .select(RESERVATION_SELECT)
    .single();

  if (error) {
    throw new Error(`Failed to cancel provider reservation: ${error.message}`);
  }

  await releaseAvailabilityIfUnused(supabase, providerId, existing.startsAt, existing.endsAt);
  return mapReservationRow(data as Record<string, unknown>);
}
