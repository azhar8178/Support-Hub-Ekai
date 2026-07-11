import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  slaConfigTable,
  ticketCategoriesTable,
  ticketEnvironmentsTable,
  type Organisation,
  type User,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { Fixtures } from "./fixtures";

// Same Clerk test double as the other suites: signed-in user id comes from the
// `x-test-clerk-user` header and fixture users are pre-linked via clerkUserId.
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
const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

let org: Organisation;
let admin: User;
let agent: User;
let customer: User;

// The fixture's createTicket always uses category "platform", environment "aws",
// and (by default) severity "P3", so we look up those seeded taxonomy rows.
let categoryId: number;
let environmentId: number;
let severityId: number;

async function usageCount(type: string, id: number, as: User): Promise<number> {
  const res = await request(app)
    .get(`/api/admin/taxonomy-usage/${type}/${id}`)
    .set(asUser(as));
  expect(res.status).toBe(200);
  return res.body.openTicketCount as number;
}

beforeAll(async () => {
  org = await fx.createOrg("Taxonomy Usage Org");
  admin = await fx.createUser({
    name: "TU Admin",
    role: "admin",
    clerkUserId: `clerk-tu-admin-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "TU Agent",
    role: "ekai_agent",
    clerkUserId: `clerk-tu-agent-${fx.suffix}`,
  });
  customer = await fx.createUser({
    name: "TU Cust",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-tu-cust-${fx.suffix}`,
  });

  const [cat] = await db
    .select()
    .from(ticketCategoriesTable)
    .where(eq(ticketCategoriesTable.key, "platform"));
  const [env] = await db
    .select()
    .from(ticketEnvironmentsTable)
    .where(eq(ticketEnvironmentsTable.key, "aws"));
  const [sev] = await db.select().from(slaConfigTable).where(eq(slaConfigTable.severity, "P3"));
  categoryId = cat!.id;
  environmentId = env!.id;
  severityId = sev!.id;
});

afterAll(async () => {
  await fx.cleanup();
});

describe("taxonomy usage count", () => {
  it("counts only open tickets, ignoring resolved and closed ones", async () => {
    const baseline = await usageCount("category", categoryId, admin);

    // Two open tickets (should be counted) ...
    await fx.createTicket({ orgId: org.id, raisedById: customer.id, status: "new" });
    await fx.createTicket({ orgId: org.id, raisedById: customer.id, status: "in_progress" });
    // ... and two closed-out tickets (should be ignored).
    await fx.createTicket({ orgId: org.id, raisedById: customer.id, status: "resolved" });
    await fx.createTicket({ orgId: org.id, raisedById: customer.id, status: "closed" });

    const after = await usageCount("category", categoryId, admin);
    expect(after - baseline).toBe(2);
  });

  it("counts open tickets for environments and severities too", async () => {
    const envBaseline = await usageCount("environment", environmentId, admin);
    const sevBaseline = await usageCount("severity", severityId, admin);

    await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      status: "triaged",
      severity: "P3",
    });

    expect((await usageCount("environment", environmentId, admin)) - envBaseline).toBe(1);
    expect((await usageCount("severity", severityId, admin)) - sevBaseline).toBe(1);
  });

  it("returns 404 for an unknown taxonomy id", async () => {
    const res = await request(app)
      .get("/api/admin/taxonomy-usage/category/99999999")
      .set(asUser(admin));
    expect(res.status).toBe(404);
  });

  it("rejects a bad taxonomy type with 400", async () => {
    const res = await request(app)
      .get(`/api/admin/taxonomy-usage/nonsense/${categoryId}`)
      .set(asUser(admin));
    expect(res.status).toBe(400);
  });

  it("is admin-only (agents and customers are forbidden)", async () => {
    const agentRes = await request(app)
      .get(`/api/admin/taxonomy-usage/category/${categoryId}`)
      .set(asUser(agent));
    expect(agentRes.status).toBe(403);

    const custRes = await request(app)
      .get(`/api/admin/taxonomy-usage/category/${categoryId}`)
      .set(asUser(customer));
    expect(custRes.status).toBe(403);
  });
});
