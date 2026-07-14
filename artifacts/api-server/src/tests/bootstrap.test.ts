/**
 * Bootstrap endpoint security tests.
 *
 * Covers four lockout scenarios:
 *  1. Wrong token → 401           (self-gate must not fire; see beforeAll below)
 *  2. Self-gate → 404             (admin who has completed setup exists)
 *  3. bootstrap-rotate auth gate  → 401 for unauthenticated callers
 *  4. bootstrap-status after rotate → { active: false }
 *
 * The test suite is auth-mode-aware:
 *  - AUTH_MODE=local  → session-based auth; admins are created with a bcrypt
 *    password and logged in via POST /api/auth/login before protected calls.
 *    The self-gate condition is `passwordHash IS NOT NULL`.
 *  - AUTH_MODE=clerk  → Clerk mock via x-test-clerk-user header.
 *    The self-gate condition is `clerkUserId IS NOT NULL`.
 *
 * IMPORTANT ordering constraint:
 *   Tests that call rotateBootstrapToken() permanently set the in-memory token
 *   to null for this process. The wrong-token and self-gate describe blocks
 *   MUST run before the rotate block. Vitest runs describe blocks top-to-bottom.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { db, usersTable, type User } from "@workspace/db";
import { and, eq, isNotNull, like } from "drizzle-orm";
import { Fixtures } from "./fixtures";
import { getBootstrapToken } from "../routes/bootstrap";

const AUTH_MODE = process.env.AUTH_MODE ?? "clerk";

// Only mock Clerk in clerk mode. In local mode the mock is irrelevant but
// harmless — requireAuth delegates to the session middleware instead.
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

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Password used for local-mode admin fixtures. Low bcrypt rounds for speed. */
const TEST_PASSWORD = "Bootstrap@Test99!";

/**
 * Hash the test password and write it to the given user row so that
 * POST /api/auth/login works for them.
 */
async function setPassword(userId: number): Promise<void> {
  const hash = await bcrypt.hash(TEST_PASSWORD, 4);
  await db.update(usersTable).set({ passwordHash: hash }).where(eq(usersTable.id, userId));
}

/**
 * Build a supertest Agent that is already signed in as the given user.
 * In local mode: logs in via POST /api/auth/login so the agent carries the
 *   session cookie for subsequent requests.
 * In clerk mode: sets the x-test-clerk-user header on every request.
 */
async function signedInAgent(user: User): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  if (AUTH_MODE === "local") {
    const res = await agent.post("/api/auth/login").send({
      email: user.email,
      password: TEST_PASSWORD,
    });
    if (res.status !== 200) {
      throw new Error(
        `signedInAgent: login failed (${res.status}): ${JSON.stringify(res.body)}`,
      );
    }
  } else {
    // Clerk mode: attach the header to every request made through this agent.
    agent.set("x-test-clerk-user", user.clerkUserId!);
  }
  return agent;
}

// ─── Global pre-flight: neutralise stale test admin data ─────────────────────
//
// If a previous test run crashed before its own afterAll cleanup, leftover
// admins would silently trigger the self-gate in the wrong-token test.
// We null-out the self-gate column rather than deleting rows (deletes may fail
// on FK constraints from tables like kb_articles). Only @test.example.com
// email addresses are touched, so real admin data is never affected.

beforeAll(async () => {
  if (AUTH_MODE === "local") {
    await db
      .update(usersTable)
      .set({ passwordHash: null })
      .where(
        and(
          eq(usersTable.role, "admin"),
          isNotNull(usersTable.passwordHash),
          like(usersTable.email, "%@test.example.com"),
        ),
      );
  } else {
    await db
      .update(usersTable)
      .set({ clerkUserId: null })
      .where(
        and(
          eq(usersTable.role, "admin"),
          isNotNull(usersTable.clerkUserId),
          like(usersTable.email, "%@test.example.com"),
        ),
      );
  }
});

// ─── 1. Wrong token ───────────────────────────────────────────────────────────
//
// The self-gate fires BEFORE token validation in the route. For the wrong-token
// branch (→ 401) to be reachable, no admin must have completed setup (no admin
// with the mode-specific credential set).
//
// We save and temporarily null-out ALL admin credentials (not just test ones)
// so even a real dev-environment admin doesn't trigger the self-gate. They are
// restored in afterAll.

