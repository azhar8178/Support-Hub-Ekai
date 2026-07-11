import {
  db,
  invitesTable,
  kbArticlesTable,
  organisationsTable,
  slaConfigTable,
  ticketMessagesTable,
  ticketsTable,
  ticketStatusHistoryTable,
  usersTable,
  type TicketStatus,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { computeInitialDeadlines } from "./sla";
import { logger } from "./logger";

/** Ensure SLA config rows exist (idempotent, safe on every boot). */
export async function ensureSlaConfig(): Promise<void> {
  const defaults = [
    { severity: "P1" as const, firstResponseMinutes: 15, resolutionMinutes: 240, use24x7: true },
    { severity: "P2" as const, firstResponseMinutes: 60, resolutionMinutes: 480, use24x7: false },
    { severity: "P3" as const, firstResponseMinutes: 240, resolutionMinutes: 1440, use24x7: false },
    { severity: "P4" as const, firstResponseMinutes: 540, resolutionMinutes: null, use24x7: false },
  ];
  for (const row of defaults) {
    await db.insert(slaConfigTable).values(row).onConflictDoNothing();
  }
}

/** Seed demo data on first boot (skipped when users already exist). */
export async function seedIfEmpty(): Promise<void> {
  await ensureSlaConfig();

  const existing = await db.select().from(usersTable).limit(1);
  if (existing.length > 0) return;

  logger.info("seeding initial data");

  const [acme] = await db
    .insert(organisationsTable)
    .values({ name: "Northwind Analytics", domain: "northwind-analytics.com" })
    .returning();
  const [globex] = await db
    .insert(organisationsTable)
    .values({ name: "Meridian Financial", domain: "meridianfin.com" })
    .returning();

  const [admin] = await db
    .insert(usersTable)
    .values({ email: "admin@ekai.ai", name: "Ekai Admin", role: "admin" })
    .returning();
  const [agent] = await db
    .insert(usersTable)
    .values({ email: "support@ekai.ai", name: "Sasha Reyes", role: "ekai_agent" })
    .returning();
  const [customer1] = await db
    .insert(usersTable)
    .values({
      email: "dana@northwind-analytics.com",
      name: "Dana Whitfield",
      role: "customer",
      orgId: acme!.id,
    })
    .returning();
  const [customer2] = await db
    .insert(usersTable)
    .values({
      email: "marcus@meridianfin.com",
      name: "Marcus Chen",
      role: "customer",
      orgId: globex!.id,
    })
    .returning();

  const hoursAgo = (h: number): Date => new Date(Date.now() - h * 3600_000);

  const seedTickets: Array<{
    title: string;
    description: string;
    severity: "P1" | "P2" | "P3" | "P4";
    status: TicketStatus;
    category: "infrastructure" | "platform" | "configuration" | "billing" | "other";
    environment: "aws" | "azure" | "gcp" | "snowflake" | "multiple";
    orgId: number;
    raisedById: number;
    assignedToId: number | null;
    createdAt: Date;
    firstResponseAt: Date | null;
    resolvedAt: Date | null;
    messages: Array<{ authorId: number; content: string; isInternal?: boolean; at: Date }>;
    history: Array<{ toStatus: TicketStatus; byId: number | null; at: Date }>;
  }> = [
    {
      title: "Semantic layer queries timing out against Snowflake",
      description:
        "Since this morning all semantic model queries routed through the Ekai layer against our Snowflake warehouse are timing out after 60 seconds. Our downstream agent workflows are failing. This is blocking our production reporting agents.",
      severity: "P1",
      status: "in_progress",
      category: "platform",
      environment: "snowflake",
      orgId: acme!.id,
      raisedById: customer1!.id,
      assignedToId: agent!.id,
      createdAt: hoursAgo(3),
      firstResponseAt: hoursAgo(2.9),
      resolvedAt: null,
      messages: [
        {
          authorId: customer1!.id,
          content:
            "Adding detail: the timeouts started around 06:30 UTC. Direct Snowflake queries work fine, so it looks specific to the Ekai routing layer.",
          at: hoursAgo(2.95),
        },
        {
          authorId: agent!.id,
          content:
            "Thanks Dana - we can reproduce this and have identified elevated latency in the query planner for Snowflake connections. Engineering is rolling back a planner change now. Next update within 30 minutes.",
          at: hoursAgo(2.9),
        },
        {
          authorId: agent!.id,
          content: "Planner rollback is at 60%. Error rate is already dropping in their region.",
          isInternal: true,
          at: hoursAgo(2.5),
        },
      ],
      history: [
        { toStatus: "new", byId: customer1!.id, at: hoursAgo(3) },
        { toStatus: "triaged", byId: agent!.id, at: hoursAgo(2.95) },
        { toStatus: "in_progress", byId: agent!.id, at: hoursAgo(2.9) },
      ],
    },
    {
      title: "Model sync failing for new Azure Synapse workspace",
      description:
        "We connected a new Azure Synapse workspace yesterday and the initial semantic model sync keeps failing at 40% with error EKAI-SYNC-4102. Retried three times.",
      severity: "P2",
      status: "awaiting_customer",
      category: "configuration",
      environment: "azure",
      orgId: globex!.id,
      raisedById: customer2!.id,
      assignedToId: agent!.id,
      createdAt: hoursAgo(30),
      firstResponseAt: hoursAgo(29),
      resolvedAt: null,
      messages: [
        {
          authorId: agent!.id,
          content:
            "Hi Marcus - EKAI-SYNC-4102 indicates the service principal is missing the Synapse Artifact Reader role. Could you confirm the role assignment on the workspace and share the principal's object ID?",
          at: hoursAgo(29),
        },
      ],
      history: [
        { toStatus: "new", byId: customer2!.id, at: hoursAgo(30) },
        { toStatus: "triaged", byId: agent!.id, at: hoursAgo(29.5) },
        { toStatus: "in_progress", byId: agent!.id, at: hoursAgo(29) },
        { toStatus: "awaiting_customer", byId: agent!.id, at: hoursAgo(28.5) },
      ],
    },
    {
      title: "Agent governance policies not applying to new GCP project",
      description:
        "Governance policies defined in the Ekai console are not being enforced for agents running in our newly added GCP project. Existing projects are fine.",
      severity: "P3",
      status: "triaged",
      category: "platform",
      environment: "gcp",
      orgId: acme!.id,
      raisedById: customer1!.id,
      assignedToId: null,
      createdAt: hoursAgo(20),
      firstResponseAt: null,
      resolvedAt: null,
      messages: [],
      history: [
        { toStatus: "new", byId: customer1!.id, at: hoursAgo(20) },
        { toStatus: "triaged", byId: agent!.id, at: hoursAgo(18) },
      ],
    },
    {
      title: "Question: usage-based billing breakdown per environment",
      description:
        "Our finance team needs a monthly breakdown of Ekai usage split by cloud environment (AWS vs Snowflake). Is there a report or API for this?",
      severity: "P4",
      status: "resolved",
      category: "billing",
      environment: "multiple",
      orgId: globex!.id,
      raisedById: customer2!.id,
      assignedToId: agent!.id,
      createdAt: hoursAgo(96),
      firstResponseAt: hoursAgo(90),
      resolvedAt: hoursAgo(48),
      messages: [
        {
          authorId: agent!.id,
          content:
            "Hi Marcus - yes, the Usage Export API supports a group_by=environment parameter, and the console's Billing page has a per-environment view under Usage > Breakdown. I've linked the docs in our knowledge base.",
          at: hoursAgo(90),
        },
        {
          authorId: customer2!.id,
          content: "Perfect, that covers what finance needed. Thanks!",
          at: hoursAgo(50),
        },
      ],
      history: [
        { toStatus: "new", byId: customer2!.id, at: hoursAgo(96) },
        { toStatus: "triaged", byId: agent!.id, at: hoursAgo(92) },
        { toStatus: "in_progress", byId: agent!.id, at: hoursAgo(90) },
        { toStatus: "resolved", byId: agent!.id, at: hoursAgo(48) },
      ],
    },
    {
      title: "Request: SSO group mapping for role provisioning",
      description:
        "We would like Ekai roles to be provisioned automatically from our IdP groups (Okta). Currently we assign roles manually for every new analyst.",
      severity: "P4",
      status: "new",
      category: "other",
      environment: "aws",
      orgId: acme!.id,
      raisedById: customer1!.id,
      assignedToId: null,
      createdAt: hoursAgo(5),
      firstResponseAt: null,
      resolvedAt: null,
      messages: [],
      history: [{ toStatus: "new", byId: customer1!.id, at: hoursAgo(5) }],
    },
  ];

  for (const t of seedTickets) {
    const deadlines = await computeInitialDeadlines(t.createdAt, t.severity);
    const [ticket] = await db
      .insert(ticketsTable)
      .values({
        title: t.title,
        description: t.description,
        severity: t.severity,
        status: t.status,
        category: t.category,
        environment: t.environment,
        orgId: t.orgId,
        raisedById: t.raisedById,
        assignedToId: t.assignedToId,
        createdAt: t.createdAt,
        firstResponseAt: t.firstResponseAt,
        resolvedAt: t.resolvedAt,
        responseDeadline: deadlines.responseDeadline,
        resolutionDeadline: deadlines.resolutionDeadline,
        slaPausedAt: t.status === "awaiting_customer" ? new Date() : null,
      })
      .returning();
    for (const m of t.messages) {
      await db.insert(ticketMessagesTable).values({
        ticketId: ticket!.id,
        authorId: m.authorId,
        content: m.content,
        isInternal: m.isInternal ?? false,
        createdAt: m.at,
      });
    }
    let prev: TicketStatus | null = null;
    for (const h of t.history) {
      await db.insert(ticketStatusHistoryTable).values({
        ticketId: ticket!.id,
        fromStatus: prev,
        toStatus: h.toStatus,
        changedById: h.byId,
        createdAt: h.at,
      });
      prev = h.toStatus;
    }
  }

  await db.insert(kbArticlesTable).values([
    {
      title: "Getting started with the Ekai semantic layer",
      category: "getting_started",
      authorId: admin!.id,
      content: `# Getting started with the Ekai semantic layer

Welcome to Ekai. This guide walks you through connecting your first data platform and publishing a semantic model that your AI agents can query safely.

## 1. Connect a data platform

Ekai supports **AWS (Redshift, Athena)**, **Azure (Synapse, Fabric)**, **GCP (BigQuery)**, and **Snowflake**.

1. In the console, go to *Connections* and choose your platform.
2. Create a dedicated service principal or role with read access to the schemas you want to model.
3. Paste the connection details and run the built-in connectivity test.

## 2. Define your first semantic model

- Import tables from the connection browser.
- Add business definitions: metrics, dimensions, and joins.
- Use the **policy editor** to restrict which fields agents may access.

## 3. Publish and query

Once published, your model is available through the Ekai query API and the agent SDKs. Every agent query is validated against the semantic layer, so agents can only see governed, well-defined data.

> Tip: start with a small, well-understood schema. Expanding a governed model is much easier than untangling an over-broad one.`,
    },
    {
      title: "Troubleshooting model sync failures (EKAI-SYNC errors)",
      category: "troubleshooting",
      authorId: admin!.id,
      content: `# Troubleshooting model sync failures

Model sync errors carry an \`EKAI-SYNC-XXXX\` code. The most common ones:

| Code | Meaning | Fix |
|------|---------|-----|
| EKAI-SYNC-4101 | Connection credentials expired | Rotate the secret in *Connections* |
| EKAI-SYNC-4102 | Missing read role on the warehouse | Grant the documented reader role to the Ekai principal |
| EKAI-SYNC-4110 | Schema drift detected | Re-run *Import* to reconcile removed columns |
| EKAI-SYNC-5001 | Warehouse unreachable | Check network policy / PrivateLink configuration |

## General checklist

1. Run the **connectivity test** on the connection - it validates network, auth, and role grants separately.
2. Check the sync log in *Models > Sync history* for the exact object that failed.
3. If a sync stops at a consistent percentage, it is almost always a permission issue on a specific schema.

If the error persists, raise a ticket with the sync ID from the history page and we will trace it server-side.`,
    },
    {
      title: "Security and compliance overview",
      category: "security_compliance",
      authorId: admin!.id,
      content: `# Security and compliance overview

Ekai is designed so that **your data never leaves your cloud**. The semantic layer compiles agent requests into governed queries that execute inside your own warehouse.

## Data handling

- Query results are streamed to agents and are not persisted by Ekai.
- Model metadata (table names, business definitions, policies) is encrypted at rest (AES-256) and in transit (TLS 1.2+).
- Per-field access policies are enforced at query compile time, before any SQL reaches your warehouse.

## Certifications

- SOC 2 Type II
- ISO 27001
- GDPR-ready data processing agreement available on request

## Access control

- SSO via SAML and OIDC.
- Role-based access in the console (viewer, modeler, admin).
- Full audit log of model changes and agent query activity, exportable to your SIEM.

For a copy of our latest penetration test summary or DPA, raise a P4 ticket in the *billing* or *other* category.`,
    },
  ]);

  // A pending invite so the invite flow is demonstrable out of the box.
  await db
    .insert(invitesTable)
    .values({
      email: "priya@northwind-analytics.com",
      role: "customer",
      orgId: acme!.id,
      token: "demo-invite-token-priya",
      expiresAt: new Date(Date.now() + 14 * 24 * 3600_000),
      createdById: admin!.id,
    })
    .onConflictDoNothing();

  logger.info("seed complete");
}
