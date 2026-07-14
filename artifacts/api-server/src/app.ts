import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const AUTH_MODE = process.env.AUTH_MODE ?? "clerk";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ---------------------------------------------------------------------------
// Auth-mode-specific middleware
// ---------------------------------------------------------------------------

if (AUTH_MODE === "local") {
  // Session-based auth: express-session backed by PostgreSQL.
  // Must come before routes so req.session is available everywhere.
  // The session table is created automatically on first startup.
  const { createSessionMiddleware } = await import("./middlewares/localAuth.js");
  app.use(createSessionMiddleware());

  // When running behind a reverse proxy (nginx / Caddy) in production, tell
  // Express to trust the X-Forwarded-* headers so secure cookies work.
  if (process.env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }
} else {
  // Clerk auth: proxy the Clerk Frontend API so the portal works without a
  // custom CNAME. Also resolves the publishable key per-request so the same
  // server can serve multiple Clerk custom domains.
  const { clerkMiddleware } = await import("@clerk/express");
  const { publishableKeyFromHost } = await import("@clerk/shared/keys");
  const {
    CLERK_PROXY_PATH,
    clerkProxyMiddleware,
    getClerkProxyHost,
  } = await import("./middlewares/clerkProxyMiddleware.js");

  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  app.use(
    clerkMiddleware((req) => ({
      publishableKey: publishableKeyFromHost(
        getClerkProxyHost(req) ?? "",
        process.env.CLERK_PUBLISHABLE_KEY,
      ),
    })),
  );
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

// Build the set of trusted origins once at startup so we don't re-parse on
// every request.
const trustedHosts = new Set(["localhost", "127.0.0.1"]);
const portalUrl = process.env.PORTAL_URL;
if (portalUrl) {
  try {
    trustedHosts.add(new URL(portalUrl).hostname);
  } catch {
    // ignore malformed PORTAL_URL — CORS will fall back to same-origin only
  }
}

function isTrustedOrigin(origin: string | undefined): boolean {
  if (!origin) return true; // same-origin / non-browser requests
  try {
    const host = new URL(origin).hostname;
    return (
      trustedHosts.has(host) ||
      host.endsWith(".replit.dev") ||
      host.endsWith(".replit.app") ||
      host.endsWith(".repl.co")
    );
  } catch {
    return false;
  }
}

app.use(
  cors({
    credentials: true,
    origin: (origin, callback) => callback(null, isTrustedOrigin(origin)),
  }),
);
app.use(express.json({ limit: "8mb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