describe("POST /api/bootstrap-admin — wrong token", () => {
  type SavedAdmin = { id: number; passwordHash: string | null; clerkUserId: string | null };
  let saved: SavedAdmin[] = [];

  beforeAll(async () => {
    if (AUTH_MODE === "local") {
      const rows = await db
        .select({ id: usersTable.id, passwordHash: usersTable.passwordHash, clerkUserId: usersTable.clerkUserId })
        .from(usersTable)
        .where(and(eq(usersTable.role, "admin"), isNotNull(usersTable.passwordHash)));
      saved = rows;
      if (saved.length > 0) {
        await db
          .update(usersTable)
          .set({ passwordHash: null })
          .where(eq(usersTable.role, "admin"));
      }
    } else {
      const rows = await db
        .select({ id: usersTable.id, passwordHash: usersTable.passwordHash, clerkUserId: usersTable.clerkUserId })
        .from(usersTable)
        .where(and(eq(usersTable.role, "admin"), isNotNull(usersTable.clerkUserId)));
      saved = rows;
      if (saved.length > 0) {
        await db
          .update(usersTable)
          .set({ clerkUserId: null })
          .where(eq(usersTable.role, "admin"));
      }
    }
  });

  afterAll(async () => {
    // Restore saved credentials.
    for (const row of saved) {
      await db
        .update(usersTable)
        .set(
          AUTH_MODE === "local"
            ? { passwordHash: row.passwordHash }
            : { clerkUserId: row.clerkUserId },
        )
        .where(eq(usersTable.id, row.id));
    }
  });

  it("returns 401 when the supplied bootstrapToken is wrong", async () => {
    // Guard: token must be non-null for the token-validation branch to be reachable.
    expect(getBootstrapToken()).not.toBeNull();

    const res = await request(app)
      .post("/api/bootstrap-admin")
      .send({ email: "attacker@evil.com", bootstrapToken: "definitely-wrong-token" });

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      message: expect.stringContaining("Invalid bootstrap token"),
    });
  });
});

// ─── 2. Self-gate (admin has completed setup) ─────────────────────────────────
//
// Create an admin whose credential (passwordHash in local mode, clerkUserId in
// clerk mode) is set — mimicking an admin who has already signed in.

describe("POST /api/bootstrap-admin — self-gate after admin signs in", () => {
  const fx = new Fixtures();
  let admin: User;

  beforeAll(async () => {
    admin = await fx.createUser({
      name: "Bootstrap Selfgate Admin",
      role: "admin",
      clerkUserId: AUTH_MODE === "clerk" ? `clerk-selfgate-${fx.suffix}` : null,
    });
    if (AUTH_MODE === "local") {
      await setPassword(admin.id);
      // Reload so admin.passwordHash is current.
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
      admin = row!;
    }
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("returns 404 when an admin who has completed setup already exists", async () => {
    // Verify fixture state matches what the self-gate checks.
    const [row] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
    if (AUTH_MODE === "local") {
      expect(row?.passwordHash).toBeTruthy();
    } else {
      expect(row?.clerkUserId).toBeTruthy();
    }

    // Even the real token returns 404 — self-gate fires first.
    const res = await request(app)
      .post("/api/bootstrap-admin")
      .send({
        email: "attacker@evil.com",
        bootstrapToken: getBootstrapToken() ?? "irrelevant",
      });

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ message: "Not found" });
  });
});

// ─── 3 & 4. bootstrap-rotate / bootstrap-status ───────────────────────────────
//
// Test that the admin-only routes enforce authentication (401 for anonymous
// callers) and that rotating the token is immediately reflected in the status.
//
// NOTE: rotateBootstrapToken() permanently sets _bootstrapToken = null for
// this Node.js process — this describe block MUST be last.

describe("bootstrap-rotate and bootstrap-status", () => {
  const fx = new Fixtures();
  let admin: User;

  beforeAll(async () => {
    admin = await fx.createUser({
      name: "Bootstrap Rotate Admin",
      role: "admin",
      clerkUserId: AUTH_MODE === "clerk" ? `clerk-rotate-${fx.suffix}` : null,
    });
    if (AUTH_MODE === "local") {
      await setPassword(admin.id);
      const [row] = await db.select().from(usersTable).where(eq(usersTable.id, admin.id));
      admin = row!;
    }
  });

  afterAll(async () => {
    await fx.cleanup();
  });

  it("POST /api/admin/bootstrap-rotate returns 401 for unauthenticated requests", async () => {
    const res = await request(app).post("/api/admin/bootstrap-rotate");
    expect(res.status).toBe(401);
  });

  it("GET /api/admin/bootstrap-status returns { active: false } after POST /api/admin/bootstrap-rotate", async () => {
    const agent = await signedInAgent(admin);

    // Rotate the token (requires admin auth).
    const rotateRes = await agent.post("/api/admin/bootstrap-rotate");
    expect(rotateRes.status).toBe(200);

    // Status must now report active:false.
    const statusRes = await agent.get("/api/admin/bootstrap-status");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toMatchObject({ active: false });
  });
});
