import { Router, type IRouter, type Request } from "express";
import {
  db,
  ticketAttachmentsTable,
  ticketMessagesTable,
  ticketsTable,
  ticketStatusHistoryTable,
  usersTable,
  type TicketStatus,
  type User,
} from "@workspace/db";
import { and, eq, gte, ilike, inArray, isNull, lte, or, type SQL } from "drizzle-orm";
import {
  AddTicketAttachmentBody,
  AddTicketMessageBody,
  AssignTicketBody,
  BulkUpdateTicketsBody,
  ChangeTicketStatusBody,
  CreateTicketBody,
  CreateTicketResponse,
  GetTicketResponse,
  ListTicketsQueryParams,
  ListTicketsResponse,
  BulkUpdateTicketsResponse,
} from "@workspace/api-zod";
import { randomUUID } from "crypto";
import { isStaff, requireAuth, requireRole } from "../middlewares/requireAuth";
import {
  ObjectNotFoundError,
  readAttachmentObject,
  saveAttachmentObject,
} from "../lib/objectStorage";
import { loadTicketDto, loadTicketsWhere } from "../lib/serializers";
import { computeInitialDeadlines } from "../lib/sla";
import { applyStatusChange, notifyTicketCreated } from "../lib/ticketActions";
import { notifyUsers } from "../lib/notify";

const router: IRouter = Router();

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function parseId(req: Request): number {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return parseInt(raw ?? "", 10);
}

async function loadTicketWithAccess(
  id: number,
  user: User,
): Promise<{ ticket: typeof ticketsTable.$inferSelect } | { error: number; message: string }> {
  if (Number.isNaN(id)) return { error: 400, message: "Invalid ticket id" };
  const [ticket] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, id));
  if (!ticket) return { error: 404, message: "Ticket not found" };
  if (!isStaff(user) && ticket.orgId !== user.orgId) {
    return { error: 404, message: "Ticket not found" };
  }
  return { ticket };
}

router.get("/tickets", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const params = ListTicketsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const q = params.data;
  const conditions: SQL[] = [];
  if (!isStaff(user)) {
    if (user.orgId == null) {
      res.json(ListTicketsResponse.parse([]));
      return;
    }
    conditions.push(eq(ticketsTable.orgId, user.orgId));
  } else if (q.orgId != null) {
    conditions.push(eq(ticketsTable.orgId, q.orgId));
  }
  if (q.severity) conditions.push(eq(ticketsTable.severity, q.severity));
  if (q.status) conditions.push(eq(ticketsTable.status, q.status));
  if (q.assignedToId != null) conditions.push(eq(ticketsTable.assignedToId, q.assignedToId));
  if (q.unassigned) conditions.push(isNull(ticketsTable.assignedToId));
  if (q.search) {
    const pattern = `%${q.search}%`;
    conditions.push(
      or(ilike(ticketsTable.title, pattern), ilike(ticketsTable.description, pattern))!,
    );
  }
  if (q.createdFrom) {
    const from = new Date(q.createdFrom);
    if (!Number.isNaN(from.getTime())) conditions.push(gte(ticketsTable.createdAt, from));
  }
  if (q.createdTo) {
    const to = new Date(q.createdTo);
    if (!Number.isNaN(to.getTime())) conditions.push(lte(ticketsTable.createdAt, to));
  }

  const tickets = await loadTicketsWhere(conditions.length ? and(...conditions) : undefined);
  res.json(ListTicketsResponse.parse(tickets));
});

