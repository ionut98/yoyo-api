import type { SupabaseClient } from "@supabase/supabase-js";

export type GoogleCalendarConnectionRow = {
  id: string;
  providerId: string;
  googleAccountEmail: string | null;
  refreshTokenEncrypted: string;
  calendarIds: string[];
  connectedBy: string | null;
  connectedAt: string;
  updatedAt: string;
};

function mapConnection(row: Record<string, unknown>): GoogleCalendarConnectionRow {
  return {
    id: row.id as string,
    providerId: row.provider_id as string,
    googleAccountEmail: (row.google_account_email as string | null) ?? null,
    refreshTokenEncrypted: row.refresh_token_encrypted as string,
    calendarIds: (row.calendar_ids as string[] | null) ?? [],
    connectedBy: (row.connected_by as string | null) ?? null,
    connectedAt: row.connected_at as string,
    updatedAt: row.updated_at as string,
  };
}

export async function getGoogleCalendarConnection(
  supabase: SupabaseClient,
  providerId: string,
): Promise<GoogleCalendarConnectionRow | null> {
  const { data, error } = await supabase
    .from("provider_google_calendar_connections")
    .select("*")
    .eq("provider_id", providerId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load Google Calendar connection: ${error.message}`);
  return data ? mapConnection(data as Record<string, unknown>) : null;
}

export async function listGoogleCalendarConnections(
  supabase: SupabaseClient,
  providerIds: string[],
): Promise<GoogleCalendarConnectionRow[]> {
  if (providerIds.length === 0) return [];
  const { data, error } = await supabase
    .from("provider_google_calendar_connections")
    .select("*")
    .in("provider_id", providerIds);
  if (error) throw new Error(`Failed to list Google Calendar connections: ${error.message}`);
  return (data ?? []).map((row) => mapConnection(row as Record<string, unknown>));
}

export async function upsertGoogleCalendarConnection(
  supabase: SupabaseClient,
  input: {
    providerId: string;
    googleAccountEmail: string | null;
    refreshTokenEncrypted: string;
    calendarIds: string[];
    connectedBy: string;
  },
): Promise<GoogleCalendarConnectionRow> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("provider_google_calendar_connections")
    .upsert(
      {
        provider_id: input.providerId,
        google_account_email: input.googleAccountEmail,
        refresh_token_encrypted: input.refreshTokenEncrypted,
        calendar_ids: input.calendarIds,
        connected_by: input.connectedBy,
        connected_at: now,
        updated_at: now,
      },
      { onConflict: "provider_id" },
    )
    .select("*")
    .single();
  if (error) throw new Error(`Failed to save Google Calendar connection: ${error.message}`);
  return mapConnection(data as Record<string, unknown>);
}

export async function updateGoogleCalendarIds(
  supabase: SupabaseClient,
  providerId: string,
  calendarIds: string[],
): Promise<GoogleCalendarConnectionRow> {
  const { data, error } = await supabase
    .from("provider_google_calendar_connections")
    .update({
      calendar_ids: calendarIds,
      updated_at: new Date().toISOString(),
    })
    .eq("provider_id", providerId)
    .select("*")
    .single();
  if (error) throw new Error(`Failed to update Google calendars: ${error.message}`);
  return mapConnection(data as Record<string, unknown>);
}

export async function deleteGoogleCalendarConnection(
  supabase: SupabaseClient,
  providerId: string,
): Promise<void> {
  const { error } = await supabase
    .from("provider_google_calendar_connections")
    .delete()
    .eq("provider_id", providerId);
  if (error) throw new Error(`Failed to disconnect Google Calendar: ${error.message}`);
}
