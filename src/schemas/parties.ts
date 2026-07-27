import { z } from "zod";

export const ageRangeSchema = z.enum(["3-5", "6-8", "9-10"]);
export const budgetSchema = z.enum(["1500", "2500", "3500", "5000+"]);
export const guestCountSchema = z.enum(["10", "15", "20", "20+"]);
export const datePreferenceSchema = z.enum([
  "this_weekend",
  "next_weekend",
  "pick_date",
  "flexible",
]);
export const sectorSchema = z.enum(["orice", "s1", "s2", "s3", "s4", "s5", "s6"]);
export const themeIdSchema = z.enum([
  "kpop",
  "minecraft",
  "roblox",
  "elsa",
  "spiderman",
  "mickey-minnie",
  "princesses",
  "unicorn",
  "superheroes",
  "unknown",
  "none",
  "custom",
]);

export const createPartyBodySchema = z.object({
  ageRange: ageRangeSchema,
  budget: budgetSchema,
  guestCount: guestCountSchema,
  datePreference: datePreferenceSchema,
  preferredDate: z.string().min(1).optional().nullable(),
  sector: sectorSchema,
  themeId: themeIdSchema,
  themeCustom: z.string().trim().max(80).optional().nullable(),
  activities: z.array(z.string().trim().min(1)).default([]),
  city: z.string().trim().min(1).default("București"),
});

export type CreatePartyBody = z.infer<typeof createPartyBodySchema>;

export const partySchema = z.object({
  id: z.string().uuid(),
  ageRange: z.string().nullable(),
  budget: z.string().nullable(),
  guestCount: z.string().nullable(),
  datePreference: z.string().nullable(),
  preferredDate: z.string().nullable(),
  sector: z.string().nullable(),
  themeId: z.string().nullable(),
  themeCustom: z.string().nullable(),
  activities: z.array(z.string()),
  status: z.string(),
  city: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PartyDto = z.infer<typeof partySchema>;

export const listPartiesResponseSchema = z.object({
  data: z.array(partySchema),
});

export type ListPartiesResponse = z.infer<typeof listPartiesResponseSchema>;
