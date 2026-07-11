import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";
import { ticketsTable } from "./tickets";

export type NotificationType =
  | "ticket_created"
  | "agent_reply"
  | "status_changed"
  | "new_critical_ticket"
  | "sla_warning"
  | "invite";

export const notificationsTable = pgTable("notifications", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id),
  type: text("type").$type<NotificationType>().notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  ticketId: integer("ticket_id").references(() => ticketsTable.id),
  emailTo: text("email_to"),
  read: boolean("read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertNotificationSchema = createInsertSchema(notificationsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertNotification = z.infer<typeof insertNotificationSchema>;
export type Notification = typeof notificationsTable.$inferSelect;
