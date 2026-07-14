/**
 * Agent / Ops Health Dashboard
 * /agent/health
 *
 * All customer environments in one place with alert feed.
 * Admins and ekai_agents only.
 */

import { useState, useEffect } from "react";
import { Link } from "wouter";
import {
  useListAdminEnvironments,
  useListHealthAlerts,
  useAcknowledgeHealthAlert,
  useListAdminEnvironmentSnapshots,
  getListHealthAlertsQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import {
  Loader2,
  ChevronDown,
  ChevronUp,
  Activity,
  Bell,
  Check,
  ExternalLink,
} from "lucide-react";

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

const STATUS_COLORS: Record<string, { row: string; badge: string; dot: string }> = {
  HEALTHY:  { row: "",               badge: "bg-emerald-100 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" },
  DEGRADED: { row: "bg-amber-50/40", badge: "bg-amber-100 text-amber-700 border-amber-200",       dot: "bg-amber-500"   },
  DOWN:     { row: "bg-red-50/40",   badge: "bg-red-100 text-red-700 border-red-200",             dot: "bg-red-500"     },
  UNKNOWN:  { row: "bg-stone-50/40", badge: "bg-stone-100 text-stone-600 border-stone-200",       dot: "bg-stone-400"   },
};

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_COLORS[status] ?? STATUS_COLORS.UNKNOWN;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold border ${c.badge}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {status}
    </span>
  );
}

