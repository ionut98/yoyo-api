import type { SupabaseClient } from "@supabase/supabase-js";
import { toPartyDto, toScheduleItemDto } from "../mappers/parties.js";
import type {
  CreatePartyBody,
  ListPartiesResponse,
  PartyDto,
  PartyHubResponse,
  PartyScheduleItemDto,
  PatchPartyBody,
  PutScheduleBody,
} from "../schemas/parties.js";
import { formatBucharestDate } from "../lib/time-intervals.js";
import { expireStalePackageRequests } from "../services/booking/package-requests.js";

const PARTY_SELECT = `
  id, age_range, budget, guest_count, date_preference, preferred_date,
  sector, theme_id, theme_custom, activities, status, city,
  notes, party_starts_at, party_ends_at, created_at, updated_at
`;

const SCHEDULE_SELECT = `
  id, party_id, kind, title, starts_at, ends_at, notes, package_item_id,
  sort_order, created_at, updated_at
`;

const BOOKING_STATUS_PRIORITY: Record<string, number> = {
  confirmed: 60,
  partially_confirmed: 50,
  requested: 40,
  failed: 30,
  expired: 20,
};

const ROLE_LABEL: Record<string, string> = {
  space: "Locație",
  entertainment: "Animație",
  balloons: "Baloane",
  cakes: "Tort",
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
    .neq("status", "cancelled")
    .order("requested_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load party booking status: ${error.message}`);
  }

  for (const row of data ?? []) {
    const partyId = row.party_id as string;
    const next = normalizeBookingStatus(row.status as string);
    if (next === "none" || next === "cancelled") continue;
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
  await expireStalePackageRequests(supabase);

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
  await expireStalePackageRequests(supabase);

  const { data, error } = await supabase
    .from("parties")
    .select(PARTY_SELECT)
    .eq("user_id", userId)
    .eq("id", partyId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get party: ${error.message}`);
  }

  if (!data) return null;

  const bookingByParty = await bookingStatusByPartyId(supabase, [partyId]);
  return toPartyDto(data, bookingByParty.get(partyId) ?? "none");
}

export async function patchPartyForUser(
  supabase: SupabaseClient,
  userId: string,
  partyId: string,
  body: PatchPartyBody,
): Promise<PartyDto | null> {
  const hub = await getPartyHubForUser(supabase, userId, partyId);
  if (!hub) return null;
  const existing = hub.party;

  assertPartyEditable(hub);

  const nextStarts =
    body.partyStartsAt !== undefined ? body.partyStartsAt : existing.partyStartsAt;
  const nextEnds = body.partyEndsAt !== undefined ? body.partyEndsAt : existing.partyEndsAt;

  if (nextStarts && nextEnds && new Date(nextEnds).getTime() <= new Date(nextStarts).getTime()) {
    throw new Error("INVALID_PARTY_WINDOW");
  }

  const partyDay = resolvePartyDay(hub);
  if (partyDay) {
    if (body.partyStartsAt) {
      if (formatBucharestDate(new Date(body.partyStartsAt)) !== partyDay) {
        throw new Error("PARTY_DAY_MISMATCH");
      }
    }
    if (body.partyEndsAt) {
      if (formatBucharestDate(new Date(body.partyEndsAt)) !== partyDay) {
        throw new Error("PARTY_DAY_MISMATCH");
      }
    }
  }

  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };
  if (body.notes !== undefined) patch.notes = body.notes;
  if (body.partyStartsAt !== undefined) patch.party_starts_at = body.partyStartsAt;
  if (body.partyEndsAt !== undefined) patch.party_ends_at = body.partyEndsAt;

  const { data, error } = await supabase
    .from("parties")
    .update(patch)
    .eq("user_id", userId)
    .eq("id", partyId)
    .select(PARTY_SELECT)
    .single();

  if (error) {
    throw new Error(`Failed to update party: ${error.message}`);
  }

  return toPartyDto(data, existing.bookingStatus);
}

function resolvePartyDay(hub: PartyHubResponse): string | null {
  if (hub.booking?.targetDate) return hub.booking.targetDate.slice(0, 10);
  if (hub.party.preferredDate) return hub.party.preferredDate.slice(0, 10);
  if (hub.booking?.targetStartsAt) {
    return formatBucharestDate(new Date(hub.booking.targetStartsAt));
  }
  if (hub.party.partyStartsAt) {
    return formatBucharestDate(new Date(hub.party.partyStartsAt));
  }
  return null;
}

function assertPartyEditable(hub: PartyHubResponse): void {
  const endIso =
    hub.party.partyEndsAt ?? hub.booking?.targetEndsAt ?? hub.party.partyStartsAt ?? null;
  if (!endIso) return;
  if (Date.parse(endIso) < Date.now()) {
    throw new Error("PARTY_IN_PAST");
  }
}

type BookingSummary = NonNullable<PartyHubResponse["booking"]>;

async function getActiveBookingSummary(
  supabase: SupabaseClient,
  partyId: string,
): Promise<BookingSummary | null> {
  const { data, error } = await supabase
    .from("party_packages")
    .select(
      `
      id, status, booking_kind, target_date, target_starts_at, target_ends_at,
      estimated_price_min, estimated_price_max, requested_at,
      party_package_items(
        id, provider_id, role, starts_at, ends_at, item_status,
        provider:providers(name)
      )
    `,
    )
    .eq("party_id", partyId)
    .neq("status", "proposed")
    .neq("status", "cancelled")
    .order("requested_at", { ascending: false })
    .limit(8);

  if (error) {
    throw new Error(`Failed to load party booking: ${error.message}`);
  }

  const rows = data ?? [];
  if (rows.length === 0) return null;

  rows.sort((a, b) => {
    const pa = BOOKING_STATUS_PRIORITY[a.status as string] ?? 0;
    const pb = BOOKING_STATUS_PRIORITY[b.status as string] ?? 0;
    return pb - pa;
  });

  const row = rows[0];
  const items = ((row.party_package_items as any[]) ?? []).map((item) => {
    const provider = Array.isArray(item.provider) ? item.provider[0] : item.provider;
    return {
      id: item.id as string,
      providerId: item.provider_id as string,
      providerName: (provider?.name as string | undefined) ?? "Furnizor",
      role: item.role as string,
      startsAt: (item.starts_at as string | null) ?? null,
      endsAt: (item.ends_at as string | null) ?? null,
      itemStatus: item.item_status as string,
    };
  });

  return {
    packageId: row.id as string,
    status: row.status as string,
    bookingKind: row.booking_kind as string,
    targetDate: String(row.target_date).slice(0, 10),
    targetStartsAt: row.target_starts_at as string,
    targetEndsAt: row.target_ends_at as string,
    estimatedPriceMin: Number(row.estimated_price_min),
    estimatedPriceMax: Number(row.estimated_price_max),
    items,
  };
}

export async function listScheduleForParty(
  supabase: SupabaseClient,
  userId: string,
  partyId: string,
): Promise<PartyScheduleItemDto[] | null> {
  const party = await getPartyById(supabase, userId, partyId);
  if (!party) return null;

  const { data, error } = await supabase
    .from("party_schedule_items")
    .select(SCHEDULE_SELECT)
    .eq("party_id", partyId)
    .order("sort_order", { ascending: true })
    .order("starts_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list schedule: ${error.message}`);
  }

  return (data ?? []).map((row) => toScheduleItemDto(row));
}

