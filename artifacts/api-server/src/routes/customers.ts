import { Router, type IRouter, type Request } from "express";
import {
  db,
  organisationsTable,
  ticketsTable,
  usersTable,
  type User,
} from "@workspace/db";
import { and, count, desc, eq, ilike, max, or, sql } from "drizzle-orm";
import {
  GetCustomerResponse,
  ListCustomersResponse,
  UpdateCustomerBody,
  UpdateCustomerResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { loadTicketsWhere } from "../lib/serializers";

const router: IRouter = Router();

function parseId(req: Request): number {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return parseInt(raw ?? "", 10);
}

interface CustomerStats {
  ticketCount: number;
  openTicketCount: number;
  lastActivityAt: Date | null;
}

function serializeCustomer(
  user: User,
  orgName: string | null,
  stats: CustomerStats,
): Record<string, unknown> {
  // Recognition cues: how long they've been a customer and when they were last active.
  const lastActivityAt =
    stats.lastActivityAt ?? user.lastLogin ?? user.createdAt;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    orgId: user.orgId,
    orgName,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    lastLogin: user.lastLogin?.toISOString() ?? null,
    ticketCount: stats.ticketCount,
    openTicketCount: stats.openTicketCount,
    lastActivityAt: lastActivityAt.toISOString(),
  };
}

/** List customer contacts with ticket activity (staff only). */
router.get(
  "/customers",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const search =
      typeof req.query.search === "string" ? req.query.search.trim() : "";
    const orgIdRaw =
      typeof req.query.orgId === "string" ? parseInt(req.query.orgId, 10) : NaN;

    // Per-customer ticket aggregates, grouped by the user who raised them.
    const stats = db
      .select({
        raisedById: ticketsTable.raisedById,
        ticketCount: count(ticketsTable.id).as("ticket_count"),
        openTicketCount:
          sql<number>`count(*) filter (where ${ticketsTable.status} not in ('resolved','closed'))`
            .mapWith(Number)
            .as("open_ticket_count"),
        lastActivityAt: max(ticketsTable.updatedAt).as("last_activity_at"),
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.raisedById)
      .as("stats");

    const conditions = [eq(usersTable.role, "customer")];
    if (search) {
      conditions.push(
        or(
          ilike(usersTable.name, `%${search}%`),
          ilike(usersTable.email, `%${search}%`),
        )!,
      );
    }
    if (!Number.isNaN(orgIdRaw)) {
      conditions.push(eq(usersTable.orgId, orgIdRaw));
    }

    const rows = await db
      .select({
        user: usersTable,
        org: organisationsTable,
        ticketCount: stats.ticketCount,
        openTicketCount: stats.openTicketCount,
        lastActivityAt: stats.lastActivityAt,
      })
      .from(usersTable)
      .leftJoin(organisationsTable, eq(usersTable.orgId, organisationsTable.id))
      .leftJoin(stats, eq(stats.raisedById, usersTable.id))
      .where(and(...conditions))
      .orderBy(usersTable.name);

    res.json(
      ListCustomersResponse.parse(
        rows.map((r) =>
          serializeCustomer(r.user, r.org?.name ?? null, {
            ticketCount: Number(r.ticketCount ?? 0),
            openTicketCount: Number(r.openTicketCount ?? 0),
            lastActivityAt: r.lastActivityAt ?? null,
          }),
        ),
      ),
    );
  },
);

async function loadCustomerDetail(id: number): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select({ user: usersTable, org: organisationsTable })
    .from(usersTable)
    .leftJoin(organisationsTable, eq(usersTable.orgId, organisationsTable.id))
    .where(eq(usersTable.id, id));
  if (!row || row.user.role !== "customer") return null;

  const tickets = await loadTicketsWhere(eq(ticketsTable.raisedById, id));
  const openTicketCount = tickets.filter(
    (t) => t.status !== "resolved" && t.status !== "closed",
  ).length;
  const lastActivityAt =
    tickets.reduce<string | null>((latest, t) => {
      return latest == null || t.updatedAt > latest ? t.updatedAt : latest;
    }, null) ?? null;

  const base = serializeCustomer(row.user, row.org?.name ?? null, {
    ticketCount: tickets.length,
    openTicketCount,
    lastActivityAt: lastActivityAt ? new Date(lastActivityAt) : null,
  });
  return {
    ...base,
    internalNotes: row.user.internalNotes ?? null,
    tickets,
  };
}

/** Get a customer with ticket history and internal notes (staff only). */
router.get(
  "/customers/:id",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }
    const detail = await loadCustomerDetail(id);
    if (!detail) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    res.json(GetCustomerResponse.parse(detail));
  },
);

/** Update a customer's name or internal notes (staff only). */
router.patch(
  "/customers/:id",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }
    const parsed = UpdateCustomerBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!existing || existing.role !== "customer") {
      res.status(404).json({ message: "Customer not found" });
      return;
    }

    const updates: Record<string, unknown> = {};
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.internalNotes !== undefined)
      updates.internalNotes = parsed.data.internalNotes;

    if (Object.keys(updates).length > 0) {
      await db.update(usersTable).set(updates).where(eq(usersTable.id, id));
    }

    const detail = await loadCustomerDetail(id);
    if (!detail) {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    res.json(UpdateCustomerResponse.parse(detail));
  },
);

/** Deactivate a customer account (admin only). */
router.delete(
  "/customers/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    if (Number.isNaN(id)) {
      res.status(400).json({ message: "Invalid customer id" });
      return;
    }
    const [existing] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.id, id));
    if (!existing || existing.role !== "customer") {
      res.status(404).json({ message: "Customer not found" });
      return;
    }
    await db
      .update(usersTable)
      .set({ active: false })
      .where(eq(usersTable.id, id));
    res.status(204).end();
  },
);

export default router;
