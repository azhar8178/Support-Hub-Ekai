import { db, kbSuggestionEventsTable, ticketsTable } from "@workspace/db";
import { eq, inArray, lt, sql } from "drizzle-orm";
import { addBusinessDays } from "./businessHours";
import { computeSlaInfo } from "./sla";
import { applyStatusChange } from "./ticketActions";
import { getAgentAndAdminIds, notifyUsers } from "./notify";
import { sweepPushReceipts } from "./push";
import { logger } from "./logger";

const SWEEP_INTERVAL_MS = 60_000;
const AUTO_CLOSE_BUSINESS_DAYS = 5;

// KB suggestion events are only needed for the deflection dashboard; drafts
// settle within 30 minutes, so anything this old is safe to drop.
const KB_EVENT_RETENTION_MS = 90 * 24 * 3600_000;
// The prune is cheap but there's no point running it every minute.
const KB_EVENT_PRUNE_INTERVAL_MS = 24 * 3600_000;

let lastKbEventPruneAt = 0;

/**
 * Delete KB suggestion events for drafts whose latest activity is older than
 * the retention window. Deleting whole drafts (rather than individual rows)
 * keeps per-draft aggregates consistent for anything still inside the window.
 */
export async function pruneOldKbSuggestionEvents(
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - KB_EVENT_RETENTION_MS);
  const staleDrafts = db
    .select({ draftId: kbSuggestionEventsTable.draftId })
    .from(kbSuggestionEventsTable)
    .groupBy(kbSuggestionEventsTable.draftId)
    .having(lt(sql`max(${kbSuggestionEventsTable.createdAt})`, cutoff));
  const deleted = await db
    .delete(kbSuggestionEventsTable)
    .where(inArray(kbSuggestionEventsTable.draftId, staleDrafts))
    .returning({ id: kbSuggestionEventsTable.id });
  if (deleted.length > 0) {
    logger.info({ count: deleted.length }, "pruned old KB suggestion events");
  }
  return deleted.length;
}

/**
 * Periodic background sweep:
 * 1. SLA 75% warning notifications for open tickets approaching a deadline.
 * 2. Auto-close Resolved tickets after 5 business days.
 * 3. Fetch due Expo push delivery receipts from the persisted queue.
 */
export async function runSweep(): Promise<void> {
  const now = new Date();

  // --- Prune old settled KB suggestion events (at most once a day) ---
  if (now.getTime() - lastKbEventPruneAt >= KB_EVENT_PRUNE_INTERVAL_MS) {
    lastKbEventPruneAt = now.getTime();
    await pruneOldKbSuggestionEvents(now);
  }

  // --- SLA 75% warnings ---
  const openTickets = await db
    .select()
    .from(ticketsTable)
    .where(inArray(ticketsTable.status, ["new", "triaged", "in_progress", "awaiting_customer"]));

  for (const ticket of openTickets) {
    if (ticket.slaWarningNotified || ticket.slaPausedAt) continue;
    const sla = computeSlaInfo(ticket, now);
    const responseAt75 =
      sla.responsePctElapsed != null && sla.responsePctElapsed >= 75 && !sla.responseBreached;
    const resolutionAt75 =
      sla.resolutionPctElapsed != null && sla.resolutionPctElapsed >= 75 && !sla.resolutionBreached;
    if (!responseAt75 && !resolutionAt75) continue;

    const which = responseAt75 ? "first response" : "resolution";
    const recipients = ticket.assignedToId
      ? [ticket.assignedToId]
      : await getAgentAndAdminIds();
    await notifyUsers(recipients, {
      type: "sla_warning",
      title: `SLA warning on ticket #${ticket.id}`,
      body: `75% of the ${which} SLA window has elapsed for "${ticket.title}" (${ticket.severity}).`,
      ticketId: ticket.id,
      meta: { ticketTitle: ticket.title, ticketSeverity: ticket.severity, which },
    });
    await db
      .update(ticketsTable)
      .set({ slaWarningNotified: true })
      .where(eq(ticketsTable.id, ticket.id));
  }

  // --- Auto-close resolved tickets after 5 business days ---
  const resolvedTickets = await db
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.status, "resolved"));

  for (const ticket of resolvedTickets) {
    if (!ticket.resolvedAt) continue;
    const closeAt = addBusinessDays(ticket.resolvedAt, AUTO_CLOSE_BUSINESS_DAYS);
    if (now >= closeAt) {
      await applyStatusChange(ticket, "closed", null);
      logger.info({ ticketId: ticket.id }, "auto-closed resolved ticket");
    }
  }

  // --- Push delivery receipt checks (persisted queue; survives restarts) ---
  await sweepPushReceipts(now);
}

export function startSweeps(): void {
  setInterval(() => {
    runSweep().catch((err) => logger.error({ err }, "background sweep failed"));
  }, SWEEP_INTERVAL_MS);
  logger.info("background SLA/auto-close sweeps started");
}
