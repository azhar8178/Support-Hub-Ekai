import { Router, type IRouter, type Request } from "express";
import {
  db,
  kbArticlesTable,
  kbFeedbackTable,
  kbSearchLogTable,
  kbSuggestionEventsTable,
  usersTable,
  type KbCategory,
} from "@workspace/db";
import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import {
  CreateKbArticleBody,
  GetKbArticleResponse,
  ListKbArticlesQueryParams,
  ListKbArticlesResponse,
  RecordKbSearchBody,
  RecordKbSuggestionEventsBody,
  SubmitKbFeedbackBody,
  UpdateKbArticleBody,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/requireAuth";

const router: IRouter = Router();

function parseId(req: Request): number {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  return parseInt(raw ?? "", 10);
}

function excerpt(content: string): string {
  const plain = content
    .replace(/[#*_`>\[\]()!-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > 180 ? `${plain.slice(0, 177)}...` : plain;
}

async function loadArticleDto(id: number): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select({ article: kbArticlesTable, author: usersTable })
    .from(kbArticlesTable)
    .leftJoin(usersTable, eq(kbArticlesTable.authorId, usersTable.id))
    .where(eq(kbArticlesTable.id, id));
  const row = rows[0];
  if (!row) return null;
  const a = row.article;
  return {
    id: a.id,
    title: a.title,
    content: a.content,
    category: a.category,
    authorId: a.authorId,
    authorName: row.author?.name ?? "Ekai Support",
    published: a.published,
    helpfulCount: a.helpfulCount,
    notHelpfulCount: a.notHelpfulCount,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

router.get("/kb/articles", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const params = ListKbArticlesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ message: params.error.message });
    return;
  }
  const q = params.data;
  const conditions: SQL[] = [];
  const canSeeUnpublished = user.role === "admin" && q.includeUnpublished;
  if (!canSeeUnpublished) conditions.push(eq(kbArticlesTable.published, true));
  if (q.category) conditions.push(eq(kbArticlesTable.category, q.category as KbCategory));
  if (q.search) {
    const pattern = `%${q.search}%`;
    conditions.push(
      or(ilike(kbArticlesTable.title, pattern), ilike(kbArticlesTable.content, pattern))!,
    );
  }
  const rows = await db
    .select()
    .from(kbArticlesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(kbArticlesTable.category, kbArticlesTable.title);

  res.json(
    ListKbArticlesResponse.parse(
      rows.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        excerpt: excerpt(a.content),
        published: a.published,
        helpfulCount: a.helpfulCount,
        notHelpfulCount: a.notHelpfulCount,
        updatedAt: a.updatedAt.toISOString(),
      })),
    ),
  );
});

router.post(
  "/kb/articles",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const parsed = CreateKbArticleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const [article] = await db
      .insert(kbArticlesTable)
      .values({
        title: parsed.data.title,
        content: parsed.data.content,
        category: parsed.data.category as KbCategory,
        published: parsed.data.published ?? true,
        authorId: req.portalUser!.id,
      })
      .returning();
    const dto = await loadArticleDto(article!.id);
    res.status(201).json(GetKbArticleResponse.parse(dto));
  },
);

router.get("/kb/articles/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseId(req);
  const dto = Number.isNaN(id) ? null : await loadArticleDto(id);
  if (!dto || (dto.published === false && req.portalUser!.role !== "admin")) {
    res.status(404).json({ message: "Article not found" });
    return;
  }
  res.json(GetKbArticleResponse.parse(dto));
});

router.patch(
  "/kb/articles/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    const parsed = UpdateKbArticleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ message: parsed.error.message });
      return;
    }
    const updates: Record<string, unknown> = {};
    if (parsed.data.title !== undefined) updates.title = parsed.data.title;
    if (parsed.data.content !== undefined) updates.content = parsed.data.content;
    if (parsed.data.category !== undefined) updates.category = parsed.data.category;
    if (parsed.data.published !== undefined) updates.published = parsed.data.published;
    const [updated] = await db
      .update(kbArticlesTable)
      .set(updates)
      .where(eq(kbArticlesTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ message: "Article not found" });
      return;
    }
    const dto = await loadArticleDto(updated.id);
    res.json(GetKbArticleResponse.parse(dto));
  },
);

