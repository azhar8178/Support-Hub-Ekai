import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { refreshSlaClockCache } from "./lib/sla";
import { startSweeps } from "./lib/sweeps";
import { getBootstrapToken, initBootstrap } from "./routes/bootstrap";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Check DB for persisted bootstrap-disabled flag before logging the token.
  // If a previous admin already rotated it, we suppress the token and stay silent.
  initBootstrap()
    .then(() => {
      const token = getBootstrapToken();
      if (token !== null) {
        logger.warn(
          { bootstrapToken: token },
          "BOOTSTRAP: use this token (valid until the first admin signs in) with " +
            "POST /api/bootstrap-admin to create the first admin invite. " +
            "Or run: pnpm --filter @workspace/api-server run bootstrap-admin -- --email <email>",
        );
      }
    })
    .then(() => seedIfEmpty())
    .then(() => refreshSlaClockCache())
    .then(() => startSweeps())
    .catch((err2) => logger.error({ err: err2 }, "startup failed"));
});
