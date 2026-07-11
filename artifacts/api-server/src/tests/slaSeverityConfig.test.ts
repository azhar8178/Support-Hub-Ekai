import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  notificationsTable,
  ticketStatusHistoryTable,
  ticketsTable,
  slaConfigTable,
  type Organisation,
  type User,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { Fixtures } from "./fixtures";
import {
  computeSlaInfo,
  getSeverityRank,
  getTopSeverityRank,
  isUrgentSeverity,
  isUse24x7,
  refreshSlaClockCache,
} from "../lib/sla";

// Same Clerk test double as the other HTTP suites: the signed-in user id is
// taken from the `x-test-clerk-user` header and resolved against pre-linked
// portal users, so requireAuth resolves without any real Clerk call.
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
let agent: User;
let admin: User;

// sla_config rows and HTTP-filed tickets are not tracked by Fixtures, so we
// track them here and tear them down explicitly.
const createdSeverityIds: number[] = [];
const httpTicketIds: number[] = [];

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

interface SeverityInput {
  key: string;
  label: string;
  isUrgent: boolean;
  use24x7: boolean;
  firstResponseMinutes: number;
  resolutionMinutes: number | null;
  resolutionOptional?: boolean;
  rank?: number;
}

interface SeverityRow {
  id: number;
  key: string;
  label: string;
  rank: number;
  isUrgent: boolean;
  use24x7: boolean;
  active: boolean;
}

async function createSeverity(input: SeverityInput): Promise<SeverityRow> {
  const res = await request(app).post("/api/admin/severities").set(asUser(admin)).send(input);
  expect(res.status).toBe(201);
  createdSeverityIds.push(res.body.id);
  return res.body as SeverityRow;
}

beforeAll(async () => {
  org = await fx.createOrg("Sev Config Org");
  customer = await fx.createUser({
    name: "Sev Cust",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-sev-cust-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "Sev Agent",
    role: "ekai_agent",
    clerkUserId: `clerk-sev-agent-${fx.suffix}`,
  });
  admin = await fx.createUser({
    name: "Sev Admin",
    role: "admin",
    clerkUserId: `clerk-sev-admin-${fx.suffix}`,
  });
});

afterAll(async () => {
  // HTTP-filed tickets: clear FK referencers first, then the tickets.
  if (httpTicketIds.length > 0) {
    await db.delete(notificationsTable).where(inArray(notificationsTable.ticketId, httpTicketIds));
    await db
      .delete(ticketStatusHistoryTable)
      .where(inArray(ticketStatusHistoryTable.ticketId, httpTicketIds));
    await db.delete(ticketsTable).where(inArray(ticketsTable.id, httpTicketIds));
  }
  await fx.cleanup();
  if (createdSeverityIds.length > 0) {
    await db.delete(slaConfigTable).where(inArray(slaConfigTable.id, createdSeverityIds));
  }
  // Restore the module cache to match the (now cleaned) DB so other suites in
  // the same worker don't see our test severities.
  await refreshSlaClockCache();
});

describe("SLA deadlines + urgent alert follow an admin-created severity's config", () => {
  it("computes deadlines and fires the critical-ticket alert for an urgent 24x7 severity", async () => {
    // The route slugifies the key, so always use the stored key it returns.
    const { key } = await createSeverity({
      key: `sev_urgent_${fx.suffix}`,
      label: "Urgent Custom",
      isUrgent: true,
      use24x7: true,
      firstResponseMinutes: 30,
      resolutionMinutes: 120,
    });

    const filed = await request(app).post("/api/tickets").set(asUser(customer)).send({
      title: "Custom urgent severity ticket",
      description: "exercising de-hardcoded severity config",
      severity: key,
      category: "platform",
      environment: "aws",
    });
    expect(filed.status).toBe(201);
    const ticketId = filed.body.id as number;
    httpTicketIds.push(ticketId);

    // Deadlines follow the severity's config: 24x7 => wall-clock offsets from
    // creation (30 min response, 120 min resolution). Allow a small skew
    // between the route's clock and the DB's defaultNow().
    const createdAt = new Date(filed.body.createdAt).getTime();
    const respGap = new Date(filed.body.sla.responseDeadline).getTime() - createdAt;
    const resGap = new Date(filed.body.sla.resolutionDeadline).getTime() - createdAt;
    expect(respGap).toBeGreaterThanOrEqual(30 * 60_000 - 3_000);
    expect(respGap).toBeLessThanOrEqual(30 * 60_000 + 3_000);
    expect(resGap).toBeGreaterThanOrEqual(120 * 60_000 - 3_000);
    expect(resGap).toBeLessThanOrEqual(120 * 60_000 + 3_000);

    // Urgent alert path: staff receive a `new_critical_ticket` notification.
    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.ticketId, ticketId));
    const staffCritical = notifs.filter((n) => n.type === "new_critical_ticket");
    const staffCriticalIds = staffCritical.map((n) => n.userId);
    expect(staffCriticalIds).toContain(agent.id);
    expect(staffCriticalIds).toContain(admin.id);
    // The raiser gets a confirmation, never the critical alert.
    expect(staffCriticalIds).not.toContain(customer.id);
    expect(notifs.some((n) => n.type === "ticket_created" && n.userId === customer.id)).toBe(true);
  });

  it("does NOT fire the critical alert for a non-urgent severity", async () => {
    const { key } = await createSeverity({
      key: `sev_calm_${fx.suffix}`,
      label: "Calm Custom",
      isUrgent: false,
      use24x7: false,
      firstResponseMinutes: 240,
      resolutionMinutes: 1440,
    });

    const filed = await request(app).post("/api/tickets").set(asUser(customer)).send({
      title: "Custom non-urgent severity ticket",
      description: "should not alert staff as critical",
      severity: key,
      category: "platform",
      environment: "aws",
    });
    expect(filed.status).toBe(201);
    const ticketId = filed.body.id as number;
    httpTicketIds.push(ticketId);

    const notifs = await db
      .select()
      .from(notificationsTable)
      .where(eq(notificationsTable.ticketId, ticketId));
    expect(notifs.some((n) => n.type === "new_critical_ticket")).toBe(false);
    // Staff still get a normal ticket_created heads-up.
    const staffCreated = notifs.filter(
      (n) => n.type === "ticket_created" && (n.userId === agent.id || n.userId === admin.id),
    );
    expect(staffCreated.length).toBeGreaterThanOrEqual(2);
  });
});

