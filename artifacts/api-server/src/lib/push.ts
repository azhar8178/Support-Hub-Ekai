import { db, pushTokensTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
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

  scheduleReceiptCheck(ticketTokens);
}

/**
 * Schedule a one-shot delayed receipt check for the given tickets. Expo only
 * knows the true (APNs/FCM) delivery outcome some minutes after accepting a
 * message, so we wait before asking. The timer is unref'd so it never keeps
 * the process alive; if the process restarts before it fires, the receipts
 * are simply skipped — acceptable at this scale.
 */
function scheduleReceiptCheck(
  ticketTokens: Map<string, string>,
  delayMs: number = RECEIPT_DELAY_MS,
): void {
  if (ticketTokens.size === 0) return;
  const timer = setTimeout(() => {
    checkPushReceipts(ticketTokens).catch((err) => {
      logger.error({ err }, "expo push receipt check failed");
    });
  }, delayMs);
  // Node timers keep the event loop alive unless unref'd; guard for
  // environments (e.g. fake timers in tests) where unref may be absent.
  timer.unref?.();
}

/**
 * Fetch delivery receipts for the given ticket IDs and act on them:
 * - log every error receipt (surfaces InvalidCredentials, MessageTooBig, etc.)
 * - prune tokens whose receipts report DeviceNotRegistered
 * Never throws; failures are logged.
 */
export async function checkPushReceipts(ticketTokens: ReadonlyMap<string, string>): Promise<void> {
  const ids = [...ticketTokens.keys()];
  if (ids.length === 0) return;

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
          // Receipt not available (yet) — Expo keeps them ~24h; nothing to act on.
          logger.warn({ ticketId: id }, "expo push receipt missing");
          continue;
        }
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
}
