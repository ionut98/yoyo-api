import { z } from "zod";

export const bookingModeSchema = z.enum(["instant", "request"]);
export const packageStatusSchema = z.enum([
  "proposed",
  "requested",
  "partially_confirmed",
  "confirmed",
  "failed",
  "expired",
  "cancelled",
]);
export const bookingKindSchema = z.enum([
  "fully_instant",
  "mixed",
  "fully_request",
]);
export const packageRoleSchema = z.enum([
  "space",
  "entertainment",
  "balloons",
  "cakes",
]);
export const availabilityStatusSchema = z.enum(["available", "limited", "booked"]);
export const holdStatusSchema = z.enum(["active", "released", "converted", "expired"]);
export const accountRoleSchema = z.enum(["parent", "provider", "admin"]);
export const providerMembershipRoleSchema = z.enum(["owner", "manager", "staff"]);
export const offeredServiceSchema = z.enum(["space", "entertainment", "balloons", "cakes"]);
export const providerCategorySchema = z.enum(["venue", "entertainment", "balloons", "cakes"]);

export const priceRangeSchema = z.object({
  min: z.number().int().nonnegative(),
  max: z.number().int().nonnegative(),
});

export const packageItemSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  providerName: z.string(),
  role: packageRoleSchema,
  date: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  priceEstimate: z.number().int().nonnegative(),
  bookingMode: bookingModeSchema,
  itemStatus: z.enum(["proposed", "held", "confirmed", "declined", "expired", "cancelled"]),
  categories: z.array(providerCategorySchema).default([]),
  address: z.string().nullable().default(null),
  city: z.string().nullable().default(null),
  photoUrl: z.string().nullable().default(null),
  rating: z.number().nullable().default(null),
  reviewCount: z.number().nullable().default(null),
  website: z.string().nullable().default(null),
  mapsUrl: z.string().nullable().default(null),
});

export const packageRecommendationSchema = z.object({
  id: z.string().uuid(),
  partyId: z.string().uuid(),
  status: packageStatusSchema,
  bookingKind: bookingKindSchema,
  targetDate: z.string(),
  targetStartsAt: z.string(),
  targetEndsAt: z.string(),
  estimatedPrice: priceRangeSchema,
  score: z.number(),
  scoreBreakdown: z.record(z.string(), z.number()),
  reasons: z.array(z.string()),
  items: z.array(packageItemSchema),
});

export const recommendationsResponseSchema = z.object({
  data: z.array(packageRecommendationSchema),
});

export const providerCalendarEventSchema = z.object({
  id: z.string().uuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: availabilityStatusSchema,
  source: z.enum(["availability", "hold", "booking"]),
});

export const providerCalendarResponseSchema = z.object({
  providerId: z.string().uuid(),
  events: z.array(providerCalendarEventSchema),
});

export const providerProfileSchema = z.object({
  providerId: z.string().uuid(),
  providerName: z.string(),
  placeId: z.string(),
  isManual: z.boolean(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  categories: z.array(providerCategorySchema),
  homeSector: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  bookingMode: bookingModeSchema,
  offeredServices: z.array(offeredServiceSchema),
  animatorTypes: z.array(z.string()),
  themes: z.array(z.string()),
  activities: z.array(z.string()),
  ageRanges: z.array(z.string()),
  serviceAreaSectors: z.array(z.string()),
  priceMin: z.number().int().nonnegative(),
  priceMax: z.number().int().nonnegative(),
});

export const providerRequestsResponseSchema = z.object({
  data: z.array(packageRecommendationSchema),
});

export const createRecommendationsParamsSchema = z.object({
  id: z.string().uuid(),
});

export const requestPackageParamsSchema = z.object({
  id: z.string().uuid(),
  packageId: z.string().uuid(),
});

export const providerPackageItemActionSchema = z.object({
  itemId: z.string().uuid(),
});

export const updateProviderAvailabilityBodySchema = z.object({
  providerId: z.string().uuid(),
  startsAt: z.string().min(10),
  endsAt: z.string().min(10),
  status: availabilityStatusSchema,
  id: z.string().uuid().optional(),
});

export const deleteProviderAvailabilityBodySchema = z.object({
  providerId: z.string().uuid(),
  id: z.string().uuid(),
});

export const updateProviderProfileBodySchema = z.object({
  providerId: z.string().uuid(),
  bookingMode: bookingModeSchema,
  offeredServices: z.array(offeredServiceSchema),
  animatorTypes: z.array(z.string()).default([]),
  themes: z.array(z.string()).default([]),
  activities: z.array(z.string()).default([]),
  ageRanges: z.array(z.string()).default([]),
  serviceAreaSectors: z.array(z.string()).default([]),
  priceMin: z.number().int().nonnegative(),
  priceMax: z.number().int().nonnegative(),
  // Editable only for manual providers
  providerName: z.string().min(2).max(120).optional(),
  address: z.string().max(300).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
});

export const createProviderBodySchema = z.object({
  name: z.string().min(2).max(120),
  category: providerCategorySchema,
  city: z.string().min(2).default("București"),
  address: z.string().min(3).max(300),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  bookingMode: bookingModeSchema.default("request"),
  offeredServices: z.array(offeredServiceSchema).min(1).optional(),
  animatorTypes: z.array(z.string()).default([]),
  themes: z.array(z.string()).default([]),
  activities: z.array(z.string()).default([]),
  ageRanges: z.array(z.string()).default([]),
  serviceAreaSectors: z.array(z.string()).default([]),
  priceMin: z.number().int().nonnegative(),
  priceMax: z.number().int().nonnegative(),
  homeSector: z.string().nullable().optional(),
});

export type PackageRecommendationDto = z.infer<typeof packageRecommendationSchema>;
export type PackageItemDto = z.infer<typeof packageItemSchema>;
export type ProviderProfileDto = z.infer<typeof providerProfileSchema>;
export type CreateProviderBody = z.infer<typeof createProviderBodySchema>;
