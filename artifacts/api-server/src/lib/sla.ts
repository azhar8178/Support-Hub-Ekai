import { db, slaConfigTable, type SlaConfig, type Ticket } from "@workspace/db";
import { eq } from "drizzle-orm";
import { addBusinessMinutes, businessMinutesBetween } from "./businessHours";

export interface SlaInfoDto {
  responseDeadline: string | null;
  resolutionDeadline: string | null;
  responseMet: boolean | null;
  resolutionMet: boolean | null;
  paused: boolean;
  resolutionPlanned: boolean;
  responsePctElapsed: number | null;
  resolutionPctElapsed: number | null;
  responseBreached: boolean;
  resolutionBreached: boolean;
}

export async function getSlaConfigFor(severity: string): Promise<SlaConfig | undefined> {
  const [config] = await db
    .select()
    .from(slaConfigTable)
    .where(eq(slaConfigTable.severity, severity as SlaConfig["severity"]));
  return config;
}

// Cached severity metadata so the synchronous SLA math and de-hardcoded
// severity checks (24x7 clock, resolution-optional, urgent alerting, ranking)
// don't hit the DB per ticket. Loaded at startup and refreshed whenever admins
// change the severity configuration. Falls back to the spec defaults
// (P1 24x7 + urgent, P2 urgent, P4 resolution-optional) until the first load.
interface SeverityMeta {
  use24x7: boolean;
  resolutionOptional: boolean;
  isUrgent: boolean;
  rank: number;
  active: boolean;
}

const DEFAULT_SEVERITY_META: Record<string, SeverityMeta> = {
  P1: { use24x7: true, resolutionOptional: false, isUrgent: true, rank: 1, active: true },
  P2: { use24x7: false, resolutionOptional: false, isUrgent: true, rank: 2, active: true },
  P3: { use24x7: false, resolutionOptional: false, isUrgent: false, rank: 3, active: true },
  P4: { use24x7: false, resolutionOptional: true, isUrgent: false, rank: 4, active: true },
};

// The cache keeps ALL severities (including retired ones) so SLA/urgency math
// still resolves for existing tickets that carry a now-retired severity. Rank
// helpers that answer "what is the top severity right now" filter to active.
let severityMetaByKey: Record<string, SeverityMeta> = { ...DEFAULT_SEVERITY_META };

export async function refreshSlaClockCache(): Promise<void> {
  const rows = await db.select().from(slaConfigTable);
  if (rows.length > 0) {
    severityMetaByKey = Object.fromEntries(
      rows.map((r) => [
        r.severity,
        {
          use24x7: r.use24x7,
          resolutionOptional: r.resolutionOptional,
          isUrgent: r.isUrgent,
          rank: r.rank,
          active: r.active,
        },
      ]),
    );
  }
}

export function isUse24x7(severity: string): boolean {
  return severityMetaByKey[severity]?.use24x7 ?? false;
}

export function isResolutionOptional(severity: string): boolean {
  return severityMetaByKey[severity]?.resolutionOptional ?? false;
}

export function isUrgentSeverity(severity: string): boolean {
  return severityMetaByKey[severity]?.isUrgent ?? false;
}

export function getSeverityRank(severity: string): number {
  return severityMetaByKey[severity]?.rank ?? Number.MAX_SAFE_INTEGER;
}

/** Rank of the most severe active severity (lowest rank number). */
export function getTopSeverityRank(): number {
  const ranks = Object.values(severityMetaByKey)
    .filter((m) => m.active)
    .map((m) => m.rank);
  return ranks.length > 0 ? Math.min(...ranks) : 1;
}