export async function getPartyHubForUser(
  supabase: SupabaseClient,
  userId: string,
  partyId: string,
): Promise<PartyHubResponse | null> {
  const party = await getPartyById(supabase, userId, partyId);
  if (!party) return null;

  const [booking, schedule] = await Promise.all([
    getActiveBookingSummary(supabase, partyId),
    listScheduleForParty(supabase, userId, partyId),
  ]);

  return {
    party,
    booking,
    schedule: schedule ?? [],
  };
}

export async function replaceScheduleForParty(
  supabase: SupabaseClient,
  userId: string,
  partyId: string,
  body: PutScheduleBody,
): Promise<PartyScheduleItemDto[] | null> {
  const hub = await getPartyHubForUser(supabase, userId, partyId);
  if (!hub) return null;

  assertPartyEditable(hub);

  const partyDay = resolvePartyDay(hub);
  const lockedByPackageItemId = new Map(
    (hub.booking?.items ?? [])
      .filter((item) => item.startsAt && item.endsAt)
      .map((item) => [
        item.id,
        { startsAt: item.startsAt as string, endsAt: item.endsAt as string },
      ]),
  );

  for (const item of body.items) {
    if (partyDay) {
      if (formatBucharestDate(new Date(item.startsAt)) !== partyDay) {
        throw new Error("PARTY_DAY_MISMATCH");
      }
      if (item.endsAt && formatBucharestDate(new Date(item.endsAt)) !== partyDay) {
        throw new Error("PARTY_DAY_MISMATCH");
      }
    }

    if (!item.packageItemId) continue;
    const locked = lockedByPackageItemId.get(item.packageItemId);
    if (!locked) {
      throw new Error("PROVIDER_TIMES_LOCKED");
    }
    if (Date.parse(item.startsAt) !== Date.parse(locked.startsAt) ||
      Date.parse(item.endsAt ?? "") !== Date.parse(locked.endsAt)) {
      throw new Error("PROVIDER_TIMES_LOCKED");
    }
  }

  const { error: deleteError } = await supabase
    .from("party_schedule_items")
    .delete()
    .eq("party_id", partyId);

  if (deleteError) {
    throw new Error(`Failed to clear schedule: ${deleteError.message}`);
  }

  if (body.items.length === 0) {
    return [];
  }

  const now = new Date().toISOString();
  const rows = body.items.map((item, index) => {
    const row: Record<string, unknown> = {
      party_id: partyId,
      kind: item.kind,
      title: item.title.trim(),
      starts_at: item.startsAt,
      ends_at: item.endsAt ?? null,
      notes: item.notes?.trim() ? item.notes.trim() : null,
      package_item_id: item.packageItemId ?? null,
      sort_order: item.sortOrder ?? index,
      created_at: now,
      updated_at: now,
    };
    if (item.id) row.id = item.id;
    return row;
  });

  const { data, error } = await supabase
    .from("party_schedule_items")
    .insert(rows)
    .select(SCHEDULE_SELECT)
    .order("sort_order", { ascending: true });

  if (error) {
    throw new Error(`Failed to save schedule: ${error.message}`);
  }

  return (data ?? []).map((row) => toScheduleItemDto(row));
}

