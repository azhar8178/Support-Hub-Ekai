import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./orgs";
import { usersTable } from "./users";

export type TicketSeverity = "P1" | "P2" | "P3" | "P4";
export type TicketStatus =
  | "new"
  | "triaged"
  | "in_progress"
  | "awaiting_customer"
  | "resolved"
  | "closed";
export type TicketCategory = "infrastructure" | "platform" | "configuration" | "billing" | "other";
export type TicketEnvironment = "aws" | "azure" | "gcp" | "snowflake" | "multiple";

export const ticketsTable = pgTable("tickets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  // severity/category/environment are admin-managed taxonomy keys (see
  // sla_config, ticket_categories, ticket_environments) — plain strings, not a
  // fixed enum. status stays a fixed union because it carries workflow logic.
  severity: text("severity").notNull(),
  status: text("status").$type<TicketStatus>().notNull().default("new"),
  category: text("category").notNull(),
  environment: text("environment").notNull(),
  orgId: integer("org_id")
    .notNull()
    .references(() => organisationsTable.id),
  raisedById: integer("raised_by_id")
    .notNull()
    .references(() => usersTable.id),
  assignedToId: integer("assigned_to_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  firstResponseAt: timestamp("first_response_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  // SLA tracking
  responseDeadline: timestamp("response_deadline", { withTimezone: true }),
  resolutionDeadline: timestamp("resolution_deadline", { withTimezone: true }),
  slaPausedAt: timestamp("sla_paused_at", { withTimezone: true }),
  slaWarningNotified: boolean("sla_warning_notified").notNull().default(false),
});

export const insertTicketSchema = createInsertSchema(ticketsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertTicket = z.infer<typeof insertTicketSchema>;
export type Ticket = typeof ticketsTable.$inferSelect;

export const ticketMessagesTable = pgTable("ticket_messages", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => ticketsTable.id),
  authorId: integer("author_id")
    .notNull()
    .references(() => usersTable.id),
  content: text("content").notNull(),
  isInternal: boolean("is_internal").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketMessageSchema = createInsertSchema(ticketMessagesTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicketMessage = z.infer<typeof insertTicketMessageSchema>;
export type TicketMessage = typeof ticketMessagesTable.$inferSelect;

export const ticketAttachmentsTable = pgTable("ticket_attachments", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => ticketsTable.id),
  messageId: integer("message_id").references(() => ticketMessagesTable.id),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  // Object storage key under PRIVATE_OBJECT_DIR; file bytes live in App Storage, not the DB.
  storageKey: text("storage_key").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketAttachmentSchema = createInsertSchema(ticketAttachmentsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicketAttachment = z.infer<typeof insertTicketAttachmentSchema>;
export type TicketAttachment = typeof ticketAttachmentsTable.$inferSelect;

export const ticketStatusHistoryTable = pgTable("ticket_status_history", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => ticketsTable.id),
  fromStatus: text("from_status").$type<TicketStatus>(),
  toStatus: text("to_status").$type<TicketStatus>().notNull(),
  changedById: integer("changed_by_id").references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTicketStatusHistorySchema = createInsertSchema(ticketStatusHistoryTable).omit({
  id: true,
  createdAt: true,
});
export type InsertTicketStatusHistory = z.infer<typeof insertTicketStatusHistorySchema>;
export type TicketStatusHistory = typeof ticketStatusHistoryTable.$inferSelect;
