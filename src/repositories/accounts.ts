import type { SupabaseClient } from "@supabase/supabase-js";

export async function ensureAccountRole(
  supabase: SupabaseClient,
  userId: string,
  role: "parent" | "provider",
): Promise<void> {
  const existing = await getAccountRole(supabase, userId);
  // Keep an existing role (e.g. parent) so the same auth account can also claim a provider.
  if (existing) {
    return;
  }

  const { error } = await supabase.from("account_roles").insert({
    user_id: userId,
    role,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    throw new Error(`Failed to ensure account role: ${error.message}`);
  }
}

export async function claimProviderMembership(
  supabase: SupabaseClient,
  userId: string,
  providerId: string,
): Promise<{ providerId: string; role: string }> {
  await ensureAccountRole(supabase, userId, "provider");

  const { data, error } = await supabase
    .from("provider_memberships")
    .upsert(
      {
        user_id: userId,
        provider_id: providerId,
        role: "owner",
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider_id" },
    )
    .select("provider_id, role")
    .single();

  if (error) {
    throw new Error(`Failed to claim provider membership: ${error.message}`);
  }

  return {
    providerId: data.provider_id as string,
    role: data.role as string,
  };
}

export async function getAccountRole(
  supabase: SupabaseClient,
  userId: string,
): Promise<"parent" | "provider" | "admin" | null> {
  const { data, error } = await supabase
    .from("account_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load account role: ${error.message}`);
  }

  return (data?.role as "parent" | "provider" | "admin" | null) ?? null;
}

export async function getProviderMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<Array<{ providerId: string; role: string }>> {
  const { data, error } = await supabase
    .from("provider_memberships")
    .select("provider_id, role")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to load provider memberships: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    providerId: row.provider_id as string,
    role: row.role as string,
  }));
}
