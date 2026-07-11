/**
 * Email delivery via AWS SES.
 *
 * Requires the following environment variables / secrets:
 *   AWS_REGION          – e.g. "us-east-1"
 *   AWS_ACCESS_KEY_ID   – IAM access key (set as a Replit Secret)
 *   AWS_SECRET_ACCESS_KEY – IAM secret key (set as a Replit Secret)
 *   EMAIL_FROM          – verified sender address, e.g. "support@example.com"
 *   PORTAL_URL          – public base URL, e.g. "https://myapp.replit.app"
 *
 * When any required variable is absent the function logs the intent and
 * resolves without error so the rest of the notification pipeline keeps
 * working during development.
 */

import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { logger } from "./logger";

// --------------------------------------------------------------------------
// Client (lazy singleton — recreated if env changes in tests)
// --------------------------------------------------------------------------

let _client: SESClient | null = null;

function getSesClient(): SESClient | null {
  const region = process.env.AWS_REGION;
  const keyId = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !keyId || !secret) return null;

  if (!_client) {
    _client = new SESClient({
      region,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    });
  }
  return _client;
}

export const portalUrl = (): string =>
  (process.env.PORTAL_URL ?? "").replace(/\/$/, "");

export const fromAddress = (): string | null =>
  process.env.EMAIL_FROM ?? null;

// --------------------------------------------------------------------------
// Core send helper
// --------------------------------------------------------------------------

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(msg: EmailMessage): Promise<void> {
  const client = getSesClient();
  const from = fromAddress();

  if (!client || !from) {
    logger.info(
      { to: msg.to, subject: msg.subject },
      "email not sent — AWS SES credentials or EMAIL_FROM not configured",
    );
    return;
  }

  try {
    await client.send(
      new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: [msg.to] },
        Message: {
          Subject: { Data: msg.subject, Charset: "UTF-8" },
          Body: {
            Html: { Data: msg.html, Charset: "UTF-8" },
            Text: { Data: msg.text, Charset: "UTF-8" },
          },
        },
      }),
    );
    logger.info({ to: msg.to, subject: msg.subject }, "email sent via SES");
  } catch (err) {
    logger.error({ err, to: msg.to, subject: msg.subject }, "SES send failed");
    throw err;
  }
}

// --------------------------------------------------------------------------
// Shared layout
// --------------------------------------------------------------------------

