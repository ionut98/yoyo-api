import "dotenv/config";
import { z } from "zod";

function firstDefined(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value !== undefined && value.length > 0);
}

const envSchema = z
  .object({
    SUPABASE_URL: z.string().url(),
    SUPABASE_PUBLISHABLE_KEY: z.string().min(1).optional(),
    SUPABASE_ANON_KEY: z.string().min(1).optional(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGIN: z
      .string()
      .default(
        "http://localhost:8080,https://yoyoparty.lovable.app,https://yoyoparty.ro,https://www.yoyoparty.ro",
      )
      .transform((value) =>
        value
          .split(",")
          .map((origin) => origin.trim())
          .filter((origin) => origin.length > 0),
      ),
    GOOGLE_CALENDAR_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CALENDAR_CLIENT_SECRET: z.string().min(1).optional(),
    GOOGLE_CALENDAR_REDIRECT_URI: z.string().url().optional(),
    TOKEN_ENCRYPTION_KEY: z.string().min(16).optional(),
  })
  .transform((env) => {
    const supabaseKey = firstDefined(env.SUPABASE_PUBLISHABLE_KEY, env.SUPABASE_ANON_KEY);
    if (!supabaseKey) {
      throw new Error(
        "Missing Supabase key. Set SUPABASE_PUBLISHABLE_KEY (recommended) or SUPABASE_ANON_KEY.",
      );
    }

    return {
      SUPABASE_URL: env.SUPABASE_URL,
      SUPABASE_ANON_KEY: supabaseKey,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY,
      PORT: env.PORT,
      CORS_ORIGIN: env.CORS_ORIGIN,
      GOOGLE_CALENDAR_CLIENT_ID: env.GOOGLE_CALENDAR_CLIENT_ID,
      GOOGLE_CALENDAR_CLIENT_SECRET: env.GOOGLE_CALENDAR_CLIENT_SECRET,
      GOOGLE_CALENDAR_REDIRECT_URI: env.GOOGLE_CALENDAR_REDIRECT_URI,
      TOKEN_ENCRYPTION_KEY: env.TOKEN_ENCRYPTION_KEY,
    };
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(
      `Missing or invalid env vars: ${missing}. Copy .env.example to .env and fill in values.`,
    );
  }
  return result.data;
}

export function requireServiceRoleKey(env: Env): string {
  if (!env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY is required for this admin action");
  }
  return env.SUPABASE_SERVICE_ROLE_KEY;
}

export function requireGoogleCalendarConfig(env: Env): {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokenEncryptionKey: string;
} {
  if (
    !env.GOOGLE_CALENDAR_CLIENT_ID ||
    !env.GOOGLE_CALENDAR_CLIENT_SECRET ||
    !env.GOOGLE_CALENDAR_REDIRECT_URI ||
    !env.TOKEN_ENCRYPTION_KEY
  ) {
    throw new Error(
      "Google Calendar is not configured. Set GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, GOOGLE_CALENDAR_REDIRECT_URI, and TOKEN_ENCRYPTION_KEY.",
    );
  }
  return {
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    redirectUri: env.GOOGLE_CALENDAR_REDIRECT_URI,
    tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY,
  };
}