function shiftMinutes(iso: string, minutes: number): string {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

export async function seedScheduleForParty(
  supabase: SupabaseClient,
  userId: string,
  partyId: string,
): Promise<PartyHubResponse | null> {
  const hub = await getPartyHubForUser(supabase, userId, partyId);
  if (!hub) return null;

  if (hub.schedule.length > 0) {
    throw new Error("SCHEDULE_NOT_EMPTY");
  }

  const booking = hub.booking;
  if (!booking) {
    throw new Error("NO_ACTIVE_BOOKING");
  }

  const confirmedLike = booking.items.filter((item) =>
    ["confirmed", "held", "proposed"].includes(item.itemStatus),
  );
  const providerItems = (confirmedLike.length > 0 ? confirmedLike : booking.items).filter(
    (item) => item.startsAt && item.endsAt,
  );

  const windowStart = booking.targetStartsAt;
  const windowEnd = booking.targetEndsAt;

  await patchPartyForUser(supabase, userId, partyId, {
    partyStartsAt: windowStart,
    partyEndsAt: windowEnd,
  });

  const items: PutScheduleBody["items"] = [];
  let order = 0;

  items.push({
    kind: "arrival",
    title: "Sosire invitați",
    startsAt: shiftMinutes(windowStart, -30),
    endsAt: windowStart,
    notes: "Bun venit, fotografii, așezare",
    sortOrder: order++,
  });

  for (const item of providerItems) {
    if (!item.startsAt) continue;
    items.push({
      kind: "provider",
      title: `${ROLE_LABEL[item.role] ?? "Furnizor"} · ${item.providerName}`,
      startsAt: item.startsAt,
      endsAt: item.endsAt,
      notes: null,
      packageItemId: item.id,
      sortOrder: order++,
    });
  }

  const hasCake = providerItems.some((item) => item.role === "cakes");
  if (!hasCake) {
    items.push({
      kind: "cake",
      title: "Tort și urări",
      startsAt: shiftMinutes(windowEnd, -45),
      endsAt: shiftMinutes(windowEnd, -20),
      notes: null,
      sortOrder: order++,
    });
  }

  items.push({
    kind: "photo",
    title: "Poze de grup",
    startsAt: shiftMinutes(windowEnd, -20),
    endsAt: shiftMinutes(windowEnd, -5),
    notes: null,
    sortOrder: order++,
  });

  items.push({
    kind: "departure",
    title: "Plecare",
    startsAt: windowEnd,
    endsAt: shiftMinutes(windowEnd, 15),
    notes: null,
    sortOrder: order++,
  });

  // Expand party window to cover arrival/departure suggestions.
  await patchPartyForUser(supabase, userId, partyId, {
    partyStartsAt: shiftMinutes(windowStart, -30),
    partyEndsAt: shiftMinutes(windowEnd, 15),
  });

  await replaceScheduleForParty(supabase, userId, partyId, { items });
  return getPartyHubForUser(supabase, userId, partyId);
}
