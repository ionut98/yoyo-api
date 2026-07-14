import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { getSupabaseForRequest } from "../middleware/auth.js";
import { getProviderById, listProviders } from "../repositories/providers.js";
import { listProvidersQuerySchema } from "../schemas/providers.js";

export function createProviderRoutes(env: Env) {
  const routes = new Hono();

  routes.get("/", async (c) => {
    const rawQuery = {
      city: c.req.query("city"),
      category: c.req.query("category"),
      minRating: c.req.query("minRating"),
      sort: c.req.query("sort"),
      order: c.req.query("order"),
      page: c.req.query("page"),
      limit: c.req.query("limit"),
    };

    const parsed = listProvidersQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid query parameters",
          details: z.treeifyError(parsed.error),
        },
        400,
      );
    }

    try {
      const supabase = getSupabaseForRequest(c, env);
      const result = await listProviders(supabase, parsed.data);
      return c.json(result);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch providers" }, 500);
    }
  });

  routes.get("/:id", async (c) => {
    const id = c.req.param("id");
    const parsedId = z.string().uuid().safeParse(id);

    if (!parsedId.success) {
      return c.json({ error: "Invalid provider id" }, 400);
    }

    try {
      const supabase = getSupabaseForRequest(c, env);
      const provider = await getProviderById(supabase, parsedId.data);

      if (!provider) {
        return c.json({ error: "Provider not found" }, 404);
      }

      return c.json(provider);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch provider" }, 500);
    }
  });

  return routes;
}
