import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { customerEnvironmentsTable } from "./customerEnvironments";

/**
 * One row per telemetry push from a customer health agent.
 * servicesJson and platformJson are stored as raw JSON strings to avoid
 * a separate normalised services table (per spec).
 */
export const healthSnapshotsTable = pgTable("health_snapshots", {
  id: serial("id").primaryKey(),
  environmentId: integer("environment_id")
    .notNull()
    .references(() => customerEnvironmentsTable.id, { onDelete: "cascade" }),
  /** Agent-reported timestamp (may differ slightly from server createdAt) */
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull(),
  overallStatus: text("overall_status").notNull(), // HEALTHY | DEGRADED | DOWN
  /** Full services array serialised as JSON string */
  servicesJson: text("services_json").notNull(),
  /** Platform metadata serialised as JSON string */
  platformJson: text("platform_json").notNull(),
  agentVersion: text("agent_version").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type HealthSnapshotRow = typeof healthSnapshotsTable.$inferSelect;
