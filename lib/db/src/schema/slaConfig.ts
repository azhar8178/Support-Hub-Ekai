import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import type { TicketSeverity } from "./tickets";

export const slaConfigTable = pgTable("sla_config", {
  id: serial("id").primaryKey(),
  severity: text("severity").$type<TicketSeverity>().notNull().unique(),
  firstResponseMinutes: integer("first_response_minutes").notNull(),
  resolutionMinutes: integer("resolution_minutes"), // null = Planned (P4)
  use24x7: boolean("use_24x7").notNull().default(false),
});

export const insertSlaConfigSchema = createInsertSchema(slaConfigTable).omit({ id: true });
export type InsertSlaConfig = z.infer<typeof insertSlaConfigSchema>;
export type SlaConfig = typeof slaConfigTable.$inferSelect;
