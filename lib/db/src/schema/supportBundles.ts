import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { ticketsTable } from "./tickets";
import { usersTable } from "./users";

export const supportBundlesTable = pgTable("support_bundles", {
  id: serial("id").primaryKey(),
  ticketId: integer("ticket_id")
    .notNull()
    .references(() => ticketsTable.id),
  uploadedById: integer("uploaded_by_id")
    .notNull()
    .references(() => usersTable.id),
  filename: text("filename").notNull(),
  fileSizeBytes: integer("file_size_bytes").notNull(),
  // NOTE: production should use S3 / Azure Blob / GCP Storage.
  // For now, this is a local filesystem path: /uploads/bundles/{ticketId}/{bundleId}-{filename}
  storageKey: text("storage_key").notNull(),
  parsedSummary: text("parsed_summary"), // JSON string of parsed bundle contents
  overallStatus: text("overall_status"), // extracted overall_status from health-snapshot.json
  issueCount: integer("issue_count").notNull().default(0), // preflight [FAIL] count
  uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
  parsedAt: timestamp("parsed_at"),
  parseError: text("parse_error"),
});

export type SupportBundle = typeof supportBundlesTable.$inferSelect;
export type NewSupportBundle = typeof supportBundlesTable.$inferInsert;
