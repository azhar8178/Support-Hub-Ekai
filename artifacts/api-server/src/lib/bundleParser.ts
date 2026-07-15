/**
 * Support bundle parser.
 * Unzips a bundle ZIP and extracts diagnostic summaries from known files.
 * All parsing is best-effort — missing or malformed files are noted, not errors.
 *
 * NOTE: This stores only extracted error lines (max 20) and line counts.
 * Full logs are available by downloading the ZIP. Raw log contents are never
 * stored in the database.
 */

import fs from "fs";
import path from "path";
import os from "os";
import { pipeline } from "stream/promises";
import unzipper from "unzipper";
import { db, supportBundlesTable, ticketsTable, ticketMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export interface BundleParsedSummary {
  parsed_at: string;
  health: {
    overall_status: string;
    collected_at: string | null;
    services: Array<{ name: string; status: string; latency_ms?: number }>;
  };
  versions: {
    ekai_version: string;
    agent_version: string;
    runtime: string;
    host_os: string;
  };
  preflight: {
    issue_count: number;
    failures: string[];
  };
  connectivity: {
    portal_reachable: boolean;
    failed_checks: string[];
  };
  environment: {
    cloud: string;
    region: string;
    runtime: string;
    version: string;
  };
  infra: {
    container_count: number;
    unhealthy_containers: string[];
  };
  logs: {
    total_lines: number;
    error_lines: string[];
    fatal_lines: string[];
  };
  parse_warnings: string[];
}

/** Extract a ZIP to a temp directory, returning the temp path. Caller must clean up. */
async function extractZip(zipPath: string, destDir: string): Promise<void> {
  const directory = await unzipper.Open.file(zipPath);
  await directory.extract({ path: destDir });
}

function tryParseJson(content: string, warnLabel: string, warnings: string[]): unknown {
  try {
    return JSON.parse(content);
  } catch {
    warnings.push(`${warnLabel}: invalid JSON, skipped`);
    return null;
  }
}

function readFileIfExists(dir: string, filename: string): string | null {
  const p = path.join(dir, filename);
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function parseHealthSnapshot(
  dir: string,
  summary: BundleParsedSummary,
): void {
  const raw = readFileIfExists(dir, "health-snapshot.json");
  if (!raw) {
    summary.parse_warnings.push("health-snapshot.json: not found");
    return;
  }
  const data = tryParseJson(raw, "health-snapshot.json", summary.parse_warnings) as any;
  if (!data) return;
  summary.health.overall_status = data.overall_status ?? "unknown";
  summary.health.collected_at = data.collected_at ?? null;
  summary.health.services = Array.isArray(data.services)
    ? data.services.map((s: any) => ({
        name: s.name ?? "unknown",
        status: s.status ?? "unknown",
        latency_ms: s.latency_ms ?? undefined,
      }))
    : [];
}

function parseVersionManifest(dir: string, summary: BundleParsedSummary): void {
  const raw = readFileIfExists(dir, "version-manifest.json");
  if (!raw) {
    summary.parse_warnings.push("version-manifest.json: not found");
    return;
  }
  const data = tryParseJson(raw, "version-manifest.json", summary.parse_warnings) as any;
  if (!data) return;
  summary.versions.ekai_version = data.ekai_version ?? "unknown";
  summary.versions.agent_version = data.fleet_agent_version ?? "unknown";
  summary.versions.runtime = data.runtime ?? "unknown";
  summary.versions.host_os = data.host_os ?? "unknown";
}

function parsePreflightCheck(dir: string, summary: BundleParsedSummary): void {
  const raw = readFileIfExists(dir, "preflight-check.txt");
  if (!raw) {
    summary.parse_warnings.push("preflight-check.txt: not found");
    return;
  }
  const lines = raw.split("\n");
  const failures = lines
    .filter((l) => l.includes("[FAIL]"))
    .map((l) => l.trim());
  summary.preflight.issue_count = failures.length;
  summary.preflight.failures = failures;
}

function parseConnectivityCheck(dir: string, summary: BundleParsedSummary): void {
  const raw = readFileIfExists(dir, "connectivity-check.txt");
  if (!raw) {
    summary.parse_warnings.push("connectivity-check.txt: not found");
    return;
  }
  summary.connectivity.portal_reachable = raw.includes("Result: REACHABLE");
  const failedLines = raw
    .split("\n")
    .filter(
      (l) =>
        l.includes("UNREACHABLE") ||
        l.includes("FAILED") ||
        l.includes("TCP FAILED"),
    )
    .map((l) => l.trim())
    .filter(Boolean);
  summary.connectivity.failed_checks = failedLines;
}

function parseEnvSummary(dir: string, summary: BundleParsedSummary): void {
  const raw = readFileIfExists(dir, "env-summary.txt");
  if (!raw) {
    summary.parse_warnings.push("env-summary.txt: not found");
    return;
  }
  const extract = (key: string): string => {
    const match = raw.match(new RegExp(`${key}[=:\\s]+([^\\s\\n]+)`));
    return match?.[1] ?? "unknown";
  };
  summary.environment.cloud = extract("FLEET_CLOUD");
  summary.environment.region = extract("FLEET_REGION");
  summary.environment.runtime = extract("FLEET_RUNTIME");
  summary.environment.version = extract("FLEET_VERSION");
}

function parseInfraState(dir: string, summary: BundleParsedSummary): void {
  const raw = readFileIfExists(dir, "infra-state.json");
  if (!raw) {
    summary.parse_warnings.push("infra-state.json: not found");
    return;
  }
  const data = tryParseJson(raw, "infra-state.json", summary.parse_warnings) as any;
  if (!data) return;

  // Docker/Compose: data.containers array
  if (Array.isArray(data.containers)) {
    summary.infra.container_count = data.containers.length;
    summary.infra.unhealthy_containers = data.containers
      .filter((c: any) => {
        const st: string = (c.status ?? c.Status ?? "").toLowerCase();
        return st && !st.startsWith("up") && !st.startsWith("running");
      })
      .map((c: any) => c.name ?? c.Names ?? "unknown");
    return;
  }
  // K8s: data.pods array
  if (Array.isArray(data.pods)) {
    summary.infra.container_count = data.pods.length;
    summary.infra.unhealthy_containers = data.pods
      .filter((p: any) => p.status !== "Running")
      .map((p: any) => `${p.name} (${p.status})`);
  }
}

function parseAppLogs(dir: string, summary: BundleParsedSummary): void {
  const logsDir = path.join(dir, "app-logs");
  if (!fs.existsSync(logsDir)) {
    summary.parse_warnings.push("app-logs/: directory not found");
    return;
  }

  let totalLines = 0;
  const errorLines: string[] = [];
  const fatalLines: string[] = [];

  let logFiles: string[];
  try {
    logFiles = fs.readdirSync(logsDir);
  } catch {
    summary.parse_warnings.push("app-logs/: could not read directory");
    return;
  }

  for (const file of logFiles) {
    try {
      const content = fs.readFileSync(path.join(logsDir, file), "utf8");
      const lines = content.split("\n");
      totalLines += lines.length;
      for (const line of lines) {
        if (/\bFATAL\b/i.test(line)) {
          if (fatalLines.length < 20) fatalLines.push(line.slice(0, 300));
        } else if (/\bERROR\b/i.test(line)) {
          if (errorLines.length < 20) errorLines.push(line.slice(0, 300));
        }
      }
    } catch {
      summary.parse_warnings.push(`app-logs/${file}: could not read`);
    }
  }

  summary.logs.total_lines = totalLines;
  summary.logs.error_lines = errorLines;
  summary.logs.fatal_lines = fatalLines;
}

/**
 * Parse a support bundle ZIP and update the SupportBundle record.
 * Also posts an internal ticket message with a human-readable summary.
 * Never throws — all errors are caught and stored as parseError.
 */
export async function parseSupportBundle(
  bundlePath: string,
  bundleId: number,
  ticketId: number,
): Promise<void> {
  const tempDir = path.join(os.tmpdir(), `ekai-bundle-${bundleId}-${Date.now()}`);

  try {
    fs.mkdirSync(tempDir, { recursive: true });

    // Extract the ZIP
    await extractZip(bundlePath, tempDir);

    // The bundle may extract into a subdirectory named after the bundle
    let workDir = tempDir;
    const entries = fs.readdirSync(tempDir);
    if (entries.length === 1 && fs.statSync(path.join(tempDir, entries[0]!)).isDirectory()) {
      workDir = path.join(tempDir, entries[0]!);
    }

    const summary: BundleParsedSummary = {
      parsed_at: new Date().toISOString(),
      health: { overall_status: "unknown", collected_at: null, services: [] },
      versions: { ekai_version: "unknown", agent_version: "unknown", runtime: "unknown", host_os: "unknown" },
      preflight: { issue_count: 0, failures: [] },
      connectivity: { portal_reachable: false, failed_checks: [] },
      environment: { cloud: "unknown", region: "unknown", runtime: "unknown", version: "unknown" },
      infra: { container_count: 0, unhealthy_containers: [] },
      logs: { total_lines: 0, error_lines: [], fatal_lines: [] },
      parse_warnings: [],
    };

    parseHealthSnapshot(workDir, summary);
    parseVersionManifest(workDir, summary);
    parsePreflightCheck(workDir, summary);
    parseConnectivityCheck(workDir, summary);
    parseEnvSummary(workDir, summary);
    parseInfraState(workDir, summary);
    parseAppLogs(workDir, summary);

    const parsedSummaryJson = JSON.stringify(summary);

    await db
      .update(supportBundlesTable)
      .set({
        parsedSummary: parsedSummaryJson,
        overallStatus: summary.health.overall_status,
        issueCount: summary.preflight.issue_count,
        parsedAt: new Date(),
        parseError: null,
      })
      .where(eq(supportBundlesTable.id, bundleId));

    // Build a concise internal message
    const statusEmoji: Record<string, string> = {
      healthy: "✅",
      degraded: "⚠️",
      down: "🔴",
      unknown: "❓",
    };
    const emoji = statusEmoji[summary.health.overall_status] ?? "❓";
    const issueText =
      summary.preflight.issue_count > 0
        ? `${summary.preflight.issue_count} pre-flight issue(s) found`
        : "All pre-flight checks passed";

    const messageContent =
      `📦 **Support bundle parsed successfully.**\n\n` +
      `**Environment health:** ${emoji} ${summary.health.overall_status.toUpperCase()}\n` +
      `**Ekai version:** ${summary.versions.ekai_version}  |  **Agent:** ${summary.versions.agent_version}\n` +
      `**Runtime:** ${summary.versions.runtime}  |  **OS:** ${summary.versions.host_os}\n` +
      `**Pre-flight:** ${issueText}\n` +
      (summary.preflight.failures.length > 0
        ? `\nFailed checks:\n${summary.preflight.failures.map((f) => `• ${f}`).join("\n")}\n`
        : "") +
      `**Portal reachable:** ${summary.connectivity.portal_reachable ? "Yes" : "No"}\n` +
      `**Log errors found:** ${summary.logs.error_lines.length + summary.logs.fatal_lines.length}` +
      (summary.parse_warnings.length > 0
        ? `\n\n_Parse warnings: ${summary.parse_warnings.join("; ")}_`
        : "");

    // Update the existing "Parsing in progress..." message if it exists,
    // otherwise insert a new internal note
    const [existingMsg] = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticketId))
      .limit(50); // fetch recent messages and find our placeholder

    const allMsgs = await db
      .select()
      .from(ticketMessagesTable)
      .where(eq(ticketMessagesTable.ticketId, ticketId));

    const placeholder = allMsgs.find(
      (m) => m.isInternal && m.content.includes("Parsing in progress"),
    );

    if (placeholder) {
      await db
        .update(ticketMessagesTable)
        .set({ content: messageContent })
        .where(eq(ticketMessagesTable.id, placeholder.id));
    } else {
      await db.insert(ticketMessagesTable).values({
        ticketId,
        authorId: null,
        content: messageContent,
        isInternal: true,
      });
    }

    // If health is DOWN and we should suggest escalation, add another note
    if (summary.health.overall_status === "down") {
      const [ticket] = await db
        .select({ severity: ticketsTable.severity })
        .from(ticketsTable)
        .where(eq(ticketsTable.id, ticketId));

      if (ticket && ticket.severity !== "P1") {
        await db.insert(ticketMessagesTable).values({
          ticketId,
          authorId: null,
          content:
            "⚠️ Bundle health snapshot shows environment **DOWN**. Consider escalating to P1.",
          isInternal: true,
        });
      }
    }
  } catch (err: any) {
    const errMsg = err?.message ?? "Unknown parse error";
    await db
      .update(supportBundlesTable)
      .set({ parseError: errMsg, parsedAt: new Date() })
      .where(eq(supportBundlesTable.id, bundleId));

    // Update placeholder message to show error
    try {
      const allMsgs = await db
        .select()
        .from(ticketMessagesTable)
        .where(eq(ticketMessagesTable.ticketId, ticketId));
      const placeholder = allMsgs.find(
        (m) => m.isInternal && m.content.includes("Parsing in progress"),
      );
      if (placeholder) {
        await db
          .update(ticketMessagesTable)
          .set({ content: `📦 Bundle parse error: ${errMsg}` })
          .where(eq(ticketMessagesTable.id, placeholder.id));
      }
    } catch {
      // best effort
    }
  } finally {
    // Clean up temp directory
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
}
