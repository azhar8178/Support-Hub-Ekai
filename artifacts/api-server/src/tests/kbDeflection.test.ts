import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  kbArticlesTable,
  kbSearchLogTable,
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
const { pruneOldKbSuggestionEvents } = await import("../lib/sweeps");

const fx = new Fixtures();

let org: Organisation;
let customer: User;
let admin: User;
let article: KbArticle;

// Unique per test run so aggregates over the shared dev DB stay assertable.
const filedDraftId = `test-filed-${fx.suffix}`;
const abandonedDraftId = `test-abandoned-${fx.suffix}`;
const ancientDraftId = `test-ancient-${fx.suffix}`;
const zeroResultDraftId = `test-zerores-${fx.suffix}`;
const notClickedDraftId = `test-noclick-${fx.suffix}`;
const activeDraftId = `test-active-${fx.suffix}`;
const draftIds = [
  filedDraftId,
  abandonedDraftId,
  ancientDraftId,
  zeroResultDraftId,
  notClickedDraftId,
  activeDraftId,
];

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
  await db.delete(kbSearchLogTable).where(inArray(kbSearchLogTable.draftId, draftIds));
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

  it("prunes drafts settled beyond the retention window, keeps recent ones", async () => {
    // A draft whose latest event is far older than the 90-day retention window.
    const ancientDate = new Date(Date.now() - 120 * 24 * 3600_000);
    await db.insert(kbSuggestionEventsTable).values([
      {
        draftId: ancientDraftId,
        eventType: "impression",
        articleId: article.id,
        userId: customer.id,
        createdAt: ancientDate,
      },
      {
        draftId: ancientDraftId,
        eventType: "click",
        articleId: article.id,
        userId: customer.id,
        createdAt: ancientDate,
      },
    ]);

    await pruneOldKbSuggestionEvents();

    const ancientRows = await db
      .select()
      .from(kbSuggestionEventsTable)
      .where(eq(kbSuggestionEventsTable.draftId, ancientDraftId));
    expect(ancientRows).toHaveLength(0);

    // Recent drafts (even the hour-old abandoned one) must be untouched.
    const recentRows = await db
      .select()
      .from(kbSuggestionEventsTable)
      .where(inArray(kbSuggestionEventsTable.draftId, [filedDraftId, abandonedDraftId]));
    expect(recentRows.length).toBeGreaterThanOrEqual(5);
  });

  it("upserts the latest search per draft", async () => {
    const res1 = await request(app)
      .post("/api/kb/suggestions/search")
      .set(asUser(customer))
      .send({ draftId: filedDraftId, query: `early partial ${fx.suffix}`, resultCount: 0 });
    expect(res1.status).toBe(200);

    const finalQuery = `deflection filed query ${fx.suffix}`;
    const res2 = await request(app)
      .post("/api/kb/suggestions/search")
      .set(asUser(customer))
      .send({ draftId: filedDraftId, query: finalQuery, resultCount: 2 });
    expect(res2.status).toBe(200);

    const rows = await db
      .select()
      .from(kbSearchLogTable)
      .where(eq(kbSearchLogTable.draftId, filedDraftId));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.query).toBe(finalQuery);
    expect(rows[0]!.resultCount).toBe(2);
  });

  it("rejects invalid search payloads", async () => {
    const res = await request(app)
      .post("/api/kb/suggestions/search")
      .set(asUser(customer))
      .send({ draftId: filedDraftId, query: "ab", resultCount: 0 });
    expect(res.status).toBe(400);
  });

  it("surfaces uncovered topics: zero-result and never-clicked settled drafts", async () => {
    const oldDate = new Date(Date.now() - 60 * 60 * 1000);
    const zeroQuery = `kafka broker flapping ${fx.suffix}`;
    const noClickQuery = `snowflake warehouse suspended ${fx.suffix}`;
    const activeQuery = `still typing this one ${fx.suffix}`;

    await db.insert(kbSearchLogTable).values([
      // Settled by inactivity, search returned nothing.
      {
        draftId: zeroResultDraftId,
        userId: customer.id,
        query: zeroQuery,
        resultCount: 0,
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      // Settled by inactivity, suggestions shown but never opened.
      {
        draftId: notClickedDraftId,
        userId: customer.id,
        query: noClickQuery,
        resultCount: 1,
        createdAt: oldDate,
        updatedAt: oldDate,
      },
      // Fresh draft: must NOT appear (user may still be typing).
      {
        draftId: activeDraftId,
        userId: customer.id,
        query: activeQuery,
        resultCount: 0,
      },
    ]);
    await db.insert(kbSuggestionEventsTable).values({
      draftId: notClickedDraftId,
      eventType: "impression",
      articleId: article.id,
      userId: customer.id,
      createdAt: oldDate,
    });

    const res = await request(app).get("/api/admin/kb-deflection").set(asUser(admin));
    expect(res.status).toBe(200);

    const queries = res.body.uncoveredQueries as Array<{
      query: string;
      drafts: number;
      zeroResultDrafts: number;
      lastSearchedAt: string;
    }>;

    const zero = queries.find((q) => q.query === zeroQuery);
    expect(zero).toBeDefined();
    expect(zero!.drafts).toBe(1);
    expect(zero!.zeroResultDrafts).toBe(1);

    const noClick = queries.find((q) => q.query === noClickQuery);
    expect(noClick).toBeDefined();
    expect(noClick!.drafts).toBe(1);
    expect(noClick!.zeroResultDrafts).toBe(0);

    // Clicked drafts are covered; active drafts aren't settled yet.
    expect(queries.find((q) => q.query.includes(`deflection filed query ${fx.suffix}`))).toBeUndefined();
    expect(queries.find((q) => q.query === activeQuery)).toBeUndefined();
  });

  it("blocks non-admins from deflection stats", async () => {
    const res = await request(app).get("/api/admin/kb-deflection").set(asUser(customer));
    expect(res.status).toBe(403);
  });
});
