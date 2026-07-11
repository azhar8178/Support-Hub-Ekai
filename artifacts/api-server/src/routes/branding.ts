import { Router, type IRouter } from "express";
import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { GetPublicBrandingResponse } from "@workspace/api-zod";
import { readAttachmentObject, ObjectNotFoundError } from "../lib/objectStorage";

const router: IRouter = Router();

/** Public branding info (no auth). */
router.get("/branding", async (_req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  res.json(
    GetPublicBrandingResponse.parse({
      companyName: row?.companyName ?? null,
      tagline: row?.tagline ?? null,
      logoUrl: row?.logoStorageKey ? "/api/branding/logo" : null,
      whatsappNumber: row?.whatsappNumber ?? null,
    }),
  );
});

/** Stream the configured logo image (no auth). */
router.get("/branding/logo", async (_req, res): Promise<void> => {
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  if (!row?.logoStorageKey) {
    res.status(404).json({ message: "No logo configured" });
    return;
  }
  let fileBytes: Buffer;
  try {
    fileBytes = await readAttachmentObject(row.logoStorageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ message: "Logo not found in storage" });
      return;
    }
    throw err;
  }
  const key = row.logoStorageKey.toLowerCase();
  let contentType = "image/jpeg";
  if (key.endsWith(".png")) contentType = "image/png";
  else if (key.endsWith(".svg")) contentType = "image/svg+xml";
  else if (key.endsWith(".webp")) contentType = "image/webp";

  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(fileBytes);
});

export default router;
