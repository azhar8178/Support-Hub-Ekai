import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import { db, usersTable, type Organisation, type User } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Fixtures } from "./fixtures";

// Same Clerk test double as the other authz suites: the signed-in Clerk user id
// comes from the `x-test-clerk-user` header; fixture users are pre-linked via
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

let org: Organisation;
let customerWithTickets: User;
let customerNoTickets: User;
let otherCustomer: User;
let agent: User;
let admin: User;

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

beforeAll(async () => {
  org = await fx.createOrg("Customers Feature Org");

  customerWithTickets = await fx.createUser({
    name: "Zephyr Ticketful",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-cust-tickets-${fx.suffix}`,
  });
  customerNoTickets = await fx.createUser({
    name: "Quiet Newcomer",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-cust-quiet-${fx.suffix}`,
  });
  otherCustomer = await fx.createUser({
    name: "Bystander Customer",
    role: "customer",
    orgId: org.id,
    clerkUserId: `clerk-cust-other-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "Cust Feature Agent",
    role: "ekai_agent",
    clerkUserId: `clerk-cust-agent-${fx.suffix}`,
  });
  admin = await fx.createUser({
    name: "Cust Feature Admin",
    role: "admin",
    clerkUserId: `clerk-cust-admin-${fx.suffix}`,
  });

  // Two open + one closed ticket for the customer with activity.
  await fx.createTicket({ orgId: org.id, raisedById: customerWithTickets.id, status: "new" });
  await fx.createTicket({ orgId: org.id, raisedById: customerWithTickets.id, status: "in_progress" });
  await fx.createTicket({ orgId: org.id, raisedById: customerWithTickets.id, status: "closed" });
});

afterAll(async () => {
  await fx.cleanup();
});

describe("customers routes are staff-only", () => {
  const requests = [
    { name: "GET /customers", run: (h: Record<string, string>) => request(app).get("/api/customers").set(h) },
    {
      name: "GET /customers/:id",
      run: (h: Record<string, string>) =>
        request(app).get(`/api/customers/${customerWithTickets.id}`).set(h),
    },
    {
      name: "PATCH /customers/:id",
      run: (h: Record<string, string>) =>
        request(app)
          .patch(`/api/customers/${customerWithTickets.id}`)
          .set(h)
          .send({ internalNotes: "sneaky" }),
    },
  ];

  for (const endpoint of requests) {
    it(`customer gets 403 on ${endpoint.name}`, async () => {
      const res = await endpoint.run(asUser(customerWithTickets));
      expect(res.status).toBe(403);
    });
  }

  it("customer's blocked PATCH does not change the record", async () => {
    await request(app)
      .patch(`/api/customers/${customerWithTickets.id}`)
      .set(asUser(customerWithTickets))
      .send({ internalNotes: "injected by customer" });
    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, customerWithTickets.id));
    expect(row!.internalNotes).not.toBe("injected by customer");
  });
});

describe("GET /customers (list)", () => {
  it("agent sees customers with ticket aggregates and no staff users", async () => {
    const res = await request(app).get("/api/customers").set(asUser(agent));
    expect(res.status).toBe(200);
    const ids = res.body.map((c: { id: number }) => c.id);
    expect(ids).toContain(customerWithTickets.id);
    expect(ids).toContain(customerNoTickets.id);
    // Staff (agents/admins) must never appear in the customer directory.
    expect(ids).not.toContain(agent.id);
    expect(ids).not.toContain(admin.id);

    const withTickets = res.body.find((c: { id: number }) => c.id === customerWithTickets.id);
    expect(withTickets.ticketCount).toBe(3);
    expect(withTickets.openTicketCount).toBe(2);
    expect(withTickets.orgName).toBe(org.name);
    expect(withTickets.lastActivityAt).toBeTruthy();

    const noTickets = res.body.find((c: { id: number }) => c.id === customerNoTickets.id);
    expect(noTickets.ticketCount).toBe(0);
    expect(noTickets.openTicketCount).toBe(0);
  });

  it("admin can search by name", async () => {
    const res = await request(app)
      .get("/api/customers?search=Zephyr")
      .set(asUser(admin));
    expect(res.status).toBe(200);
    const ids = res.body.map((c: { id: number }) => c.id);
    expect(ids).toContain(customerWithTickets.id);
    expect(ids).not.toContain(customerNoTickets.id);
  });
});

describe("GET /customers/:id (detail)", () => {
  it("returns the customer with ticket history and notes field", async () => {
    const res = await request(app)
      .get(`/api/customers/${customerWithTickets.id}`)
      .set(asUser(agent));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(customerWithTickets.id);
    expect(res.body.ticketCount).toBe(3);
    expect(res.body.openTicketCount).toBe(2);
    expect(Array.isArray(res.body.tickets)).toBe(true);
    expect(res.body.tickets.length).toBe(3);
    expect(res.body).toHaveProperty("internalNotes");
  });

  it("returns 404 for a non-customer user id (agents are not customers)", async () => {
    const res = await request(app)
      .get(`/api/customers/${agent.id}`)
      .set(asUser(admin));
    expect(res.status).toBe(404);
  });

  it("returns 404 for an unknown id", async () => {
    const res = await request(app).get("/api/customers/99999999").set(asUser(admin));
    expect(res.status).toBe(404);
  });
});

describe("PATCH /customers/:id (maintain record)", () => {
  it("agent can update name and internal notes", async () => {
    const res = await request(app)
      .patch(`/api/customers/${otherCustomer.id}`)
      .set(asUser(agent))
      .send({ name: "Bystander (VIP)", internalNotes: "Prefers email. Renewal in Q3." });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Bystander (VIP)");
    expect(res.body.internalNotes).toBe("Prefers email. Renewal in Q3.");

    const [row] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, otherCustomer.id));
    expect(row!.name).toBe("Bystander (VIP)");
    expect(row!.internalNotes).toBe("Prefers email. Renewal in Q3.");
  });

  it("returns 404 when trying to update a non-customer", async () => {
    const res = await request(app)
      .patch(`/api/customers/${admin.id}`)
      .set(asUser(admin))
      .send({ internalNotes: "nope" });
    expect(res.status).toBe(404);
  });
});