/** Compute initial deadlines for a new ticket. */
export async function computeInitialDeadlines(
  createdAt: Date,
  severity: string,
): Promise<{ responseDeadline: Date | null; resolutionDeadline: Date | null }> {
  const config = await getSlaConfigFor(severity);
  if (!config) return { responseDeadline: null, resolutionDeadline: null };
  const add = (minutes: number): Date =>
    config.use24x7
      ? new Date(createdAt.getTime() + minutes * 60_000)
      : addBusinessMinutes(createdAt, minutes);
  return {
    responseDeadline: add(config.firstResponseMinutes),
    resolutionDeadline: config.resolutionMinutes == null ? null : add(config.resolutionMinutes),
  };
}

/** Shift a deadline forward by the paused interval (business-aware for non-24x7). */
export function shiftDeadlineForPause(
  deadline: Date,
  pausedAt: Date,
  resumedAt: Date,
  use24x7: boolean,
): Date {
  if (use24x7) {
    return new Date(deadline.getTime() + (resumedAt.getTime() - pausedAt.getTime()));
  }
  const pausedBusinessMinutes = businessMinutesBetween(pausedAt, resumedAt);
  return addBusinessMinutes(deadline, pausedBusinessMinutes);
}

function pctElapsed(createdAt: Date, deadline: Date, now: Date, use24x7: boolean): number {
  if (use24x7) {
    const total = deadline.getTime() - createdAt.getTime();
    if (total <= 0) return 100;
    return Math.max(0, ((now.getTime() - createdAt.getTime()) / total) * 100);
  }
  // Business-hours SLA: progress only advances during business time
  // (09:00-18:00 UTC Mon-Fri), so nights and weekends do not move the needle.
  const totalBusinessMinutes = businessMinutesBetween(createdAt, deadline);
  if (totalBusinessMinutes <= 0) return now >= deadline ? 100 : 0;
  const elapsedBusinessMinutes = businessMinutesBetween(createdAt, now);
  return Math.max(0, (elapsedBusinessMinutes / totalBusinessMinutes) * 100);
}

/** Compute the presented SLA state for a ticket. */
export function computeSlaInfo(ticket: Ticket, now: Date = new Date()): SlaInfoDto {
  const paused = ticket.slaPausedAt != null && ticket.status === "awaiting_customer";
  const resolutionPlanned =
    isResolutionOptional(ticket.severity) && ticket.resolutionDeadline == null;

  const effectiveNow = paused && ticket.slaPausedAt ? ticket.slaPausedAt : now;

  const responseMet =
    ticket.firstResponseAt != null && ticket.responseDeadline != null
      ? ticket.firstResponseAt <= ticket.responseDeadline
      : ticket.firstResponseAt != null
        ? true
        : null;

  const resolutionMet =
    ticket.resolvedAt != null && ticket.resolutionDeadline != null
      ? ticket.resolvedAt <= ticket.resolutionDeadline
      : ticket.resolvedAt != null
        ? true
        : null;

  const responseBreached =
    responseMet === false ||
    (responseMet == null &&
      ticket.responseDeadline != null &&
      effectiveNow > ticket.responseDeadline);

  const resolutionBreached =
    resolutionMet === false ||
    (resolutionMet == null &&
      ticket.resolutionDeadline != null &&
      effectiveNow > ticket.resolutionDeadline);

  return {
    responseDeadline: ticket.responseDeadline?.toISOString() ?? null,
    resolutionDeadline: ticket.resolutionDeadline?.toISOString() ?? null,
    responseMet,
    resolutionMet,
    paused,
    resolutionPlanned,
    responsePctElapsed:
      responseMet == null && ticket.responseDeadline != null
        ? Math.round(
            pctElapsed(
              ticket.createdAt,
              ticket.responseDeadline,
              effectiveNow,
              isUse24x7(ticket.severity),
            ),
          )
        : null,
    resolutionPctElapsed:
      resolutionMet == null && ticket.resolutionDeadline != null
        ? Math.round(
            pctElapsed(
              ticket.createdAt,
              ticket.resolutionDeadline,
              effectiveNow,
              isUse24x7(ticket.severity),
            ),
          )
        : null,
    responseBreached,
    resolutionBreached,
  };
}
