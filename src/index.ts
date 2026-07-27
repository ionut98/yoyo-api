import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadEnv } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { createPartyRoutes } from "./routes/parties.js";
import { createProviderRoutes } from "./routes/providers.js";

const env = loadEnv();

const app = new Hono();

app.use(
  "*",
  cors({
    origin: env.CORS_ORIGIN,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

app.route("/", healthRoutes);
app.route("/api/providers", createProviderRoutes(env));
app.route("/api/parties", createPartyRoutes(env));

serve(
  {
    fetch: app.fetch,
    port: env.PORT,
  },
  (info) => {
    console.log(`yoyo-api listening on http://localhost:${info.port}`);
  },
);

export default app;
