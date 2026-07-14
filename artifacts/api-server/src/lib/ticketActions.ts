import {
  db,
  ticketsTable,
  ticketStatusHistoryTable,
  type Ticket,
  type TicketStatus,
  type User,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { getSlaConfigFor, isUrgentSeverity, shiftDeadlineForPause } from "./sla";
import { getAgentAndAdminIds, notifyUsers } from "./notify";

export const TICKET_STATUSES: TicketStatus[] = [
  "new",
  "triaged",
  "in_progress",
  "awaiting_customer",
  "resolved",
  "closed",
];

export const STATUS_LABELS: Record<TicketStatus, string> = {
  new: "New",
  triaged: "Triaged",
  in_progress: "In Progress",
  awaiting_customer: "Awaiting Customer",
  resolved: "Resolved",
  closed: "Closed",
};

/**
 * Apply a status change: handles SLA pause/resume, resolved/closed
 * bookkeeping, status history, and notifications.
 * Caller is responsible for authorization. Returns the updated ticket.
 */
export async function applyStatusChange(
  ticket: Ticket,
  toStatus: TicketStatus,
  actor: User | null,
): Promise<Ticket> {
  if (ticket.status === toStatus) return ticket;

  const now = new Date();
  const updates: Partial<typeof ticketsTable.$inferInsert> = { status: toStatus };

  // Resume SLA clock when leaving Awaiting Customer.
  if (ticket.status === "awaiting_customer" && ticket.slaPausedAt) {
    const config = await getSlaConfigFor(ticket.severity);
    const use24x7 = config?.use24x7 ?? false;
    if (ticket.responseDeadline && !ticket.firstResponseAt) {
      updates.responseDeadline = shiftDeadlineForPause(
        ticket.responseDeadline,
        ticket.slaPausedAt,
        now,
        use24x7,
      );
    }
    if (ticket.resolutionDeadline && !ticket.resolvedAt) {
      updates.resolutionDeadline = shiftDeadlineForPause(
        ticket.resolutionDeadline,
        ticket.slaPausedAt,
        now,
        use24x7,
      );
    }
    updates.slaPausedAt = null;
  }

  // Pause SLA clock when entering Awaiting Customer.
  if (toStatus === "awaiting_customer") {
    updates.slaPausedAt = now;
  }

  if (toStatus === "resolved") {
    updates.resolvedAt = now;
  } else if (ticket.status === "resolved" && toStatus !== "closed") {
    // Reopened
    updates.resolvedAt = null;
  }

  const [updated] = await db
    .update(ticketsTable)
    .set(updates)
    .where(eq(ticketsTable.id, ticket.id))
    .returning();

  await db.insert(ticketStatusHistoryTable).values({
    ticketId: ticket.id,
    fromStatus: ticket.status,
    toStatus,
    changedById: actor?.id ?? null,
  });

  // Notify the customer who raised the ticket (unless they made the change).
  const recipients = new Set<number>();
  if (ticket.raisedById != null && ticket.raisedById !== actor?.id) recipients.add(ticket.raisedById);
  if (ticket.assignedToId && ticket.assignedToId !== actor?.id) recipients.add(ticket.assignedToId);
  await notifyUsers([...recipients], {
    type: "status_changed",
    title: `Ticket #${ticket.id} is now ${STATUS_LABELS[toStatus]}`,
    body: `"${ticket.title}" status changed from ${STATUS_LABELS[ticket.status]} to ${STATUS_LABELS[toStatus]}.`,
    ticketId: ticket.id,
    meta: {
      ticketTitle: ticket.title,
      fromStatus: STATUS_LABELS[ticket.status],
      toStatus: STATUS_LABELS[toStatus],
    },
  });

  return updated!;
}

/** Notifications fired when a ticket is created. */
export async function notifyTicketCreated(ticket: Ticket, raiser: User): Promise<void> {
  // Confirmation to the customer.
  await notifyUsers([raiser.id], {
    type: "ticket_created",
    title: `Ticket #${ticket.id} received`,
    body: `We have received "${ticket.title}" (${ticket.severity}). Our team will respond within the SLA for this severity.`,
    ticketId: ticket.id,
    meta: { ticketTitle: ticket.title, ticketSeverity: ticket.severity },
  });
  // Alert the support team.
  const staff = (await getAgentAndAdminIds()).filter((id) => id !== raiser.id);
  if (isUrgentSeverity(ticket.severity)) {
    await notifyUsers(staff, {
      type: "new_critical_ticket",
      title: `New ${ticket.severity} ticket #${ticket.id}`,
      body: `${raiser.name} raised a ${ticket.severity} ticket: "${ticket.title}".`,
      ticketId: ticket.id,
      meta: { ticketTitle: ticket.title, ticketSeverity: ticket.severity, raiserName: raiser.name },
    });
  } else {
    await notifyUsers(staff, {
      type: "ticket_created",
      title: `New ticket #${ticket.id}`,
      body: `${raiser.name} raised a ${ticket.severity} ticket: "${ticket.title}".`,
      ticketId: ticket.id,
      meta: { ticketTitle: ticket.title, ticketSeverity: ticket.severity, raiserName: raiser.name },
    });
  }
}
