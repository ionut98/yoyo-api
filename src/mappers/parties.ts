import type { PartyDto, PartyScheduleItemDto } from "../schemas/parties.js";

type DbPartyRow = {
  id: string;
  age_range: string | null;
  budget: string | null;
  guest_count: string | null;
  date_preference: string | null;
  preferred_date: string | null;
  sector: string | null;
  theme_id: string | null;
  theme_custom: string | null;
  activities: string[] | null;
  status: string;
  city: string;
  notes?: string | null;
  party_starts_at?: string | null;
  party_ends_at?: string | null;
  created_at: string;
  updated_at: string;
};

type DbScheduleRow = {
  id: string;
  party_id: string;
  kind: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  notes: string | null;
  package_item_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export function toPartyDto(
  row: DbPartyRow,
  bookingStatus: PartyDto["bookingStatus"] = "none",
): PartyDto {
  return {
    id: row.id,
    ageRange: row.age_range,
    budget: row.budget,
    guestCount: row.guest_count,
    datePreference: row.date_preference,
    preferredDate: row.preferred_date,
    sector: row.sector,
    themeId: row.theme_id,
    themeCustom: row.theme_custom,
    activities: row.activities ?? [],
    status: row.status,
    bookingStatus,
    city: row.city,
    notes: row.notes ?? null,
    partyStartsAt: row.party_starts_at ?? null,
    partyEndsAt: row.party_ends_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toScheduleItemDto(row: DbScheduleRow): PartyScheduleItemDto {
  return {
    id: row.id,
    partyId: row.party_id,
    kind: row.kind as PartyScheduleItemDto["kind"],
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    notes: row.notes,
    packageItemId: row.package_item_id,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
