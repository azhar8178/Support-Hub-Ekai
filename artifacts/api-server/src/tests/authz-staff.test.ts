import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  kbArticlesTable,
  kbFeedbackTable,
  notificationsTable,
  type KbArticle,
  type Notification,
  type Organisation,
  type Ticket,
  type User,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { Fixtures } from "./fixtures";

// Same Clerk test double as authz.test.ts: signed-in Clerk user id comes
// from the `x-test-clerk-user` header; fixture users are pre-linked via
// clerkUserId so requireAuth resolves them without a Clerk API call.
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

let orgA: Organisation;
let orgB: Organisation;
let customer: User;
let orphanCustomer: User; // customer with no org
let agent: User;
let admin: User;

let ticketA: Ticket;
let ticketB: Ticket;

let customerNotif: Notification;
let agentNotif: Notification;

let publishedArticle: KbArticle;
let unpublishedArticle: KbArticle;
const kbArticleIds: number[] = [];

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

beforeAll(async () => {
  orgA = await fx.createOrg("Staff Authz Org A");
  orgB = await fx.createOrg("Staff Authz Org B");

  customer = await fx.createUser({
    name: "Authz Customer",
    role: "customer",
    orgId: orgA.id,
    clerkUserId: `clerk-sa-cust-${fx.suffix}`,
  });
  orphanCustomer = await fx.createUser({
    name: "Authz Orphan",
    role: "customer",
    orgId: null,
    clerkUserId: `clerk-sa-orphan-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "Authz Agent",
    role: "ekai_agent",
    clerkUserId: `clerk-sa-agent-${fx.suffix}`,
  });
  admin = await fx.createUser({
    name: "Authz Admin",
    role: "admin",
    clerkUserId: `clerk-sa-admin-${fx.suffix}`,
  });

  ticketA = await fx.createTicket({ orgId: orgA.id, raisedById: customer.id });
  ticketB = await fx.createTicket({ orgId: orgB.id, raisedById: customer.id });

  // Notifications for two different users (cleanup removes them by userId).
  const [n1] = await db
    .insert(notificationsTable)
    .values({
      userId: customer.id,
      type: "agent_reply",
      title: "Customer-only notification",
      body: "visible only to its owner",
      ticketId: ticketA.id,
    })
    .returning();
  customerNotif = n1!;
  const [n2] = await db
    .insert(notificationsTable)
    .values({
      userId: agent.id,
      type: "agent_reply",
      title: "AGENT SECRET notification",
      body: "must not leak to customers",
      ticketId: ticketA.id,
    })
    .returning();
  agentNotif = n2!;

  // KB articles (tracked locally; cleaned up in afterAll).
  const [pub] = await db
    .insert(kbArticlesTable)
    .values({
      title: `Published article ${fx.suffix}`,
      content: "public knowledge",
      category: "troubleshooting",
      published: true,
      authorId: admin.id,
    })
    .returning();
  publishedArticle = pub!;
  kbArticleIds.push(pub!.id);
  const [unpub] = await db
    .insert(kbArticlesTable)
    .values({
      title: `DRAFT SECRET article ${fx.suffix}`,
      content: "unpublished draft content",
      category: "troubleshooting",
      published: false,
      authorId: admin.id,
    })
    .returning();
  unpublishedArticle = unpub!;
  kbArticleIds.push(unpub!.id);
});

afterAll(async () => {
  if (kbArticleIds.length > 0) {
    await db.delete(kbFeedbackTable).where(inArray(kbFeedbackTable.articleId, kbArticleIds));
    await db.delete(kbArticlesTable).where(inArray(kbArticlesTable.id, kbArticleIds));
  }
  await fx.cleanup();
});

describe("admin routes are staff/admin only", () => {
  const adminOnlyRequests = [
    { name: "GET /admin/users", run: (h: Record<string, string>) => request(app).get("/api/admin/users").set(h) },
    {
      name: "PATCH /admin/users/:id",
      run: (h: Record<string, string>) =>
        request(app).patch(`/api/admin/users/${customer.id}`).set(h).send({ active: false }),
    },
    { name: "GET /admin/invites", run: (h: Record<string, string>) => request(app).get("/api/admin/invites").set(h) },
    {
      name: "POST /admin/invites",
      run: (h: Record<string, string>) =>
        request(app)
          .post("/api/admin/invites")
          .set(h)
          .send({ email: `sneaky-${fx.suffix}@example.com`, role: "admin" }),
    },
    {
      name: "POST /admin/orgs",
      run: (h: Record<string, string>) =>
        request(app).post("/api/admin/orgs").set(h).send({ name: `Sneaky Org ${fx.suffix}` }),
    },
    {
      name: "PUT /admin/sla-config",
      run: (h: Record<string, string>) =>
        request(app)
          .put("/api/admin/sla-config")
          .set(h)
          .send({
            targets: [
              { severity: "P1", firstResponseMinutes: 1, resolutionMinutes: 1, use24x7: true },
            ],
          }),
    },
    { name: "GET /admin/reports", run: (h: Record<string, string>) => request(app).get("/api/admin/reports").set(h) },
  ];

  for (const endpoint of adminOnlyRequests) {
    it(`customer gets 403 on ${endpoint.name}`, async () => {
      const res = await endpoint.run(asUser(customer));
      expect(res.status).toBe(403);
    });

    it(`agent gets 403 on ${endpoint.name} (admin-only)`, async () => {
      const res = await endpoint.run(asUser(agent));
      expect(res.status).toBe(403);
    });
  }

  it("customer gets 403 on staff-readable admin endpoints too", async () => {
    const orgs = await request(app).get("/api/admin/orgs").set(asUser(customer));
    expect(orgs.status).toBe(403);
    const sla = await request(app).get("/api/admin/sla-config").set(asUser(customer));
    expect(sla.status).toBe(403);
  });

  it("agent can read orgs and SLA config (staff-readable)", async () => {
    const orgs = await request(app).get("/api/admin/orgs").set(asUser(agent));
    expect(orgs.status).toBe(200);
    const sla = await request(app).get("/api/admin/sla-config").set(asUser(agent));
    expect(sla.status).toBe(200);
  });

  it("admin can read the user list", async () => {
    const res = await request(app).get("/api/admin/users").set(asUser(admin));
    expect(res.status).toBe(200);
  });

  it("customer's 403 on user update does not change the target user", async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${agent.id}`)
      .set(asUser(customer))
      .send({ role: "customer", active: false });
    expect(res.status).toBe(403);
    const check = await request(app).get("/api/admin/users").set(asUser(admin));
    const target = check.body.find((u: { id: number }) => u.id === agent.id);
    expect(target.role).toBe("ekai_agent");
    expect(target.active).toBe(true);
  });
});

