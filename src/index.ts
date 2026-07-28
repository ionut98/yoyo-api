import "dotenv/config";

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { loadEnv } from "./config/env.js";
import { healthRoutes } from "./routes/health.js";
import { createPackageRequestRoutes } from "./routes/package-requests.js";
import { createPartyRoutes } from "./routes/parties.js";
import { createProviderConsoleRoutes } from "./routes/provider-console.js";
import { createProviderRoutes } from "./routes/providers.js";
import { createRecommendationRoutes } from "./routes/recommendations.js";

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
app.route("/api/parties", createRecommendationRoutes(env));
app.route("/api/packages", createPackageRequestRoutes(env));
app.route("/api/provider", createProviderConsoleRoutes(env));

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