router.post("/tickets", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  if (user.orgId == null && user.role === "customer") {
    res.status(400).json({ message: "Your account is not linked to an organisation." });
    return;
  }
  const parsed = CreateTicketBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }

  const createdAt = new Date();
  const deadlines = await computeInitialDeadlines(createdAt, parsed.data.severity);

  // Staff without an org raise tickets against... require org for customers only;
  // staff-created tickets keep their own org if set, else reject.
  const orgId = user.orgId;
  if (orgId == null) {
    res.status(400).json({ message: "Your account is not linked to an organisation." });
    return;
  }

  const [ticket] = await db
    .insert(ticketsTable)
    .values({
      ...parsed.data,
      orgId,
      raisedById: user.id,
      responseDeadline: deadlines.responseDeadline,
      resolutionDeadline: deadlines.resolutionDeadline,
    })
    .returning();

  await db.insert(ticketStatusHistoryTable).values({
    ticketId: ticket!.id,
    fromStatus: null,
    toStatus: "new",
    changedById: user.id,
  });

  await notifyTicketCreated(ticket!, user);

  const dto = await loadTicketDto(ticket!.id);
  res.status(201).json(CreateTicketResponse.parse(dto));
});

router.post(
  "/tickets/bulk",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const user = req.portalUser!;
    const parsed = BulkUpdateTicketsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const { ticketIds, status, assignedToId } = parsed.data;

    const tickets = await db
      .select()
      .from(ticketsTable)
      .where(inArray(ticketsTable.id, ticketIds));

    for (const ticket of tickets) {
      if (assignedToId !== undefined) {
        await db
          .update(ticketsTable)
          .set({ assignedToId })
          .where(eq(ticketsTable.id, ticket.id));
      }
      if (status && ticket.status !== status) {
        const [fresh] = await db
          .select()
          .from(ticketsTable)
          .where(eq(ticketsTable.id, ticket.id));
        if (fresh) await applyStatusChange(fresh, status as TicketStatus, user);
      }
    }

    const updated = await loadTicketsWhere(inArray(ticketsTable.id, ticketIds));
    res.json(BulkUpdateTicketsResponse.parse(updated));
  },
);

