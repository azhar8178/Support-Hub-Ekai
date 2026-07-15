/**
 * Support bundle upload/list/download routes.
 *
 * POST   /tickets/:id/bundles                     — upload a bundle ZIP (multipart/form-data)
 * GET    /tickets/:id/bundles                     — list bundles for a ticket
 * GET    /tickets/:id/bundles/:bundleId/download  — download a bundle ZIP (agents/admins only)
 *
 * File storage: /uploads/bundles/{ticketId}/{bundleId}-{filename}
 * NOTE: production deployments should replace local disk with S3 / Azure Blob / GCP Storage.
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import {
  db,
  supportBundlesTable,
  ticketsTable,
  ticketMessagesTable,
  type User,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { isStaff, requireAuth, requireRole } from "../middlewares/requireAuth";
import { parseSupportBundle } from "../lib/bundleParser";

const router: IRouter = Router();

const MAX_BUNDLE_BYTES = 50 * 1024 * 1024; // 50 MB

// Multer: write to a temp dir first (we don't know the bundleId yet)
const tmpUploadDir = path.join(process.cwd(), "uploads", "bundles", "_tmp");
fs.mkdirSync(tmpUploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, tmpUploadDir),
  filename: (_req, _file, cb) => cb(null, `bundle-${Date.now()}-${Math.random().toString(36).slice(2)}`),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_BUNDLE_BYTES },
  fileFilter: (_req, file, cb) => {
    const ok =
      file.mimetype === "application/zip" ||
      file.mimetype === "application/x-zip-compressed" ||
      file.originalname.toLowerCase().endsWith(".zip");
    if (!ok) {
      return cb(new Error("Only ZIP files are accepted"));
    }
    cb(null, true);
  },
});

function parseTicketId(raw: string | string[] | undefined): number {
  const s = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(s ?? "", 10);
}

async function loadTicketForBundle(
  ticketId: number,
  user: User,
): Promise<
  | { ticket: typeof ticketsTable.$inferSelect }
  | { error: number; message: string }
> {
  if (Number.isNaN(ticketId)) return { error: 400, message: "Invalid ticket id" };
  const [ticket] = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, ticketId));
  if (!ticket) return { error: 404, message: "Ticket not found" };
  // Customers can only access their own org's tickets
  if (!isStaff(user) && ticket.orgId !== user.orgId) {
    return { error: 404, message: "Ticket not found" };
  }
  return { ticket };
}

// ---------------------------------------------------------------------------
// POST /tickets/:id/bundles — upload a support bundle ZIP
// ---------------------------------------------------------------------------
router.post(
  "/tickets/:id/bundles",
  requireAuth,
  (req, res, next) => {
    upload.single("bundle")(req, res, (err) => {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        res.status(400).json({ message: "Bundle exceeds the 50 MB limit" });
        return;
      }
      if (err) {
        res.status(400).json({ message: err.message ?? "Upload error" });
        return;
      }
      next();
    });
  },
  async (req, res): Promise<void> => {
    const user = req.portalUser!;
    const ticketId = parseTicketId(req.params.id);
    const result = await loadTicketForBundle(ticketId, user);

    if ("error" in result) {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(result.error).json({ message: result.message });
      return;
    }

    const ticket = result.ticket;
    if (ticket.status === "closed") {
      if (req.file) fs.unlink(req.file.path, () => {});
      res.status(400).json({ message: "This ticket is closed." });
      return;
    }

    if (!req.file) {
      res.status(400).json({ message: "No file uploaded. Send the ZIP as the 'bundle' form field." });
      return;
    }

    const { originalname, size: fileSizeBytes, path: tmpPath } = req.file;

    // Create the DB record first to get the bundleId
    const [bundle] = await db
      .insert(supportBundlesTable)
      .values({
        ticketId: ticket.id,
        uploadedById: user.id,
        filename: originalname,
        fileSizeBytes,
        storageKey: "", // will be updated after we move the file
      })
      .returning();

    const bundleId = bundle!.id;

    // Move file from temp to its permanent location
    const bundleDir = path.join(process.cwd(), "uploads", "bundles", String(ticket.id));
    fs.mkdirSync(bundleDir, { recursive: true });
    const finalFilename = `${bundleId}-${originalname}`;
    const finalPath = path.join(bundleDir, finalFilename);
    const storageKey = path.join("uploads", "bundles", String(ticket.id), finalFilename);

    fs.renameSync(tmpPath, finalPath);

    await db
      .update(supportBundlesTable)
      .set({ storageKey })
      .where(eq(supportBundlesTable.id, bundleId));

    // Internal ticket message — placeholder while parsing runs
    const sizeMb = (fileSizeBytes / (1024 * 1024)).toFixed(1);
    const [msg] = await db
      .insert(ticketMessagesTable)
      .values({
        ticketId: ticket.id,
        authorId: null,
        content: `📦 Support bundle uploaded: **${originalname}** (${sizeMb} MB). Parsing in progress...`,
        isInternal: true,
      })
      .returning();

    // Parse asynchronously — never block the response
    setImmediate(() => {
      parseSupportBundle(finalPath, bundleId, ticket.id).catch(() => {});
    });

    res.status(201).json({
      bundleId,
      message: "Bundle uploaded successfully",
    });
  },
);

// ---------------------------------------------------------------------------
// GET /tickets/:id/bundles — list bundles for a ticket
// ---------------------------------------------------------------------------
router.get("/tickets/:id/bundles", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const ticketId = parseTicketId(req.params.id);
  const result = await loadTicketForBundle(ticketId, user);
  if ("error" in result) {
    res.status(result.error).json({ message: result.message });
    return;
  }

  const bundles = await db
    .select()
    .from(supportBundlesTable)
    .where(eq(supportBundlesTable.ticketId, ticketId))
    .orderBy(desc(supportBundlesTable.uploadedAt));

  res.json(
    bundles.map((b) => ({
      id: b.id,
      ticketId: b.ticketId,
      filename: b.filename,
      fileSizeBytes: b.fileSizeBytes,
      overallStatus: b.overallStatus,
      issueCount: b.issueCount,
      uploadedAt: b.uploadedAt.toISOString(),
      parsedAt: b.parsedAt?.toISOString() ?? null,
      parseError: b.parseError,
      // Full parsed summary only for staff — customers get null
      parsedSummary: isStaff(user) ? b.parsedSummary : null,
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /tickets/:id/bundles/:bundleId/download — download a bundle ZIP
// ---------------------------------------------------------------------------
router.get(
  "/tickets/:id/bundles/:bundleId/download",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const user = req.portalUser!;
    const ticketId = parseTicketId(req.params.id);
    const bundleIdRaw = Array.isArray(req.params.bundleId)
      ? req.params.bundleId[0]
      : req.params.bundleId;
    const bundleId = parseInt(bundleIdRaw ?? "", 10);

    const result = await loadTicketForBundle(ticketId, user);
    if ("error" in result) {
      res.status(result.error).json({ message: result.message });
      return;
    }

    if (Number.isNaN(bundleId)) {
      res.status(400).json({ message: "Invalid bundle id" });
      return;
    }

    const [bundle] = await db
      .select()
      .from(supportBundlesTable)
      .where(
        and(
          eq(supportBundlesTable.id, bundleId),
          eq(supportBundlesTable.ticketId, ticketId),
        ),
      );

    if (!bundle) {
      res.status(404).json({ message: "Bundle not found" });
      return;
    }

    const filePath = path.join(process.cwd(), bundle.storageKey);
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ message: "Bundle file is no longer available" });
      return;
    }

    res.setHeader("Content-Disposition", `attachment; filename="${bundle.filename}"`);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Length", String(bundle.fileSizeBytes));
    res.sendFile(filePath, { root: "/" });
  },
);

export default router;
