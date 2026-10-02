import { Hono, type Context } from "hono";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { createServiceRoleClient } from "../clients/supabase.js";
import {
  createRequireAuth,
  getSupabaseForRequest,
  type AuthVariables,
} from "../middleware/auth.js";
import { getAccountRole } from "../repositories/accounts.js";
import {
  approveClaimRequest,
  cleanupGeneratedAvailabilityForUnclaimed,
  listAdminClaimRequests,
  rejectClaimRequest,
  type ClaimRequestStatus,
} from "../repositories/claim-requests.js";

async function requireAdmin(
  env: Env,
  c: Context<{ Variables: AuthVariables }>,
) {
  const user = c.get("user");
  if (!user) throw new Error("Unauthorized");
  const supabase = getSupabaseForRequest(c, env);
  const role = await getAccountRole(supabase, user.id);
  if (role !== "admin") throw new Error("Forbidden");
  return { user, supabase };
}

export function createAdminRoutes(env: Env) {
  const routes = new Hono<{ Variables: AuthVariables }>();
  routes.use("*", createRequireAuth(env));

  routes.get("/me", async (c) => {
    try {
      const { user } = await requireAdmin(env, c);
      return c.json({ userId: user.id, accountRole: "admin" as const });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Forbidden";
      return c.json({ error: message }, message === "Unauthorized" ? 401 : 403);
    }
  });

  routes.get("/claim-requests", async (c) => {
    const statusParse = z
      .enum(["pending", "approved", "rejected", "cancelled"])
      .default("pending")
      .safeParse(c.req.query("status") ?? "pending");
    if (!statusParse.success) {
      return c.json({ error: "Invalid status" }, 400);
    }

    try {
      const { supabase } = await requireAdmin(env, c);
      const data = await listAdminClaimRequests(
        supabase,
        statusParse.data as ClaimRequestStatus,
      );
      return c.json({ data });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to list claim requests";
      return c.json({ error: message }, message === "Forbidden" ? 403 : 500);
    }
  });

  routes.post("/claim-requests/:id/approve", async (c) => {
    const idParse = z.string().uuid().safeParse(c.req.param("id"));
    if (!idParse.success) return c.json({ error: "Invalid claim request id" }, 400);

    try {
      const { user } = await requireAdmin(env, c);
      const service = createServiceRoleClient(env);
      const data = await approveClaimRequest(service, {
        requestId: idParse.data,
        adminUserId: user.id,
      });
      return c.json({ data });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to approve claim request";
      const status =
        message === "Forbidden" ? 403 : message.includes("not") ? 400 : 500;
      return c.json({ error: message }, status);
    }
  });

  routes.post("/claim-requests/:id/reject", async (c) => {
    const idParse = z.string().uuid().safeParse(c.req.param("id"));
    if (!idParse.success) return c.json({ error: "Invalid claim request id" }, 400);
    const json = await c.req.json().catch(() => ({}));
    const body = z
      .object({ adminNote: z.string().max(2000).nullable().optional() })
      .safeParse(json ?? {});
    if (!body.success) return c.json({ error: "Invalid reject payload" }, 400);

    try {
      const { user, supabase } = await requireAdmin(env, c);
      const data = await rejectClaimRequest(supabase, {
        requestId: idParse.data,
        adminUserId: user.id,
        adminNote: body.data.adminNote,
      });
      return c.json({ data });
    } catch (error) {
      console.error(error);
      const message = error instanceof Error ? error.message : "Failed to reject claim request";
      return c.json({ error: message }, message === "Forbidden" ? 403 : 500);
    }
  });

  routes.post("/cleanup-generated-availability", async (c) => {
    try {
      await requireAdmin(env, c);
      const service = createServiceRoleClient(env);
      const result = await cleanupGeneratedAvailabilityForUnclaimed(service);
      return c.json({ ok: true, ...result });
    } catch (error) {
      console.error(error);
      const message =
        error instanceof Error ? error.message : "Failed to cleanup generated availability";
      return c.json({ error: message }, message.includes("SERVICE_ROLE") ? 500 : message === "Forbidden" ? 403 : 500);
    }
  });

  return routes;
}
