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
    PORT: z.coerce.number().int().positive().default(3001),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
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
      PORT: env.PORT,
      CORS_ORIGIN: env.CORS_ORIGIN,
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
