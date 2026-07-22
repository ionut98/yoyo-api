import type { SupabaseClient } from "@supabase/supabase-js";
import { toProviderDetailDto, toProviderDto } from "../mappers/providers.js";
import type {
  ListProvidersQuery,
  ListProvidersResponse,
  ProviderDetailDto,
} from "../schemas/providers.js";

const PROVIDER_SELECT = `
  id, place_id, name, address, phone, website,
  rating, review_count, lat, lng, categories, maps_url,
  city:cities(id, name),
  provider_photos(id, public_url, width_px, height_px)
`;

async function resolveCityId(
  supabase: SupabaseClient,
  cityName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("cities")
    .select("id")
    .eq("name", cityName)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to resolve city: ${error.message}`);
  }

  return data?.id ?? null;
}

export async function listProviders(
  supabase: SupabaseClient,
  query: ListProvidersQuery,
): Promise<ListProvidersResponse> {
  const { city, category, minRating, sort, order, page, limit } = query;
  const offset = (page - 1) * limit;

  let cityId: string | null = null;
  if (city) {
    cityId = await resolveCityId(supabase, city);
    if (!cityId) {
      return {
        data: [],
        pagination: { page, limit, total: 0, totalPages: 0 },
      };
    }
  }

  let dbQuery = supabase
    .from("providers")
    .select(PROVIDER_SELECT, { count: "exact" });

  if (cityId) {
    dbQuery = dbQuery.eq("city_id", cityId);
  }

  if (category) {
    dbQuery = dbQuery.contains("categories", [category]);
  }

  if (minRating !== undefined) {
    dbQuery = dbQuery.gte("rating", minRating);
  }

  dbQuery = dbQuery
    .order(sort, { ascending: order === "asc", nullsFirst: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await dbQuery;

  if (error) {
    throw new Error(`Failed to list providers: ${error.message}`);
  }

  const total = count ?? 0;
  const totalPages = total === 0 ? 0 : Math.ceil(total / limit);

  return {
    data: (data ?? []).map(toProviderDto),
    pagination: { page, limit, total, totalPages },
  };
}

export async function getProviderById(
  supabase: SupabaseClient,
  id: string,
): Promise<ProviderDetailDto | null> {
  const { data, error } = await supabase
    .from("providers")
    .select(PROVIDER_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to get provider: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return toProviderDetailDto(data);
}
