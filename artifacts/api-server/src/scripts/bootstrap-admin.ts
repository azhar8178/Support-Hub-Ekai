#!/usr/bin/env node
/**
 * CLI helper to bootstrap the very first admin account.
 *
 * Usage (after `pnpm run build`):
 *   pnpm --filter @workspace/api-server run bootstrap-admin -- --email you@yourcompany.com
 *
 * The script:
 *   1. Creates (or promotes) a DB user row with role=admin for the given email.
 *   2. Inserts an invite token for that email.
 *   3. Prints the accept-invite URL.
 *
 * The operator then visits the URL, signs up / signs in via Clerk with the
 * same email, and the accept-invite flow links their Clerk account as admin.
 */

import { randomBytes } from "node:crypto";
import { db, invitesTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const emailIdx = args.indexOf("--email");
const email = emailIdx >= 0 ? args[emailIdx + 1] : null;

if (!email || !email.includes("@")) {
  console.error("Usage: bootstrap-admin --email <admin-email@domain.com>");
  process.exit(1);
}

const normalizedEmail = email.toLowerCase().trim();
const portalUrl = (process.env.PORTAL_URL ?? "").replace(/\/$/, "");

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function run(): Promise<void> {
  console.log(`\nBootstrapping admin account for: ${normalizedEmail}\n`);

  // Upsert the user row (satisfies invite FK and pre-registers the email).
  let userId: number;
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, normalizedEmail));

  if (existing) {
    userId = existing.id;
    if (existing.role !== "admin") {
      await db
        .update(usersTable)
        .set({ role: "admin", active: true })
        .where(eq(usersTable.id, existing.id));
      console.log(`  ✔ Promoted existing user to admin.`);
    } else {
      console.log(`  ✔ User already has admin role.`);
    }
  } else {
    const [created] = await db
      .insert(usersTable)
      .values({
        email: normalizedEmail,
        name: normalizedEmail.split("@")[0]!,
        role: "admin",
        active: true,
      })
      .returning();
    userId = created!.id;
    console.log(`  ✔ Created admin user (id=${userId}).`);
  }

  // Issue a fresh invite token.
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + 14 * 24 * 3_600_000);

  await db.insert(invitesTable).values({
    email: normalizedEmail,
    role: "admin",
    token,
    expiresAt,
    createdById: userId,
  });

  const invitePath = `/accept-invite?token=${token}`;
  const inviteUrl = portalUrl ? `${portalUrl}${invitePath}` : invitePath;

  console.log(`  ✔ Invite created (expires ${expiresAt.toUTCString()}).\n`);
  console.log("─────────────────────────────────────────────────────────");
  console.log("  Invite URL (share this with the admin):");
  console.log();
  console.log(`  ${inviteUrl}`);
  console.log();
  console.log("  The admin must sign up / sign in via Clerk using:");
  console.log(`    ${normalizedEmail}`);
  console.log("─────────────────────────────────────────────────────────\n");
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
