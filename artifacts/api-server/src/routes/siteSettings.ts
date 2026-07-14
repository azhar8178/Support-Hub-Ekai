import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  GetSiteSettingsResponse,
  UpdateSiteSettingsBody,
  UploadSiteLogoBody,
  UploadSiteLogoResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  saveAttachmentObject,
  deleteAttachmentObject,
} from "../lib/objectStorage";
import { invalidateSystemConfigCache } from "../lib/systemConfig";

const router: IRouter = Router();

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const LOGO_STORAGE_KEY = "branding/logo";

function serializeSettings(row: typeof siteSettingsTable.$inferSelect | null) {
  const emailConfigured = !!(
    process.env["AWS_ACCESS_KEY_ID"] &&
    process.env["AWS_SECRET_ACCESS_KEY"]
  );
  const storageConfigured = !!(
    (row?.privateObjectDir ?? process.env["PRIVATE_OBJECT_DIR"])
  );

  if (!row) {
    return {
      id: 0,
      companyName: null,
      tagline: null,
      logoUrl: null,
      whatsappNumber: null,
      slackWebhookUrl: null,
      emailFrom: null,
      awsRegion: null,
      emailConfigured,
      privateObjectDir: null,
      storageConfigured,
      portalUrl: null,
      logLevel: null,
      updatedAt: new Date().toISOString(),
    };
  }
  return {
    id: row.id,
    companyName: row.companyName ?? null,
    tagline: row.tagline ?? null,
    logoUrl: row.logoStorageKey ? "/api/branding/logo" : null,
    whatsappNumber: row.whatsappNumber ?? null,
    slackWebhookUrl: row.slackWebhookUrl ?? null,
    emailFrom: row.emailFrom ?? null,
    awsRegion: row.awsRegion ?? null,
    emailConfigured,
    privateObjectDir: row.privateObjectDir ?? null,
    storageConfigured,
    portalUrl: row.portalUrl ?? null,
    logLevel: row.logLevel ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Get current site settings (staff only). */
router.get(
  "/admin/settings",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const [row] = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1));
    res.json(GetSiteSettingsResponse.parse(serializeSettings(row ?? null)));
  },
);

/** Update site settings (admin only). */
router.patch(
  "/admin/settings",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UpdateSiteSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const fields: Record<string, unknown> = {};
    if (parsed.data.companyName !== undefined) fields.companyName = parsed.data.companyName ?? null;
    if (parsed.data.tagline !== undefined) fields.tagline = parsed.data.tagline ?? null;
    if (parsed.data.whatsappNumber !== undefined) fields.whatsappNumber = parsed.data.whatsappNumber ?? null;
    if (parsed.data.slackWebhookUrl !== undefined) fields.slackWebhookUrl = parsed.data.slackWebhookUrl ?? null;
    if (parsed.data.emailFrom !== undefined) fields.emailFrom = parsed.data.emailFrom ?? null;
    if (parsed.data.awsRegion !== undefined) fields.awsRegion = parsed.data.awsRegion ?? null;
    if (parsed.data.privateObjectDir !== undefined) fields.privateObjectDir = parsed.data.privateObjectDir ?? null;
    if (parsed.data.portalUrl !== undefined) fields.portalUrl = parsed.data.portalUrl ?? null;
    if (parsed.data.logLevel !== undefined) fields.logLevel = parsed.data.logLevel ?? null;
    invalidateSystemConfigCache();

    await db
      .insert(siteSettingsTable)
      .values({ id: 1, ...fields, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: siteSettingsTable.id,
        set: { ...fields, updatedAt: new Date() },
      });
    const [row] = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1));
    res.json(GetSiteSettingsResponse.parse(serializeSettings(row ?? null)));
  },
);

/** Upload or replace the portal logo (admin only). */
router.post(
  "/admin/settings/logo",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = UploadSiteLogoBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const fileBytes = Buffer.from(parsed.data.data, "base64");
    if (fileBytes.length > MAX_LOGO_BYTES) {
      res.status(400).json({ message: "Logo must be 2 MB or smaller." });
      return;
    }
    await saveAttachmentObject(LOGO_STORAGE_KEY, fileBytes, parsed.data.contentType);
    await db
      .insert(siteSettingsTable)
      .values({ id: 1, logoStorageKey: LOGO_STORAGE_KEY, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: siteSettingsTable.id,
        set: { logoStorageKey: LOGO_STORAGE_KEY, updatedAt: new Date() },
      });
    res.status(201).json(UploadSiteLogoResponse.parse({ logoUrl: "/api/branding/logo" }));
  },
);

/** Remove the portal logo (admin only). */
router.delete(
  "/admin/settings/logo",
  requireAuth,
  requireRole("admin"),
  async (_req, res): Promise<void> => {
    const [row] = await db
      .select()
      .from(siteSettingsTable)
      .where(eq(siteSettingsTable.id, 1));
    if (row?.logoStorageKey) {
      await deleteAttachmentObject(row.logoStorageKey);
      await db
        .update(siteSettingsTable)
        .set({ logoStorageKey: null, updatedAt: new Date() })
        .where(eq(siteSettingsTable.id, 1));
    }
    res.status(204).send();
  },
);

export default router;
