import { Router, type IRouter } from "express";
import { db, notificationsTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ListNotificationsResponse, MarkNotificationsReadBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/notifications", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, user.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(50);
  res.json(
    ListNotificationsResponse.parse(
      rows.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        ticketId: n.ticketId,
        emailTo: n.emailTo,
        read: n.read,
        createdAt: n.createdAt.toISOString(),
      })),
    ),
  );
});

router.post("/notifications/read", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const parsed = MarkNotificationsReadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  if (parsed.data.all) {
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(eq(notificationsTable.userId, user.id));
  } else if (parsed.data.ids && parsed.data.ids.length > 0) {
    await db
      .update(notificationsTable)
      .set({ read: true })
      .where(
        and(
          eq(notificationsTable.userId, user.id),
          inArray(notificationsTable.id, parsed.data.ids),
        ),
      );
  }
  res.json({ message: "ok" });
});

export default router;
