import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import { createRecommendationsForParty } from "../services/orchestrator/create-recommendations.js";

export function createRecommendationRoutes(env: Env) {
  const routes = new Hono<{ Variables: AuthVariables }>();
  routes.use("*", createRequireAuth(env));

  routes.post("/:id/recommendations", async (c) => {
    const parsed = z.string().uuid().safeParse(c.req.param("id"));
    if (!parsed.success) {
      return c.json({ error: "Invalid party id" }, 400);
    }

    try {
      const user = c.get("user");
      if (!user) return c.json({ error: "Unauthorized" }, 401);
      const supabase = getSupabaseForRequest(c, env);
      const data = await createRecommendationsForParty(supabase, parsed.data, user.id);
      return c.json({ data });
    } catch (error) {
      console.error(error);
      return c.json({ error: error instanceof Error ? error.message : "Failed to create recommendations" }, 500);
    }
  });

  return routes;
}
