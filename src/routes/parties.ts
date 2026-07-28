import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import { ensureAccountRole } from "../repositories/accounts.js";
import { createPartyForUser, listPartiesForUser } from "../repositories/parties.js";
import { createPartyBodySchema } from "../schemas/parties.js";

export function createPartyRoutes(env: Env) {
  const routes = new Hono<{ Variables: AuthVariables }>();

  routes.use("*", createRequireAuth(env));

  routes.get("/", async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const supabase = getSupabaseForRequest(c, env);
      const result = await listPartiesForUser(supabase, user.id);
      return c.json(result);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch parties" }, 500);
    }
  });

  routes.post("/", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = createPartyBodySchema.safeParse(json);

    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid party payload",
          details: z.treeifyError(parsed.error),
        },
        400,
      );
    }

    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const supabase = getSupabaseForRequest(c, env);
      await ensureAccountRole(supabase, user.id, "parent");
      const party = await createPartyForUser(supabase, user.id, parsed.data);
      return c.json(party, 201);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to create party" }, 500);
    }
  });

  return routes;
}
