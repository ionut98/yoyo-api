import type { SupabaseClient } from "@supabase/supabase-js";
import { toPartyDto } from "../mappers/parties.js";
import type { CreatePartyBody, ListPartiesResponse, PartyDto } from "../schemas/parties.js";

const PARTY_SELECT = `
  id, age_range, budget, guest_count, date_preference, preferred_date,
  sector, theme_id, theme_custom, activities, status, city, created_at, updated_at
`;

const BOOKING_STATUS_PRIORITY: Record<string, number> = {
  confirmed: 60,
  partially_confirmed: 50,
  requested: 40,
  failed: 30,
  expired: 20,
  cancelled: 10,
};

function normalizeBookingStatus(value: string | null | undefined): PartyDto["bookingStatus"] {
  if (
    value === "requested" ||
    value === "partially_confirmed" ||
    value === "confirmed" ||
    value === "failed" ||
    value === "expired" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "none";
}

async function bookingStatusByPartyId(
  supabase: SupabaseClient,
  partyIds: string[],
): Promise<Map<string, PartyDto["bookingStatus"]>> {
  const result = new Map<string, PartyDto["bookingStatus"]>();
  if (partyIds.length === 0) return result;

  const { data, error } = await supabase
    .from("party_packages")
    .select("party_id, status, requested_at")
    .in("party_id", partyIds)
    .neq("status", "proposed")
    .order("requested_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load party booking status: ${error.message}`);
  }

  for (const row of data ?? []) {
    const partyId = row.party_id as string;
    const next = normalizeBookingStatus(row.status as string);
    const current = result.get(partyId) ?? "none";
    if ((BOOKING_STATUS_PRIORITY[next] ?? 0) >= (BOOKING_STATUS_PRIORITY[current] ?? 0)) {
      result.set(partyId, next);
    }
  }

  return result;
}

export async function listPartiesForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<ListPartiesResponse> {
  const { data, error } = await supabase
    .from("parties")
    .select(PARTY_SELECT)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to list parties: ${error.message}`);
  }

  const rows = data ?? [];
  const bookingByParty = await bookingStatusByPartyId(
    supabase,
    rows.map((row) => row.id as string),
  );

  return {
    data: rows.map((row) =>
      toPartyDto(row, bookingByParty.get(row.id as string) ?? "none"),
    ),
  };
}

export async function createPartyForUser(
  supabase: SupabaseClient,
  userId: string,
  body: CreatePartyBody,
): Promise<PartyDto> {
  const preferredDate =
    body.datePreference === "pick_date" && body.preferredDate
      ? body.preferredDate.slice(0, 10)
      : null;

  const themeCustom = body.themeId === "custom" ? (body.themeCustom?.trim() || null) : null;

  const { data, error } = await supabase
    .from("parties")
    .insert({
      user_id: userId,
      age_range: body.ageRange,
      budget: body.budget,
      guest_count: body.guestCount,
      date_preference: body.datePreference,
      preferred_date: preferredDate,
      sector: body.sector,
      theme_id: body.themeId,
      theme_custom: themeCustom,
      activities: body.activities,
      status: "intake",
      city: body.city,
    })
    .select(PARTY_SELECT)
    .single();

  if (error) {
    throw new Error(`Failed to create party: ${error.message}`);
  }

  return toPartyDto(data);
}

export async function getPartyById(
  supabase: SupabaseClient,
  userId: string,
  partyId: string,
): Promise<PartyDto | null> {
  const { data, error } = await supabase
    .from("parties")
    .select(PARTY_SELECT)
    .eq("user_id", userId)
    .eq("id", partyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get party: ${error.message}`);
  }

  return data ? toPartyDto(data) : null;
}
