import { db, notificationsTable, usersTable, type NotificationType } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";

export interface NotificationPayload {
  type: NotificationType;
  title: string;
  body: string;
  ticketId?: number | null;
}

/**
 * Pluggable notification channel. In-app is always on; an email provider
 * (e.g. Resend) can be added later by implementing this interface and
 * registering it in `channels` below.
 */
export interface NotificationChannel {
  deliver(userEmail: string, payload: NotificationPayload): Promise<void>;
}

class EmailStubChannel implements NotificationChannel {
  async deliver(userEmail: string, payload: NotificationPayload): Promise<void> {
    // Email provider not wired up yet. Log the outbound email intent so the
    // trigger points are verifiable; swap in a real provider later.
    logger.info(
      { to: userEmail, type: payload.type, title: payload.title },
      "email notification (stub, no provider configured)",
    );
  }
}

const channels: NotificationChannel[] = [new EmailStubChannel()];

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
