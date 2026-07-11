import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Expo push tickets awaiting a delivery-receipt check. Rows are inserted
 * after a successful send (due ~15 minutes later) and removed once the
 * receipt has been fetched and acted on. Persisting them means receipt
 * checks survive server restarts; Expo keeps receipts for ~24h, so rows
 * older than that are dropped unprocessed.
 */
export const pushReceiptQueueTable = pgTable("push_receipt_queue", {
  id: serial("id").primaryKey(),
  /** Expo push ticket ID returned by the send endpoint. */
  ticketId: text("ticket_id").notNull().unique(),
  /** Device push token the ticket was sent to, so errors can prune it. */
  token: text("token").notNull(),
  /** When the receipt becomes worth fetching (~15 min after the send). */
  dueAt: timestamp("due_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type PushReceiptQueueRow = typeof pushReceiptQueueTable.$inferSelect;
