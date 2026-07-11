import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { db, pushTokensTable, notificationsTable, type User } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { Fixtures } from "./fixtures";
import { sendExpoPushToUsers } from "../lib/push";
import { notifyUsers, type NotificationPayload } from "../lib/notify";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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
