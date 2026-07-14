import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { refreshSlaClockCache } from "./lib/sla";
import { startSweeps } from "./lib/sweeps";
import { getBootstrapToken } from "./routes/bootstrap";

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

  // Log the bootstrap token so the operator can use it before the first admin
  // signs in.  It lives only in memory — never committed to disk or source.
  logger.warn(
    { bootstrapToken: getBootstrapToken() },
    "BOOTSTRAP: use this token (valid until the first admin signs in) with " +
      "POST /api/bootstrap-admin to create the first admin invite. " +
      "Or run: pnpm --filter @workspace/api-server run bootstrap-admin -- --email <email>",
  );

  seedIfEmpty()
    .then(() => refreshSlaClockCache())
    .then(() => startSweeps())
    .catch((err2) => logger.error({ err: err2 }, "seed failed"));
});
