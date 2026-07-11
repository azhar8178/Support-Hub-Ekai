import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  kbArticlesTable,
  kbSuggestionEventsTable,
  notificationsTable,
  ticketsTable,
  ticketStatusHistoryTable,
  type KbArticle,
  type Organisation,
  type User,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
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

let org: Organisation;
let customer: User;
let admin: User;
let article: KbArticle;

// Unique per test run so aggregates over the shared dev DB stay assertable.
const filedDraftId = `test-filed-${fx.suffix}`;
const abandonedDraftId = `test-abandoned-${fx.suffix}`;
const draftIds = [filedDraftId, abandonedDraftId];

let createdTicketId: number | null = null;

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

beforeAll(async () => {
  org = await fx.createOrg("Deflection Org");
  customer = await fx.createUser({
    name: "Deflection Cust",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-deflection-cust-${fx.suffix}`,
  });
  admin = await fx.createUser({
    name: "Deflection Admin",
    role: "admin",
    clerkUserId: `clerk-deflection-admin-${fx.suffix}`,
  });
  const [a] = await db
    .insert(kbArticlesTable)
    .values({
      title: `Deflection test article ${fx.suffix}`,
      content: "How to fix the thing without a ticket.",
      category: "troubleshooting",
    })
    .returning();
  article = a!;
});

afterAll(async () => {
  await db.delete(kbSuggestionEventsTable).where(inArray(kbSuggestionEventsTable.draftId, draftIds));
  if (createdTicketId != null) {
    await db.delete(notificationsTable).where(eq(notificationsTable.ticketId, createdTicketId));
    await db
      .delete(ticketStatusHistoryTable)
      .where(eq(ticketStatusHistoryTable.ticketId, createdTicketId));
    await db.delete(ticketsTable).where(eq(ticketsTable.id, createdTicketId));
  }
  await db.delete(kbArticlesTable).where(eq(kbArticlesTable.id, article.id));
  await fx.cleanup();
});

describe("KB suggestion deflection tracking", () => {
  it("records impressions and clicks idempotently", async () => {
    const payload = {
      draftId: filedDraftId,
      events: [
        { articleId: article.id, eventType: "impression" },
        { articleId: article.id, eventType: "click" },
      ],
    };
    const res1 = await request(app)
      .post("/api/kb/suggestions/events")
      .set(asUser(customer))
      .send(payload);
    expect(res1.status).toBe(200);

    // Duplicate submission must not create duplicate rows.
    const res2 = await request(app)
      .post("/api/kb/suggestions/events")
      .set(asUser(customer))
      .send(payload);
    expect(res2.status).toBe(200);

    const rows = await db
      .select()
      .from(kbSuggestionEventsTable)
      .where(eq(kbSuggestionEventsTable.draftId, filedDraftId));
    expect(rows).toHaveLength(2);
  });

  it("ignores events for non-existent articles", async () => {
    const res = await request(app)
      .post("/api/kb/suggestions/events")
      .set(asUser(customer))
      .send({
        draftId: filedDraftId,
        events: [{ articleId: 99999999, eventType: "impression" }],
      });
    expect(res.status).toBe(200);
    const rows = await db
      .select()
      .from(kbSuggestionEventsTable)
      .where(eq(kbSuggestionEventsTable.draftId, filedDraftId));
    expect(rows).toHaveLength(2);
  });

  it("links a filed ticket to its draft session", async () => {
    const res = await request(app).post("/api/tickets").set(asUser(customer)).send({
      title: `Deflection filed ticket ${fx.suffix}`,
      description: "Article did not help, filing anyway.",
      severity: "P3",
      category: "platform",
      environment: "aws",
      kbDraftId: filedDraftId,
    });
    expect(res.status).toBe(201);
    createdTicketId = res.body.id;

    const rows = await db
      .select()
      .from(kbSuggestionEventsTable)
      .where(eq(kbSuggestionEventsTable.draftId, filedDraftId));
    const filed = rows.find((r) => r.eventType === "ticket_filed");
    expect(filed).toBeDefined();
    expect(filed!.ticketId).toBe(createdTicketId);
  });

  it("counts an inactive clicked draft as likely deflected", async () => {
    // Simulate an old draft: impression + click an hour ago, no ticket.
    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(kbSuggestionEventsTable).values([
      {
        draftId: abandonedDraftId,
        eventType: "impression",
        articleId: article.id,
        userId: customer.id,
        createdAt: oldDate,
      },
      {
        draftId: abandonedDraftId,
        eventType: "click",
        articleId: article.id,
        userId: customer.id,
        createdAt: oldDate,
      },
    ]);

    const res = await request(app).get("/api/admin/kb-deflection").set(asUser(admin));
    expect(res.status).toBe(200);

    // The shared dev DB may hold other events, so assert lower bounds plus
    // exact per-article counts for our unique article.
    expect(res.body.draftsWithSuggestions).toBeGreaterThanOrEqual(2);
    expect(res.body.draftsWithClicks).toBeGreaterThanOrEqual(2);
    expect(res.body.ticketsFiledAfterSuggestions).toBeGreaterThanOrEqual(1);
    expect(res.body.ticketsFiledAfterClick).toBeGreaterThanOrEqual(1);
    expect(res.body.draftsAbandonedAfterClick).toBeGreaterThanOrEqual(1);
    expect(res.body.deflectionRatePct).not.toBeNull();

    const mine = res.body.topArticles.find(
      (a: { articleId: number }) => a.articleId === article.id,
    );
    if (mine) {
      expect(mine.impressions).toBe(2);
      expect(mine.clicks).toBe(2);
    }
  });

  it("blocks non-admins from deflection stats", async () => {
    const res = await request(app).get("/api/admin/kb-deflection").set(asUser(customer));
    expect(res.status).toBe(403);
  });
});
