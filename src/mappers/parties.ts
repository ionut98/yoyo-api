import type { PartyDto } from "../schemas/parties.js";

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