describe("retiring the top severity keeps ranking and existing-ticket SLA correct", () => {
  it("dashboard top-severity count rolls to the next active severity; retired tickets still resolve", async () => {
    // Two custom severities that occupy the most-severe ranks across the whole
    // taxonomy (lower rank = more severe; seeded P1 is rank 1).
    const top = await createSeverity({
      key: `sev_top_${fx.suffix}`,
      label: "Top Custom",
      isUrgent: true,
      use24x7: true,
      firstResponseMinutes: 15,
      resolutionMinutes: 60,
      rank: -100,
    });
    const next = await createSeverity({
      key: `sev_next_${fx.suffix}`,
      label: "Next Custom",
      isUrgent: true,
      use24x7: false,
      firstResponseMinutes: 60,
      resolutionMinutes: 240,
      rank: -99,
    });
    const topKey = top.key;
    const nextKey = next.key;

    const now = Date.now();
    // An existing OPEN ticket at the top severity, already past its response
    // deadline with no first response (so it is breached).
    const topTicket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      severity: topKey,
      status: "new",
      responseDeadline: new Date(now - 60 * 60_000),
      resolutionDeadline: new Date(now + 60 * 60_000),
    });
    // Two existing OPEN tickets at the next severity.
    await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      severity: nextKey,
      status: "new",
      responseDeadline: new Date(now + 30 * 60_000),
      resolutionDeadline: new Date(now + 180 * 60_000),
    });
    await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      severity: nextKey,
      status: "triaged",
      responseDeadline: new Date(now + 30 * 60_000),
      resolutionDeadline: new Date(now + 180 * 60_000),
    });

    // Before retiring: the top active rank is our custom top severity.
    expect(getTopSeverityRank()).toBe(-100);
    const before = await request(app).get("/api/agent/metrics").set(asUser(agent));
    expect(before.status).toBe(200);
    // The top-severity open count includes our open top-severity ticket.
    expect(before.body.openP1Count).toBeGreaterThanOrEqual(1);

    // Retire the top severity.
    const retire = await request(app)
      .patch(`/api/admin/severities/${top.id}`)
      .set(asUser(admin))
      .send({ active: false });
    expect(retire.status).toBe(200);
    expect(retire.body.active).toBe(false);

    // Top rank rolls forward to the next active severity — not to nothing.
    expect(getTopSeverityRank()).toBe(-99);
    const after = await request(app).get("/api/agent/metrics").set(asUser(agent));
    expect(after.status).toBe(200);
    // Count now reflects the two open tickets at the next (now top) severity,
    // and crucially did not collapse to 0.
    expect(after.body.openP1Count).toBeGreaterThanOrEqual(2);

    // The retired severity's metadata is still resolvable for existing tickets:
    // urgency, 24x7 clock and rank all survive retirement.
    expect(isUrgentSeverity(topKey)).toBe(true);
    expect(isUse24x7(topKey)).toBe(true);
    expect(getSeverityRank(topKey)).toBe(-100);

    // And SLA math still evaluates correctly for the retired-severity ticket.
    const [freshTop] = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.id, topTicket.id));
    const sla = computeSlaInfo(freshTop!, new Date());
    expect(sla.responseBreached).toBe(true);
    expect(sla.resolutionBreached).toBe(false);

    // The next severity is genuinely urgent per its config (sanity on the roll).
    expect(isUrgentSeverity(nextKey)).toBe(true);
    expect(next.rank).toBe(-99);
  });
});

describe("renaming a severity keeps existing tickets' metadata", () => {
  it("relabels without touching the stored severity key or its runtime config", async () => {
    const created = await createSeverity({
      key: `sev_rename_${fx.suffix}`,
      label: "Original Label",
      isUrgent: false,
      use24x7: false,
      firstResponseMinutes: 120,
      resolutionMinutes: 480,
    });
    const key = created.key;
    const rank = created.rank;

    const ticket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      severity: key,
      status: "in_progress",
      responseDeadline: new Date(Date.now() + 60 * 60_000),
      resolutionDeadline: new Date(Date.now() + 240 * 60_000),
    });

    const patch = await request(app)
      .patch(`/api/admin/severities/${created.id}`)
      .set(asUser(admin))
      .send({ label: "Renamed Label" });
    expect(patch.status).toBe(200);
    expect(patch.body.label).toBe("Renamed Label");
    // Rename changes the display label only — the stable key is untouched.
    expect(patch.body.key).toBe(key);

    // The existing ticket still carries the same severity key (its metadata).
    const [fresh] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticket.id));
    expect(fresh!.severity).toBe(key);

    // Runtime config for the key is unchanged after the rename.
    expect(getSeverityRank(key)).toBe(rank);
    expect(isUrgentSeverity(key)).toBe(false);

    // Listing reflects the new label under the same key.
    const list = await request(app).get("/api/admin/severities").set(asUser(admin));
    expect(list.status).toBe(200);
    const row = list.body.find((s: { key: string }) => s.key === key);
    expect(row.label).toBe("Renamed Label");
  });
});
