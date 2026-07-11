import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { db, pushTokensTable, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Fixtures } from "./fixtures";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, unknown> }) => ({
    userId: (req.headers["x-test-clerk-user"] as string | undefined) ?? null,
  }),
  clerkMiddleware:
    () =>
    (_req: unknown, _res: unknown, next: () => void): void =>
      next(),
  clerkClient: {
    users: {
      getUser: async (id: string) => ({
        primaryEmailAddress: { emailAddress: `${id}@uninvited.example.com` },
        emailAddresses: [],
      }),
    },
  },
}));

const { default: app } = await import("../app");

const fx = new Fixtures();

let customer: User;
let agent: User;

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });
const token = (label: string) => `ExponentPushToken[${label}-${fx.suffix}]`;

beforeAll(async () => {
  const org = await fx.createOrg("Push Org");
  customer = await fx.createUser({
    name: "Push Customer",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-push-cust-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "Push Agent",
    role: "ekai_agent",
    clerkUserId: `clerk-push-agent-${fx.suffix}`,
  });
});

afterAll(async () => {
  await fx.cleanup();
});

describe("push token registration", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .post("/api/push-tokens")
      .send({ token: token("anon"), platform: "ios" });
    expect(res.status).toBe(401);
  });

  it("registers a valid Expo push token for the current user", async () => {
    const t = token("cust");
    const res = await request(app)
      .post("/api/push-tokens")
      .set(asUser(customer))
      .send({ token: t, platform: "ios" });
    expect(res.status).toBe(200);

    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, t));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(customer.id);
    expect(rows[0]!.platform).toBe("ios");
  });

  it("rejects strings that are not Expo push tokens", async () => {
    const res = await request(app)
      .post("/api/push-tokens")
      .set(asUser(customer))
      .send({ token: "not-a-push-token", platform: "android" });
    expect(res.status).toBe(400);
  });

  it("reassigns a token to whoever signs in on the device", async () => {
    const shared = token("shared-device");
    await request(app)
      .post("/api/push-tokens")
      .set(asUser(customer))
      .send({ token: shared, platform: "android" })
      .expect(200);
    await request(app)
      .post("/api/push-tokens")
      .set(asUser(agent))
      .send({ token: shared, platform: "android" })
      .expect(200);

    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, shared));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(agent.id);
  });

  it("removes a token on request and is idempotent", async () => {
    const t = token("to-remove");
    await request(app)
      .post("/api/push-tokens")
      .set(asUser(customer))
      .send({ token: t, platform: "ios" })
      .expect(200);

    await request(app)
      .post("/api/push-tokens/remove")
      .set(asUser(customer))
      .send({ token: t })
      .expect(200);
    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, t));
    expect(rows).toHaveLength(0);

    // Removing again is a no-op, not an error.
    await request(app)
      .post("/api/push-tokens/remove")
      .set(asUser(customer))
      .send({ token: t })
      .expect(200);
  });

  it("does not let one user remove another user's token", async () => {
    const t = token("agent-owned");
    await request(app)
      .post("/api/push-tokens")
      .set(asUser(agent))
      .send({ token: t, platform: "ios" })
      .expect(200);

    await request(app)
      .post("/api/push-tokens/remove")
      .set(asUser(customer))
      .send({ token: t })
      .expect(200);

    const rows = await db.select().from(pushTokensTable).where(eq(pushTokensTable.token, t));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(agent.id);
  });
});
