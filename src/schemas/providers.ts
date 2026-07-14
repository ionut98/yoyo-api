import { z } from "zod";

export const providerCategorySchema = z.enum([
  "venue",
  "entertainment",
  "balloons",
  "cakes",
]);

export type ProviderCategory = z.infer<typeof providerCategorySchema>;

export const listProvidersQuerySchema = z.object({
  city: z.string().min(1).optional(),
  category: providerCategorySchema.optional(),
  minRating: z.coerce.number().min(0).max(5).optional(),
  sort: z.enum(["rating", "name", "review_count"]).default("rating"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;

export const citySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});

export const providerPhotoSchema = z.object({
  id: z.string().uuid(),
  publicUrl: z.string().nullable(),
  widthPx: z.number().nullable(),
  heightPx: z.number().nullable(),
});

export const providerSchema = z.object({
  id: z.string().uuid(),
  placeId: z.string(),
  name: z.string(),
  categories: z.array(providerCategorySchema),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  website: z.string().nullable(),
  rating: z.number().nullable(),
  reviewCount: z.number().nullable(),
  lat: z.number().nullable(),
  lng: z.number().nullable(),
  mapsUrl: z.string().nullable(),
  city: citySchema.nullable(),
});

export type ProviderDto = z.infer<typeof providerSchema>;

export const providerDetailSchema = providerSchema.extend({
  photos: z.array(providerPhotoSchema),
});

export type ProviderDetailDto = z.infer<typeof providerDetailSchema>;

export const paginationSchema = z.object({
  page: z.number(),
  limit: z.number(),
  total: z.number(),
  totalPages: z.number(),
});

export const listProvidersResponseSchema = z.object({
  data: z.array(providerSchema),
  pagination: paginationSchema,
});

export type ListProvidersResponse = z.infer<typeof listProvidersResponseSchema>;
