import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import {
  db,
  ticketMessagesTable,
  type Organisation,
  type Ticket,
  type TicketAttachment,
  type TicketMessage,
  type User,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { Fixtures } from "./fixtures";

// Replace Clerk with a test double: the signed-in Clerk user id is taken
// from the `x-test-clerk-user` header. Portal users in the fixtures are
// pre-linked via clerkUserId, so requireAuth's fast path resolves them
// without any Clerk API call. Unknown ids resolve to an email that is not
// invited, exercising the "not invited" branch.
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
let custA: User;
let custB: User;
let agent: User;
let deactivated: User;

let ticketA: Ticket;
let ticketB: Ticket;
let closedTicketA: Ticket;

let publicMsg: TicketMessage;
let internalMsg: TicketMessage;
let publicAttachment: TicketAttachment;
let internalAttachment: TicketAttachment;
let crossOrgAttachment: TicketAttachment;

const asUser = (u: User) => ({ "x-test-clerk-user": u.clerkUserId! });

beforeAll(async () => {
  orgA = await fx.createOrg("Org A");
  orgB = await fx.createOrg("Org B");

  custA = await fx.createUser({
    name: "Cust A",
    role: "customer",
    orgId: orgA.id,
    clerkUserId: `clerk-custA-${fx.suffix}`,
  });
  custB = await fx.createUser({
    name: "Cust B",
    role: "customer",
    orgId: orgB.id,
    clerkUserId: `clerk-custB-${fx.suffix}`,
  });
  agent = await fx.createUser({
    name: "Agent",
    role: "ekai_agent",
    clerkUserId: `clerk-agent-${fx.suffix}`,
  });
  deactivated = await fx.createUser({
    name: "Deactivated",
    role: "customer",
    orgId: orgA.id,
    clerkUserId: `clerk-deactivated-${fx.suffix}`,
    active: false,
  });

  ticketA = await fx.createTicket({ orgId: orgA.id, raisedById: custA.id });
  ticketB = await fx.createTicket({ orgId: orgB.id, raisedById: custB.id });
  closedTicketA = await fx.createTicket({
    orgId: orgA.id,
    raisedById: custA.id,
    status: "closed",
  });

  publicMsg = await fx.createMessage({
    ticketId: ticketA.id,
    authorId: agent.id,
    content: "public reply",
  });
  internalMsg = await fx.createMessage({
    ticketId: ticketA.id,
    authorId: agent.id,
    content: "STAFF ONLY internal note",
    isInternal: true,
  });
  publicAttachment = await fx.createAttachment({
    ticketId: ticketA.id,
    messageId: publicMsg.id,
    filename: "public.txt",
  });
  internalAttachment = await fx.createAttachment({
    ticketId: ticketA.id,
    messageId: internalMsg.id,
    filename: "internal-secret.txt",
  });
  crossOrgAttachment = await fx.createAttachment({
    ticketId: ticketB.id,
    filename: "other-org.txt",
  });
});

afterAll(async () => {
  await fx.cleanup();
});

describe("authentication gates", () => {
  it("rejects unauthenticated requests with 401", async () => {
    const res = await request(app).get("/api/tickets");
    expect(res.status).toBe(401);
  });

  it("rejects a signed-in Clerk user who was never invited with 403", async () => {
    const res = await request(app)
      .get("/api/tickets")
      .set("x-test-clerk-user", `clerk-ghost-${fx.suffix}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_invited");
  });

  it("rejects a deactivated user with 403", async () => {
    const res = await request(app).get("/api/tickets").set(asUser(deactivated));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("deactivated");
  });
});

describe("org scoping", () => {
  it("customer list never includes another org's tickets", async () => {
    const res = await request(app).get("/api/tickets").set(asUser(custA));
    expect(res.status).toBe(200);
    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(ticketA.id);
    expect(ids).not.toContain(ticketB.id);
  });

  it("customer cannot filter their way into another org (orgId param is ignored)", async () => {
    const res = await request(app)
      .get(`/api/tickets?orgId=${orgB.id}`)
      .set(asUser(custA));
    expect(res.status).toBe(200);
    const ids = res.body.map((t: { id: number }) => t.id);
    expect(ids).not.toContain(ticketB.id);
  });

  it("customer reading another org's ticket gets 404 (no existence leak)", async () => {
    const res = await request(app).get(`/api/tickets/${ticketB.id}`).set(asUser(custA));
    expect(res.status).toBe(404);
  });

  it("customer cannot post messages on another org's ticket", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketB.id}/messages`)
      .set(asUser(custA))
      .send({ content: "hi" });
    expect(res.status).toBe(404);
  });

  it("customer cannot upload attachments to another org's ticket", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketB.id}/attachments`)
      .set(asUser(custA))
      .send({ filename: "x.txt", contentType: "text/plain", data: "aGVsbG8=" });
    expect(res.status).toBe(404);
  });

  it("staff can read any org's ticket", async () => {
    const res = await request(app).get(`/api/tickets/${ticketB.id}`).set(asUser(agent));
    expect(res.status).toBe(200);
    expect(res.body.ticket.id).toBe(ticketB.id);
  });
});

describe("internal notes and their attachments", () => {
  it("customer detail view hides internal messages and their attachments", async () => {
    const res = await request(app).get(`/api/tickets/${ticketA.id}`).set(asUser(custA));
    expect(res.status).toBe(200);

    const messageIds = res.body.messages.map((m: { id: number }) => m.id);
    expect(messageIds).toContain(publicMsg.id);
    expect(messageIds).not.toContain(internalMsg.id);
    expect(JSON.stringify(res.body)).not.toContain("STAFF ONLY");

    const attachmentIds = res.body.attachments.map((a: { id: number }) => a.id);
    expect(attachmentIds).toContain(publicAttachment.id);
    expect(attachmentIds).not.toContain(internalAttachment.id);
  });

  it("staff detail view includes internal messages and their attachments", async () => {
    const res = await request(app).get(`/api/tickets/${ticketA.id}`).set(asUser(agent));
    expect(res.status).toBe(200);
    const messageIds = res.body.messages.map((m: { id: number }) => m.id);
    expect(messageIds).toContain(internalMsg.id);
    const attachmentIds = res.body.attachments.map((a: { id: number }) => a.id);
    expect(attachmentIds).toContain(internalAttachment.id);
  });

  it("customer cannot download an internal-note attachment's content", async () => {
    const res = await request(app)
      .get(`/api/attachments/${internalAttachment.id}/content`)
      .set(asUser(custA));
    expect(res.status).toBe(404);
  });

  it("customer cannot download another org's attachment content", async () => {
    const res = await request(app)
      .get(`/api/attachments/${crossOrgAttachment.id}/content`)
      .set(asUser(custA));
    expect(res.status).toBe(404);
  });

  it("customer can download a public attachment; staff can download internal", async () => {
    const pub = await request(app)
      .get(`/api/attachments/${publicAttachment.id}/content`)
      .set(asUser(custA));
    expect(pub.status).toBe(200);
    expect(pub.body.data).toBe("aGVsbG8=");

    const int = await request(app)
      .get(`/api/attachments/${internalAttachment.id}/content`)
      .set(asUser(agent));
    expect(int.status).toBe(200);
  });

  it("customer posting isInternal=true is stored as a public message", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketA.id}/messages`)
      .set(asUser(custA))
      .send({ content: "customer trying to post internal", isInternal: true });
    expect(res.status).toBe(201);
    expect(res.body.isInternal).toBe(false);

    const [stored] = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.id, res.body.id));
    expect(stored!.isInternal).toBe(false);
  });

  it("customer cannot link an attachment to an internal message", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketA.id}/attachments`)
      .set(asUser(custA))
      .send({
        filename: "x.txt",
        contentType: "text/plain",
        data: "aGVsbG8=",
        messageId: internalMsg.id,
      });
    expect(res.status).toBe(400);
  });
});

describe("role restrictions", () => {
  it("customer cannot change ticket status", async () => {
    const res = await request(app)
      .post(`/api/tickets/${ticketA.id}/status`)
      .set(asUser(custA))
      .send({ status: "resolved" });
    expect(res.status).toBe(403);
  });

  it("customer cannot assign tickets or bulk-update", async () => {
    const assign = await request(app)
      .post(`/api/tickets/${ticketA.id}/assign`)
      .set(asUser(custA))
      .send({ assignedToId: agent.id });
    expect(assign.status).toBe(403);

    const bulk = await request(app)
      .post("/api/tickets/bulk")
      .set(asUser(custA))
      .send({ ticketIds: [ticketA.id], status: "closed" });
    expect(bulk.status).toBe(403);
  });
});

describe("closed tickets are read-only", () => {
  it("rejects new messages on a closed ticket", async () => {
    const res = await request(app)
      .post(`/api/tickets/${closedTicketA.id}/messages`)
      .set(asUser(custA))
      .send({ content: "hello?" });
    expect(res.status).toBe(400);
  });

  it("rejects new attachments on a closed ticket", async () => {
    const res = await request(app)
      .post(`/api/tickets/${closedTicketA.id}/attachments`)
      .set(asUser(custA))
      .send({ filename: "x.txt", contentType: "text/plain", data: "aGVsbG8=" });
    expect(res.status).toBe(400);
  });

  it("rejects status changes on a closed ticket even for staff", async () => {
    const res = await request(app)
      .post(`/api/tickets/${closedTicketA.id}/status`)
      .set(asUser(agent))
      .send({ status: "in_progress" });
    expect(res.status).toBe(400);
  });
});
