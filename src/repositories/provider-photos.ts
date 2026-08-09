import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_PROVIDER_PHOTOS = 12;
export const MAX_PROVIDER_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
]);

export type ProviderPhotoDto = {
  id: string;
  publicUrl: string | null;
  widthPx: number | null;
  heightPx: number | null;
  sortOrder: number;
  isCover: boolean;
};

const PHOTO_SELECT =
  "id, public_url, width_px, height_px, sort_order, is_cover, storage_path";

function mapPhoto(row: Record<string, unknown>): ProviderPhotoDto {
  return {
    id: row.id as string,
    publicUrl: (row.public_url as string | null) ?? null,
    widthPx: (row.width_px as number | null) ?? null,
    heightPx: (row.height_px as number | null) ?? null,
    sortOrder: Number(row.sort_order ?? 0),
    isCover: Boolean(row.is_cover),
  };
}

function extensionForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

export async function listProviderPhotos(
  supabase: SupabaseClient,
  providerId: string,
): Promise<ProviderPhotoDto[]> {
  const { data, error } = await supabase
    .from("provider_photos")
    .select(PHOTO_SELECT)
    .eq("provider_id", providerId)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to list provider photos: ${error.message}`);
  }
  return (data ?? []).map((row) => mapPhoto(row as Record<string, unknown>));
}

export async function uploadProviderPhoto(
  supabase: SupabaseClient,
  providerId: string,
  file: {
    bytes: Uint8Array;
    contentType: string;
    fileName?: string;
  },
): Promise<ProviderPhotoDto> {
  if (!ALLOWED_MIME.has(file.contentType)) {
    throw new Error("Unsupported image type");
  }
  if (file.bytes.byteLength > MAX_PROVIDER_PHOTO_BYTES) {
    throw new Error("Image too large (max 5MB)");
  }

  const existing = await listProviderPhotos(supabase, providerId);
  if (existing.length >= MAX_PROVIDER_PHOTOS) {
    throw new Error(`Maximum ${MAX_PROVIDER_PHOTOS} photos allowed`);
  }

  const photoId = crypto.randomUUID();
  const ext = extensionForMime(file.contentType);
  const storagePath = `${providerId}/${photoId}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("provider-photos")
    .upload(storagePath, file.bytes, {
      contentType: file.contentType,
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload photo: ${uploadError.message}`);
  }

  const { data: publicData } = supabase.storage.from("provider-photos").getPublicUrl(storagePath);
  const publicUrl = publicData.publicUrl;
  const nextOrder =
    existing.length === 0 ? 0 : Math.max(...existing.map((photo) => photo.sortOrder)) + 1;
  const isCover = existing.length === 0;

  const { data, error } = await supabase
    .from("provider_photos")
    .insert({
      id: photoId,
      provider_id: providerId,
      google_photo_name: null,
      storage_path: storagePath,
      public_url: publicUrl,
      sort_order: nextOrder,
      is_cover: isCover,
      attribution: file.fileName ?? "upload",
    })
    .select(PHOTO_SELECT)
    .single();

  if (error) {
    await supabase.storage.from("provider-photos").remove([storagePath]);
    throw new Error(`Failed to save photo row: ${error.message}`);
  }

  return mapPhoto(data as Record<string, unknown>);
}

export async function reorderProviderPhotos(
  supabase: SupabaseClient,
  providerId: string,
  orderedIds: string[],
  coverId?: string | null,
): Promise<ProviderPhotoDto[]> {
  const existing = await listProviderPhotos(supabase, providerId);
  const existingIds = new Set(existing.map((photo) => photo.id));
  if (orderedIds.length !== existing.length || orderedIds.some((id) => !existingIds.has(id))) {
    throw new Error("Invalid photo order payload");
  }

  const cover = coverId && existingIds.has(coverId) ? coverId : orderedIds[0];

  for (let index = 0; index < orderedIds.length; index += 1) {
    const id = orderedIds[index]!;
    const { error } = await supabase
      .from("provider_photos")
      .update({
        sort_order: index,
        is_cover: id === cover,
      })
      .eq("id", id)
      .eq("provider_id", providerId);
    if (error) {
      throw new Error(`Failed to reorder photos: ${error.message}`);
    }
  }

  return listProviderPhotos(supabase, providerId);
}

export async function deleteProviderPhoto(
  supabase: SupabaseClient,
  providerId: string,
  photoId: string,
): Promise<ProviderPhotoDto[]> {
  const { data: row, error: loadError } = await supabase
    .from("provider_photos")
    .select(PHOTO_SELECT)
    .eq("id", photoId)
    .eq("provider_id", providerId)
    .maybeSingle();

  if (loadError) {
    throw new Error(`Failed to load photo: ${loadError.message}`);
  }
  if (!row) {
    throw new Error("Photo not found");
  }

  const storagePath = (row.storage_path as string | null) ?? null;
  const wasCover = Boolean(row.is_cover);

  const { error: deleteError } = await supabase
    .from("provider_photos")
    .delete()
    .eq("id", photoId)
    .eq("provider_id", providerId);

  if (deleteError) {
    throw new Error(`Failed to delete photo: ${deleteError.message}`);
  }

  if (storagePath) {
    await supabase.storage.from("provider-photos").remove([storagePath]);
  }

  const remaining = await listProviderPhotos(supabase, providerId);
  if (remaining.length === 0) return remaining;

  const orderedIds = remaining.map((photo) => photo.id);
  const coverId = wasCover ? orderedIds[0] : remaining.find((photo) => photo.isCover)?.id;
  return reorderProviderPhotos(supabase, providerId, orderedIds, coverId);
}
