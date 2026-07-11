import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  db,
  pushReceiptQueueTable,
  pushTokensTable,
  notificationsTable,
  type User,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { Fixtures } from "./fixtures";
import {
  sendExpoPushToUsers,
  checkPushReceipts,
  sweepPushReceipts,
  RECEIPT_DELAY_MS,
  RECEIPT_MAX_AGE_MS,
} from "../lib/push";
import { notifyUsers, type NotificationPayload } from "../lib/notify";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";

const fx = new Fixtures();

let user: User;

const token = (label: string) => `ExponentPushToken[${label}-${fx.suffix}]`;

const payload: NotificationPayload = {
  type: "agent_reply",
  title: "Agent replied",
  body: "An agent replied to your ticket",
  ticketId: 12345,
};

/** Register a push token row directly for a user. */
async function addToken(userId: number, t: string): Promise<void> {
  await db.insert(pushTokensTable).values({ userId, token: t, platform: "ios" });
}

async function tokensFor(userId: number): Promise<string[]> {
  const rows = await db
    .select({ token: pushTokensTable.token })
    .from(pushTokensTable)
    .where(eq(pushTokensTable.userId, userId));
  return rows.map((r) => r.token);
}

function okResponse(tickets: unknown[]): Response {
  return new Response(JSON.stringify({ data: tickets }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/** Parse the messages array a fetch mock call was invoked with. */
function sentMessages(call: unknown[]): { to: string; title: string; body: string; sound: string; data: { type: string; ticketId: number | null } }[] {
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeAll(async () => {
  const org = await fx.createOrg("Push Send Org");
  user = await fx.createUser({ name: "Push Send User", role: "customer", orgId: org.id });
});

afterAll(async () => {
  await fx.cleanup();
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // Remove any tokens left over from a test so cases stay independent.
  await db.delete(pushTokensTable).where(eq(pushTokensTable.userId, user.id));
});

describe("sendExpoPushToUsers", () => {
  it("sends a correctly shaped message for each registered token", async () => {
    const t = token("shape");
    await addToken(user.id, t);

    const fetchMock = vi.fn(async () => okResponse([{ status: "ok", id: "1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushToUsers([user.id], payload);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(EXPO_PUSH_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");

    const messages = sentMessages(fetchMock.mock.calls[0]! as unknown[]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toEqual({
      to: t,
      title: payload.title,
      body: payload.body,
      sound: "default",
      data: { type: payload.type, ticketId: payload.ticketId },
    });
  });

  it("includes the recipient's unread count as the badge field", async () => {
    const t = token("badge");
    await addToken(user.id, t);

    // Two unread + one read notification for the recipient.
    const inserted = await db
      .insert(notificationsTable)
      .values([
        { userId: user.id, type: "agent_reply", title: "a", body: "a", read: false },
        { userId: user.id, type: "agent_reply", title: "b", body: "b", read: false },
        { userId: user.id, type: "agent_reply", title: "c", body: "c", read: true },
      ])
      .returning({ id: notificationsTable.id });

    const fetchMock = vi.fn(async () => okResponse([{ status: "ok", id: "1" }]));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await sendExpoPushToUsers([user.id], payload);

      const messages = sentMessages(fetchMock.mock.calls[0]! as unknown[]) as unknown as {
        to: string;
        badge?: number;
      }[];
      expect(messages).toHaveLength(1);
      expect(messages[0]!.badge).toBe(2);
    } finally {
      await db
        .delete(notificationsTable)
        .where(inArray(notificationsTable.id, inserted.map((r) => r.id)));
    }
  });

  it("omits the badge field when the recipient has no unread notifications", async () => {
    const t = token("no-badge");
    await addToken(user.id, t);

    const fetchMock = vi.fn(async () => okResponse([{ status: "ok", id: "1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushToUsers([user.id], payload);

    const messages = sentMessages(fetchMock.mock.calls[0]! as unknown[]) as unknown as {
      badge?: number;
    }[];
    expect(messages).toHaveLength(1);
    expect("badge" in messages[0]!).toBe(false);
  });

  it("does not call the push service when the user has no tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushToUsers([user.id], payload);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call the push service for an empty user list", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushToUsers([], payload);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("splits messages into chunks of at most 100", async () => {
    const total = 150;
    const values = Array.from({ length: total }, (_, i) => ({
      userId: user.id,
      token: token(`chunk-${i}`),
      platform: "ios" as const,
    }));
    await db.insert(pushTokensTable).values(values);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const chunk = JSON.parse(init.body as string) as unknown[];
      return okResponse(chunk.map(() => ({ status: "ok" })));
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushToUsers([user.id], payload);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map((c) => sentMessages(c as unknown[]).length);
    expect(sizes).toEqual([100, 50]);

    // Every token was included exactly once across the chunks.
    const allSent = fetchMock.mock.calls.flatMap((c) => sentMessages(c as unknown[]).map((m) => m.to));
    expect(new Set(allSent).size).toBe(total);
  });

  it("prunes tokens Expo reports as DeviceNotRegistered, keeping the rest", async () => {
    const dead = token("dead");
    const alive = token("alive");
    await addToken(user.id, dead);
    await addToken(user.id, alive);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const chunk = JSON.parse(init.body as string) as { to: string }[];
      return okResponse(
        chunk.map((m) =>
          m.to === dead
            ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
            : { status: "ok" },
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushToUsers([user.id], payload);

    const remaining = await tokensFor(user.id);
    expect(remaining).toContain(alive);
    expect(remaining).not.toContain(dead);
  });

  it("does not prune tokens for other ticket errors", async () => {
    const t = token("throttled");
    await addToken(user.id, t);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse([
          { status: "error", message: "rate limited", details: { error: "MessageRateExceeded" } },
        ]),
      ),
    );

    await sendExpoPushToUsers([user.id], payload);

    expect(await tokensFor(user.id)).toContain(t);
  });

  it("logs and returns (no throw) when the push service responds with an HTTP error", async () => {
    await addToken(user.id, token("http-error"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Internal Server Error", { status: 500 })),
    );

    await expect(sendExpoPushToUsers([user.id], payload)).resolves.toBeUndefined();
    // Token is kept — a transient server error must not prune anything.
    expect(await tokensFor(user.id)).toHaveLength(1);
  });

  it("logs and returns (no throw) when the network request fails", async () => {
    await addToken(user.id, token("net-error"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );

    await expect(sendExpoPushToUsers([user.id], payload)).resolves.toBeUndefined();
    expect(await tokensFor(user.id)).toHaveLength(1);
  });

  it("continues to later chunks after an earlier chunk fails", async () => {
    const total = 120;
    const values = Array.from({ length: total }, (_, i) => ({
      userId: user.id,
      token: token(`resume-${i}`),
      platform: "android" as const,
    }));
    await db.insert(pushTokensTable).values(values);

    const fetchMock = vi
      .fn(async (_url: string, init: RequestInit) => {
        const chunk = JSON.parse(init.body as string) as unknown[];
        return okResponse(chunk.map(() => ({ status: "ok" })));
      })
      .mockRejectedValueOnce(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(sendExpoPushToUsers([user.id], payload)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function receiptsResponse(receipts: Record<string, unknown>): Response {
  return new Response(JSON.stringify({ data: receipts }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("checkPushReceipts", () => {
  it("fetches receipts for the given ticket IDs with the right request shape", async () => {
    const fetchMock = vi.fn(async () => receiptsResponse({ "r-1": { status: "ok" } }));
    vi.stubGlobal("fetch", fetchMock);

    await checkPushReceipts(new Map([["r-1", token("receipt-shape")]]));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(EXPO_RECEIPTS_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/json");
    expect(JSON.parse(init.body as string)).toEqual({ ids: ["r-1"] });
  });

  it("does nothing for an empty ticket map", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await checkPushReceipts(new Map());

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("prunes tokens whose receipts report DeviceNotRegistered, keeping the rest", async () => {
    const dead = token("receipt-dead");
    const alive = token("receipt-alive");
    await addToken(user.id, dead);
    await addToken(user.id, alive);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        receiptsResponse({
          "r-dead": {
            status: "error",
            message: "device gone",
            details: { error: "DeviceNotRegistered" },
          },
          "r-alive": { status: "ok" },
        }),
      ),
    );

    await checkPushReceipts(
      new Map([
        ["r-dead", dead],
        ["r-alive", alive],
      ]),
    );

    const remaining = await tokensFor(user.id);
    expect(remaining).toContain(alive);
    expect(remaining).not.toContain(dead);
  });

  it("does not prune tokens for other receipt errors (e.g. InvalidCredentials)", async () => {
    const t = token("receipt-creds");
    await addToken(user.id, t);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        receiptsResponse({
          "r-creds": {
            status: "error",
            message: "bad push credentials",
            details: { error: "InvalidCredentials" },
          },
        }),
      ),
    );

    await checkPushReceipts(new Map([["r-creds", t]]));

    expect(await tokensFor(user.id)).toContain(t);
  });

  it("does not prune when a receipt is missing from the response", async () => {
    const t = token("receipt-missing");
    await addToken(user.id, t);

    vi.stubGlobal("fetch", vi.fn(async () => receiptsResponse({})));

    await checkPushReceipts(new Map([["r-missing", t]]));

    expect(await tokensFor(user.id)).toContain(t);
  });

  it("logs and returns (no throw) when the receipts endpoint responds with an HTTP error", async () => {
    const t = token("receipt-http");
    await addToken(user.id, t);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Internal Server Error", { status: 500 })),
    );

    // Nothing processed — the failed chunk's IDs are retryable.
    await expect(checkPushReceipts(new Map([["r-http", t]]))).resolves.toEqual([]);
    expect(await tokensFor(user.id)).toContain(t);
  });

  it("logs and returns (no throw) when the receipts request fails on the network", async () => {
    const t = token("receipt-net");
    await addToken(user.id, t);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    // Nothing processed — the failed chunk's IDs are retryable.
    await expect(checkPushReceipts(new Map([["r-net", t]]))).resolves.toEqual([]);
    expect(await tokensFor(user.id)).toContain(t);
  });

  it("splits receipt requests into chunks of at most 300 IDs", async () => {
    const total = 301;
    const entries = Array.from(
      { length: total },
      (_, i) => [`r-chunk-${i}`, token(`receipt-chunk-${i}`)] as const,
    );

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { ids } = JSON.parse(init.body as string) as { ids: string[] };
      return receiptsResponse(Object.fromEntries(ids.map((id) => [id, { status: "ok" }])));
    });
    vi.stubGlobal("fetch", fetchMock);

    await checkPushReceipts(new Map(entries));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sizes = fetchMock.mock.calls.map(
      (c) => (JSON.parse((c[1] as RequestInit).body as string) as { ids: string[] }).ids.length,
    );
    expect(sizes).toEqual([300, 1]);
  });
});

describe("receipt queue persistence and sweep", () => {
  /** Unique-per-run Expo ticket ID so parallel test runs never collide. */
  const qid = (label: string) => `q-${label}-${fx.suffix}`;

  async function queueRowsFor(ticketIds: string[]) {
    return db
      .select()
      .from(pushReceiptQueueTable)
      .where(inArray(pushReceiptQueueTable.ticketId, ticketIds));
  }

  afterEach(async () => {
    // Remove any queue rows this suite created (ticket IDs carry fx.suffix).
    const rows = await db.select().from(pushReceiptQueueTable);
    const ours = rows.filter((r) => r.ticketId.includes(fx.suffix)).map((r) => r.id);
    if (ours.length > 0) {
      await db.delete(pushReceiptQueueTable).where(inArray(pushReceiptQueueTable.id, ours));
    }
  });

  it("persists successful tickets with their token and a ~15min due-at after a send", async () => {
    const t = token("queue-persist");
    await addToken(user.id, t);
    const id = qid("persist");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => okResponse([{ status: "ok", id }])),
    );

    const before = Date.now();
    await sendExpoPushToUsers([user.id], payload);
    const after = Date.now();

    const rows = await queueRowsFor([id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token).toBe(t);
    const due = rows[0]!.dueAt.getTime();
    expect(due).toBeGreaterThanOrEqual(before + RECEIPT_DELAY_MS);
    expect(due).toBeLessThanOrEqual(after + RECEIPT_DELAY_MS);
  });

  it("does not persist anything when no tickets came back with IDs", async () => {
    const t = token("queue-no-ids");
    await addToken(user.id, t);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        okResponse([
          { status: "error", message: "rate limited", details: { error: "MessageRateExceeded" } },
        ]),
      ),
    );

    await sendExpoPushToUsers([user.id], payload);

    const rows = await db.select().from(pushReceiptQueueTable);
    expect(rows.filter((r) => r.ticketId.includes(fx.suffix))).toHaveLength(0);
  });

  it("sweep fetches due entries, prunes DeviceNotRegistered tokens, and removes processed rows", async () => {
    const dead = token("sweep-dead");
    const alive = token("sweep-alive");
    await addToken(user.id, dead);
    await addToken(user.id, alive);

    const deadId = qid("sweep-dead");
    const aliveId = qid("sweep-alive");
    const now = new Date();
    await db.insert(pushReceiptQueueTable).values([
      { ticketId: deadId, token: dead, dueAt: new Date(now.getTime() - 1000) },
      { ticketId: aliveId, token: alive, dueAt: new Date(now.getTime() - 1000) },
    ]);

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { ids } = JSON.parse(init.body as string) as { ids: string[] };
      return receiptsResponse(
        Object.fromEntries(
          ids.map((id) => [
            id,
            id === deadId
              ? { status: "error", message: "gone", details: { error: "DeviceNotRegistered" } }
              : { status: "ok" },
          ]),
        ),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await sweepPushReceipts(now);

    const requestedIds = fetchMock.mock.calls.flatMap(
      (c) => (JSON.parse((c[1] as RequestInit).body as string) as { ids: string[] }).ids,
    );
    expect(requestedIds).toContain(deadId);
    expect(requestedIds).toContain(aliveId);

    // Dead token pruned, alive kept.
    const remaining = await tokensFor(user.id);
    expect(remaining).toContain(alive);
    expect(remaining).not.toContain(dead);

    // Both rows processed and removed from the queue.
    expect(await queueRowsFor([deadId, aliveId])).toHaveLength(0);
  });

  it("sweep does not fetch entries that are not yet due", async () => {
    const notDueId = qid("not-due");
    const now = new Date();
    await db.insert(pushReceiptQueueTable).values({
      ticketId: notDueId,
      token: token("not-due"),
      dueAt: new Date(now.getTime() + RECEIPT_DELAY_MS),
    });

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { ids } = JSON.parse(init.body as string) as { ids: string[] };
      return receiptsResponse(Object.fromEntries(ids.map((id) => [id, { status: "ok" }])));
    });
    vi.stubGlobal("fetch", fetchMock);

    await sweepPushReceipts(now);

    const requestedIds = fetchMock.mock.calls.flatMap(
      (c) => (JSON.parse((c[1] as RequestInit).body as string) as { ids: string[] }).ids,
    );
    expect(requestedIds).not.toContain(notDueId);
    // Row stays queued for a later sweep.
    expect(await queueRowsFor([notDueId])).toHaveLength(1);
  });

  it("keeps entries whose receipts are missing so they retry on a later sweep", async () => {
    const missingId = qid("missing");
    const now = new Date();
    await db.insert(pushReceiptQueueTable).values({
      ticketId: missingId,
      token: token("sweep-missing"),
      dueAt: new Date(now.getTime() - 1000),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const { ids } = JSON.parse(init.body as string) as { ids: string[] };
        // Every receipt except ours is ok; ours is missing from the response.
        return receiptsResponse(
          Object.fromEntries(
            ids.filter((id) => id !== missingId).map((id) => [id, { status: "ok" }]),
          ),
        );
      }),
    );

    await sweepPushReceipts(now);

    expect(await queueRowsFor([missingId])).toHaveLength(1);
  });

  it("drops entries older than 24h without fetching their receipts", async () => {
    const expiredId = qid("expired");
    const now = new Date();
    await db.insert(pushReceiptQueueTable).values({
      ticketId: expiredId,
      token: token("expired"),
      dueAt: new Date(now.getTime() - RECEIPT_MAX_AGE_MS),
      createdAt: new Date(now.getTime() - RECEIPT_MAX_AGE_MS - 60_000),
    });

    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const { ids } = JSON.parse(init.body as string) as { ids: string[] };
      return receiptsResponse(Object.fromEntries(ids.map((id) => [id, { status: "ok" }])));
    });
    vi.stubGlobal("fetch", fetchMock);

    await sweepPushReceipts(now);

    const requestedIds = fetchMock.mock.calls.flatMap(
      (c) => (JSON.parse((c[1] as RequestInit).body as string) as { ids: string[] }).ids,
    );
    expect(requestedIds).not.toContain(expiredId);
    expect(await queueRowsFor([expiredId])).toHaveLength(0);
  });

  it("keeps queue rows when the receipts request fails, so they retry later", async () => {
    const retryId = qid("retry");
    const now = new Date();
    await db.insert(pushReceiptQueueTable).values({
      ticketId: retryId,
      token: token("sweep-retry"),
      dueAt: new Date(now.getTime() - 1000),
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );

    await expect(sweepPushReceipts(now)).resolves.toBeUndefined();

    expect(await queueRowsFor([retryId])).toHaveLength(1);
  });
});

describe("notifyUsers with the push service down", () => {
  it("still creates in-app notification rows when every push request fails", async () => {
    await addToken(user.id, token("down"));

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("push service unreachable");
      }),
    );

    const org = await fx.createOrg("Push Down Org");
    const ticket = await fx.createTicket({ orgId: org.id, raisedById: user.id });
    const ticketId = ticket.id;
    await expect(
      notifyUsers([user.id], { ...payload, ticketId }),
    ).resolves.toBeUndefined();

    const rows = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.userId, user.id));
    const created = rows.filter((r) => r.ticketId === ticketId);
    expect(created).toHaveLength(1);
    expect(created[0]!.title).toBe(payload.title);
    expect(created[0]!.body).toBe(payload.body);
    expect(created[0]!.type).toBe(payload.type);

    await db
      .delete(notificationsTable)
      .where(inArray(notificationsTable.id, created.map((r) => r.id)));
  });
});