function layout(title: string, bodyHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escHtml(title)}</title>
  <style>
    body { margin: 0; padding: 0; background: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #172b4d; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.12); }
    .header { background: #0052cc; padding: 24px 32px; }
    .header h1 { margin: 0; font-size: 20px; color: #ffffff; font-weight: 600; }
    .body { padding: 32px; }
    .body p { margin: 0 0 16px; line-height: 1.6; font-size: 15px; }
    .btn { display: inline-block; margin-top: 8px; padding: 12px 24px; background: #0052cc; color: #ffffff !important; text-decoration: none; border-radius: 4px; font-size: 15px; font-weight: 600; }
    .footer { padding: 16px 32px; font-size: 12px; color: #6b778c; border-top: 1px solid #ebecf0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header"><h1>Ekai Support</h1></div>
    <div class="body">${bodyHtml}</div>
    <div class="footer">You received this because you have an account on the Ekai Support Portal.</div>
  </div>
</body>
</html>`;
}

function escHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --------------------------------------------------------------------------
// Templates
// --------------------------------------------------------------------------

export function ticketCreatedEmail(opts: {
  to: string;
  ticketId: number;
  ticketTitle: string;
  severity: string;
}): EmailMessage {
  const url = `${portalUrl()}/tickets/${opts.ticketId}`;
  const subject = `[Ticket #${opts.ticketId}] We received your request`;
  const html = layout(
    subject,
    `<p>Hi,</p>
     <p>We have received your support request and our team will respond within the SLA for <strong>${escHtml(opts.severity)}</strong> tickets.</p>
     <p><strong>#${opts.ticketId} — ${escHtml(opts.ticketTitle)}</strong></p>
     <p><a class="btn" href="${escHtml(url)}">View ticket</a></p>`,
  );
  const text = `We received ticket #${opts.ticketId}: "${opts.ticketTitle}" (${opts.severity}).\n\nView it here: ${url}`;
  return { to: opts.to, subject, html, text };
}

export function agentReplyEmail(opts: {
  to: string;
  ticketId: number;
  ticketTitle: string;
  agentName: string;
}): EmailMessage {
  const url = `${portalUrl()}/tickets/${opts.ticketId}`;
  const subject = `[Ticket #${opts.ticketId}] New reply from ${opts.agentName}`;
  const html = layout(
    subject,
    `<p>Hi,</p>
     <p><strong>${escHtml(opts.agentName)}</strong> has replied to your ticket.</p>
     <p><strong>#${opts.ticketId} — ${escHtml(opts.ticketTitle)}</strong></p>
     <p><a class="btn" href="${escHtml(url)}">View reply</a></p>`,
  );
  const text = `${opts.agentName} replied to ticket #${opts.ticketId}: "${opts.ticketTitle}".\n\nView it here: ${url}`;
  return { to: opts.to, subject, html, text };
}

export function statusChangedEmail(opts: {
  to: string;
  ticketId: number;
  ticketTitle: string;
  fromStatus: string;
  toStatus: string;
}): EmailMessage {
  const url = `${portalUrl()}/tickets/${opts.ticketId}`;
  const subject = `[Ticket #${opts.ticketId}] Status changed to ${opts.toStatus}`;
  const html = layout(
    subject,
    `<p>Hi,</p>
     <p>The status of your ticket has been updated.</p>
     <p><strong>#${opts.ticketId} — ${escHtml(opts.ticketTitle)}</strong></p>
     <p>${escHtml(opts.fromStatus)} → <strong>${escHtml(opts.toStatus)}</strong></p>
     <p><a class="btn" href="${escHtml(url)}">View ticket</a></p>`,
  );
  const text = `Ticket #${opts.ticketId} "${opts.ticketTitle}" status changed: ${opts.fromStatus} → ${opts.toStatus}.\n\nView it here: ${url}`;
  return { to: opts.to, subject, html, text };
}

export function newCriticalTicketEmail(opts: {
  to: string;
  ticketId: number;
  ticketTitle: string;
  severity: string;
  raiserName: string;
}): EmailMessage {
  const url = `${portalUrl()}/tickets/${opts.ticketId}`;
  const subject = `[${opts.severity}] New critical ticket #${opts.ticketId}`;
  const html = layout(
    subject,
    `<p>A high-priority ticket has been opened and needs your attention.</p>
     <p><strong>#${opts.ticketId} — ${escHtml(opts.ticketTitle)}</strong></p>
     <p>Severity: <strong>${escHtml(opts.severity)}</strong> · Raised by: ${escHtml(opts.raiserName)}</p>
     <p><a class="btn" href="${escHtml(url)}">View ticket</a></p>`,
  );
  const text = `New ${opts.severity} ticket #${opts.ticketId} "${opts.ticketTitle}" raised by ${opts.raiserName}.\n\nView it here: ${url}`;
  return { to: opts.to, subject, html, text };
}

export function slaWarningEmail(opts: {
  to: string;
  ticketId: number;
  ticketTitle: string;
  severity: string;
  which: string; // "first response" | "resolution"
}): EmailMessage {
  const url = `${portalUrl()}/tickets/${opts.ticketId}`;
  const subject = `[SLA Warning] Ticket #${opts.ticketId} has used 75% of the ${opts.which} window`;
  const html = layout(
    subject,
    `<p>75% of the <strong>${escHtml(opts.which)}</strong> SLA window has elapsed for the following ticket.</p>
     <p><strong>#${opts.ticketId} — ${escHtml(opts.ticketTitle)}</strong></p>
     <p>Severity: <strong>${escHtml(opts.severity)}</strong></p>
     <p><a class="btn" href="${escHtml(url)}">View ticket</a></p>`,
  );
  const text = `SLA warning: 75% of the ${opts.which} window has elapsed for ticket #${opts.ticketId} "${opts.ticketTitle}" (${opts.severity}).\n\nView it here: ${url}`;
  return { to: opts.to, subject, html, text };
}

export function inviteEmail(opts: {
  to: string;
  inviteUrl: string;
  role: string;
  inviterName: string;
}): EmailMessage {
  const subject = `You've been invited to the Ekai Support Portal`;
  const fullUrl = opts.inviteUrl.startsWith("http")
    ? opts.inviteUrl
    : `${portalUrl()}${opts.inviteUrl}`;
  const html = layout(
    subject,
    `<p>Hi,</p>
     <p><strong>${escHtml(opts.inviterName)}</strong> has invited you to join the Ekai Support Portal as a <strong>${escHtml(opts.role)}</strong>.</p>
     <p>Click the button below to accept your invitation. The link expires in 14 days.</p>
     <p><a class="btn" href="${escHtml(fullUrl)}">Accept invitation</a></p>
     <p style="font-size:13px;color:#6b778c;">Or copy this link: ${escHtml(fullUrl)}</p>`,
  );
  const text = `You've been invited to the Ekai Support Portal as ${opts.role} by ${opts.inviterName}.\n\nAccept your invitation here (expires in 14 days):\n${fullUrl}`;
  return { to: opts.to, subject, html, text };
}
