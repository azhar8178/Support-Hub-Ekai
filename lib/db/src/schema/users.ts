import { boolean, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { organisationsTable } from "./orgs";

export type UserRole = "customer" | "ekai_agent" | "admin";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").unique(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").$type<UserRole>().notNull(),
  orgId: integer("org_id").references(() => organisationsTable.id),
  active: boolean("active").notNull().default(true),
  // Staff-only free-text notes about a customer contact (not visible to the customer).
  internalNotes: text("internal_notes"),
  // Local auth mode only — bcrypt hash of the user's password. Null when using Clerk.
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLogin: timestamp("last_login", { withTimezone: true }),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({
  id: true,
  createdAt: true,
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
