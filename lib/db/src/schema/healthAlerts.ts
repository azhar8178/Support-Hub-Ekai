import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { customerEnvironmentsTable } from "./customerEnvironments";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

/**
 * Health alert created on status transitions or missed heartbeats.
 * When a DOWN/DEGRADED alert triggers auto-ticket creation, linkedTicketId
 * points back to that ticket.
 */
export const healthAlertsTable = pgTable("health_alerts", {
  id: serial("id").primaryKey(),
  environmentId: integer("environment_id")
    .notNull()
    .references(() => customerEnvironmentsTable.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(), // STATUS_CHANGE | MISSED_HEARTBEAT
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  triggeredAt: timestamp("triggered_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  /** Auto-created ticket (for DOWN/DEGRADED transitions) */
  linkedTicketId: integer("linked_ticket_id").references(() => ticketsTable.id, {
    onDelete: "set null",
  }),
  acknowledged: boolean("acknowledged").notNull().default(false),
  acknowledgedByUserId: integer("acknowledged_by_user_id").references(
    () => usersTable.id,
    { onDelete: "set null" },
  ),
});

export type HealthAlertRow = typeof healthAlertsTable.$inferSelect;
