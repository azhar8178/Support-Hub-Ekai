import { Router, type IRouter } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { RegisterPushTokenBody, RemovePushTokenBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

// Expo push tokens look like ExponentPushToken[xxxx] (or ExpoPushToken[xxxx]).
const EXPO_TOKEN_PATTERN = /^Expo(nent)?PushToken\[.+\]$/;

router.post("/push-tokens", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const parsed = RegisterPushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const { token, platform } = parsed.data;
  if (!EXPO_TOKEN_PATTERN.test(token)) {
    res.status(400).json({ message: "Not a valid Expo push token" });
    return;
  }
  // A device token belongs to whoever is signed in on that device now.
  await db
    .insert(pushTokensTable)
    .values({ userId: user.id, token, platform })
    .onConflictDoUpdate({
      target: pushTokensTable.token,
      set: { userId: user.id, platform, updatedAt: new Date() },
    });
  res.json({ message: "ok" });
});

router.post("/push-tokens/remove", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const parsed = RemovePushTokenBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  await db
    .delete(pushTokensTable)
    .where(and(eq(pushTokensTable.userId, user.id), eq(pushTokensTable.token, parsed.data.token)));
  res.json({ message: "ok" });
});

export default router;
