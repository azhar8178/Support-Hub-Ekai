/**
 * Customer Health Dashboard
 * /health
 *
 * Shows health status for all environments belonging to the current user's org.
 * Auto-refreshes every 60 seconds.
 */

import { useEffect } from "react";
import { useListMyEnvironments, useListEnvironmentSnapshots } from "@workspace/api-client-react";
import { Loader2, Activity, AlertTriangle } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ServiceRow {
  name: string;
  type: string;
  status: string;
  cpu_percent: number | null;
  memory_percent: number | null;
  latency_ms: number;
  error_rate_percent: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  HEALTHY:  { bg: "bg-emerald-50 border-emerald-200", text: "text-emerald-700", dot: "bg-emerald-500" },
  DEGRADED: { bg: "bg-amber-50 border-amber-200",     text: "text-amber-700",   dot: "bg-amber-500"   },
  DOWN:     { bg: "bg-red-50 border-red-200",          text: "text-red-700",     dot: "bg-red-500"     },
  UNKNOWN:  { bg: "bg-stone-50 border-stone-200",      text: "text-stone-500",   dot: "bg-stone-400"   },
};

function StatusDot({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN;
  return <span className={`inline-block h-2.5 w-2.5 rounded-full ${c.dot}`} />;
}

function relativeTime(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function pct(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return `${val.toFixed(1)}%`;
}

function MiniBar({ value, color }: { value: number | null; color: string }) {
  const v = Math.min(100, Math.max(0, value ?? 0));
  return (
    <div className="flex items-center gap-1.5 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-stone-200 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs text-stone-500 w-8 text-right">{pct(value)}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 24h timeline bar (96 × 15-min buckets)
// ---------------------------------------------------------------------------

function TimelineBar({ snapshots }: { snapshots: Array<{ timestamp: string; overallStatus: string }> }) {
  const now = Date.now();
  const dayStart = now - 24 * 60 * 60 * 1000;

  const buckets = Array.from({ length: 96 }, (_, i) => {
    const bStart = dayStart + i * 15 * 60 * 1000;
    const bEnd   = bStart + 15 * 60 * 1000;
    const inBucket = snapshots.filter((s) => {
      const t = new Date(s.timestamp).getTime();
      return t >= bStart && t < bEnd;
    });
    if (!inBucket.length) return "UNKNOWN";
    if (inBucket.some((s) => s.overallStatus === "DOWN"))     return "DOWN";
    if (inBucket.some((s) => s.overallStatus === "DEGRADED")) return "DEGRADED";
    return "HEALTHY";
  });

  const colorMap: Record<string, string> = {
    HEALTHY:  "bg-emerald-500",
    DEGRADED: "bg-amber-400",
    DOWN:     "bg-red-500",
    UNKNOWN:  "bg-stone-200",
  };

  return (
    <div>
      <div className="flex items-center justify-between text-xs text-stone-400 mb-1">
        <span>24h ago</span>
        <span>Now</span>
      </div>
      <div className="flex gap-px h-5 rounded overflow-hidden">
        {buckets.map((status, i) => (
          <div
            key={i}
            className={`flex-1 ${colorMap[status]} transition-colors`}
            title={`${new Date(dayStart + i * 15 * 60 * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}: ${status}`}
          />
        ))}
      </div>
      <div className="flex gap-4 mt-2">
        {(["HEALTHY","DEGRADED","DOWN","UNKNOWN"] as const).map((s) => (
          <span key={s} className="flex items-center gap-1 text-xs text-stone-500">
            <span className={`inline-block h-2 w-2 rounded-sm ${colorMap[s]}`} />
            {s.charAt(0) + s.slice(1).toLowerCase()}
          </span>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single environment card (auto-refreshes snapshots every 60s)
// ---------------------------------------------------------------------------

function EnvCard({ env }: { env: { id: number; name: string; cloud: string; region: string; environment: string; status: string; lastSeen: string | null; agentVersion: string | null } }) {
  const { data: snapshots = [], refetch } = useListEnvironmentSnapshots(env.id);

  useEffect(() => {
    const t = setInterval(() => { refetch(); }, 60_000);
    return () => clearInterval(t);
  }, [refetch]);

  const latest = snapshots[0];
  const services: ServiceRow[] = latest ? (latest.services as unknown as ServiceRow[]) : [];
  const c = STATUS_COLORS[env.status] ?? STATUS_COLORS.UNKNOWN;

  return (
    <div className={`bg-white rounded-xl border-2 ${c.bg} shadow-sm overflow-hidden`}>
      {/* Card header */}
      <div className="px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-[#0F1F3D]">{env.name}</h2>
            <span className="text-xs uppercase font-semibold px-2 py-0.5 rounded-full bg-stone-100 text-stone-600">
              {env.environment}
            </span>
          </div>
          <div className="text-sm text-stone-500">
            {env.cloud.toUpperCase()} · {env.region}
          </div>
        </div>

        <div className="text-right">
          <div className={`text-2xl font-bold ${c.text} flex items-center gap-2`}>
            <StatusDot status={env.status} />
            {env.status}
          </div>
          <div className="text-xs text-stone-400 mt-1">Last seen {relativeTime(env.lastSeen)}</div>
          {env.agentVersion && (
            <div className="text-xs text-stone-400">Agent v{env.agentVersion}</div>
          )}
        </div>
      </div>

      {/* Missed heartbeat banner */}
      {env.status === "UNKNOWN" && (
        <div className="mx-6 mb-4 p-3 rounded-lg bg-stone-100 border border-stone-200 flex items-start gap-2">
          <AlertTriangle className="h-4 w-4 text-stone-500 shrink-0 mt-0.5" />
          <p className="text-sm text-stone-600">
            No heartbeat received in the last 10 minutes. This may indicate the health agent is not running.
          </p>
        </div>
      )}

      {/* Services grid */}
      {services.length > 0 && (
        <div className="px-6 pb-4">
          <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Services</h3>
          <div className="space-y-2">
            {services.map((svc) => (
              <div key={svc.name} className="flex items-center gap-4 py-2 border-b border-stone-100 last:border-0">
                <div className="flex items-center gap-2 w-40 shrink-0">
                  <StatusDot status={svc.status.toUpperCase()} />
                  <div>
                    <div className="text-sm font-medium text-[#0F1F3D] truncate">{svc.name}</div>
                    <div className="text-xs text-stone-400">{svc.type}</div>
                  </div>
                </div>
                <MiniBar value={svc.cpu_percent} color="bg-blue-500" />
                <MiniBar value={svc.memory_percent} color="bg-purple-500" />
                <div className="text-xs text-stone-500 w-20 text-right">{svc.latency_ms}ms</div>
                <div className="text-xs text-stone-500 w-16 text-right">{svc.error_rate_percent.toFixed(1)}% err</div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 mt-2 text-xs text-stone-400">
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-blue-500 inline-block" />CPU</span>
            <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-purple-500 inline-block" />Memory</span>
          </div>
        </div>
      )}

      {/* 24h timeline */}
      <div className="px-6 pb-5">
        <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Last 24 hours</h3>
        <TimelineBar snapshots={snapshots} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function HealthPage() {
  const { data: envs, isLoading, refetch: refetchEnvs } = useListMyEnvironments();

  useEffect(() => {
    const t = setInterval(() => { refetchEnvs(); }, 60_000);
    return () => clearInterval(t);
  }, [refetchEnvs]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-stone-300" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-8 py-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Environment Health</h1>
        <p className="text-stone-500 mt-1">Real-time health of your deployed environments. Auto-refreshes every 60 s.</p>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {!envs?.length ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
            <Activity className="h-12 w-12 text-stone-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[#0F1F3D] mb-1">No environments registered</h3>
            <p className="text-stone-500">Contact your Ekai support team to set up health monitoring for your deployments.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {envs.map((env) => (
              <EnvCard key={env.id} env={env} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
