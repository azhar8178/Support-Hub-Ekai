import {
  db,
  organisationsTable,
  supportBundlesTable,
  ticketsTable,
  usersTable,
  type Organisation,
  type Ticket,
  type User,
} from "@workspace/db";
import { alias } from "drizzle-orm/pg-core";
import { eq, inArray, type SQL } from "drizzle-orm";
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
  raisedById: number | null;
  raisedByName: string;
  assignedToId: number | null;
  assignedToName: string | null;
  createdAt: string;
  updatedAt: string;
  firstResponseAt: string | null;
  resolvedAt: string | null;
  sla: SlaInfoDto;
  bundleCount: number;
  latestBundleStatus: string | null;
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

export function serializeTicketRow(
  row: TicketRow,
  now: Date = new Date(),
  bundleInfo?: { bundleCount: number; latestBundleStatus: string | null },
): TicketDto {
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
    raisedById: t.raisedById ?? null,
    raisedByName: row.raisedBy?.name ?? "System",
    assignedToId: t.assignedToId,
    assignedToName: row.assignee?.name ?? null,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    firstResponseAt: t.firstResponseAt?.toISOString() ?? null,
    resolvedAt: t.resolvedAt?.toISOString() ?? null,
    sla: computeSlaInfo(t, now),
    bundleCount: bundleInfo?.bundleCount ?? 0,
    latestBundleStatus: bundleInfo?.latestBundleStatus ?? null,
  };
}

/** Fetch bundle summary info (count + latest status) for a set of ticket IDs. */
async function loadBundleInfoMap(
  ticketIds: number[],
): Promise<Map<number, { bundleCount: number; latestBundleStatus: string | null }>> {
  const map = new Map<number, { bundleCount: number; latestBundleStatus: string | null }>();
  if (ticketIds.length === 0) return map;

  const bundles = await db
    .select({
      ticketId: supportBundlesTable.ticketId,
      overallStatus: supportBundlesTable.overallStatus,
      uploadedAt: supportBundlesTable.uploadedAt,
    })
    .from(supportBundlesTable)
    .where(inArray(supportBundlesTable.ticketId, ticketIds));

  // Sort DESC so the first occurrence per ticket is the most recent
  bundles.sort((a, b) => b.uploadedAt.getTime() - a.uploadedAt.getTime());

  for (const b of bundles) {
    const existing = map.get(b.ticketId);
    if (!existing) {
      map.set(b.ticketId, { bundleCount: 1, latestBundleStatus: b.overallStatus });
    } else {
      existing.bundleCount++;
    }
  }
  return map;
}

export async function loadTicketDto(id: number): Promise<TicketDto | null> {
  const rows = await ticketQuery().where(eq(ticketsTable.id, id));
  const row = rows[0];
  if (!row) return null;
  const bundleMap = await loadBundleInfoMap([row.ticket.id]);
  return serializeTicketRow(row, new Date(), bundleMap.get(row.ticket.id));
}

export async function loadTicketsWhere(where: SQL | undefined): Promise<TicketDto[]> {
  const query = where ? ticketQuery().where(where) : ticketQuery();
  const rows = await query;
  const now = new Date();
  const ticketIds = rows.map((r) => r.ticket.id);
  const bundleMap = await loadBundleInfoMap(ticketIds);
  return rows
    .map((r) => serializeTicketRow(r, now, bundleMap.get(r.ticket.id)))
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
  setupWizardDismissed: boolean;
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
    // Guard against schema drift: if the column doesn't exist in the deployed
    // DB yet, drizzle returns undefined; default to false so Zod never rejects.
    setupWizardDismissed: user.setupWizardDismissed ?? false,
  };
}