describe("team routes", () => {
  it("customer gets 403 on GET /team/agents", async () => {
    const res = await request(app).get("/api/team/agents").set(asUser(customer));
    expect(res.status).toBe(403);
  });

  it("agent and admin can list agents; customers never appear in the list", async () => {
    const res = await request(app).get("/api/team/agents").set(asUser(agent));
    expect(res.status).toBe(200);
    const ids = res.body.map((u: { id: number }) => u.id);
    expect(ids).toContain(agent.id);
    expect(ids).toContain(admin.id);
    expect(ids).not.toContain(customer.id);

    const adminRes = await request(app).get("/api/team/agents").set(asUser(admin));
    expect(adminRes.status).toBe(200);
  });
});

describe("dashboard routes", () => {
  it("customer summary is scoped to their own org", async () => {
    const res = await request(app).get("/api/dashboard/summary").set(asUser(customer));
    expect(res.status).toBe(200);
    const recentIds = res.body.recentTickets.map((t: { id: number }) => t.id);
    expect(recentIds).toContain(ticketA.id);
    expect(recentIds).not.toContain(ticketB.id);
  });

  it("customer without an org gets an empty summary, not global data", async () => {
    const res = await request(app).get("/api/dashboard/summary").set(asUser(orphanCustomer));
    expect(res.status).toBe(200);
    expect(res.body.openCount).toBe(0);
    expect(res.body.inProgressCount).toBe(0);
    expect(res.body.resolvedLast30Days).toBe(0);
    expect(res.body.recentTickets).toEqual([]);
  });

  it("customer gets 403 on staff agent metrics", async () => {
    const res = await request(app).get("/api/agent/metrics").set(asUser(customer));
    expect(res.status).toBe(403);
  });

  it("agent can read agent metrics", async () => {
    const res = await request(app).get("/api/agent/metrics").set(asUser(agent));
    expect(res.status).toBe(200);
  });
});

