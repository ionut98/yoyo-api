import { describe, expect, it } from "vitest";

import type { EffectiveAvailabilityRow } from "../src/repositories/provider-enrichment.js";
import { listBookableWindows } from "../src/services/orchestrator/available-windows.js";
import { bucharestDateTimeIso } from "../src/lib/time-intervals.js";

const providerId = "20000000-0000-4000-8000-000000000099";
const date = "2026-08-15";

function row(
  partial: Partial<EffectiveAvailabilityRow> &
    Pick<EffectiveAvailabilityRow, "startsAt" | "endsAt" | "status">,
): EffectiveAvailabilityRow {
  return {
    id: partial.id ?? `${partial.startsAt}-${partial.status}`,
    providerId,
    date,
    startsAt: partial.startsAt,
    endsAt: partial.endsAt,
    status: partial.status,
    source: "availability",
    packageId: null,
    packageItemId: null,
    reservationId: null,
    title: null,
  };
}

describe("listBookableWindows", () => {
  it("carves duration slots from a continuous free block", () => {
    const availability = [
      row({
        startsAt: bucharestDateTimeIso(date, 10, 0),
        endsAt: bucharestDateTimeIso(date, 14, 0),
        status: "available",
      }),
    ];

    const windows = listBookableWindows(availability, providerId, date, 120);
    expect(windows.length).toBeGreaterThan(0);
    expect(windows[0]).toEqual({
      startsAt: bucharestDateTimeIso(date, 10, 0),
      endsAt: bucharestDateTimeIso(date, 12, 0),
    });
    // 10–12, 10:30–12:30, 11–13, 11:30–13:30, 12–14
    expect(windows).toHaveLength(5);
  });

  it("skips slots that overlap booked gaps", () => {
    const availability = [
      row({
        startsAt: bucharestDateTimeIso(date, 10, 0),
        endsAt: bucharestDateTimeIso(date, 16, 0),
        status: "available",
      }),
      row({
        id: "booked",
        startsAt: bucharestDateTimeIso(date, 12, 0),
        endsAt: bucharestDateTimeIso(date, 14, 0),
        status: "booked",
      }),
    ];

    const windows = listBookableWindows(availability, providerId, date, 120);
    for (const window of windows) {
      const start = Date.parse(window.startsAt);
      const end = Date.parse(window.endsAt);
      const bookedStart = Date.parse(bucharestDateTimeIso(date, 12, 0));
      const bookedEnd = Date.parse(bucharestDateTimeIso(date, 14, 0));
      const overlaps = start < bookedEnd && end > bookedStart;
      expect(overlaps).toBe(false);
    }
  });
});
