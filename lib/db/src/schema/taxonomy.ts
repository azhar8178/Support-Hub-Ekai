import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Admin-managed ticket taxonomy. Categories and environments are pure
// reference data: a stable `key` (stored on the ticket text column), a display
// `label`, ordering, and an `active` flag. Retiring an option sets active=false
// so existing tickets that reference it still resolve their label.

export const ticketCategoriesTable = pgTable("ticket_categories", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const insertTicketCategorySchema = createInsertSchema(ticketCategoriesTable).omit({
  id: true,
});
export type InsertTicketCategory = z.infer<typeof insertTicketCategorySchema>;
export type TicketCategoryRow = typeof ticketCategoriesTable.$inferSelect;

export const ticketEnvironmentsTable = pgTable("ticket_environments", {
  id: serial("id").primaryKey(),
  key: text("key").notNull().unique(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  active: boolean("active").notNull().default(true),
});

export const insertTicketEnvironmentSchema = createInsertSchema(ticketEnvironmentsTable).omit({
  id: true,
});
export type InsertTicketEnvironment = z.infer<typeof insertTicketEnvironmentSchema>;
export type TicketEnvironmentRow = typeof ticketEnvironmentsTable.$inferSelect;
