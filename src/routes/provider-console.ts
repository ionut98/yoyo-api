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
  deleteProviderAvailability,
  getProviderProfileForMember,
  listEffectiveAvailabilityRange,
  upsertProviderAvailability,
  updateProviderProfile,
} from "../repositories/provider-enrichment.js";
import { providerRespondToItem } from "../services/booking/package-requests.js";
import {
  createProviderBodySchema,
  deleteProviderAvailabilityBodySchema,
  providerPackageItemActionSchema,
  providerProfileSchema,
  updateProviderAvailabilityBodySchema,
  updateProviderProfileBodySchema,
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

function toProfileDto(profile: NonNullable<Awaited<ReturnType<typeof getProviderProfileForMember>>>) {
  return providerProfileSchema.parse({
    providerId: profile.providerId,
    providerName: profile.providerName,
    placeId: profile.placeId,
    isManual: profile.isManual,
    address: profile.address,
    phone: profile.phone,
    website: profile.website,
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
      return c.json({ error: "Failed to decline request" }, 500);
    }
  });

  routes.get("/calendar/:providerId", async (c) => {
    const providerId = z.string().uuid().parse(c.req.param("providerId"));
    const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
    try {
      const supabase = await requireProviderMembership(env, c as any, providerId);
      const [year, monthNumber] = month.split("-").map(Number);
      if (!year || !monthNumber) {
        return c.json({ error: "Invalid month" }, 400);
      }

      const startIso = new Date(Date.UTC(year, monthNumber - 1, 1)).toISOString();
      const endIso = new Date(Date.UTC(year, monthNumber, 1)).toISOString();

      const rows = await listEffectiveAvailabilityRange(supabase, {
        providerIds: [providerId],
        startIso,
        endIso,
      });

      return c.json({
        providerId,
        events: rows.map((row) => ({
          id: row.id,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          status: row.status,
          source: row.source ?? ("availability" as const),
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
      return c.json(toProfileDto(profile));
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
      return c.json({ ok: true });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to update provider profile" }, 500);
    }
  });

  return routes;
}
