import { Hono } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import { ensureAccountRole } from "../repositories/accounts.js";
import {
  createPartyForUser,
  getPartyHubForUser,
  listPartiesForUser,
  listScheduleForParty,
  patchPartyForUser,
  replaceScheduleForParty,
  seedScheduleForParty,
} from "../repositories/parties.js";
import {
  createPartyBodySchema,
  patchPartyBodySchema,
  putScheduleBodySchema,
} from "../schemas/parties.js";

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

  routes.get("/:partyId", async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const partyId = c.req.param("partyId");
      const supabase = getSupabaseForRequest(c, env);
      const hub = await getPartyHubForUser(supabase, user.id, partyId);
      if (!hub) {
        return c.json({ error: "Party not found" }, 404);
      }
      return c.json(hub);
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch party" }, 500);
    }
  });

  routes.patch("/:partyId", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = patchPartyBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid party patch",
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
      const partyId = c.req.param("partyId");
      const supabase = getSupabaseForRequest(c, env);
      const party = await patchPartyForUser(supabase, user.id, partyId, parsed.data);
      if (!party) {
        return c.json({ error: "Party not found" }, 404);
      }
      return c.json(party);
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_PARTY_WINDOW") {
        return c.json({ error: "partyEndsAt must be after partyStartsAt" }, 400);
      }
      console.error(error);
      return c.json({ error: "Failed to update party" }, 500);
    }
  });

  routes.get("/:partyId/schedule", async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const partyId = c.req.param("partyId");
      const supabase = getSupabaseForRequest(c, env);
      const schedule = await listScheduleForParty(supabase, user.id, partyId);
      if (!schedule) {
        return c.json({ error: "Party not found" }, 404);
      }
      return c.json({ data: schedule });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to fetch schedule" }, 500);
    }
  });

  routes.put("/:partyId/schedule", async (c) => {
    const json = await c.req.json().catch(() => null);
    const parsed = putScheduleBodySchema.safeParse(json);
    if (!parsed.success) {
      return c.json(
        {
          error: "Invalid schedule payload",
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
      const partyId = c.req.param("partyId");
      const supabase = getSupabaseForRequest(c, env);
      const schedule = await replaceScheduleForParty(supabase, user.id, partyId, parsed.data);
      if (!schedule) {
        return c.json({ error: "Party not found" }, 404);
      }
      return c.json({ data: schedule });
    } catch (error) {
      console.error(error);
      return c.json({ error: "Failed to save schedule" }, 500);
    }
  });

  routes.post("/:partyId/schedule/seed", async (c) => {
    try {
      const user = c.get("user");
      if (!user) {
        return c.json({ error: "Unauthorized" }, 401);
      }
      const partyId = c.req.param("partyId");
      const supabase = getSupabaseForRequest(c, env);
      const hub = await seedScheduleForParty(supabase, user.id, partyId);
      if (!hub) {
        return c.json({ error: "Party not found" }, 404);
      }
      return c.json(hub);
    } catch (error) {
      if (error instanceof Error && error.message === "SCHEDULE_NOT_EMPTY") {
        return c.json({ error: "Schedule already exists" }, 409);
      }
      if (error instanceof Error && error.message === "NO_ACTIVE_BOOKING") {
        return c.json({ error: "No active booking to seed from" }, 400);
      }
      console.error(error);
      return c.json({ error: "Failed to seed schedule" }, 500);
    }
  });

  return routes;
}
