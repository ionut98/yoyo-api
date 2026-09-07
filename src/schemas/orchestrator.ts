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
export const availabilityStatusSchema = z.enum(["available", "booked"]);
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
  availableWindows: z
    .array(
      z.object({
        startsAt: z.string(),
        endsAt: z.string(),
      }),
    )
    .default([]),
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
  requestedAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  party: z
    .object({
      parentName: z.string().nullable(),
      parentEmail: z.string().nullable(),
      sector: z.string().nullable(),
      ageRange: z.string().nullable(),
      budget: z.string().nullable(),
      guestCount: z.string().nullable(),
      themeId: z.string().nullable(),
      themeCustom: z.string().nullable(),
      activities: z.array(z.string()).default([]),
      city: z.string().nullable(),
      preferredDate: z.string().nullable(),
    })
    .nullable()
    .optional(),
});

export const recommendationsResponseSchema = z.object({
  data: z.array(packageRecommendationSchema),
});

export const providerCalendarEventSchema = z.object({
  id: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
  status: availabilityStatusSchema,
  source: z.enum(["availability", "hold", "booking"]),
  packageId: z.string().uuid().nullable().optional(),
  packageItemId: z.string().uuid().nullable().optional(),
  title: z.string().nullable().optional(),
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
  description: z.string().nullable().default(null),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  lat: z.number().nullable().default(null),
  lng: z.number().nullable().default(null),
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
  defaultBookingDurationMinutes: z.number().int().min(30).max(480).default(120),
  photos: z
    .array(
      z.object({
        id: z.string().uuid(),
        publicUrl: z.string().nullable(),
        widthPx: z.number().nullable(),
        heightPx: z.number().nullable(),
        sortOrder: z.number().int().nonnegative(),
        isCover: z.boolean(),
      }),
    )
    .default([]),
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

export const providerReservationSchema = z.object({
  id: z.string().uuid(),
  providerId: z.string().uuid(),
  startsAt: z.string(),
  endsAt: z.string(),
  origin: z.literal("manual"),
  parentName: z.string(),
  parentPhone: z.string().nullable(),
  parentEmail: z.string().nullable(),
  ageRange: z.string().nullable(),
  guestCount: z.string().nullable(),
  budget: z.string().nullable(),
  sector: z.string().nullable(),
  city: z.string().nullable(),
  address: z.string().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  themeLabel: z.string().nullable(),
  activities: z.array(z.string()),
  notes: z.string().nullable(),
  status: z.enum(["confirmed", "cancelled"]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const createProviderReservationBodySchema = z.object({
  providerId: z.string().uuid(),
  startsAt: z.string().min(10),
  endsAt: z.string().min(10),
  parentName: z.string().min(1).max(120),
  parentPhone: z.string().max(40).nullable().optional(),
  parentEmail: z.union([z.string().email(), z.literal(""), z.null()]).optional(),
  ageRange: z.string().max(40).nullable().optional(),
  guestCount: z.string().max(40).nullable().optional(),
  budget: z.string().max(40).nullable().optional(),
  sector: z.string().max(40).nullable().optional(),
  city: z.string().max(80).nullable().optional(),
  address: z.string().min(3).max(300),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
  themeLabel: z.string().max(120).nullable().optional(),
  activities: z.array(z.string()).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const updateProviderReservationBodySchema = createProviderReservationBodySchema.extend({
  id: z.string().uuid(),
});

export const cancelProviderReservationBodySchema = z.object({
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
  defaultBookingDurationMinutes: z.number().int().min(30).max(480).default(120),
  providerName: z.string().min(2).max(120).optional(),
  description: z.string().max(4000).nullable().optional(),
  address: z.string().max(300).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  website: z.string().max(300).nullable().optional(),
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

export const createProviderBodySchema = z.object({
  name: z.string().min(2).max(120),
  category: providerCategorySchema,
  city: z.string().min(2).default("București"),
  address: z.string().min(3).max(300),
  description: z.string().max(4000).nullable().optional(),
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
  lat: z.number().nullable().optional(),
  lng: z.number().nullable().optional(),
});

export const reorderProviderPhotosBodySchema = z.object({
  providerId: z.string().uuid(),
  orderedIds: z.array(z.string().uuid()).min(1),
  coverId: z.string().uuid().nullable().optional(),
});

export const deleteProviderPhotoBodySchema = z.object({
  providerId: z.string().uuid(),
  photoId: z.string().uuid(),
});

export type PackageRecommendationDto = z.infer<typeof packageRecommendationSchema>;
export type PackageItemDto = z.infer<typeof packageItemSchema>;
export type ProviderProfileDto = z.infer<typeof providerProfileSchema>;
export type CreateProviderBody = z.infer<typeof createProviderBodySchema>;
