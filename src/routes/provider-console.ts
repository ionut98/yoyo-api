import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import {
  claimProviderMembership,
  getProviderMemberships,
} from "../repositories/accounts.js";
import { createManualProvider } from "../repositories/create-provider.js";
import { listProviderPackages } from "../repositories/package-requests.js";
import {
  cancelProviderReservation,
  createProviderReservation,
  getProviderReservation,
  listProviderReservations,
  updateProviderReservation,
} from "../repositories/provider-reservations.js";
import {
  deleteProviderAvailability,
  getProviderProfileForMember,
  listEffectiveAvailabilityRange,
  upsertProviderAvailability,
  updateProviderProfile,
} from "../repositories/provider-enrichment.js";
import {
  expireStalePackageRequests,
  providerDismissExpiredItem,
  providerRespondToItem,
} from "../services/booking/package-requests.js";
import {
  deleteProviderPhoto,
  listProviderPhotos,
  reorderProviderPhotos,
  uploadProviderPhoto,
} from "../repositories/provider-photos.js";
import {
  cancelProviderReservationBodySchema,
  createProviderBodySchema,
  createProviderReservationBodySchema,
  deleteProviderAvailabilityBodySchema,
  deleteProviderPhotoBodySchema,
  providerPackageItemActionSchema,
  providerProfileSchema,
  providerReservationSchema,
  reorderProviderPhotosBodySchema,
  updateProviderAvailabilityBodySchema,
  updateProviderProfileBodySchema,
  updateProviderReservationBodySchema,
} from "../schemas/orchestrator.js";

async function requireProviderMembership(
  env: Env,
  c: Context<{ Variables: AuthVariables }>,
  providerId: string,
) {
  const user = c.get("user");
  if (!user) {
    throw new Error("Unauthorized");
  }
  const supabase = getSupabaseForRequest(c, env);
  const memberships = await getProviderMemberships(supabase, user.id);
  if (!memberships.some((membership) => membership.providerId === providerId)) {
    throw new Error("Forbidden");
  }
  return supabase;
}

async function toProfileDto(
  supabase: Awaited<ReturnType<typeof getSupabaseForRequest>>,
  profile: NonNullable<Awaited<ReturnType<typeof getProviderProfileForMember>>>,
) {
  const photos = await listProviderPhotos(supabase, profile.providerId);
  return providerProfileSchema.parse({
    providerId: profile.providerId,
    providerName: profile.providerName,
    placeId: profile.placeId,
    isManual: profile.isManual,
    description: profile.description,
    address: profile.address,
    phone: profile.phone,
    website: profile.website,
    lat: profile.lat,
    lng: profile.lng,
    categories: profile.categories,
    homeSector: profile.homeSector,
    rating: profile.rating,
    reviewCount: profile.reviewCount,
    bookingMode: profile.bookingMode,
    offeredServices: profile.offeredServices,
    animatorTypes: profile.animatorTypes,
    themes: profile.themes,
    activities: profile.activities,
    ageRanges: profile.ageRanges,
    serviceAreaSectors: profile.serviceAreaSectors,
    priceMin: profile.priceMin,
    priceMax: profile.priceMax,
    photos,
  });
}

