import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import { createSupabaseClient } from "../clients/supabase.js";

export async function ensureAccountRole(
  env: Env,
  userId: string,
  role: "parent" | "provider",
): Promise<void> {
  const supabase = createSupabaseClient(env);
  const { error } = await supabase.from("account_roles").upsert(
    {
      user_id: userId,
      role,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  if (error) {
    throw new Error(`Failed to ensure account role: ${error.message}`);
  }
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
