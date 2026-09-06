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

export const scheduleKindSchema = z.enum([
  "arrival",
  "provider",
  "activity",
  "cake",
  "food",
  "photo",
  "departure",
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

export const patchPartyBodySchema = z
  .object({
    notes: z.string().max(4000).nullable().optional(),
    partyStartsAt: z.string().datetime({ offset: true }).nullable().optional(),
    partyEndsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine(
    (value) =>
      value.notes !== undefined ||
      value.partyStartsAt !== undefined ||
      value.partyEndsAt !== undefined,
    { message: "At least one field is required" },
  );

export type PatchPartyBody = z.infer<typeof patchPartyBodySchema>;

export const partyScheduleItemSchema = z.object({
  id: z.string().uuid(),
  partyId: z.string().uuid(),
  kind: scheduleKindSchema,
  title: z.string(),
  startsAt: z.string(),
  endsAt: z.string().nullable(),
  notes: z.string().nullable(),
  packageItemId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PartyScheduleItemDto = z.infer<typeof partyScheduleItemSchema>;

export const scheduleItemInputSchema = z.object({
  id: z.string().uuid().optional(),
  kind: scheduleKindSchema,
  title: z.string().trim().min(1).max(120),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  packageItemId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const putScheduleBodySchema = z.object({
  items: z.array(scheduleItemInputSchema).max(50),
});

export type PutScheduleBody = z.infer<typeof putScheduleBodySchema>;

export const partyBookingSummaryItemSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  providerName: z.string(),
  role: z.string(),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  itemStatus: z.string(),
});

export const partyBookingSummarySchema = z
  .object({
    packageId: z.string().uuid(),
    status: z.string(),
    bookingKind: z.string(),
    targetDate: z.string(),
    targetStartsAt: z.string(),
    targetEndsAt: z.string(),
    estimatedPriceMin: z.number(),
    estimatedPriceMax: z.number(),
    items: z.array(partyBookingSummaryItemSchema),
  })
  .nullable();

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
  bookingStatus: z
    .enum([
      "none",
      "requested",
      "partially_confirmed",
      "confirmed",
      "failed",
      "expired",
      "cancelled",
    ])
    .default("none"),
  city: z.string(),
  notes: z.string().nullable().optional().default(null),
  partyStartsAt: z.string().nullable().optional().default(null),
  partyEndsAt: z.string().nullable().optional().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type PartyDto = z.infer<typeof partySchema>;

export const listPartiesResponseSchema = z.object({
  data: z.array(partySchema),
});

export type ListPartiesResponse = z.infer<typeof listPartiesResponseSchema>;

export const partyHubResponseSchema = z.object({
  party: partySchema,
  booking: partyBookingSummarySchema,
  schedule: z.array(partyScheduleItemSchema),
});

export type PartyHubResponse = z.infer<typeof partyHubResponseSchema>;

export const scheduleListResponseSchema = z.object({
  data: z.array(partyScheduleItemSchema),
});
