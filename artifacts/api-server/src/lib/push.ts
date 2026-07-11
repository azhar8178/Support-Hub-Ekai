import { db, pushTokensTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "./logger";
import type { NotificationPayload } from "./notify";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const CHUNK_SIZE = 100;

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/**
 * Send a native push (via Expo's push service) to every registered device of
 * the given users. Failures are logged, never thrown — push delivery must not
 * break notification creation. Tokens Expo reports as DeviceNotRegistered are
 * pruned so we stop pushing to uninstalled apps.
 */
export async function sendExpoPushToUsers(
  userIds: number[],
  payload: NotificationPayload,
): Promise<void> {
  if (userIds.length === 0) return;

  let tokens: { token: string }[];
  try {
    tokens = await db
      .select({ token: pushTokensTable.token })
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.userId, userIds));
  } catch (err) {
    logger.error({ err }, "failed to load push tokens");
    return;
  }
  if (tokens.length === 0) return;

  const messages = tokens.map(({ token }) => ({
    to: token,
    title: payload.title,
    body: payload.body,
    sound: "default" as const,
    data: {
      type: payload.type,
      ticketId: payload.ticketId ?? null,
    },
  }));

  for (let i = 0; i < messages.length; i += CHUNK_SIZE) {
    const chunk = messages.slice(i, i + CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify(chunk),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error({ status: res.status, body: text.slice(0, 500) }, "expo push request failed");
        continue;
      }
      const json = (await res.json()) as { data?: ExpoPushTicket[] };
      const tickets = Array.isArray(json.data) ? json.data : [];
      const deadTokens: string[] = [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === "error") {
          logger.warn(
            { error: ticket.details?.error, message: ticket.message },
            "expo push ticket error",
          );
          if (ticket.details?.error === "DeviceNotRegistered" && chunk[idx]) {
            deadTokens.push(chunk[idx].to);
          }
        }
      });
      if (deadTokens.length > 0) {
        await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, deadTokens));
        logger.info({ count: deadTokens.length }, "pruned unregistered push tokens");
      }
    } catch (err) {
      logger.error({ err }, "expo push send failed");
    }
  }
}
