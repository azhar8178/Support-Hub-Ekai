import type { NextFunction, Request, RequestHandler, Response } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { db, usersTable, type User, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";

declare global {
  namespace Express {
    interface Request {
      portalUser?: User;
    }
  }
}

// Cache clerkUserId -> primary email to avoid a Clerk API call per request.
const emailCache = new Map<string, string>();

export async function resolvePortalUser(req: Request): Promise<User | null> {
  const auth = getAuth(req);
  if (!auth.userId) return null;

  // Fast path: already linked.
  const [linked] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, auth.userId));
  if (linked) return linked;

  // Look up the Clerk user's email and try to link to an invited portal user.
  let email = emailCache.get(auth.userId);
  if (!email) {
    const clerkUser = await clerkClient.users.getUser(auth.userId);
    email =
      clerkUser.primaryEmailAddress?.emailAddress ??
      clerkUser.emailAddresses[0]?.emailAddress ??
      undefined;
    if (!email) return null;
    emailCache.set(auth.userId, email);
  }

  const [byEmail] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, email.toLowerCase()));
  if (!byEmail) return null;
  if (byEmail.clerkUserId && byEmail.clerkUserId !== auth.userId) return null;

  const [updated] = await db
    .update(usersTable)
    .set({ clerkUserId: auth.userId, lastLogin: new Date() })
    .where(eq(usersTable.id, byEmail.id))
    .returning();
  return updated ?? byEmail;
}

/** Requires a Clerk session AND an invited, active portal user. */
export const requireAuth: RequestHandler = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const auth = getAuth(req);
  if (!auth.userId) {
    res.status(401).json({ message: "Not signed in" });
    return;
  }
  const user = await resolvePortalUser(req);
  if (!user) {
    res.status(403).json({ message: "Access to this portal is by invitation only.", code: "not_invited" });
    return;
  }
  if (!user.active) {
    res.status(403).json({ message: "Your account has been deactivated.", code: "deactivated" });
    return;
  }
  req.portalUser = user;
  next();
};

/** Requires one of the given roles (mount after requireAuth). */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.portalUser;
    if (!user || !roles.includes(user.role)) {
      res.status(403).json({ message: "Insufficient permissions" });
      return;
    }
    next();
  };
}

export function isStaff(user: User): boolean {
  return user.role === "ekai_agent" || user.role === "admin";
}
