import { db, ticketsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { addBusinessDays } from "./businessHours";
import { computeSlaInfo } from "./sla";
import { applyStatusChange } from "./ticketActions";
import { getAgentAndAdminIds, notifyUsers } from "./notify";
import { sweepPushReceipts } from "./push";
import { logger } from "./logger";

const SWEEP_INTERVAL_MS = 60_000;
const AUTO_CLOSE_BUSINESS_DAYS = 5;

/**
 * Periodic background sweep:
 * 1. SLA 75% warning notifications for open tickets approaching a deadline.
 * 2. Auto-close Resolved tickets after 5 business days.
 * 3. Fetch due Expo push delivery receipts from the persisted queue.
 */
export async function runSweep(): Promise<void> {
  const now = new Date();

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
