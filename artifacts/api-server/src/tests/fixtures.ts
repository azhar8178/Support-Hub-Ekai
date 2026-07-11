import {
  db,
  notificationsTable,
  organisationsTable,
  ticketAttachmentsTable,
  ticketMessagesTable,
  ticketsTable,
  ticketStatusHistoryTable,
  usersTable,
  type Organisation,
  type Ticket,
  type TicketMessage,
  type TicketAttachment,
  type User,
} from "@workspace/db";
import { inArray, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import { deleteAttachmentObject, saveAttachmentObject } from "../lib/objectStorage";

/**
 * Tracks every row a test creates so cleanup removes exactly (and only)
 * test data from the shared dev database.
 */
export class Fixtures {
  private orgIds: number[] = [];
  private userIds: number[] = [];
  private ticketIds: number[] = [];
  private storageKeys: string[] = [];
  readonly suffix = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

  async createOrg(name: string): Promise<Organisation> {
    const [org] = await db
      .insert(organisationsTable)
      .values({ name: `${name} ${this.suffix}` })
      .returning();
    this.orgIds.push(org!.id);
    return org!;
  }

  async createUser(input: {
    name: string;
    role: User["role"];
    orgId?: number | null;
    clerkUserId?: string | null;
    active?: boolean;
  }): Promise<User> {
    const [user] = await db
      .insert(usersTable)
      .values({
        name: input.name,
        email: `${input.name.toLowerCase().replace(/\s+/g, ".")}-${this.suffix}@test.example.com`,
        role: input.role,
        orgId: input.orgId ?? null,
        clerkUserId: input.clerkUserId ?? null,
        active: input.active ?? true,
      })
      .returning();
    this.userIds.push(user!.id);
    return user!;
  }

  async createTicket(input: {
    orgId: number;
    raisedById: number;
    title?: string;
    severity?: Ticket["severity"];
    status?: Ticket["status"];
    responseDeadline?: Date | null;
    resolutionDeadline?: Date | null;
    slaPausedAt?: Date | null;
    firstResponseAt?: Date | null;
  }): Promise<Ticket> {
    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        title: input.title ?? `Test ticket ${this.suffix}`,
        description: "test ticket description",
        severity: input.severity ?? "P3",
        status: input.status ?? "new",
        category: "platform",
        environment: "aws",
        orgId: input.orgId,
        raisedById: input.raisedById,
        responseDeadline: input.responseDeadline ?? null,
        resolutionDeadline: input.resolutionDeadline ?? null,
        slaPausedAt: input.slaPausedAt ?? null,
        firstResponseAt: input.firstResponseAt ?? null,
      })
      .returning();
    this.ticketIds.push(ticket!.id);
    return ticket!;
  }

  async createMessage(input: {
    ticketId: number;
    authorId: number;
    content?: string;
    isInternal?: boolean;
  }): Promise<TicketMessage> {
    const [message] = await db
      .insert(ticketMessagesTable)
      .values({
        ticketId: input.ticketId,
        authorId: input.authorId,
        content: input.content ?? "test message",
        isInternal: input.isInternal ?? false,
      })
      .returning();
    return message!;
  }

  async createAttachment(input: {
    ticketId: number;
    messageId?: number | null;
    filename?: string;
  }): Promise<TicketAttachment> {
    const storageKey = `attachments/${input.ticketId}/test-${randomUUID()}`;
    await saveAttachmentObject(storageKey, Buffer.from("aGVsbG8=", "base64"), "text/plain");
    this.storageKeys.push(storageKey);
    const [attachment] = await db
      .insert(ticketAttachmentsTable)
      .values({
        ticketId: input.ticketId,
        messageId: input.messageId ?? null,
        filename: input.filename ?? "test.txt",
        contentType: "text/plain",
        sizeBytes: 5,
        storageKey,
      })
      .returning();
    return attachment!;
  }

  /** Delete everything this fixture set created, respecting FK order. */
  async cleanup(): Promise<void> {
    await Promise.all(
      this.storageKeys.map((key) => deleteAttachmentObject(key).catch(() => undefined)),
    );
    if (this.ticketIds.length > 0 || this.userIds.length > 0) {
      const conds = [];
      if (this.ticketIds.length > 0)
        conds.push(inArray(notificationsTable.ticketId, this.ticketIds));
      if (this.userIds.length > 0) conds.push(inArray(notificationsTable.userId, this.userIds));
      await db.delete(notificationsTable).where(or(...conds));
    }
    if (this.ticketIds.length > 0) {
      await db
        .delete(ticketAttachmentsTable)
        .where(inArray(ticketAttachmentsTable.ticketId, this.ticketIds));
      await db
        .delete(ticketMessagesTable)
        .where(inArray(ticketMessagesTable.ticketId, this.ticketIds));
      await db
        .delete(ticketStatusHistoryTable)
        .where(inArray(ticketStatusHistoryTable.ticketId, this.ticketIds));
      await db.delete(ticketsTable).where(inArray(ticketsTable.id, this.ticketIds));
    }
    if (this.userIds.length > 0) {
      await db.delete(usersTable).where(inArray(usersTable.id, this.userIds));
    }
    if (this.orgIds.length > 0) {
      await db.delete(organisationsTable).where(inArray(organisationsTable.id, this.orgIds));
    }
  }
}