describe("notifications are owner-only", () => {
  it("list returns only the caller's notifications", async () => {
    const res = await request(app).get("/api/notifications").set(asUser(customer));
    expect(res.status).toBe(200);
    const ids = res.body.map((n: { id: number }) => n.id);
    expect(ids).toContain(customerNotif.id);
    expect(ids).not.toContain(agentNotif.id);
    expect(JSON.stringify(res.body)).not.toContain("AGENT SECRET");
  });

  it("marking another user's notification ids as read has no effect", async () => {
    const res = await request(app)
      .post("/api/notifications/read")
      .set(asUser(customer))
      .send({ ids: [agentNotif.id] });
    expect(res.status).toBe(200);

    const [stored] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, agentNotif.id));
    expect(stored!.read).toBe(false);
  });

  it("mark-all-read only touches the caller's own notifications", async () => {
    const res = await request(app)
      .post("/api/notifications/read")
      .set(asUser(customer))
      .send({ all: true });
    expect(res.status).toBe(200);

    const [own] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, customerNotif.id));
    expect(own!.read).toBe(true);

    const [other] = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.id, agentNotif.id));
    expect(other!.read).toBe(false);
  });
});

describe("knowledge base scoping", () => {
  it("customer list only contains published articles, even with includeUnpublished", async () => {
    const res = await request(app)
      .get("/api/kb/articles?includeUnpublished=true")
      .set(asUser(customer));
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: number }) => a.id);
    expect(ids).toContain(publishedArticle.id);
    expect(ids).not.toContain(unpublishedArticle.id);
    expect(JSON.stringify(res.body)).not.toContain("DRAFT SECRET");
  });

  it("agent also cannot list unpublished articles (admin-only)", async () => {
    const res = await request(app)
      .get("/api/kb/articles?includeUnpublished=true")
      .set(asUser(agent));
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: number }) => a.id);
    expect(ids).not.toContain(unpublishedArticle.id);
  });

  it("admin can list unpublished articles", async () => {
    const res = await request(app)
      .get("/api/kb/articles?includeUnpublished=true")
      .set(asUser(admin));
    expect(res.status).toBe(200);
    const ids = res.body.map((a: { id: number }) => a.id);
    expect(ids).toContain(unpublishedArticle.id);
  });

  it("customer reading an unpublished article gets 404 (no existence leak)", async () => {
    const res = await request(app)
      .get(`/api/kb/articles/${unpublishedArticle.id}`)
      .set(asUser(customer));
    expect(res.status).toBe(404);

    const adminRes = await request(app)
      .get(`/api/kb/articles/${unpublishedArticle.id}`)
      .set(asUser(admin));
    expect(adminRes.status).toBe(200);
  });

  it("customer and agent get 403 on article create/update/delete", async () => {
    for (const who of [customer, agent]) {
      const create = await request(app)
        .post("/api/kb/articles")
        .set(asUser(who))
        .send({ title: "hack", content: "hack", category: "troubleshooting" });
      expect(create.status).toBe(403);

      const update = await request(app)
        .patch(`/api/kb/articles/${publishedArticle.id}`)
        .set(asUser(who))
        .send({ title: "defaced" });
      expect(update.status).toBe(403);

      const del = await request(app)
        .delete(`/api/kb/articles/${publishedArticle.id}`)
        .set(asUser(who));
      expect(del.status).toBe(403);
    }
  });

  it("customer can submit feedback on a published article", async () => {
    const res = await request(app)
      .post(`/api/kb/articles/${publishedArticle.id}/feedback`)
      .set(asUser(customer))
      .send({ helpful: true });
    expect(res.status).toBe(200);
    expect(res.body.helpfulCount).toBeGreaterThanOrEqual(1);
  });
});
