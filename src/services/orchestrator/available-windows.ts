import type { EffectiveAvailabilityRow } from "../../repositories/provider-enrichment.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import { availableOnInterval } from "./build-packages.js";

export type AvailableWindow = { startsAt: string; endsAt: string };

type PackageRole = PackageRecommendationDto["items"][number]["role"];

const DEFAULT_DURATION_MINUTES = 120;
const MAX_CHIPS_PER_PROVIDER = 10;

/** Preferred start hours (Bucharest) for staggered defaults by role. */
const ROLE_PREFERRED_START_HOURS: Record<PackageRole, number[]> = {
  space: [16, 14, 18, 12, 10],
  entertainment: [16, 14, 18, 12, 10],
  balloons: [14, 12, 10, 16, 18],
  cakes: [16, 14, 18, 12, 10],
};

function windowKey(startsAt: string, endsAt: string): string {
  return `${Date.parse(startsAt)}|${Date.parse(endsAt)}`;
}

function bucharestHour(iso: string): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/Bucharest",
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso)),
  );
}

function durationForProvider(
  providerId: string,
  durationByProviderId?: Map<string, number> | Record<string, number>,
): number {
  if (!durationByProviderId) return DEFAULT_DURATION_MINUTES;
  const value =
    durationByProviderId instanceof Map
      ? durationByProviderId.get(providerId)
      : durationByProviderId[providerId];
  if (!value || !Number.isFinite(value)) return DEFAULT_DURATION_MINUTES;
  return Math.max(30, Math.min(480, Math.round(value)));
}

/**
 * Carve bookable slots of `durationMinutes` from real free availability rows.
 * Step is min(30, duration) so parents see overlapping options inside long free blocks.
 */
export function listBookableWindows(
  availability: EffectiveAvailabilityRow[],
  providerId: string,
  date: string,
  durationMinutes: number,
): AvailableWindow[] {
  const durationMs = durationMinutes * 60 * 1000;
  const stepMs = Math.min(30, durationMinutes) * 60 * 1000;
  const freeRows = availability
    .filter(
      (row) =>
        row.providerId === providerId &&
        row.status === "available" &&
        row.date === date,
    )
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));

  const seen = new Set<string>();
  const windows: AvailableWindow[] = [];

  for (const row of freeRows) {
    let cursor = Date.parse(row.startsAt);
    const rowEnd = Date.parse(row.endsAt);
    while (cursor + durationMs <= rowEnd + 1) {
      const startsAt = new Date(cursor).toISOString();
      const endsAt = new Date(cursor + durationMs).toISOString();
      const key = windowKey(startsAt, endsAt);
      if (!seen.has(key) && availableOnInterval(availability, providerId, startsAt, endsAt)) {
        seen.add(key);
        windows.push({ startsAt, endsAt });
      }
      cursor += stepMs;
      if (windows.length >= MAX_CHIPS_PER_PROVIDER) break;
    }
    if (windows.length >= MAX_CHIPS_PER_PROVIDER) break;
  }

  return windows;
}

/** @deprecated use listBookableWindows — kept name for call sites during transition */
export function listCoveredDefaultWindows(
  availability: EffectiveAvailabilityRow[],
  providerId: string,
  date: string,
  durationMinutes = DEFAULT_DURATION_MINUTES,
): AvailableWindow[] {
  return listBookableWindows(availability, providerId, date, durationMinutes);
}

export function pickPreferredWindow(
  role: PackageRole,
  windows: AvailableWindow[],
  fallback: AvailableWindow,
): AvailableWindow {
  if (windows.length === 0) return fallback;

  const byHour = new Map<number, AvailableWindow[]>();
  for (const window of windows) {
    const hour = bucharestHour(window.startsAt);
    const list = byHour.get(hour) ?? [];
    list.push(window);
    byHour.set(hour, list);
  }

  for (const hour of ROLE_PREFERRED_START_HOURS[role]) {
    const match = byHour.get(hour)?.[0];
    if (match) return match;
  }

  const exact = windows.find(
    (window) => windowKey(window.startsAt, window.endsAt) === windowKey(fallback.startsAt, fallback.endsAt),
  );
  return exact ?? windows[0] ?? fallback;
}

export function applyAvailableWindowsAndStagger<
  T extends {
    targetDate: string;
    targetStartsAt: string;
    targetEndsAt: string;
    items: Array<{
      providerId: string;
      role: PackageRole;
      startsAt: string;
      endsAt: string;
      availableWindows?: AvailableWindow[];
    }>;
  },
>(
  pkg: T,
  availability: EffectiveAvailabilityRow[],
  durationByProviderId?: Map<string, number> | Record<string, number>,
): T {
  const date = pkg.targetDate.slice(0, 10);
  const items = pkg.items.map((item) => {
    const durationMinutes = durationForProvider(item.providerId, durationByProviderId);
    const availableWindows = listBookableWindows(
      availability,
      item.providerId,
      date,
      durationMinutes,
    );
    const preferred = pickPreferredWindow(item.role, availableWindows, {
      startsAt: item.startsAt,
      endsAt: item.endsAt,
    });
    return {
      ...item,
      availableWindows,
      startsAt: preferred.startsAt,
      endsAt: preferred.endsAt,
    };
  });

  const starts = items.map((item) => Date.parse(item.startsAt));
  const ends = items.map((item) => Date.parse(item.endsAt));

  return {
    ...pkg,
    items,
    targetStartsAt: new Date(Math.min(...starts)).toISOString(),
    targetEndsAt: new Date(Math.max(...ends)).toISOString(),
  };
}

/** Attach fresh windows without changing assigned times (for GET proposed packages). */
export function attachAvailableWindows<
  T extends {
    targetDate: string;
    items: Array<{
      providerId: string;
      availableWindows?: AvailableWindow[];
    }>;
  },
>(
  pkg: T,
  availability: EffectiveAvailabilityRow[],
  durationByProviderId?: Map<string, number> | Record<string, number>,
): T {
  const date = pkg.targetDate.slice(0, 10);
  return {
    ...pkg,
    items: pkg.items.map((item) => ({
      ...item,
      availableWindows: listBookableWindows(
        availability,
        item.providerId,
        date,
        durationForProvider(item.providerId, durationByProviderId),
      ),
    })),
  };
}
