import type { SupabaseClient } from "@supabase/supabase-js";
import type { Env } from "../config/env.js";
import { requireGoogleCalendarConfig } from "../config/env.js";
import { decryptSecret, encryptSecret, signState, verifyState } from "../lib/token-crypto.js";
import { formatBucharestDate } from "../lib/time-intervals.js";
import type { EffectiveAvailabilityRow } from "../repositories/provider-enrichment.js";
import {
  deleteGoogleCalendarConnection,
  getGoogleCalendarConnection,
  listGoogleCalendarConnections,
  updateGoogleCalendarIds,
  upsertGoogleCalendarConnection,
} from "../repositories/google-calendar.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_CALENDAR_LIST_URL = "https://www.googleapis.com/calendar/v3/users/me/calendarList";
const GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"];

type FreeBusyCacheEntry = {
  expiresAt: number;
  intervals: Array<{ startsAt: string; endsAt: string }>;
};

const freeBusyCache = new Map<string, FreeBusyCacheEntry>();
const FREEBUSY_TTL_MS = 10 * 60 * 1000;

function cacheKey(providerId: string, startIso: string, endIso: string): string {
  return `${providerId}|${startIso}|${endIso}`;
}

export function buildGoogleConnectUrl(
  env: Env,
  input: { providerId: string; userId: string; returnTo?: string | null },
): string {
  const config = requireGoogleCalendarConfig(env);
  const statePayload = JSON.stringify({
    providerId: input.providerId,
    userId: input.userId,
    returnTo: input.returnTo ?? null,
    nonce: crypto.randomUUID(),
    exp: Date.now() + 15 * 60 * 1000,
  });
  const state = signState(statePayload, config.tokenEncryptionKey);
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function exchangeCodeForTokens(
  env: Env,
  code: string,
): Promise<{ refreshToken: string; accessToken: string; email: string | null }> {
  const config = requireGoogleCalendarConfig(env);
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: "authorization_code",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${text}`);
  }
  const json = (await response.json()) as {
    refresh_token?: string;
    access_token?: string;
  };
  if (!json.refresh_token || !json.access_token) {
    throw new Error("Google did not return a refresh token. Reconnect with consent.");
  }

  let email: string | null = null;
  const userInfoResponse = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${json.access_token}` },
  });
  if (userInfoResponse.ok) {
    const userInfo = (await userInfoResponse.json()) as { email?: string };
    email = userInfo.email ?? null;
  }

  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    email,
  };
}

async function refreshAccessToken(env: Env, refreshToken: string): Promise<string> {
  const config = requireGoogleCalendarConfig(env);
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token refresh failed: ${text}`);
  }
  const json = (await response.json()) as { access_token?: string };
  if (!json.access_token) throw new Error("Google token refresh missing access_token");
  return json.access_token;
}

async function listCalendars(
  accessToken: string,
): Promise<Array<{ id: string; summary: string; primary: boolean }>> {
  const response = await fetch(`${GOOGLE_CALENDAR_LIST_URL}?minAccessRole=reader&maxResults=250`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to list Google calendars: ${text}`);
  }
  const json = (await response.json()) as {
    items?: Array<{ id?: string; summary?: string; primary?: boolean }>;
  };
  return (json.items ?? [])
    .filter((item): item is { id: string; summary?: string; primary?: boolean } => Boolean(item.id))
    .map((item) => ({
      id: item.id,
      summary: item.summary ?? item.id,
      primary: Boolean(item.primary),
    }));
}

export async function completeGoogleCalendarCallback(
  env: Env,
  supabase: SupabaseClient,
  input: { providerId: string; userId: string; code: string; state: string },
) {
  const config = requireGoogleCalendarConfig(env);
  const raw = verifyState(input.state, config.tokenEncryptionKey);
  const state = JSON.parse(raw) as {
    providerId: string;
    userId: string;
    returnTo?: string | null;
    exp?: number;
  };
  if (state.providerId !== input.providerId) {
    throw new Error("OAuth state provider mismatch");
  }
  if (state.userId !== input.userId) {
    throw new Error("OAuth state user mismatch");
  }
  if (state.exp && state.exp < Date.now()) {
    throw new Error("OAuth state expired");
  }

  const tokens = await exchangeCodeForTokens(env, input.code);
  const calendars = await listCalendars(tokens.accessToken);
  const defaultCalendarIds = calendars.filter((cal) => cal.primary).map((cal) => cal.id);
  const calendarIds =
    defaultCalendarIds.length > 0 ? defaultCalendarIds : calendars.slice(0, 1).map((cal) => cal.id);

  const connection = await upsertGoogleCalendarConnection(supabase, {
    providerId: input.providerId,
    googleAccountEmail: tokens.email,
    refreshTokenEncrypted: encryptSecret(tokens.refreshToken, config.tokenEncryptionKey),
    calendarIds,
    connectedBy: input.userId,
  });

  return {
    connection,
    calendars,
    returnTo: state.returnTo ?? null,
  };
}

