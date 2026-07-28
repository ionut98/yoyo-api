import type { PartyDto } from "../../schemas/parties.js";

function toDateAtNoon(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(12, 0, 0, 0);
  return copy;
}

function nextSaturday(base: Date, offsetWeeks = 0): string {
  const date = toDateAtNoon(base);
  const day = date.getDay();
  const delta = (6 - day + 7) % 7;
  date.setDate(date.getDate() + delta + offsetWeeks * 7);
  return date.toISOString().slice(0, 10);
}

export function resolveTargetDate(party: PartyDto, now = new Date()): string {
  if (party.datePreference === "pick_date" && party.preferredDate) {
    return party.preferredDate.slice(0, 10);
  }
  if (party.datePreference === "next_weekend") {
    return nextSaturday(now, 1);
  }
  return nextSaturday(now, 0);
}

export function resolveTargetSlot(): "morning" | "afternoon" {
  return "afternoon";
}
