import { boolean, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

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
  // Runtime-configurable system settings (non-sensitive; secrets stay in env vars)
  emailFrom: text("email_from"),
  awsRegion: text("aws_region"),
  // SMTP credentials — stored in DB so admins can configure email from the portal.
  // smtpPass is treated as sensitive: the GET response returns smtpPassSet (boolean) only.
  smtpHost: text("smtp_host"),
  smtpPort: text("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPass: text("smtp_pass"),
  privateObjectDir: text("private_object_dir"),
  portalUrl: text("portal_url"),
  logLevel: text("log_level"),
  // Set to true by POST /admin/bootstrap-rotate — persists across restarts.
  bootstrapDisabled: boolean("bootstrap_disabled").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SiteSettings = typeof siteSettingsTable.$inferSelect;
