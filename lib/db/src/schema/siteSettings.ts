import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Single-row table (id = 1) storing portal-wide configuration:
 * branding (company name, tagline, logo), and integration credentials
 * (Slack webhook URL for urgent alerts, WhatsApp click-to-chat number).
 *
 * Use the upsert pattern (`onConflictDoUpdate`) to keep it to one row.
 */
export const siteSettingsTable = pgTable("site_settings", {
  id: serial("id").primaryKey(),
  companyName: text("company_name"),
  tagline: text("tagline"),
  logoStorageKey: text("logo_storage_key"),
  whatsappNumber: text("whatsapp_number"),
  slackWebhookUrl: text("slack_webhook_url"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
