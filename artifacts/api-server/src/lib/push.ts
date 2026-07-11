import { db, pushReceiptQueueTable, pushTokensTable, notificationsTable } from "@workspace/db";
import { and, count, eq, inArray, lt, lte } from "drizzle-orm";
import { logger } from "./logger";
import type { NotificationPayload } from "./notify";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const CHUNK_SIZE = 100;
/** Expo accepts up to 1000 receipt IDs per request; their SDK uses 300. */
const RECEIPT_CHUNK_SIZE = 300;
/** Expo recommends waiting ~15 minutes before fetching receipts. */
export const RECEIPT_DELAY_MS = 15 * 60 * 1000;

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

interface ExpoPushReceipt {
  status: "ok" | "error";
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

  let tokens: { token: string; userId: number }[];
  try {
    tokens = await db
      .select({ token: pushTokensTable.token, userId: pushTokensTable.userId })
      .from(pushTokensTable)
      .where(inArray(pushTokensTable.userId, userIds));
  } catch (err) {
    logger.error({ err }, "failed to load push tokens");
    return;
  }
  if (tokens.length === 0) return;

  // Per-recipient unread notification count, so the OS can set the app icon
  // badge on delivery (the in-app notification row is inserted before this
  // runs, so the count already includes this notification). Badge is
  // best-effort: if the count query fails, send the push without it.
  const badgeByUserId = new Map<number, number>();
  try {
    const tokenUserIds = [...new Set(tokens.map((t) => t.userId))];
    const rows = await db
      .select({ userId: notificationsTable.userId, unread: count() })
      .from(notificationsTable)
      .where(
        and(inArray(notificationsTable.userId, tokenUserIds), eq(notificationsTable.read, false)),
      )
      .groupBy(notificationsTable.userId);
    for (const row of rows) badgeByUserId.set(row.userId, row.unread);
  } catch (err) {
    logger.error({ err }, "failed to compute unread badge counts");
  }

  const messages = tokens.map(({ token, userId }) => ({
    to: token,
    title: payload.title,
    body: payload.body,
    sound: "default" as const,
    ...(badgeByUserId.has(userId) ? { badge: badgeByUserId.get(userId) } : {}),
    data: {
      type: payload.type,
      ticketId: payload.ticketId ?? null,
    },
  }));

  // Ticket ID -> device token, so receipt errors can prune the right token.
  const ticketTokens = new Map<string, string>();

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
        } else if (ticket.id && chunk[idx]) {
          ticketTokens.set(ticket.id, chunk[idx].to);
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

  await enqueueReceiptChecks(ticketTokens);
}

/**
 * Persist ticket IDs from a successful send so the periodic sweep can fetch
 * their delivery receipts once due (~15 minutes later, per Expo's guidance).
 * Persisting instead of using an in-process timer means receipt checks
 * survive server restarts. Never throws; failures are logged — losing a
 * receipt check must not break notification delivery.
 */
async function enqueueReceiptChecks(ticketTokens: ReadonlyMap<string, string>): Promise<void> {
  if (ticketTokens.size === 0) return;
  const dueAt = new Date(Date.now() + RECEIPT_DELAY_MS);
  const rows = [...ticketTokens.entries()].map(([ticketId, token]) => ({
    ticketId,
    token,
    dueAt,
  }));
  try {
    await db.insert(pushReceiptQueueTable).values(rows).onConflictDoNothing();
  } catch (err) {
    logger.error({ err, count: rows.length }, "failed to enqueue push receipt checks");
  }
}

/**
 * Fetch delivery receipts for the given ticket IDs and act on them:
 * - log every error receipt (surfaces InvalidCredentials, MessageTooBig, etc.)
 * - prune tokens whose receipts report DeviceNotRegistered
 * Never throws; failures are logged.
 *
 * Returns the ticket IDs whose receipts were found and handled. IDs whose
 * receipts were missing (not ready yet) or whose request failed are NOT
 * returned, so callers can retry them later.
 */
export async function checkPushReceipts(
  ticketTokens: ReadonlyMap<string, string>,
): Promise<string[]> {
  const ids = [...ticketTokens.keys()];
  const processed: string[] = [];
  if (ids.length === 0) return processed;

  for (let i = 0; i < ids.length; i += RECEIPT_CHUNK_SIZE) {
    const idChunk = ids.slice(i, i + RECEIPT_CHUNK_SIZE);
    try {
      const res = await fetch(EXPO_RECEIPTS_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({ ids: idChunk }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        logger.error(
          { status: res.status, body: text.slice(0, 500) },
          "expo push receipts request failed",
        );
        continue;
      }
      const json = (await res.json()) as { data?: Record<string, ExpoPushReceipt> };
      const receipts = json.data ?? {};
      const deadTokens: string[] = [];
      for (const id of idChunk) {
        const receipt = receipts[id];
        if (!receipt) {
          // Receipt not available (yet) — Expo keeps them ~24h; the caller
          // may retry this ID on a later sweep.
          logger.warn({ ticketId: id }, "expo push receipt missing");
          continue;
        }
        processed.push(id);
        if (receipt.status === "error") {
          logger.error(
            {
              ticketId: id,
              error: receipt.details?.error,
              message: receipt.message,
              token: ticketTokens.get(id),
            },
            "expo push receipt error",
          );
          if (receipt.details?.error === "DeviceNotRegistered") {
            const token = ticketTokens.get(id);
            if (token) deadTokens.push(token);
          }
        }
      }
      if (deadTokens.length > 0) {
        await db.delete(pushTokensTable).where(inArray(pushTokensTable.token, deadTokens));
        logger.info({ count: deadTokens.length }, "pruned unregistered push tokens via receipts");
      }
    } catch (err) {
      logger.error({ err }, "expo push receipts fetch failed");
    }
  }
  return processed;
}

/** Expo discards receipts after ~24h; queue entries older than this are useless. */
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Process the persisted push-receipt queue:
 * 1. Drop entries older than ~24h — Expo no longer has their receipts.
 * 2. Fetch receipts for due entries and act on them (log errors, prune
 *    DeviceNotRegistered tokens), then remove the processed rows.
 * Entries whose receipts are still missing stay queued and are retried on
 * later sweeps until they age out. Never throws; failures are logged.
 */
export async function sweepPushReceipts(now: Date = new Date()): Promise<void> {
  try {
    const cutoff = new Date(now.getTime() - RECEIPT_MAX_AGE_MS);
    const expired = await db
      .delete(pushReceiptQueueTable)
      .where(lt(pushReceiptQueueTable.createdAt, cutoff))
      .returning({ id: pushReceiptQueueTable.id });
    if (expired.length > 0) {
      logger.warn({ count: expired.length }, "dropped expired push receipt queue entries");
    }

    const due = await db
      .select({
        ticketId: pushReceiptQueueTable.ticketId,
        token: pushReceiptQueueTable.token,
      })
      .from(pushReceiptQueueTable)
      .where(lte(pushReceiptQueueTable.dueAt, now));
    if (due.length === 0) return;

    const ticketTokens = new Map(due.map((row) => [row.ticketId, row.token]));
    const processed = await checkPushReceipts(ticketTokens);
    if (processed.length > 0) {
      await db
        .delete(pushReceiptQueueTable)
        .where(inArray(pushReceiptQueueTable.ticketId, processed));
    }
  } catch (err) {
    logger.error({ err }, "push receipt sweep failed");
  }
}
