import type {
  ProviderCategory,
  ProviderDetailDto,
  ProviderDto,
} from "../schemas/providers.js";

type DbCity = {
  id: string;
  name: string;
};

type DbProviderPhotoRow = {
  id: string;
  public_url: string | null;
  width_px: number | null;
  height_px: number | null;
};

type DbProviderRow = {
  id: string;
  place_id: string;
  name: string;
  categories: string[];
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  review_count: number | null;
  lat: number | null;
  lng: number | null;
  maps_url: string | null;
  city: DbCity | DbCity[] | null;
  provider_photos?: DbProviderPhotoRow[] | null;
};

function normalizeCity(city: DbCity | DbCity[] | null): DbCity | null {
  if (!city) return null;
  return Array.isArray(city) ? (city[0] ?? null) : city;
}

type DbProviderDetailRow = DbProviderRow & {
  provider_photos: DbProviderPhotoRow[] | null;
};

const VALID_CATEGORIES = new Set<string>([
  "venue",
  "entertainment",
  "balloons",
  "cakes",
]);

function toCategories(raw: string[]): ProviderCategory[] {
  return raw.filter((c): c is ProviderCategory => VALID_CATEGORIES.has(c));
}

function firstPhotoUrl(photos: DbProviderPhotoRow[] | null | undefined): string | null {
  const url = photos?.find((photo) => Boolean(photo.public_url))?.public_url;
  return url ?? null;
}

export function toProviderDto(row: DbProviderRow): ProviderDto {
  return {
    id: row.id,
    placeId: row.place_id,
    name: row.name,
    categories: toCategories(row.categories),
    address: row.address,
    phone: row.phone,
    website: row.website,
    rating: row.rating,
    reviewCount: row.review_count,
    lat: row.lat,
    lng: row.lng,
    mapsUrl: row.maps_url,
    city: normalizeCity(row.city),
    photoUrl: firstPhotoUrl(row.provider_photos),
  };
}

export function toProviderDetailDto(row: DbProviderDetailRow): ProviderDetailDto {
  const photos = (row.provider_photos ?? []).map((photo) => ({
    id: photo.id,
    publicUrl: photo.public_url,
    widthPx: photo.width_px,
    heightPx: photo.height_px,
  }));

  return {
    ...toProviderDto(row),
    photos,
  };
}
