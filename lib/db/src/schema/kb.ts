import { boolean, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { usersTable } from "./users";

export type KbCategory =
  | "getting_started"
  | "infrastructure_deployment"
  | "troubleshooting"
  | "security_compliance"
  | "release_notes";

export const kbArticlesTable = pgTable("kb_articles", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  category: text("category").$type<KbCategory>().notNull(),
  authorId: integer("author_id").references(() => usersTable.id),
  published: boolean("published").notNull().default(true),
  helpfulCount: integer("helpful_count").notNull().default(0),
  notHelpfulCount: integer("not_helpful_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertKbArticleSchema = createInsertSchema(kbArticlesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertKbArticle = z.infer<typeof insertKbArticleSchema>;
export type KbArticle = typeof kbArticlesTable.$inferSelect;

export const kbFeedbackTable = pgTable(
  "kb_feedback",
  {
    id: serial("id").primaryKey(),
    articleId: integer("article_id")
      .notNull()
      .references(() => kbArticlesTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    helpful: boolean("helpful").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("kb_feedback_article_user_unique").on(t.articleId, t.userId)],
);

export const insertKbFeedbackSchema = createInsertSchema(kbFeedbackTable).omit({
  id: true,
  createdAt: true,
});
export type InsertKbFeedback = z.infer<typeof insertKbFeedbackSchema>;
export type KbFeedback = typeof kbFeedbackTable.$inferSelect;

export type KbSuggestionEventType = "impression" | "click" | "ticket_filed";

// Tracks KB suggestion deflection: impressions/clicks while drafting a ticket,
// plus a ticket_filed marker when the draft turns into a real ticket.
export const kbSuggestionEventsTable = pgTable(
  "kb_suggestion_events",
  {
    id: serial("id").primaryKey(),
    draftId: text("draft_id").notNull(),
    eventType: text("event_type").$type<KbSuggestionEventType>().notNull(),
    articleId: integer("article_id").references(() => kbArticlesTable.id),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id),
    ticketId: integer("ticket_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("kb_suggestion_events_draft_article_type_unique").on(t.draftId, t.articleId, t.eventType),
    index("kb_suggestion_events_draft_idx").on(t.draftId),
  ],
);

export type KbSuggestionEvent = typeof kbSuggestionEventsTable.$inferSelect;
export type InsertKbSuggestionEvent = typeof kbSuggestionEventsTable.$inferInsert;
