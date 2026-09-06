import {
  bucharestDateTimeIso,
  DEFAULT_AVAILABILITY_WINDOWS,
} from "../../lib/time-intervals.js";
import type { EffectiveAvailabilityRow } from "../../repositories/provider-enrichment.js";
import type { PackageRecommendationDto } from "../../schemas/orchestrator.js";
import { availableOnInterval } from "./build-packages.js";

export type AvailableWindow = { startsAt: string; endsAt: string };

type PackageRole = PackageRecommendationDto["items"][number]["role"];

/** Preference order of default 2h windows per role (party-day logic). */
const ROLE_WINDOW_PREFERENCES: Record<
  PackageRole,
  ReadonlyArray<{ startHour: number; endHour: number }>
> = {
  space: [
    { startHour: 16, endHour: 18 },
    { startHour: 14, endHour: 16 },
    { startHour: 18, endHour: 20 },
    { startHour: 12, endHour: 14 },
    { startHour: 10, endHour: 12 },
  ],
  entertainment: [
    { startHour: 16, endHour: 18 },
    { startHour: 14, endHour: 16 },
    { startHour: 18, endHour: 20 },
    { startHour: 12, endHour: 14 },
    { startHour: 10, endHour: 12 },
  ],
  balloons: [
    { startHour: 14, endHour: 16 },
    { startHour: 12, endHour: 14 },
    { startHour: 10, endHour: 12 },
    { startHour: 16, endHour: 18 },
    { startHour: 18, endHour: 20 },
  ],
  cakes: [
    { startHour: 16, endHour: 18 },
    { startHour: 14, endHour: 16 },
    { startHour: 18, endHour: 20 },
    { startHour: 12, endHour: 14 },
    { startHour: 10, endHour: 12 },
  ],
};

function windowKey(startsAt: string, endsAt: string): string {
  return `${Date.parse(startsAt)}|${Date.parse(endsAt)}`;
}

export function listCoveredDefaultWindows(
  availability: EffectiveAvailabilityRow[],
  providerId: string,
  date: string,
): AvailableWindow[] {
  const windows: AvailableWindow[] = [];
  for (const slot of DEFAULT_AVAILABILITY_WINDOWS) {
    const startsAt = bucharestDateTimeIso(date, slot.startHour, 0);
    const endsAt = bucharestDateTimeIso(date, slot.endHour, 0);
    if (availableOnInterval(availability, providerId, startsAt, endsAt)) {
      windows.push({ startsAt, endsAt });
    }
  }
  return windows;
}

export function pickPreferredWindow(
  role: PackageRole,
  date: string,
  windows: AvailableWindow[],
  fallback: AvailableWindow,
): AvailableWindow {
  if (windows.length === 0) return fallback;

  const byKey = new Map(windows.map((window) => [windowKey(window.startsAt, window.endsAt), window]));

  for (const pref of ROLE_WINDOW_PREFERENCES[role]) {
    const startsAt = bucharestDateTimeIso(date, pref.startHour, 0);
    const endsAt = bucharestDateTimeIso(date, pref.endHour, 0);
    const match = byKey.get(windowKey(startsAt, endsAt));
    if (match) return match;
  }

  const exact = byKey.get(windowKey(fallback.startsAt, fallback.endsAt));
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
>(pkg: T, availability: EffectiveAvailabilityRow[]): T {
  const date = pkg.targetDate.slice(0, 10);
  const items = pkg.items.map((item) => {
    const availableWindows = listCoveredDefaultWindows(availability, item.providerId, date);
    const preferred = pickPreferredWindow(
      item.role,
      date,
      availableWindows,
      { startsAt: item.startsAt, endsAt: item.endsAt },
    );
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
>(pkg: T, availability: EffectiveAvailabilityRow[]): T {
  const date = pkg.targetDate.slice(0, 10);
  return {
    ...pkg,
    items: pkg.items.map((item) => ({
      ...item,
      availableWindows: listCoveredDefaultWindows(availability, item.providerId, date),
    })),
  };
}