function relativeTime(iso: string | null) {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

// ---------------------------------------------------------------------------
// Inline service expansion
// ---------------------------------------------------------------------------

function InlineServices({ envId }: { envId: number }) {
  const { data: snapshots, isLoading } = useListAdminEnvironmentSnapshots(envId);

  if (isLoading) {
    return (
      <div className="py-4 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-stone-300" />
      </div>
    );
  }

  const latest = snapshots?.[0];
  const services: ServiceRow[] = latest ? (latest.services as unknown as ServiceRow[]) : [];

  if (!services.length) {
    return <p className="py-4 text-sm text-stone-400 text-center">No snapshot data yet.</p>;
  }

  return (
    <div className="py-3 px-4 bg-stone-50/80 border-t border-stone-200">
      <p className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-2">
        Latest snapshot — {latest ? new Date(latest.timestamp).toLocaleString() : ""}
      </p>
      <div className="space-y-1">
        {services.map((svc) => {
          const dot = STATUS_COLORS[svc.status.toUpperCase()]?.dot ?? STATUS_COLORS.UNKNOWN.dot;
          return (
            <div key={svc.name} className="flex items-center gap-4 text-sm">
              <span className={`h-2 w-2 rounded-full shrink-0 ${dot}`} />
              <span className="w-36 font-medium text-[#0F1F3D] truncate">{svc.name}</span>
              <span className="text-xs text-stone-400 w-16">{svc.type}</span>
              <span className="text-xs text-stone-500 w-20">{svc.latency_ms}ms</span>
              <span className="text-xs text-stone-500 w-14">
                {svc.cpu_percent !== null ? `CPU ${svc.cpu_percent.toFixed(0)}%` : ""}
              </span>
              <span className="text-xs text-stone-500">
                {svc.memory_percent !== null ? `Mem ${svc.memory_percent.toFixed(0)}%` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alert feed
// ---------------------------------------------------------------------------

function AlertFeed() {
  const { data: alerts, isLoading, refetch } = useListHealthAlerts();
  const ack = useAcknowledgeHealthAlert();

  useEffect(() => {
    const t = setInterval(() => { refetch(); }, 60_000);
    return () => clearInterval(t);
  }, [refetch]);

  const handleAck = async (id: number) => {
    try {
      await ack.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListHealthAlertsQueryKey() });
    } catch {
      toast.error("Failed to acknowledge");
    }
  };

  return (
    <div className="bg-white border border-stone-200 rounded-xl h-full flex flex-col">
      <div className="px-4 py-3 border-b border-stone-200 flex items-center gap-2">
        <Bell className="h-4 w-4 text-stone-500" />
        <h2 className="font-semibold text-sm text-[#0F1F3D]">Recent Alerts</h2>
        {alerts && alerts.filter((a) => !a.acknowledged).length > 0 && (
          <span className="ml-auto bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5">
            {alerts.filter((a) => !a.acknowledged).length}
          </span>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center h-24">
            <Loader2 className="h-5 w-5 animate-spin text-stone-300" />
          </div>
        ) : !alerts?.length ? (
          <div className="p-6 text-center text-sm text-stone-400">No alerts yet.</div>
        ) : (
          <div className="divide-y divide-stone-100">
            {alerts.slice(0, 20).map((alert) => (
              <div key={alert.id} className={`px-4 py-3 ${alert.acknowledged ? "opacity-50" : ""}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[#0F1F3D] truncate">
                      {alert.orgName} · {alert.envName}
                    </div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      {alert.alertType === "STATUS_CHANGE"
                        ? `${alert.fromStatus} → ${alert.toStatus}`
                        : "Missed heartbeat"}
                    </div>
                    <div className="text-[11px] text-stone-400 mt-0.5">
                      {relativeTime(alert.triggeredAt)}
                    </div>
                    {alert.linkedTicketId && (
                      <Link href={`/tickets/${alert.linkedTicketId}`} className="text-[11px] text-amber-600 hover:underline">
                        Ticket #{alert.linkedTicketId}
                      </Link>
                    )}
                  </div>
                  {!alert.acknowledged && (
                    <button
                      onClick={() => handleAck(alert.id)}
                      className="shrink-0 p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-emerald-600"
                      title="Acknowledge"
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AgentHealthPage() {
  const { data: envs, isLoading, refetch: refetchEnvs } = useListAdminEnvironments();

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterOrg, setFilterOrg]     = useState("");
  const [filterCloud, setFilterCloud] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterEnvType, setFilterEnvType] = useState("all");

  useEffect(() => {
    const t = setInterval(() => { refetchEnvs(); }, 60_000);
    return () => clearInterval(t);
  }, [refetchEnvs]);

  // Summary counts
  const counts = {
    total:    envs?.length ?? 0,
    healthy:  envs?.filter((e) => e.status === "HEALTHY").length  ?? 0,
    degraded: envs?.filter((e) => e.status === "DEGRADED").length ?? 0,
    down:     envs?.filter((e) => e.status === "DOWN").length     ?? 0,
    unknown:  envs?.filter((e) => e.status === "UNKNOWN").length  ?? 0,
  };

  const filtered = (envs ?? []).filter((e) => {
    if (filterOrg && !e.orgName?.toLowerCase().includes(filterOrg.toLowerCase())) return false;
    if (filterCloud !== "all" && e.cloud !== filterCloud) return false;
    if (filterStatus !== "all" && e.status !== filterStatus) return false;
    if (filterEnvType !== "all" && e.environment !== filterEnvType) return false;
    return true;
  });

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-8 py-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Health Overview</h1>
        <p className="text-stone-500 mt-1">All customer environments. Auto-refreshes every 60 s.</p>
      </div>

      <div className="flex-1 overflow-hidden flex gap-0">
        {/* Main panel */}
        <div className="flex-1 overflow-auto p-6 space-y-4">
          {/* Summary strip */}
          <div className="grid grid-cols-5 gap-3">
            {[
              { label: "Total",    count: counts.total,    color: "text-[#0F1F3D]",    bg: "bg-white" },
              { label: "Healthy",  count: counts.healthy,  color: "text-emerald-700",  bg: "bg-emerald-50" },
              { label: "Degraded", count: counts.degraded, color: "text-amber-700",    bg: "bg-amber-50" },
              { label: "Down",     count: counts.down,     color: "text-red-700",      bg: "bg-red-50" },
              { label: "Unknown",  count: counts.unknown,  color: "text-stone-600",    bg: "bg-stone-50" },
            ].map(({ label, count, color, bg }) => (
              <div key={label} className={`${bg} rounded-xl border border-stone-200 p-4 text-center`}>
                <div className={`text-2xl font-bold ${color}`}>{count}</div>
                <div className="text-xs text-stone-500 mt-1">{label}</div>
              </div>
            ))}
          </div>

          {/* Filter bar */}
          <div className="bg-white rounded-lg border border-stone-200 p-3 flex gap-3 flex-wrap items-center">
            <Input
              placeholder="Search organisation…"
              value={filterOrg}
              onChange={(e) => setFilterOrg(e.target.value)}
              className="w-52 h-8 text-sm"
            />
            {[
              { label: "Cloud", value: filterCloud, setter: setFilterCloud, options: ["all","aws","azure","gcp","other"] },
              { label: "Status", value: filterStatus, setter: setFilterStatus, options: ["all","HEALTHY","DEGRADED","DOWN","UNKNOWN"] },
              { label: "Env type", value: filterEnvType, setter: setFilterEnvType, options: ["all","production","staging","dev"] },
            ].map(({ label, value, setter, options }) => (
              <Select key={label} value={value} onValueChange={setter}>
                <SelectTrigger className="w-36 h-8 text-sm"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o} value={o}>{o === "all" ? `All ${label}s` : o}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ))}
            {filtered.length !== (envs?.length ?? 0) && (
              <span className="text-xs text-stone-400">{filtered.length} of {envs?.length} shown</span>
            )}
          </div>

          {/* Table */}
          {isLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="h-8 w-8 animate-spin text-stone-300" />
            </div>
          ) : !filtered.length ? (
            <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
              <Activity className="h-12 w-12 text-stone-300 mx-auto mb-4" />
              <p className="text-stone-500">No environments match the current filters.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
              <table className="w-full text-sm">
                <thead className="bg-stone-50 border-b border-stone-200">
                  <tr>
                    {["Org","Environment","Cloud","Region","Status","Last seen","Agent","Details",""].map((h) => (
                      <th key={h} className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((env) => {
                    const expanded = expandedId === env.id;
                    const rowBg = STATUS_COLORS[env.status]?.row ?? "";
                    return (
                      <>
                        <tr
                          key={env.id}
                          className={`${rowBg} hover:bg-stone-50/80 transition-colors cursor-pointer border-b border-stone-100`}
                          onClick={() => setExpandedId(expanded ? null : env.id)}
                        >
                          <td className="px-4 py-3 font-medium text-[#0F1F3D]">{env.orgName ?? "—"}</td>
                          <td className="px-4 py-3">
                            <div className="font-medium">{env.name}</div>
                            <div className="text-xs text-stone-400">{env.environment}</div>
                          </td>
                          <td className="px-4 py-3 uppercase text-stone-600">{env.cloud}</td>
                          <td className="px-4 py-3 text-stone-600">{env.region}</td>
                          <td className="px-4 py-3"><StatusBadge status={env.status} /></td>
                          <td className="px-4 py-3 text-stone-500">{relativeTime(env.lastSeen)}</td>
                          <td className="px-4 py-3 text-xs font-mono text-stone-400">{env.agentVersion ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Link
                              href={`/agent/health/${env.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-xs text-amber-600 hover:underline"
                            >
                              History <ExternalLink className="h-3 w-3" />
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-stone-400">
                            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </td>
                        </tr>
                        {expanded && (
                          <tr key={`${env.id}-expanded`} className="border-b border-stone-100">
                            <td colSpan={9} className="p-0">
                              <InlineServices envId={env.id} />
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Alert feed sidebar */}
        <div className="w-80 shrink-0 p-6 pl-0">
          <AlertFeed />
        </div>
      </div>
    </div>
  );
}
