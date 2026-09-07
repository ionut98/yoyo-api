import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import { getPackageById } from "../repositories/package-requests.js";
import { listEffectiveAvailability } from "../repositories/provider-enrichment.js";
import { attachAvailableWindows } from "../services/orchestrator/available-windows.js";
import { cancelPackageBooking, requestPackageBooking } from "../services/booking/package-requests.js";

const requestPackageBodySchema = z
  .object({
    itemTimes: z
      .array(
        z.object({
          itemId: z.string().uuid(),
          startsAt: z.string().datetime({ offset: true }),
          endsAt: z.string().datetime({ offset: true }),
        }),
      )
      .min(1)
      .optional(),
  })
  .optional()
  .default({});

const CLIENT_REQUEST_ERRORS = new Set([
  "ITEM_TIMES_REQUIRED",
  "INVALID_ITEM_TIMES",
  "ITEM_TIMES_WRONG_DAY",
]);

export function createPackageRequestRoutes(env: Env) {
  const routes = new Hono<{ Variables: AuthVariables }>();
  routes.use("*", createRequireAuth(env));

  routes.post("/:packageId/request", async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param("packageId"));
    if (!parsed.success) {
      return c.json({ error: "Invalid package id" }, 400);
    }

    try {
      const body = requestPackageBodySchema.parse(await c.req.json().catch(() => ({})));
      const supabase = getSupabaseForRequest(c, env);
      const pkg = await requestPackageBooking(supabase, parsed.data, {
        itemTimes: body.itemTimes,
      });
      return c.json(pkg);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to request package";
      if (CLIENT_REQUEST_ERRORS.has(message)) {
        return c.json({ error: message }, 400);
      }
      const unavailable = message.includes("is not available");
      return c.json({ error: message }, unavailable ? 409 : 500);
    }
  });

  routes.get("/:packageId", async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param("packageId"));
    if (!parsed.success) {
      return c.json({ error: "Invalid package id" }, 400);
    }

    try {
      const supabase = getSupabaseForRequest(c, env);
      const pkg = await getPackageById(supabase, parsed.data);
      if (!pkg) return c.json({ error: "Package not found" }, 404);

      if (pkg.status !== "proposed") {
        return c.json({
          ...pkg,
          items: pkg.items.map((item) => ({
            ...item,
            availableWindows: item.availableWindows ?? [],
          })),
        });
      }

      const providerIds = [...new Set(pkg.items.map((item) => item.providerId))];
      const availability = await listEffectiveAvailability(supabase, {
        providerIds,
        date: pkg.targetDate.slice(0, 10),
      });
      const { data: durationRows } = await supabase
        .from("provider_service_profiles")
        .select("provider_id, default_booking_duration_minutes")
        .in("provider_id", providerIds);
      const durationByProviderId = new Map<string, number>(
        (durationRows ?? []).map((row) => [
          row.provider_id as string,
          Number(row.default_booking_duration_minutes ?? 120) || 120,
        ]),
      );
      return c.json(attachAvailableWindows(pkg, availability, durationByProviderId));
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to load package" }, 500);
    }
  });

  routes.post("/:packageId/cancel", async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param("packageId"));
    if (!parsed.success) {
      return c.json({ error: "Invalid package id" }, 400);
    }

    try {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const supabase = getSupabaseForRequest(c, env);
      const pkg = await cancelPackageBooking(supabase, parsed.data, user.id);
      return c.json(pkg);
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to cancel package";
      if (message === "FORBIDDEN") return c.json({ error: message }, 403);
      if (message === "Package not found") return c.json({ error: message }, 404);
      if (message.includes("fully confirmed")) return c.json({ error: message }, 409);
      return c.json({ error: "Failed to cancel package" }, 500);
    }
  });

  return routes;
}
