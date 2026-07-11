import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Severity definitions. This table is the source of truth for the ticket
// severity taxonomy AND its SLA targets. `severity` is the stable key stored on
// the ticket text column; the remaining columns carry admin-editable metadata:
//   label              display name (e.g. "P1")
//   rank               ordering / urgency; lower rank = more severe (1 = top)
//   isUrgent           fires the "critical ticket" alert to staff on creation
//   resolutionOptional resolution SLA may be null ("Planned"), e.g. P4
//   active             false = retired (hidden from new-ticket forms, labels kept)
export const slaConfigTable = pgTable("sla_config", {
  id: serial("id").primaryKey(),
  severity: text("severity").notNull().unique(),
  label: text("label").notNull().default(""),
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes"), // null = Planned (e.g. P4)
  use24x7: boolean("use_24x7").notNull().default(false),
  rank: integer("rank").notNull().default(0),
  isUrgent: boolean("is_urgent").notNull().default(false),
  resolutionOptional: boolean("resolution_optional").notNull().default(false),
  active: boolean("active").notNull().default(true),
});

export const insertSlaConfigSchema = createInsertSchema(slaConfigTable).omit({ id: true });
export type InsertSlaConfig = z.infer<typeof insertSlaConfigSchema>;
export type SlaConfig = typeof slaConfigTable.$inferSelect;
