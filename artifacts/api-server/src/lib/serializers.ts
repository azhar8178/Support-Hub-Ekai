import {
  db,
  organisationsTable,
  ticketsTable,
  usersTable,
  type Organisation,
  type Ticket,
  type User,
} from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import { eq, type SQL } from "drizzle-orm";
import { computeSlaInfo, type SlaInfoDto } from "./sla";

export interface TicketDto {
  id: number;
  title: string;
  description: string;
  severity: string;
  status: string;
  category: string;
  environment: string;
  orgId: number;
  orgName: string;
  raisedById: number;
  raisedByName: string;
  assignedToId: number | null;
  assignedToName: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  sla: SlaInfoDto;
}

export const assigneeAlias = alias(usersTable, "assignee");

export interface TicketRow {
  ticket: Ticket;
  org: Organisation | null;
  raisedBy: User | null;
  assignee: User | null;
}

export function ticketQuery() {
  return db
    .select({
      ticket: ticketsTable,
      org: organisationsTable,
      raisedBy: usersTable,
      assignee: assigneeAlias,
    })
    .from(ticketsTable)
    .leftJoin(organisationsTable, eq(ticketsTable.orgId, organisationsTable.id))
    .leftJoin(usersTable, eq(ticketsTable.raisedById, usersTable.id))
    .leftJoin(assigneeAlias, eq(ticketsTable.assignedToId, assigneeAlias.id));
}

export function serializeTicketRow(row: TicketRow, now: Date = new Date()): TicketDto {
  const t = row.ticket;
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    severity: t.severity,
    status: t.status,
    category: t.category,
    environment: t.environment,
    orgId: t.orgId,
    orgName: row.org?.name ?? "Unknown",
    raisedById: t.raisedById,
    raisedByName: row.raisedBy?.name ?? "Unknown",
    assignedToId: t.assignedToId,
    assignedToName: row.assignee?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    firstResponseAt: t.firstResponseAt?.toISOString() ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    sla: computeSlaInfo(t, now),
  };
}

export async function loadTicketDto(id: number): Promise<TicketDto | null> {
  const rows = await ticketQuery().where(eq(ticketsTable.id, id));
  const row = rows[0];
  if (!row) return null;
  return serializeTicketRow(row);
}

export async function loadTicketsWhere(where: SQL | undefined): Promise<TicketDto[]> {
  const query = where ? ticketQuery().where(where) : ticketQuery();
  const rows = await query;
  const now = new Date();
  return rows
    .map((r) => serializeTicketRow(r, now))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function serializeUser(user: User, orgName: string | null): {
  id: number;
  email: string;
  name: string;
  role: string;
  orgId: number | null;
  orgName: string | null;
  active: boolean;
  createdAt: string;
  lastLogin: string | null;
} {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    orgId: user.orgId,
    orgName,
    active: user.active,
    createdAt: user.createdAt.toISOString(),
    lastLogin: user.lastLogin?.toISOString() ?? null,
  };
}
