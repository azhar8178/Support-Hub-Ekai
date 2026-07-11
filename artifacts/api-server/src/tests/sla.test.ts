import { describe, it, expect, afterAll } from "vitest";
import { db, ticketsTable, type Ticket } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  addBusinessMinutes,
  businessMinutesBetween,
  nextBusinessMoment,
} from "../lib/businessHours";
import { computeSlaInfo, shiftDeadlineForPause } from "../lib/sla";
import { applyStatusChange } from "../lib/ticketActions";
import { Fixtures } from "./fixtures";

const fx = new Fixtures();

afterAll(async () => {
  await fx.cleanup();
});

// Fixed reference dates (UTC). 2026-07-06 is a Monday.
const mon10 = new Date("2026-07-06T10:00:00Z");
const fri17 = new Date("2026-07-10T17:00:00Z");
const sat12 = new Date("2026-07-11T12:00:00Z");
const nextMon10 = new Date("2026-07-13T10:00:00Z");

describe("business-hours engine", () => {
  it("nextBusinessMoment skips weekends and nights", () => {
    expect(nextBusinessMoment(sat12).toISOString()).toBe("2026-07-13T09:00:00.000Z");
    expect(nextBusinessMoment(new Date("2026-07-06T07:30:00Z")).toISOString()).toBe(
      "2026-07-06T09:00:00.000Z",
    );
    expect(nextBusinessMoment(new Date("2026-07-06T19:00:00Z")).toISOString()).toBe(
      "2026-07-07T09:00:00.000Z",
    );
    // Already inside business hours: unchanged.
    expect(nextBusinessMoment(mon10).toISOString()).toBe(mon10.toISOString());
  });

  it("addBusinessMinutes rolls over end of day and weekends", () => {
    // Mon 10:00 + 60 min = Mon 11:00
    expect(addBusinessMinutes(mon10, 60).toISOString()).toBe("2026-07-06T11:00:00.000Z");
    // Fri 17:00 + 120 min = 60 min Fri + 60 min Mon => Mon 10:00
    expect(addBusinessMinutes(fri17, 120).toISOString()).toBe(nextMon10.toISOString());
  });

  it("businessMinutesBetween ignores nights and weekends", () => {
    // Fri 17:00 -> next Mon 10:00 = 60 (Fri) + 60 (Mon) business minutes
    expect(businessMinutesBetween(fri17, nextMon10)).toBe(120);
    // Entirely within a weekend: zero
    expect(businessMinutesBetween(sat12, new Date("2026-07-12T12:00:00Z"))).toBe(0);
    expect(businessMinutesBetween(nextMon10, fri17)).toBe(0); // b <= a
  });
});

describe("shiftDeadlineForPause", () => {
  it("24x7: shifts by exact wall-clock pause duration", () => {
    const deadline = new Date("2026-07-06T12:00:00Z");
    const pausedAt = new Date("2026-07-06T10:00:00Z");
    const resumedAt = new Date("2026-07-06T10:45:00Z");
    expect(shiftDeadlineForPause(deadline, pausedAt, resumedAt, true).toISOString()).toBe(
      "2026-07-06T12:45:00.000Z",
    );
  });

  it("business hours: a pause across a weekend only shifts by business minutes", () => {
    const deadline = new Date("2026-07-13T12:00:00Z"); // Mon noon
    // Paused Fri 17:00, resumed next Mon 10:00 => 120 business minutes paused.
    const shifted = shiftDeadlineForPause(deadline, fri17, nextMon10, false);
    expect(shifted.toISOString()).toBe("2026-07-13T14:00:00.000Z");
  });

  it("business hours: pause entirely inside a weekend shifts nothing", () => {
    const deadline = new Date("2026-07-13T12:00:00Z");
    const shifted = shiftDeadlineForPause(
      deadline,
      sat12,
      new Date("2026-07-12T15:00:00Z"),
      false,
    );
    expect(shifted.toISOString()).toBe(deadline.toISOString());
  });
});

