import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { organisationsTable } from "./orgs";

/**
 * Each registered customer environment that sends telemetry to the portal.
 * API keys are stored bcrypt-hashed; the plaintext key is shown once on creation.
 */
export const customerEnvironmentsTable = pgTable("customer_environments", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id")
    .notNull()
    .references(() => organisationsTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  cloud: text("cloud").notNull(), // aws | azure | gcp | other
  region: text("region").notNull(),
  runtime: text("runtime").notNull(), // ecs | eks | aks | gke | docker | k8s | vm | other
  /** bcrypt hash of the plaintext API key */
  apiKeyHash: text("api_key_hash").notNull().unique(),
  /** First 16 chars of the plaintext key (prefix for display, e.g. "ek_live_abcd1234") */
  apiKeyPrefix: text("api_key_prefix").notNull(),
  environment: text("environment").notNull(), // production | staging | dev
  status: text("status").notNull().default("UNKNOWN"), // HEALTHY | DEGRADED | DOWN | UNKNOWN
  lastSeen: timestamp("last_seen", { withTimezone: true }),
  agentVersion: text("agent_version"),
  /** push = client sends heartbeats; poll = portal fetches from deployment URL */
  heartbeatMode: text("heartbeat_mode").notNull().default("push"),
  /** Soft-delete: false means decommissioned, historical snapshots are kept */
  active: boolean("active").notNull().default(true),
  /** When false, no health alerts or auto-tickets are created for this environment */
  alertsEnabled: boolean("alerts_enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type CustomerEnvironmentRow = typeof customerEnvironmentsTable.$inferSelect;
