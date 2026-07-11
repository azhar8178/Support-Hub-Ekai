import { db, notificationsTable, usersTable, type NotificationType } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";
import {
  sendEmail,
  ticketCreatedEmail,
  agentReplyEmail,
  statusChangedEmail,
  newCriticalTicketEmail,
  slaWarningEmail,
} from "./email";

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  ticketId?: number | null;
  /** Extra context fields used by email templates. */
  meta?: {
    ticketTitle?: string;
    ticketSeverity?: string;
    fromStatus?: string;
    toStatus?: string;
    agentName?: string;
    raiserName?: string;
    which?: string; // for SLA warning: "first response" | "resolution"
  };
}

/**
 * Pluggable notification channel. In-app is always on; an email provider
 * can be added by implementing this interface and registering it in
 * `channels` below.
 */
export interface NotificationChannel {
  deliver(userEmail: string, payload: NotificationPayload): Promise<void>;
}

/**
 * AWS SES email channel. Sends real emails when credentials are present;
 * logs the intent without error when they are not, so development and CI
 * keep working without credentials.
 */
class AwsSesEmailChannel implements NotificationChannel {
  async deliver(userEmail: string, payload: NotificationPayload): Promise<void> {
    const id = payload.ticketId ?? 0;
    const meta = payload.meta ?? {};

    try {
      switch (payload.type) {
        case "ticket_created":
          await sendEmail(
            ticketCreatedEmail({
              to: userEmail,
              ticketId: id,
              ticketTitle: meta.ticketTitle ?? payload.title,
              severity: meta.ticketSeverity ?? "",
            }),
          );
          break;

        case "agent_reply":
          await sendEmail(
            agentReplyEmail({
              to: userEmail,
              ticketId: id,
              ticketTitle: meta.ticketTitle ?? payload.title,
              agentName: meta.agentName ?? "Support",
            }),
          );
          break;

        case "status_changed":
          await sendEmail(
            statusChangedEmail({
              to: userEmail,
              ticketId: id,
              ticketTitle: meta.ticketTitle ?? payload.title,
              fromStatus: meta.fromStatus ?? "",
              toStatus: meta.toStatus ?? "",
            }),
          );
          break;

        case "new_critical_ticket":
          await sendEmail(
            newCriticalTicketEmail({
              to: userEmail,
              ticketId: id,
              ticketTitle: meta.ticketTitle ?? payload.title,
              severity: meta.ticketSeverity ?? "",
              raiserName: meta.raiserName ?? "Customer",
            }),
          );
          break;

        case "sla_warning":
          await sendEmail(
            slaWarningEmail({
              to: userEmail,
              ticketId: id,
              ticketTitle: meta.ticketTitle ?? payload.title,
              severity: meta.ticketSeverity ?? "",
              which: meta.which ?? "response",
            }),
          );
          break;

        default:
          // "invite" is handled directly in admin.ts; other future types log only.
          logger.info(
            { to: userEmail, type: payload.type },
            "email channel: no template for type, skipping",
          );
      }
    } catch (err) {
      // Already logged inside sendEmail; re-throw so the outer catch records it.
      throw err;
    }
  }
}

const channels: NotificationChannel[] = [new AwsSesEmailChannel()];

/** Create in-app notifications (and fan out to channels) for the given users. */
export async function notifyUsers(userIds: number[], payload: NotificationPayload): Promise<void> {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return;

  const users = await db.select().from(usersTable).where(inArray(usersTable.id, uniqueIds));
  const activeUsers = users.filter((u) => u.active);
  if (activeUsers.length === 0) return;

  await db.insert(notificationsTable).values(
    activeUsers.map((u) => ({
      userId: u.id,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      ticketId: payload.ticketId ?? null,
      emailTo: u.email,
    })),
  );

  for (const user of activeUsers) {
    for (const channel of channels) {
      try {
        await channel.deliver(user.email, payload);
      } catch (err) {
        logger.error({ err, userId: user.id }, "notification channel delivery failed");
      }
    }
  }
}

/** All active agents + admins. */
export async function getAgentAndAdminIds(): Promise<number[]> {
  const users = await db.select().from(usersTable);
  return users.filter((u) => u.active && (u.role === "ekai_agent" || u.role === "admin")).map((u) => u.id);
}