router.delete(
  "/kb/articles/:id",
  requireAuth,
  requireRole("admin"),
  async (req, res): Promise<void> => {
    const id = parseId(req);
    await db.delete(kbSuggestionEventsTable).where(eq(kbSuggestionEventsTable.articleId, id));
    await db.delete(kbFeedbackTable).where(eq(kbFeedbackTable.articleId, id));
    const [deleted] = await db
      .delete(kbArticlesTable)
      .where(eq(kbArticlesTable.id, id))
      .returning();
    if (!deleted) {
      res.status(404).json({ message: "Article not found" });
      return;
    }
    res.json({ message: "Article deleted" });
  },
);

router.post("/kb/suggestions/events", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const parsed = RecordKbSuggestionEventsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const { draftId, events } = parsed.data;

  // Only record events against articles that actually exist.
  const articleIds = [...new Set(events.map((e) => e.articleId))];
  const existing = await db
    .select({ id: kbArticlesTable.id })
    .from(kbArticlesTable)
    .where(inArray(kbArticlesTable.id, articleIds));
  const validIds = new Set(existing.map((r) => r.id));
  const rows = events
    .filter((e) => validIds.has(e.articleId))
    .map((e) => ({
      draftId,
      eventType: e.eventType as "impression" | "click",
      articleId: e.articleId,
      userId: user.id,
    }));

  if (rows.length > 0) {
    await db.insert(kbSuggestionEventsTable).values(rows).onConflictDoNothing();
  }
  res.json({ message: "Events recorded" });
});

// Upsert the latest search per draft: the final query a user typed is the
// content-gap signal when no suggestion helped.
router.post("/kb/suggestions/search", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const parsed = RecordKbSearchBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const { draftId, resultCount } = parsed.data;
  const query = parsed.data.query.trim();
  if (query.length < 3) {
    res.status(400).json({ message: "Query too short" });
    return;
  }
  await db
    .insert(kbSearchLogTable)
    .values({ draftId, userId: user.id, query, resultCount })
    .onConflictDoUpdate({
      target: kbSearchLogTable.draftId,
      set: { query, resultCount, updatedAt: new Date() },
    });
  res.json({ message: "Search recorded" });
});

router.post("/kb/articles/:id/feedback", requireAuth, async (req, res): Promise<void> => {
  const user = req.portalUser!;
  const id = parseId(req);
  const parsed = SubmitKbFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: parsed.error.message });
    return;
  }
  const [article] = await db.select().from(kbArticlesTable).where(eq(kbArticlesTable.id, id));
  if (!article) {
    res.status(404).json({ message: "Article not found" });
    return;
  }

  await db
    .insert(kbFeedbackTable)
    .values({ articleId: id, userId: user.id, helpful: parsed.data.helpful })
    .onConflictDoUpdate({
      target: [kbFeedbackTable.articleId, kbFeedbackTable.userId],
      set: { helpful: parsed.data.helpful },
    });

  // Recount from feedback rows to stay accurate on changed votes.
  const [counts] = await db
    .select({
      helpful: sql<number>`count(*) filter (where ${kbFeedbackTable.helpful})`,
      notHelpful: sql<number>`count(*) filter (where not ${kbFeedbackTable.helpful})`,
    })
    .from(kbFeedbackTable)
    .where(eq(kbFeedbackTable.articleId, id));

  await db
    .update(kbArticlesTable)
    .set({
      helpfulCount: Number(counts?.helpful ?? 0),
      notHelpfulCount: Number(counts?.notHelpful ?? 0),
    })
    .where(eq(kbArticlesTable.id, id));

  const dto = await loadArticleDto(id);
  res.json(GetKbArticleResponse.parse(dto));
});

export default router;
