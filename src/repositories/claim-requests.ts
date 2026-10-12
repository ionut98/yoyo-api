import type { SupabaseClient } from "@supabase/supabase-js";

export type ClaimRequestStatus = "pending" | "approved" | "rejected" | "cancelled";

export type ClaimRequestRow = {
  id: string;
  providerId: string;
  providerName: string | null;
  /** Requester auth user id — events UI Zod schema expects `userId`. */
  userId: string;
  status: ClaimRequestStatus;
  message: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  proofUrl: string | null;
  adminNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Exported for unit tests — keeps API JSON aligned with yoyo-events claim schema. */
export function mapClaimRequest(row: Record<string, unknown>): ClaimRequestRow {
  const provider = row.provider as
    | { name?: string | null }
    | Array<{ name?: string | null }>
    | null
    | undefined;
  const providerName = Array.isArray(provider)
    ? (provider[0]?.name ?? null)
    : (provider?.name ?? null);

  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    providerName,
    userId: row.requester_user_id as string,
    status: row.status as ClaimRequestStatus,
    message: (row.message as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
    proofUrl: (row.proof_url as string | null) ?? null,
    adminNote: (row.admin_note as string | null) ?? null,
    reviewedBy: (row.reviewed_by as string | null) ?? null,
    reviewedAt: (row.reviewed_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const CLAIM_SELECT = `
  id, provider_id, requester_user_id, status, message, contact_phone, contact_email,
  proof_url, admin_note, reviewed_by, reviewed_at, created_at, updated_at,
  provider:providers(name)
`;

export type ClaimCandidateDto = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  categories: string[];
  phone: string | null;
  photoUrl: string | null;
};

export type ClaimCandidatesPage = {
  data: ClaimCandidateDto[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};

type ClaimCandidatePhoto = {
  public_url: string | null;
  sort_order?: number | null;
  is_cover?: boolean | null;
};

function firstPhotoUrl(photos: ClaimCandidatePhoto[] | null | undefined): string | null {
  const ordered = [...(photos ?? [])].sort((a, b) => {
    const coverDelta = Number(Boolean(b.is_cover)) - Number(Boolean(a.is_cover));
    if (coverDelta !== 0) return coverDelta;
    return (a.sort_order ?? 0) - (b.sort_order ?? 0);
  });
  const cover = ordered.find((photo) => photo.is_cover && photo.public_url) ?? ordered[0];
  return cover?.public_url ?? null;
}

function emptyClaimCandidatesPage(page: number, limit: number): ClaimCandidatesPage {
  return {
    data: [],
    pagination: { page, limit, total: 0, totalPages: 0 },
  };
}

export async function listClaimCandidates(
  supabase: SupabaseClient,
  options: { q?: string; city?: string; page?: number; limit?: number },
): Promise<ClaimCandidatesPage> {
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const limit = Math.min(50, Math.max(1, Math.floor(options.limit ?? 12)));
  const offset = (page - 1) * limit;

  let cityId: string | null = null;
  if (options.city) {
    const { data: cityRow, error: cityError } = await supabase
      .from("cities")
      .select("id")
      .eq("name", options.city)
      .maybeSingle();
    if (cityError) throw new Error(`Failed to resolve city: ${cityError.message}`);
    if (!cityRow?.id) return emptyClaimCandidatesPage(page, limit);
    cityId = cityRow.id as string;
  }

  const { data: owned, error: ownedError } = await supabase.rpc("provider_ids_with_owner");
  if (ownedError) throw new Error(`Failed to load owned providers: ${ownedError.message}`);
  const ownedIds = ((owned as string[] | null) ?? []).filter(Boolean);

  let query = supabase
    .from("providers")
    .select(
      `
      id,
      name,
      address,
      phone,
      categories,
      city:cities(name),
      provider_photos(public_url, sort_order, is_cover)
    `,
      { count: "exact" },
    )
    .order("name", { ascending: true })
    .range(offset, offset + limit - 1);

  if (cityId) query = query.eq("city_id", cityId);
  if (options.q?.trim()) query = query.ilike("name", `%${options.q.trim()}%`);
  if (ownedIds.length > 0) {
    query = query.not("id", "in", `(${ownedIds.join(",")})`);
  }

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to list claim candidates: ${error.message}`);

  const total = count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    data: (data ?? []).map((row) => {
      const city = row.city as { name?: string } | Array<{ name?: string }> | null;
      return {
        id: row.id as string,
        name: row.name as string,
        address: (row.address as string | null) ?? null,
        phone: (row.phone as string | null) ?? null,
        categories: (row.categories as string[] | null) ?? [],
        city: Array.isArray(city) ? (city[0]?.name ?? null) : (city?.name ?? null),
        photoUrl: firstPhotoUrl(row.provider_photos as ClaimCandidatePhoto[] | null),
      };
    }),
    pagination: { page, limit, total, totalPages },
  };
}

export async function createClaimRequest(
  supabase: SupabaseClient,
  input: {
    providerId: string;
    requesterUserId: string;
    message?: string | null;
    contactPhone?: string | null;
    contactEmail?: string | null;
    proofUrl?: string | null;
  },
): Promise<ClaimRequestRow> {
  const { data: ownedIds, error: ownerError } = await supabase.rpc("provider_ids_with_owner");
  if (ownerError) throw new Error(`Failed to check provider ownership: ${ownerError.message}`);
  if (((ownedIds as string[] | null) ?? []).includes(input.providerId)) {
    throw new Error("Provider already has an owner");
  }

  const { data, error } = await supabase
    .from("provider_claim_requests")
    .insert({
      provider_id: input.providerId,
      requester_user_id: input.requesterUserId,
      status: "pending",
      message: input.message?.trim() || null,
      contact_phone: input.contactPhone?.trim() || null,
      contact_email: input.contactEmail?.trim() || null,
      proof_url: input.proofUrl?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .select(CLAIM_SELECT)
    .single();

  if (error) {
    if (error.code === "23505") {
      throw new Error("A pending claim request already exists for this provider");
    }
    throw new Error(`Failed to create claim request: ${error.message}`);
  }

  return mapClaimRequest(data as Record<string, unknown>);
}

export async function listMyClaimRequests(
  supabase: SupabaseClient,
  userId: string,
): Promise<ClaimRequestRow[]> {
  const { data, error } = await supabase
    .from("provider_claim_requests")
    .select(CLAIM_SELECT)
    .eq("requester_user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Failed to list claim requests: ${error.message}`);
  return (data ?? []).map((row) => mapClaimRequest(row as Record<string, unknown>));
}

export async function listAdminClaimRequests(
  supabase: SupabaseClient,
  status: ClaimRequestStatus = "pending",
): Promise<ClaimRequestRow[]> {
  const { data, error } = await supabase
    .from("provider_claim_requests")
    .select(CLAIM_SELECT)
    .eq("status", status)
    .order("created_at", { ascending: true });
  if (error) throw new Error(`Failed to list admin claim requests: ${error.message}`);
  return (data ?? []).map((row) => mapClaimRequest(row as Record<string, unknown>));
}

export async function getClaimRequestById(
  supabase: SupabaseClient,
  id: string,
): Promise<ClaimRequestRow | null> {
  const { data, error } = await supabase
    .from("provider_claim_requests")
    .select(CLAIM_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Failed to load claim request: ${error.message}`);
  return data ? mapClaimRequest(data as Record<string, unknown>) : null;
}

export async function approveClaimRequest(
  serviceSupabase: SupabaseClient,
  input: { requestId: string; adminUserId: string },
): Promise<ClaimRequestRow> {
  const request = await getClaimRequestById(serviceSupabase, input.requestId);
  if (!request) throw new Error("Claim request not found");
  if (request.status !== "pending") throw new Error("Claim request is not pending");

  const now = new Date().toISOString();

  const { error: membershipError } = await serviceSupabase.from("provider_memberships").upsert(
    {
      user_id: request.userId,
      provider_id: request.providerId,
      role: "owner",
      updated_at: now,
    },
    { onConflict: "user_id,provider_id" },
  );
  if (membershipError) {
    throw new Error(`Failed to assign provider membership: ${membershipError.message}`);
  }

  const { data: existingRole, error: roleLookupError } = await serviceSupabase
    .from("account_roles")
    .select("role")
    .eq("user_id", request.userId)
    .maybeSingle();
  if (roleLookupError) {
    throw new Error(`Failed to load account role: ${roleLookupError.message}`);
  }
  if (!existingRole) {
    const { error: roleError } = await serviceSupabase.from("account_roles").insert({
      user_id: request.userId,
      role: "provider",
      updated_at: now,
    });
    if (roleError) {
      throw new Error(`Failed to ensure provider account role: ${roleError.message}`);
    }
  }

  const { error: clearError } = await serviceSupabase
    .from("provider_availability")
    .delete()
    .eq("provider_id", request.providerId);
  if (clearError) {
    throw new Error(`Failed to clear provider availability: ${clearError.message}`);
  }

  const { error: cancelError } = await serviceSupabase
    .from("provider_claim_requests")
    .update({ status: "cancelled", updated_at: now })
    .eq("provider_id", request.providerId)
    .eq("status", "pending")
    .neq("id", request.id);
  if (cancelError) {
    throw new Error(`Failed to cancel sibling claim requests: ${cancelError.message}`);
  }

  const { data, error } = await serviceSupabase
    .from("provider_claim_requests")
    .update({
      status: "approved",
      reviewed_by: input.adminUserId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", request.id)
    .select(CLAIM_SELECT)
    .single();
  if (error) throw new Error(`Failed to approve claim request: ${error.message}`);

  return mapClaimRequest(data as Record<string, unknown>);
}

export async function rejectClaimRequest(
  supabase: SupabaseClient,
  input: { requestId: string; adminUserId: string; adminNote?: string | null },
): Promise<ClaimRequestRow> {
  const request = await getClaimRequestById(supabase, input.requestId);
  if (!request) throw new Error("Claim request not found");
  if (request.status !== "pending") throw new Error("Claim request is not pending");

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("provider_claim_requests")
    .update({
      status: "rejected",
      admin_note: input.adminNote?.trim() || null,
      reviewed_by: input.adminUserId,
      reviewed_at: now,
      updated_at: now,
    })
    .eq("id", request.id)
    .select(CLAIM_SELECT)
    .single();
  if (error) throw new Error(`Failed to reject claim request: ${error.message}`);
  return mapClaimRequest(data as Record<string, unknown>);
}

export async function cleanupGeneratedAvailabilityForUnclaimed(
  serviceSupabase: SupabaseClient,
): Promise<{ deleted: number }> {
  const { data, error } = await serviceSupabase.rpc("cleanup_unclaimed_provider_availability");
  if (error) throw new Error(`Failed to cleanup generated availability: ${error.message}`);
  return { deleted: Number(data ?? 0) };
}
