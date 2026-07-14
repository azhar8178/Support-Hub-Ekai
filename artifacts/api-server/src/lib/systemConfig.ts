/**
 * Runtime system configuration.
 *
 * Non-sensitive values (URLs, addresses, region names) can be stored in the
 * database and edited from the admin Settings page.  Sensitive credentials
 * (AWS keys) always come from environment variables only.
 *
 * The cached getter refreshes every 60 seconds so the server picks up changes
 * made through the UI without a restart.
 */

import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger";

type DbRow = typeof siteSettingsTable.$inferSelect;

let _cache: DbRow | null = null;
let _lastFetch = 0;
const TTL_MS = 60_000;

async function loadConfig(): Promise<DbRow | null> {
  try {
    const [row] = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1));
    return row ?? null;
  } catch (err) {
    logger.warn({ err }, "systemConfig: failed to load config from DB");
    return null;
  }
}

async function getCachedConfig(): Promise<DbRow | null> {
  const now = Date.now();
  if (_cache === null || now - _lastFetch > TTL_MS) {
    _cache = await loadConfig();
    _lastFetch = now;
  }
  return _cache;
}

/** Invalidate the in-memory cache (call after a settings update). */
export function invalidateSystemConfigCache(): void {
  _cache = null;
  _lastFetch = 0;
}

/**
 * Return the effective value for a non-sensitive config key.
 * DB value takes precedence; falls back to the provided env var value.
 */
async function getConfigValue(
  dbValue: string | null | undefined,
  envValue: string | undefined,
): Promise<string | null> {
  if (dbValue != null && dbValue.trim() !== "") return dbValue.trim();
  return envValue?.trim() || null;
}

// ---------------------------------------------------------------------------
// Public accessors — each returns the runtime-effective value
// ---------------------------------------------------------------------------

export async function getEmailFrom(): Promise<string | null> {
  const cfg = await getCachedConfig();
  return getConfigValue(cfg?.emailFrom, process.env.EMAIL_FROM);
}

export async function getAwsRegion(): Promise<string | null> {
  const cfg = await getCachedConfig();
  return getConfigValue(cfg?.awsRegion, process.env.AWS_REGION);
}

export async function getPrivateObjectDir(): Promise<string | null> {
  const cfg = await getCachedConfig();
  return getConfigValue(cfg?.privateObjectDir, process.env.PRIVATE_OBJECT_DIR);
}

export async function getPortalUrl(): Promise<string | null> {
  const cfg = await getCachedConfig();
  return getConfigValue(cfg?.portalUrl, process.env.PORTAL_URL);
}

export async function getLogLevel(): Promise<string | null> {
  const cfg = await getCachedConfig();
  return getConfigValue(cfg?.logLevel, process.env.LOG_LEVEL);
}
