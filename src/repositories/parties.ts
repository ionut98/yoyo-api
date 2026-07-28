import type { SupabaseClient } from "@supabase/supabase-js";
import { toPartyDto } from "../mappers/parties.js";
import type { CreatePartyBody, ListPartiesResponse, PartyDto } from "../schemas/parties.js";

const PARTY_SELECT = `
  id, age_range, budget, guest_count, date_preference, preferred_date,
  sector, theme_id, theme_custom, activities, status, city, created_at, updated_at
`;

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

  return {
    data: (data ?? []).map(toPartyDto),
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