router.get("/tickets/:id", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const result = await loadTicketWithAccess(parseId(req), user);
  if ("error" in result) {
    res.status(result.error).json({ message: result.message });
    return;
  }
  const ticket = result.ticket;

  const messageRows = await db
    .select({ message: ticketMessagesTable, author: usersTable })
    .from(ticketMessagesTable)
    .leftJoin(usersTable, eq(ticketMessagesTable.authorId, usersTable.id))
    .where(eq(ticketMessagesTable.ticketId, ticket.id));

  const messages = messageRows
    .filter((r) => isStaff(user) || !r.message.isInternal)
    .map((r) => ({
      id: r.message.id,
      ticketId: r.message.ticketId,
      authorId: r.message.authorId,
      authorName: r.author?.name ?? "Unknown",
      authorRole: r.author?.role ?? "customer",
      content: r.message.content,
      isInternal: r.message.isInternal,
      createdAt: r.message.createdAt.toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const internalMessageIds = new Set(
    messageRows.filter((r) => r.message.isInternal).map((r) => r.message.id),
  );
  const attachments = (
    await db
      .select({
        id: ticketAttachmentsTable.id,
        ticketId: ticketAttachmentsTable.ticketId,
        messageId: ticketAttachmentsTable.messageId,
        filename: ticketAttachmentsTable.filename,
        contentType: ticketAttachmentsTable.contentType,
        sizeBytes: ticketAttachmentsTable.sizeBytes,
        createdAt: ticketAttachmentsTable.createdAt,
      })
      .from(ticketAttachmentsTable)
      .where(eq(ticketAttachmentsTable.ticketId, ticket.id))
  )
    // Hide attachments linked to internal notes from customers.
    .filter((a) => isStaff(user) || a.messageId == null || !internalMessageIds.has(a.messageId))
    .map((a) => ({ ...a, createdAt: a.createdAt.toISOString() }));

  const historyRows = await db
    .select({ entry: ticketStatusHistoryTable, changedBy: usersTable })
    .from(ticketStatusHistoryTable)
    .leftJoin(usersTable, eq(ticketStatusHistoryTable.changedById, usersTable.id))
    .where(eq(ticketStatusHistoryTable.ticketId, ticket.id));

  const statusHistory = historyRows
    .map((r) => ({
      id: r.entry.id,
      ticketId: r.entry.ticketId,
      fromStatus: r.entry.fromStatus,
      toStatus: r.entry.toStatus,
      changedById: r.entry.changedById,
      changedByName: r.changedBy?.name ?? "System",
      createdAt: r.entry.createdAt.toISOString(),
    }))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  const dto = await loadTicketDto(ticket.id);
  res.json(GetTicketResponse.parse({ ticket: dto, messages, attachments, statusHistory }));
});

router.post("/tickets/:id/messages", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const result = await loadTicketWithAccess(parseId(req), user);
  if ("error" in result) {
    res.status(result.error).json({ message: result.message });
    return;
  }
  const ticket = result.ticket;
  if (ticket.status === "closed") {
    res.status(400).json({ message: "This ticket is closed and read-only." });
    return;
  }
  const parsed = AddTicketMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const isInternal = parsed.data.isInternal === true && isStaff(user);

  const [message] = await db
    .insert(ticketMessagesTable)
    .values({
      ticketId: ticket.id,
      authorId: user.id,
      content: parsed.data.content,
      isInternal,
    })
    .returning();

  await db
    .update(ticketsTable)
    .set({ updatedAt: new Date() })
    .where(eq(ticketsTable.id, ticket.id));

  if (isStaff(user) && !isInternal) {
    // First public agent response stops the response SLA clock.
    if (!ticket.firstResponseAt) {
      await db
        .update(ticketsTable)
        .set({ firstResponseAt: new Date() })
        .where(eq(ticketsTable.id, ticket.id));
    }
    if (ticket.raisedById !== user.id) {
      await notifyUsers([ticket.raisedById], {
        type: "agent_reply",
        title: `New reply on ticket #${ticket.id}`,
        body: `${user.name} replied to "${ticket.title}".`,
        ticketId: ticket.id,
      });
    }
  }

  // Customer reply while Awaiting Customer moves the ticket back to In Progress.
  if (!isStaff(user) && ticket.status === "awaiting_customer") {
    const [fresh] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticket.id));
    if (fresh) await applyStatusChange(fresh, "in_progress", user);
  } else if (!isStaff(user) && ticket.assignedToId && ticket.assignedToId !== user.id) {
    await notifyUsers([ticket.assignedToId], {
      type: "agent_reply",
      title: `Customer reply on ticket #${ticket.id}`,
      body: `${user.name} replied to "${ticket.title}".`,
      ticketId: ticket.id,
    });
  }

  res.status(201).json({
    id: message!.id,
    ticketId: message!.ticketId,
    authorId: user.id,
    authorName: user.name,
    authorRole: user.role,
    content: message!.content,
    isInternal: message!.isInternal,
    createdAt: message!.createdAt.toISOString(),
  });
});

router.post(
  "/tickets/:id/status",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const user = req.portalUser!;
    const result = await loadTicketWithAccess(parseId(req), user);
    if ("error" in result) {
      res.status(result.error).json({ message: result.message });
      return;
    }
    if (result.ticket.status === "closed") {
      res.status(400).json({ message: "Closed tickets are read-only." });
      return;
    }
    const parsed = ChangeTicketStatusBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    await applyStatusChange(result.ticket, parsed.data.status as TicketStatus, user);
    const dto = await loadTicketDto(result.ticket.id);
    res.json(CreateTicketResponse.parse(dto));
  },
);

