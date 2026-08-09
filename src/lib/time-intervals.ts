/** Shared Bucharest-aware interval helpers for booking / availability. */

export const DEFAULT_PARTY_DURATION_MS = 2 * 60 * 60 * 1000;
export const DEFAULT_PARTY_START_HOUR = 16; // 16:00 Europe/Bucharest

const BUCHAREST = "Europe/Bucharest";

/** Format a Date as YYYY-MM-DD in Europe/Bucharest. */
export function formatBucharestDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: BUCHAREST,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function bucharestOffsetIso(date: string): string {
  const probe = new Date(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: BUCHAREST,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(probe);
  const tzName = parts.find((part) => part.type === "timeZoneName")?.value ?? "GMT+3";
  const match = /GMT([+-]\d{1,2})(?::?(\d{2}))?/.exec(tzName);
  const offsetHours = match ? Number(match[1]) : 3;
  const offsetMinutes = match?.[2] ? Number(match[2]) : 0;
  const sign = offsetHours >= 0 ? "+" : "-";
  const absH = String(Math.abs(offsetHours)).padStart(2, "0");
  const absM = String(Math.abs(offsetMinutes)).padStart(2, "0");
  return `${sign}${absH}:${absM}`;
}

/**
 * Build a timestamptz ISO string for `date` (YYYY-MM-DD) + local Bucharest wall time.
 */
export function bucharestDateTimeIso(date: string, hour: number, minute = 0): string {
  const paddedHour = String(hour).padStart(2, "0");
  const paddedMinute = String(minute).padStart(2, "0");
  const offset = bucharestOffsetIso(date);
  return new Date(`${date}T${paddedHour}:${paddedMinute}:00${offset}`).toISOString();
}

export function intervalsOverlap(
  aStart: string,
  aEnd: string,
  bStart: string,
  bEnd: string,
): boolean {
  const as = Date.parse(aStart);
  const ae = Date.parse(aEnd);
  const bs = Date.parse(bStart);
  const be = Date.parse(bEnd);
  return as < be && bs < ae;
}

export function resolveTargetInterval(date: string): { startsAt: string; endsAt: string } {
  const startsAt = bucharestDateTimeIso(date, DEFAULT_PARTY_START_HOUR, 0);
  const endsAt = new Date(Date.parse(startsAt) + DEFAULT_PARTY_DURATION_MS).toISOString();
  return { startsAt, endsAt };
}

/** Default bookable 2h windows (local hours) for seed / calendar defaults. */
export const DEFAULT_AVAILABILITY_WINDOWS = [
  { startHour: 10, endHour: 12 },
  { startHour: 12, endHour: 14 },
  { startHour: 14, endHour: 16 },
  { startHour: 16, endHour: 18 },
  { startHour: 18, endHour: 20 },
] as const;

/** YYYY-MM-DD dates from startIso (inclusive) to endIso (exclusive), Bucharest calendar days. */
export function eachBucharestDateInRange(startIso: string, endIso: string): string[] {
  const startDay = formatBucharestDate(new Date(startIso));
  const endDay = formatBucharestDate(new Date(Date.parse(endIso) - 1));
  if (Date.parse(endIso) <= Date.parse(startIso)) return [];

  const dates: string[] = [];
  let cursor = startDay;
  while (cursor <= endDay) {
    dates.push(cursor);
    const [year, month, day] = cursor.split("-").map(Number);
    const next = new Date(Date.UTC(year!, month! - 1, day! + 1));
    cursor = next.toISOString().slice(0, 10);
  }
  return dates;
}

/**
 * Default Liber slots for days/windows with no existing coverage.
 * Used by the provider calendar so far-future months aren't blank.
 */
export function buildDefaultAvailableSlots(options: {
  providerId: string;
  startIso: string;
  endIso: string;
  existingIntervals: Array<{ startsAt: string; endsAt: string }>;
  nowMs?: number;
}): Array<{
  id: string;
  startsAt: string;
  endsAt: string;
  status: "available";
  source: "availability";
}> {
  const nowMs = options.nowMs ?? Date.now();
  const rangeStart = Date.parse(options.startIso);
  const rangeEnd = Date.parse(options.endIso);
  const slots: Array<{
    id: string;
    startsAt: string;
    endsAt: string;
    status: "available";
    source: "availability";
  }> = [];

  for (const date of eachBucharestDateInRange(options.startIso, options.endIso)) {
    for (const window of DEFAULT_AVAILABILITY_WINDOWS) {
      const startsAt = bucharestDateTimeIso(date, window.startHour, 0);
      const endsAt = bucharestDateTimeIso(date, window.endHour, 0);
      const startMs = Date.parse(startsAt);
      const endMs = Date.parse(endsAt);
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
      if (endMs <= nowMs) continue;
      if (endMs <= rangeStart || startMs >= rangeEnd) continue;

      const covered = options.existingIntervals.some((interval) =>
        intervalsOverlap(startsAt, endsAt, interval.startsAt, interval.endsAt),
      );
      if (covered) continue;

      slots.push({
        id: `default:${options.providerId}:${startsAt}`,
        startsAt,
        endsAt,
        status: "available",
        source: "availability",
      });
    }
  }

  return slots;
}
