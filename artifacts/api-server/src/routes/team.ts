import { Router, type IRouter } from "express";
import { db, organisationsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ListAgentsResponse } from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";
import { serializeUser } from "../lib/serializers";

const router: IRouter = Router();

router.get(
  "/team/agents",
  requireAuth,
  requireRole("ekai_agent", "admin"),
  async (_req, res): Promise<void> => {
    const rows = await db
      .select({ user: usersTable, org: organisationsTable })
      .from(usersTable)
      .leftJoin(organisationsTable, eq(usersTable.orgId, organisationsTable.id))
      .where(inArray(usersTable.role, ["ekai_agent", "admin"]));
    res.json(
      ListAgentsResponse.parse(
        rows
          .filter((r) => r.user.active)
          .map((r) => serializeUser(r.user, r.org?.name ?? null))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    );
  },
);

export default router;
