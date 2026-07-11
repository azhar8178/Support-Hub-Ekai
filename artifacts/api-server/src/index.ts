import app from "./app";
import { logger } from "./lib/logger";
import { seedIfEmpty } from "./lib/seed";
import { refreshSlaClockCache } from "./lib/sla";
import { startSweeps } from "./lib/sweeps";

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

  seedIfEmpty()
    .then(() => refreshSlaClockCache())
    .then(() => startSweeps())
    .catch((err2) => logger.error({ err: err2 }, "seed failed"));
});