export function createProviderConsoleRoutes(env: Env) {
  const routes = new Hono<{ Variables: AuthVariables }>();
  routes.use("*", createRequireAuth(env));

  routes.get("/me", async (c) => {
    try {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const supabase = getSupabaseForRequest(c, env);
      const memberships = await getProviderMemberships(supabase, user.id);
      return c.json({ data: memberships });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load provider memberships" }, 500);
    }
  });

  routes.post("/create", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = createProviderBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid create provider payload", details: z.treeifyError(parsed.error) }, 400);
    }
    if (parsed.data.priceMax < parsed.data.priceMin) {
      return c.json({ error: "priceMax must be >= priceMin" }, 400);
    }

    try {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const supabase = getSupabaseForRequest(c, env);
      const profile = await createManualProvider(supabase, user.id, parsed.data);
      return c.json(profile, 201);
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to create provider" },
        500,
      );
    }
  });

  routes.post("/claim", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = z
      .object({
        providerId: z.string().uuid(),
      })
      .safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid claim payload" }, 400);
    }

    try {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const supabase = getSupabaseForRequest(c, env);
      const membership = await claimProviderMembership(
        supabase,
        user.id,
        parsed.data.providerId,
      );
      return c.json({ data: membership });
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to claim provider" },
        500,
      );
    }
  });

  routes.get("/requests/:providerId", async (c) => {
    const providerId = z.string().uuid().parse(c.req.param("providerId"));
    try {
      const supabase = await requireProviderMembership(env, c as any, providerId);
      await expireStalePackageRequests(supabase);
      const data = await listProviderPackages(supabase, providerId);
      return c.json({ data });
    } catch (error) {
      console.error(error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to load requests" }, 403);
    }
  });

  routes.post("/requests/items/:itemId/accept", async (c) => {
    const parsed = providerPackageItemActionSchema.safeParse({ itemId: c.req.param("itemId") });
    if (!parsed.success) {
      return c.json({ error: "Invalid item id" }, 400);
    }
    try {
      const supabase = getSupabaseForRequest(c, env);
      const data = await providerRespondToItem(supabase, parsed.data.itemId, "accept");
      return c.json(data);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to accept request";
      if (message === "REQUEST_EXPIRED_OR_CLOSED") {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: "Failed to accept request" }, 500);
    }
  });

  routes.post("/requests/items/:itemId/decline", async (c) => {
    const parsed = providerPackageItemActionSchema.safeParse({ itemId: c.req.param("itemId") });
    if (!parsed.success) {
      return c.json({ error: "Invalid item id" }, 400);
    }
    try {
      const supabase = getSupabaseForRequest(c, env);
      const data = await providerRespondToItem(supabase, parsed.data.itemId, "decline");
      return c.json(data);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to decline request";
      if (message === "REQUEST_EXPIRED_OR_CLOSED") {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: "Failed to decline request" }, 500);
    }
  });

  routes.post("/requests/items/:itemId/dismiss", async (c) => {
    const parsed = providerPackageItemActionSchema.safeParse({ itemId: c.req.param("itemId") });
    if (!parsed.success) {
      return c.json({ error: "Invalid item id" }, 400);
    }
    try {
      const supabase = getSupabaseForRequest(c, env);
      const data = await providerDismissExpiredItem(supabase, parsed.data.itemId);
      return c.json(data);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to dismiss request";
      if (message === "REQUEST_NOT_EXPIRED") {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: "Failed to dismiss request" }, 500);
    }
  });

  routes.get("/reservations/item/:reservationId", async (c) => {
    const reservationId = z.string().uuid().parse(c.req.param("reservationId"));
    try {
      const supabase = getSupabaseForRequest(c, env);
      const row = await getProviderReservation(supabase, reservationId);
      if (!row) return c.json({ error: "Reservation not found" }, 404);
      await requireProviderMembership(env, c as any, row.providerId);
      return c.json({ data: providerReservationSchema.parse(row) });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load reservation" }, 403);
    }
  });

  routes.get("/reservations/:providerId", async (c) => {
    const providerId = z.string().uuid().parse(c.req.param("providerId"));
    try {
      const supabase = await requireProviderMembership(env, c as any, providerId);
      const data = await listProviderReservations(supabase, providerId);
      return c.json({ data: data.map((row) => providerReservationSchema.parse(row)) });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load reservations" }, 403);
    }
  });

  routes.post("/reservations", async (c) => {
    const user = c.get("user");
    if (!user) return c.json({ error: "Unauthorized" }, 401);
    const json = await c.req.json().catch(() => null);
    const parsed = createProviderReservationBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid reservation payload", details: z.treeifyError(parsed.error) }, 400);
    }
    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      const { providerId, ...input } = parsed.data;
      const data = await createProviderReservation(supabase, providerId, user.id, {
        ...input,
        parentEmail: input.parentEmail || null,
      });
      return c.json({ data: providerReservationSchema.parse(data) });
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to create reservation" },
        500,
      );
    }
  });

  routes.patch("/reservations", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = updateProviderReservationBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid reservation payload", details: z.treeifyError(parsed.error) }, 400);
    }
    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      const { providerId, id, ...input } = parsed.data;
      const data = await updateProviderReservation(supabase, providerId, id, {
        ...input,
        parentEmail: input.parentEmail || null,
      });
      return c.json({ data: providerReservationSchema.parse(data) });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to update reservation";
      if (message === "RESERVATION_CANCELLED" || message === "Reservation not found") {
        return c.json({ error: message }, 409);
      }
      return c.json({ error: message }, 500);
    }
  });

  routes.delete("/reservations", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = cancelProviderReservationBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid cancel payload", details: z.treeifyError(parsed.error) }, 400);
    }
    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      const data = await cancelProviderReservation(supabase, parsed.data.providerId, parsed.data.id);
      return c.json({ data: providerReservationSchema.parse(data) });
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to cancel reservation" },
        500,
      );
    }
  });

  routes.get("/calendar/:providerId", async (c) => {
    const providerId = z.string().uuid().parse(c.req.param("providerId"));
    const fromParam = c.req.query("from");
    const toParam = c.req.query("to");
    const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
    try {
      const supabase = await requireProviderMembership(env, c as any, providerId);

      let startIso: string;
      let endIso: string;
      if (fromParam && toParam) {
        const startMs = Date.parse(fromParam);
        const endMs = Date.parse(toParam);
        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          return c.json({ error: "Invalid from/to range" }, 400);
        }
        startIso = new Date(startMs).toISOString();
        endIso = new Date(endMs).toISOString();
      } else {
        const [year, monthNumber] = month.split("-").map(Number);
        if (!year || !monthNumber) {
          return c.json({ error: "Invalid month" }, 400);
        }
        startIso = new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString();
        endIso = new Date(Date.UTC(year, monthNumber, 1)).toISOString();
      }

      const rows = await listEffectiveAvailabilityRange(supabase, {
        providerIds: [providerId],
        startIso,
        endIso,
      });

      const packageIds = [
        ...new Set(rows.map((row) => row.packageId).filter((id): id is string => Boolean(id))),
      ];
      const titleByPackageId = new Map<string, string>();
      if (packageIds.length > 0) {
        const { data: contexts, error: contextError } = await supabase.rpc(
          "get_packages_party_context",
          { p_package_ids: packageIds },
        );
        if (contextError) {
          throw new Error(`Failed to load booking context: ${contextError.message}`);
        }
        for (const row of contexts ?? []) {
          const name = (row.parent_name as string | null) ?? null;
          const sector = (row.sector as string | null) ?? null;
          const parts = [name, sector && sector !== "orice" ? sector.toUpperCase() : null].filter(
            Boolean,
          );
          titleByPackageId.set(row.package_id as string, parts.join(" · ") || "Rezervare");
        }
      }

      return c.json({
        providerId,
        events: rows.map((row) => ({
          id: row.id,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status,
          source: row.source ?? ("availability" as const),
          packageId: row.packageId ?? null,
          packageItemId: row.packageItemId ?? null,
          reservationId: row.reservationId ?? null,
          title:
            row.title ??
            (row.packageId ? (titleByPackageId.get(row.packageId) ?? "Rezervare") : null),
        })),
      });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load provider calendar" }, 500);
    }
  });

  routes.patch("/availability", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = updateProviderAvailabilityBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid availability payload", details: z.treeifyError(parsed.error) }, 400);
    }

    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      const result = await upsertProviderAvailability(supabase, parsed.data.providerId, {
        id: parsed.data.id,
        startsAt: parsed.data.startsAt,
        endsAt: parsed.data.endsAt,
        status: parsed.data.status,
      });
      return c.json({ ok: true, id: result.id });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to update availability" }, 500);
    }
  });

  routes.delete("/availability", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = deleteProviderAvailabilityBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid delete availability payload", details: z.treeifyError(parsed.error) }, 400);
    }

    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      await deleteProviderAvailability(supabase, parsed.data.providerId, parsed.data.id);
      return c.json({ ok: true });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to delete availability" }, 500);
    }
  });

  routes.get("/profile/:providerId", async (c) => {
    const providerId = z.string().uuid().parse(c.req.param("providerId"));
    try {
      const supabase = await requireProviderMembership(env, c as any, providerId);
      const profile = await getProviderProfileForMember(supabase, providerId);
      if (!profile) return c.json({ error: "Provider profile not found" }, 404);
      return c.json(await toProfileDto(supabase, profile));
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load provider profile" }, 500);
    }
  });

  routes.patch("/profile", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = updateProviderProfileBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid provider profile payload", details: z.treeifyError(parsed.error) }, 400);
    }

    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      await updateProviderProfile(supabase, parsed.data.providerId, parsed.data);
      const profile = await getProviderProfileForMember(supabase, parsed.data.providerId);
      if (!profile) return c.json({ ok: true });
      return c.json(await toProfileDto(supabase, profile));
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to update provider profile" }, 500);
    }
  });

  routes.get("/photos/:providerId", async (c) => {
    const providerId = z.string().uuid().parse(c.req.param("providerId"));
    try {
      const supabase = await requireProviderMembership(env, c as any, providerId);
      const photos = await listProviderPhotos(supabase, providerId);
      return c.json({ data: photos });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load photos" }, 403);
    }
  });

  routes.post("/photos", async (c) => {
    try {
      const form = await c.req.parseBody({ all: true });
      const providerIdRaw = form.providerId;
      const providerId =
        typeof providerIdRaw === "string" ? z.string().uuid().parse(providerIdRaw) : null;
      if (!providerId) {
        return c.json({ error: "providerId is required" }, 400);
      }

      const supabase = await requireProviderMembership(env, c as any, providerId);
      const fileField = form.file;
      const files = Array.isArray(fileField) ? fileField : fileField ? [fileField] : [];
      const uploaded = [];

      for (const entry of files) {
        if (typeof entry === "string" || !entry || typeof (entry as File).arrayBuffer !== "function") {
          continue;
        }
        const file = entry as File;
        const bytes = new Uint8Array(await file.arrayBuffer());
        uploaded.push(
          await uploadProviderPhoto(supabase, providerId, {
            bytes,
            contentType: file.type || "image/jpeg",
            fileName: file.name,
          }),
        );
      }

      if (uploaded.length === 0) {
        return c.json({ error: "No image files provided" }, 400);
      }

      return c.json({ data: await listProviderPhotos(supabase, providerId) }, 201);
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to upload photos" },
        500,
      );
    }
  });

  routes.patch("/photos/reorder", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = reorderProviderPhotosBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid reorder payload", details: z.treeifyError(parsed.error) }, 400);
    }
    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      const data = await reorderProviderPhotos(
        supabase,
        parsed.data.providerId,
        parsed.data.orderedIds,
        parsed.data.coverId,
      );
      return c.json({ data });
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to reorder photos" },
        500,
      );
    }
  });

  routes.delete("/photos", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = deleteProviderPhotoBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: "Invalid delete photo payload", details: z.treeifyError(parsed.error) }, 400);
    }
    try {
      const supabase = await requireProviderMembership(env, c as any, parsed.data.providerId);
      const data = await deleteProviderPhoto(
        supabase,
        parsed.data.providerId,
        parsed.data.photoId,
      );
      return c.json({ data });
    } catch (error) {
      console.error(error);
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to delete photo" },
        500,
      );
    }
  });

  return routes;
}