export async function getGoogleCalendarStatus(
  env: Env,
  supabase: SupabaseClient,
  providerId: string,
) {
  const connection = await getGoogleCalendarConnection(supabase, providerId);
  if (!connection) {
    return { connected: false as const, connection: null, calendars: [] as Array<{ id: string; summary: string; primary: boolean }> };
  }

  let calendars: Array<{ id: string; summary: string; primary: boolean }> = [];
  try {
    const config = requireGoogleCalendarConfig(env);
    const refreshToken = decryptSecret(connection.refreshTokenEncrypted, config.tokenEncryptionKey);
    const accessToken = await refreshAccessToken(env, refreshToken);
    calendars = await listCalendars(accessToken);
  } catch (error) {
    console.error("Failed to list Google calendars for status", error);
  }

  return {
    connected: true as const,
    connection: {
      providerId: connection.providerId,
      googleAccountEmail: connection.googleAccountEmail,
      calendarIds: connection.calendarIds,
      connectedAt: connection.connectedAt,
    },
    calendars,
  };
}

export async function setGoogleCalendarIds(
  supabase: SupabaseClient,
  providerId: string,
  calendarIds: string[],
) {
  return updateGoogleCalendarIds(supabase, providerId, calendarIds);
}

export async function disconnectGoogleCalendar(supabase: SupabaseClient, providerId: string) {
  await deleteGoogleCalendarConnection(supabase, providerId);
  for (const key of freeBusyCache.keys()) {
    if (key.startsWith(`${providerId}|`)) freeBusyCache.delete(key);
  }
}

async function fetchFreeBusyIntervals(
  env: Env,
  refreshTokenEncrypted: string,
  calendarIds: string[],
  startIso: string,
  endIso: string,
): Promise<Array<{ startsAt: string; endsAt: string }>> {
  if (calendarIds.length === 0) return [];
  const config = requireGoogleCalendarConfig(env);
  const refreshToken = decryptSecret(refreshTokenEncrypted, config.tokenEncryptionKey);
  const accessToken = await refreshAccessToken(env, refreshToken);

  const response = await fetch(GOOGLE_FREEBUSY_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      timeMin: startIso,
      timeMax: endIso,
      items: calendarIds.map((id) => ({ id })),
    }),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google FreeBusy failed: ${text}`);
  }

  const json = (await response.json()) as {
    calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }>;
  };

  const intervals: Array<{ startsAt: string; endsAt: string }> = [];
  for (const calendar of Object.values(json.calendars ?? {})) {
    for (const busy of calendar.busy ?? []) {
      if (!busy.start || !busy.end) continue;
      intervals.push({ startsAt: new Date(busy.start).toISOString(), endsAt: new Date(busy.end).toISOString() });
    }
  }
  return intervals;
}

export async function listGoogleBusyBlockers(
  env: Env,
  supabase: SupabaseClient,
  options: { providerIds: string[]; startIso: string; endIso: string },
): Promise<EffectiveAvailabilityRow[]> {
  if (
    !env.GOOGLE_CALENDAR_CLIENT_ID ||
    !env.GOOGLE_CALENDAR_CLIENT_SECRET ||
    !env.TOKEN_ENCRYPTION_KEY ||
    options.providerIds.length === 0
  ) {
    return [];
  }

  const connections = await listGoogleCalendarConnections(supabase, options.providerIds);
  const blockers: EffectiveAvailabilityRow[] = [];

  for (const connection of connections) {
    const key = cacheKey(connection.providerId, options.startIso, options.endIso);
    const cached = freeBusyCache.get(key);
    let intervals: Array<{ startsAt: string; endsAt: string }>;
    if (cached && cached.expiresAt > Date.now()) {
      intervals = cached.intervals;
    } else {
      try {
        intervals = await fetchFreeBusyIntervals(
          env,
          connection.refreshTokenEncrypted,
          connection.calendarIds,
          options.startIso,
          options.endIso,
        );
        freeBusyCache.set(key, { expiresAt: Date.now() + FREEBUSY_TTL_MS, intervals });
      } catch (error) {
        console.error(`Google FreeBusy failed for provider ${connection.providerId}`, error);
        continue;
      }
    }

    for (const [index, interval] of intervals.entries()) {
      blockers.push({
        id: `google:${connection.providerId}:${interval.startsAt}:${index}`,
        providerId: connection.providerId,
        date: formatBucharestDate(new Date(interval.startsAt)),
        startsAt: interval.startsAt,
        endsAt: interval.endsAt,
        status: "booked",
        source: "google",
        packageId: null,
        packageItemId: null,
        reservationId: null,
        title: "Google Calendar",
      });
    }
  }

  return blockers;
}

export async function mergeAvailabilityWithGoogleBusy(
  env: Env,
  supabase: SupabaseClient,
  options: { providerIds: string[]; startIso: string; endIso: string },
  rows: EffectiveAvailabilityRow[],
): Promise<EffectiveAvailabilityRow[]> {
  const googleBusy = await listGoogleBusyBlockers(env, supabase, options);
  if (googleBusy.length === 0) return rows;

  const merged = rows.map((row) => {
    if (row.status === "booked") return row;
    const blocked = googleBusy.some(
      (busy) =>
        busy.providerId === row.providerId &&
        Date.parse(busy.startsAt) < Date.parse(row.endsAt) &&
        Date.parse(busy.endsAt) > Date.parse(row.startsAt),
    );
    return blocked ? { ...row, status: "booked" as const } : row;
  });

  return [...merged, ...googleBusy];
}
