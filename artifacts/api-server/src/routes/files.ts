import { Router, type IRouter } from "express";
import {
  db,
  ticketAttachmentsTable,
  ticketMessagesTable,
  ticketsTable,
  usersTable,
} from "@workspace/db";
import { and, desc, ilike, or, sql } from "drizzle-orm";
import { ListFilesResponse } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";

const router: IRouter = Router();

/** List all uploaded attachments across all tickets (staff only). */
router.get(
  "/admin/files",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : undefined;
    const contentTypeFilter =
      typeof req.query.contentType === "string" ? req.query.contentType : undefined;

    // Aliases for the two user joins
    const msgAuthor = usersTable;
    const ticketRaiser = usersTable;

    // Build using aliased tables via drizzle alias
    const { alias } = await import("drizzle-orm/pg-core");
    const msgAuthorTable = alias(usersTable, "msg_author");
    const ticketRaiserTable = alias(usersTable, "ticket_raiser");

    const conditions = [];

    if (search) {
      const pattern = `%${search}%`;
      conditions.push(
        or(
          ilike(ticketAttachmentsTable.filename, pattern),
          ilike(msgAuthorTable.name, pattern),
          ilike(ticketRaiserTable.name, pattern),
        )!,
      );
    }

    if (contentTypeFilter) {
      conditions.push(
        sql`${ticketAttachmentsTable.contentType} ilike ${contentTypeFilter + "%"}`,
      );
    }

    const rows = await db
      .select({
        id: ticketAttachmentsTable.id,
        filename: ticketAttachmentsTable.filename,
        contentType: ticketAttachmentsTable.contentType,
        sizeBytes: ticketAttachmentsTable.sizeBytes,
        createdAt: ticketAttachmentsTable.createdAt,
        ticketId: ticketAttachmentsTable.ticketId,
        ticketTitle: ticketsTable.title,
        msgAuthorName: msgAuthorTable.name,
        ticketRaiserName: ticketRaiserTable.name,
      })
      .from(ticketAttachmentsTable)
      .innerJoin(ticketsTable, sql`${ticketsTable.id} = ${ticketAttachmentsTable.ticketId}`)
      .leftJoin(
        ticketMessagesTable,
        sql`${ticketMessagesTable.id} = ${ticketAttachmentsTable.messageId}`,
      )
      .leftJoin(
        msgAuthorTable,
        sql`${msgAuthorTable.id} = ${ticketMessagesTable.authorId}`,
      )
      .leftJoin(
        ticketRaiserTable,
        sql`${ticketRaiserTable.id} = ${ticketsTable.raisedById}`,
      )
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(ticketAttachmentsTable.createdAt));

    const items = rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt.toISOString(),
      ticketId: r.ticketId,
      ticketTitle: r.ticketTitle,
      uploaderName: r.msgAuthorName ?? r.ticketRaiserName ?? null,
      downloadPath: `/attachments/${r.id}/content`,
    }));

    res.json(ListFilesResponse.parse(items));
  },
);

export default router;