describe("computeSlaInfo pause presentation", () => {
  const baseTicket = (overrides: Partial<Ticket>): Ticket =>
    ({
      id: 1,
      title: "t",
      description: "d",
      severity: "P1",
      status: "in_progress",
      category: "platform",
      environment: "aws",
      orgId: 1,
      raisedById: 1,
      assignedToId: null,
      createdAt: new Date("2026-07-06T10:00:00Z"),
      updatedAt: new Date("2026-07-06T10:00:00Z"),
      firstResponseAt: null,
      resolvedAt: null,
      responseDeadline: new Date("2026-07-06T10:15:00Z"),
      resolutionDeadline: new Date("2026-07-06T14:00:00Z"),
      slaPausedAt: null,
      slaWarningNotified: false,
      ...overrides,
    }) as Ticket;

  it("reports paused only while awaiting_customer with a pause timestamp", () => {
    const paused = computeSlaInfo(
      baseTicket({ status: "awaiting_customer", slaPausedAt: new Date("2026-07-06T10:05:00Z") }),
      new Date("2026-07-06T11:00:00Z"),
    );
    expect(paused.paused).toBe(true);
    // Clock is frozen at the pause moment: deadline not treated as breached
    // even though "now" is past it.
    expect(paused.responseBreached).toBe(false);

    const notPaused = computeSlaInfo(
      baseTicket({ status: "in_progress", slaPausedAt: new Date("2026-07-06T10:05:00Z") }),
      new Date("2026-07-06T11:00:00Z"),
    );
    expect(notPaused.paused).toBe(false);
    expect(notPaused.responseBreached).toBe(true);
  });
});

describe("applyStatusChange SLA pause/resume (integration)", () => {
  it("pauses on awaiting_customer and shifts deadlines on resume (24x7 P1)", async () => {
    const org = await fx.createOrg("SLA Org");
    const customer = await fx.createUser({ name: "Sla Cust", role: "customer", orgId: org.id });
    const agent = await fx.createUser({ name: "Sla Agent", role: "ekai_agent" });

    const now = Date.now();
    const responseDeadline = new Date(now + 15 * 60_000);
    const resolutionDeadline = new Date(now + 240 * 60_000);
    const ticket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      severity: "P1", // seeded as 24x7
      status: "in_progress",
      responseDeadline,
      resolutionDeadline,
    });

    // Enter awaiting_customer: SLA clock pauses.
    const pausedTicket = await applyStatusChange(ticket, "awaiting_customer", agent);
    expect(pausedTicket.status).toBe("awaiting_customer");
    expect(pausedTicket.slaPausedAt).not.toBeNull();
    // Deadlines untouched while paused.
    expect(pausedTicket.responseDeadline!.getTime()).toBe(responseDeadline.getTime());
    expect(pausedTicket.resolutionDeadline!.getTime()).toBe(resolutionDeadline.getTime());

    // Backdate the pause by 60 minutes so the resume shift is measurable.
    const backdatedPause = new Date(Date.now() - 60 * 60_000);
    await db
      .update(ticketsTable)
      .set({ slaPausedAt: backdatedPause })
      .where(eq(ticketsTable.id, ticket.id));
    const [fresh] = await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticket.id));

    // Resume: deadlines must shift forward by the paused duration (~60 min).
    const resumed = await applyStatusChange(fresh!, "in_progress", customer);
    expect(resumed.status).toBe("in_progress");
    expect(resumed.slaPausedAt).toBeNull();

    const shiftMs = resumed.responseDeadline!.getTime() - responseDeadline.getTime();
    expect(shiftMs).toBeGreaterThanOrEqual(59 * 60_000);
    expect(shiftMs).toBeLessThanOrEqual(61 * 60_000);

    const resShiftMs = resumed.resolutionDeadline!.getTime() - resolutionDeadline.getTime();
    expect(resShiftMs).toBeGreaterThanOrEqual(59 * 60_000);
    expect(resShiftMs).toBeLessThanOrEqual(61 * 60_000);
  });

  it("does not shift the response deadline once first response happened", async () => {
    const org = await fx.createOrg("SLA Org 2");
    const customer = await fx.createUser({ name: "Sla Cust2", role: "customer", orgId: org.id });
    const agent = await fx.createUser({ name: "Sla Agent2", role: "ekai_agent" });

    const now = Date.now();
    const responseDeadline = new Date(now + 15 * 60_000);
    const resolutionDeadline = new Date(now + 240 * 60_000);
    const ticket = await fx.createTicket({
      orgId: org.id,
      raisedById: customer.id,
      severity: "P1",
      status: "awaiting_customer",
      responseDeadline,
      resolutionDeadline,
      firstResponseAt: new Date(now - 5 * 60_000),
      slaPausedAt: new Date(now - 30 * 60_000),
    });

    const resumed = await applyStatusChange(ticket, "in_progress", agent);
    // Response SLA already satisfied: its deadline stays put.
    expect(resumed.responseDeadline!.getTime()).toBe(responseDeadline.getTime());
    // Resolution deadline still shifts (~30 min).
    const shiftMs = resumed.resolutionDeadline!.getTime() - resolutionDeadline.getTime();
    expect(shiftMs).toBeGreaterThanOrEqual(29 * 60_000);
    expect(shiftMs).toBeLessThanOrEqual(31 * 60_000);
  });
});
