import { db, siteSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

interface TicketRef {
  id: number;
  title: string;
  severity: string;
  orgId: number;
}

interface RaisedBy {
  name: string;
}

let cachedWebhookUrl: string | null | undefined = undefined;
let cacheExpiresAt = 0;

async function getSlackWebhookUrl(): Promise<string | null> {
  const now = Date.now();
  if (cachedWebhookUrl !== undefined && now < cacheExpiresAt) {
    return cachedWebhookUrl;
  }
  const [row] = await db
    .select()
    .from(siteSettingsTable)
    .where(eq(siteSettingsTable.id, 1));
  cachedWebhookUrl = row?.slackWebhookUrl ?? null;
  cacheExpiresAt = now + 60_000;
  return cachedWebhookUrl;
}

function severityEmoji(severity: string): string {
  if (severity === "P1") return "🔴";
  if (severity === "P2") return "🟠";
  return "⚪";
}

/**
 * Send a plain-text message to a specific Slack webhook URL. Falls back
 * silently if no URL is provided.
 */
async function sendSlackMessage(webhookUrl: string, text: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Send a plain-text Slack message for fleet/ops alerts. If `overrideUrl` is
 * provided it is used directly; otherwise the global site-settings webhook is
 * used. Falls back silently if no webhook is configured.
 */
export async function sendSlackFleetAlert(text: string, overrideUrl?: string | null): Promise<void> {
  try {
    const webhookUrl = overrideUrl ?? (await getSlackWebhookUrl());
    if (!webhookUrl) return;
    await sendSlackMessage(webhookUrl, text);
  } catch (err) {
    console.error("[slack] Failed to send fleet alert:", err);
  }
}

export async function sendSlackAlert(ticket: TicketRef, raisedBy: RaisedBy): Promise<void> {
  try {
    const webhookUrl = await getSlackWebhookUrl();
    if (!webhookUrl) return;

    const emoji = severityEmoji(ticket.severity);
    const ticketUrl = `/tickets/${ticket.id}`;

    const body = {
      blocks: [
        {
          type: "header",
          text: {
            type: "plain_text",
            text: `${emoji} ${ticket.severity} Ticket Raised`,
            emoji: true,
          },
        },
        {
          type: "section",
          fields: [
            {
              type: "mrkdwn",
              text: `*Ticket:*\n<${ticketUrl}|#${ticket.id} – ${ticket.title}>`,
            },
            {
              type: "mrkdwn",
              text: `*Raised by:*\n${raisedBy.name}`,
            },
          ],
        },
      ],
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    console.error("[slack] Failed to send Slack alert:", err);
  }
}
