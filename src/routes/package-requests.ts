import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import { getPackageById } from "../repositories/package-requests.js";
import { cancelPackageBooking, requestPackageBooking } from "../services/booking/package-requests.js";

export function createPackageRequestRoutes(env: Env) {
  const routes = new Hono<{ Variables: AuthVariables }>();
  routes.use("*", createRequireAuth(env));

  routes.post("/:packageId/request", async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param("packageId"));
    if (!parsed.success) {
      return c.json({ error: "Invalid package id" }, 400);
    }

    try {
      const supabase = getSupabaseForRequest(c, env);
      const pkg = await requestPackageBooking(supabase, parsed.data);
      return c.json(pkg);
    } catch (error) {
      console.error(error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to request package" }, 500);
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
      return c.json(pkg);
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
      const supabase = getSupabaseForRequest(c, env);
      const pkg = await cancelPackageBooking(supabase, parsed.data);
      return c.json(pkg);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to cancel package" }, 500);
    }
  });

  return routes;
}
