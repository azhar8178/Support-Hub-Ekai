import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Registry of remote Ekai client deployments. Each row represents one
 * deployed Ekai instance (potentially at a different client site). The
 * apiKeyHash is the SHA-256 hex of the plaintext API key shown once on
 * creation; never store the plaintext key here.
 */
export const deploymentsTable = pgTable("deployments", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  apiKeyHash: text("api_key_hash").notNull(),
  status: text("status").$type<"healthy" | "degraded" | "offline">().notNull().default("offline"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  lastHealthJson: jsonb("last_health_json"),
  lastAlertedAt: timestamp("last_alerted_at", { withTimezone: true }),
  slackWebhookUrl: text("slack_webhook_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeploymentRow = typeof deploymentsTable.$inferSelect;

/**
 * Rolling 24-hour heartbeat history per deployment (max ~288 rows per
 * deployment at a 5-minute cadence). Older rows are pruned by the sweep.
 */
export const deploymentHeartbeatsTable = pgTable("deployment_heartbeats", {
  id: serial("id").primaryKey(),
  deploymentId: integer("deployment_id")
    .notNull()
    .references(() => deploymentsTable.id, { onDelete: "cascade" }),
  status: text("status").$type<"healthy" | "degraded" | "offline">().notNull(),
  healthJson: jsonb("health_json"),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DeploymentHeartbeatRow = typeof deploymentHeartbeatsTable.$inferSelect;