router.post(
  "/tickets/:id/assign",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const user = req.portalUser!;
    const result = await loadTicketWithAccess(parseId(req), user);
    if ("error" in result) {
      res.status(result.error).json({ message: result.message });
      return;
    }
    const parsed = AssignTicketBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const assignedToId = parsed.data.assignedToId;
    if (assignedToId != null) {
      const [assignee] = await db.select().from(usersTable).where(eq(usersTable.id, assignedToId));
      if (!assignee || !isStaff(assignee)) {
        res.status(400).json({ message: "Assignee must be an Ekai agent or admin." });
        return;
      }
    }
    await db
      .update(ticketsTable)
      .set({ assignedToId })
      .where(eq(ticketsTable.id, result.ticket.id));
    if (assignedToId != null && assignedToId !== user.id) {
      await notifyUsers([assignedToId], {
        type: "status_changed",
        title: `Ticket #${result.ticket.id} assigned to you`,
        body: `${user.name} assigned "${result.ticket.title}" to you.`,
        ticketId: result.ticket.id,
      });
    }
    const dto = await loadTicketDto(result.ticket.id);
    res.json(CreateTicketResponse.parse(dto));
  },
);

router.post("/tickets/:id/attachments", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const result = await loadTicketWithAccess(parseId(req), user);
  if ("error" in result) {
    res.status(result.error).json({ message: result.message });
    return;
  }
  if (result.ticket.status === "closed") {
    res.status(400).json({ message: "This ticket is closed and read-only." });
    return;
  }
  const parsed = AddTicketAttachmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const fileBytes = Buffer.from(parsed.data.data, "base64");
  const sizeBytes = fileBytes.length;
  if (sizeBytes > MAX_ATTACHMENT_BYTES) {
    res.status(400).json({ message: "Attachments are limited to 5 MB." });
    return;
  }
  if (parsed.data.messageId != null) {
    const [linkedMessage] = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.id, parsed.data.messageId));
    if (
      !linkedMessage ||
      linkedMessage.ticketId !== result.ticket.id ||
      (linkedMessage.isInternal && !isStaff(user))
    ) {
      res.status(400).json({ message: "Invalid message reference for this ticket." });
      return;
    }
  }
  // File bytes go to object storage; the DB row keeps only metadata + storage key.
  const storageKey = `attachments/${result.ticket.id}/${randomUUID()}`;
  await saveAttachmentObject(storageKey, fileBytes, parsed.data.contentType);
  const [attachment] = await db
    .insert(ticketAttachmentsTable)
    .values({
      ticketId: result.ticket.id,
      messageId: parsed.data.messageId ?? null,
      filename: parsed.data.filename,
      contentType: parsed.data.contentType,
      sizeBytes,
      storageKey,
    })
    .returning();
  res.status(201).json({
    id: attachment!.id,
    ticketId: attachment!.ticketId,
    messageId: attachment!.messageId,
    filename: attachment!.filename,
    contentType: attachment!.contentType,
    sizeBytes: attachment!.sizeBytes,
    createdAt: attachment!.createdAt.toISOString(),
  });
});

router.get("/attachments/:id/content", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw ?? "", 10);
  if (Number.isNaN(id)) {
    res.status(400).json({ message: "Invalid attachment id" });
    return;
  }
  const [attachment] = await db
    .select()
    .from(ticketAttachmentsTable)
    .where(eq(ticketAttachmentsTable.id, id));
  if (!attachment) {
    res.status(404).json({ message: "Attachment not found" });
    return;
  }
  const access = await loadTicketWithAccess(attachment.ticketId, user);
  if ("error" in access) {
    res.status(404).json({ message: "Attachment not found" });
    return;
  }
  if (attachment.messageId != null && !isStaff(user)) {
    const [linkedMessage] = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.id, attachment.messageId));
    if (linkedMessage?.isInternal) {
      res.status(404).json({ message: "Attachment not found" });
      return;
    }
  }
  let fileBytes: Buffer;
  try {
    fileBytes = await readAttachmentObject(attachment.storageKey);
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ message: "Attachment content is no longer available." });
      return;
    }
    throw err;
  }
  res.json({
    id: attachment.id,
    filename: attachment.filename,
    contentType: attachment.contentType,
    data: fileBytes.toString("base64"),
  });
});

export default router;
