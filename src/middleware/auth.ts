import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import type { User } from "@supabase/supabase-js";
import {
  createSupabaseClient,
  createSupabaseClientWithToken,
} from "../clients/supabase.js";
import type { Env } from "../config/env.js";

export type AuthVariables = {
  user: User | null;
};

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.slice("Bearer ".length).trim();
  return token.length > 0 ? token : null;
}

export function createOptionalAuth(env: Env) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));

    if (!token) {
      c.set("user", null);
      await next();
      return;
    }

    const supabase = createSupabaseClient(env);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      c.set("user", null);
      await next();
      return;
    }

    c.set("user", data.user);
    await next();
  });
}

export function createRequireAuth(env: Env) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const token = extractBearerToken(c.req.header("Authorization"));

    if (!token) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabase = createSupabaseClient(env);
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    c.set("user", data.user);
    await next();
  });
}

export function getSupabaseForRequest(c: Context<{ Variables: AuthVariables }>, env: Env) {
  const token = extractBearerToken(c.req.header("Authorization"));
  if (token) {
    return createSupabaseClientWithToken(env, token);
  }
  return createSupabaseClient(env);
}
