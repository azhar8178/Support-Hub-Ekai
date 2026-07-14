/**
 * Agent / Ops — Environment Health Detail
 * /agent/health/:id
 *
 * 7-day status history chart, snapshot table, and alert log.
 */

import { useParams, Link } from "wouter";
import {
  useListAdminEnvironmentSnapshots,
  useListEnvironmentAlerts,
  useListAdminEnvironments,
  useAcknowledgeHealthAlert,
  getListEnvironmentAlertsQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { toast } from "sonner";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Loader2, ArrowLeft, Check } from "lucide-react";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_NUM: Record<string, number> = { DOWN: 0, DEGRADED: 1, HEALTHY: 2, UNKNOWN: -1 };
const NUM_STATUS: Record<number, string> = { 0: "DOWN", 1: "DEGRADED", 2: "HEALTHY", [-1]: "UNKNOWN" };

const STATUS_BADGE: Record<string, string> = {
  HEALTHY:  "bg-emerald-100 text-emerald-700 border-emerald-200",
  DEGRADED: "bg-amber-100 text-amber-700 border-amber-200",
  DOWN:     "bg-red-100 text-red-700 border-red-200",
  UNKNOWN:  "bg-stone-100 text-stone-600 border-stone-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold border ${STATUS_BADGE[status] ?? STATUS_BADGE.UNKNOWN}`}>
      {status}
    </span>
  );
}

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// 7-day hourly chart
// ---------------------------------------------------------------------------

interface ChartPoint {
  hour: string;
  statusNum: number;
  status: string;
}

function StatusHistoryChart({ snapshots }: { snapshots: Array<{ timestamp: string; overallStatus: string }> }) {
  const now = Date.now();
  const weekStart = now - 7 * 24 * 60 * 60 * 1000;

  const points: ChartPoint[] = Array.from({ length: 7 * 24 }, (_, i) => {
    const hStart = weekStart + i * 3_600_000;
    const hEnd   = hStart + 3_600_000;
    const inHour = snapshots.filter((s) => {
      const t = new Date(s.timestamp).getTime();
      return t >= hStart && t < hEnd;
    });
    const status = inHour.length === 0
      ? "UNKNOWN"
      : inHour.some((s) => s.overallStatus === "DOWN")     ? "DOWN"
      : inHour.some((s) => s.overallStatus === "DEGRADED") ? "DEGRADED"
      : "HEALTHY";

    return { hour: new Date(hStart).toISOString(), statusNum: STATUS_NUM[status] ?? -1, status };
  });

  return (
    <div className="h-56">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={points} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
          <XAxis
            dataKey="hour"
            tickFormatter={formatDate}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval={23}
          />
          <YAxis
            domain={[-1, 2]}
            ticks={[-1, 0, 1, 2]}
            tickFormatter={(v) => NUM_STATUS[v as number] ?? ""}
            tick={{ fill: "#94a3b8", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={65}
          />
          <Tooltip
            labelFormatter={(v) => formatDateTime(v as string)}
            formatter={(v) => [NUM_STATUS[v as number] ?? v, "Status"]}
            contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
          />
          <Line
            type="stepAfter"
            dataKey="statusNum"
            name="Status"
            stroke="#EFB323"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Snapshots table
// ---------------------------------------------------------------------------

function SnapshotsTable({ snapshots }: {
  snapshots: Array<{ id: number; timestamp: string; overallStatus: string; agentVersion: string; services: unknown[] }>;
}) {
  if (!snapshots.length) return <p className="text-sm text-stone-400 py-4 text-center">No snapshots yet.</p>;

  return (
    <div className="overflow-auto max-h-80 rounded-lg border border-stone-200">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 border-b border-stone-200 sticky top-0">
          <tr>
            {["Time", "Status", "Services", "Agent"].map((h) => (
              <th key={h} className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-4 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {snapshots.map((s) => (
            <tr key={s.id} className="hover:bg-stone-50">
              <td className="px-4 py-2 text-stone-600">{formatDateTime(s.timestamp)}</td>
              <td className="px-4 py-2"><StatusBadge status={s.overallStatus} /></td>
              <td className="px-4 py-2 text-stone-500">{(s.services as unknown[]).length}</td>
              <td className="px-4 py-2 font-mono text-xs text-stone-400">{s.agentVersion}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Alerts table
// ---------------------------------------------------------------------------

function AlertsTable({ envId }: { envId: number }) {
  const { data: alerts = [], isLoading } = useListEnvironmentAlerts(envId);
  const ack = useAcknowledgeHealthAlert();

  const handleAck = async (id: number) => {
    try {
      await ack.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListEnvironmentAlertsQueryKey(envId) });
    } catch {
      toast.error("Failed to acknowledge");
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-stone-300" /></div>;
  if (!alerts.length) return <p className="text-sm text-stone-400 py-4 text-center">No alerts for this environment.</p>;

  return (
    <div className="overflow-auto max-h-80 rounded-lg border border-stone-200">
      <table className="w-full text-sm">
        <thead className="bg-stone-50 border-b border-stone-200 sticky top-0">
          <tr>
            {["Time", "Type", "Transition", "Ticket", ""].map((h) => (
              <th key={h} className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-4 py-2">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {alerts.map((a) => (
            <tr key={a.id} className={`hover:bg-stone-50 ${a.acknowledged ? "opacity-50" : ""}`}>
              <td className="px-4 py-2 text-stone-600">{formatDateTime(a.triggeredAt)}</td>
              <td className="px-4 py-2 text-stone-600">{a.alertType.replace("_", " ")}</td>
              <td className="px-4 py-2">
                {a.fromStatus && a.toStatus
                  ? <><StatusBadge status={a.fromStatus} /><span className="mx-1 text-stone-400">→</span><StatusBadge status={a.toStatus} /></>
                  : "—"}
              </td>
              <td className="px-4 py-2">
                {a.linkedTicketId
                  ? <Link href={`/tickets/${a.linkedTicketId}`} className="text-amber-600 hover:underline text-xs">#{a.linkedTicketId}</Link>
                  : "—"}
              </td>
              <td className="px-4 py-2">
                {!a.acknowledged && (
                  <button
                    onClick={() => handleAck(a.id)}
                    className="p-1 rounded hover:bg-stone-100 text-stone-400 hover:text-emerald-600"
                    title="Acknowledge"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentHealthDetailPage() {
  const params = useParams<{ id: string }>();
  const envId = Number(params.id);

  const { data: allEnvs } = useListAdminEnvironments();
  const env = allEnvs?.find((e) => e.id === envId);

  const { data: snapshots = [], isLoading } = useListAdminEnvironmentSnapshots(envId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-stone-300" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-8 py-6 shrink-0">
        <Link href="/agent/health" className="inline-flex items-center gap-1 text-sm text-stone-500 hover:text-[#0F1F3D] mb-3">
          <ArrowLeft className="h-4 w-4" /> Back to Health Overview
        </Link>
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">
              {env?.name ?? `Environment #${envId}`}
            </h1>
            <p className="text-stone-500 mt-0.5">
              {env?.orgName} · {env?.cloud?.toUpperCase()} · {env?.region} · {env?.environment}
            </p>
          </div>
          {env?.status && <StatusBadge status={env.status} />}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-8 space-y-8">
        {/* 7-day chart */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-[#0F1F3D] mb-4">7-day status history</h2>
          <StatusHistoryChart snapshots={snapshots} />
          <p className="text-xs text-stone-400 mt-3 text-right">2 = HEALTHY · 1 = DEGRADED · 0 = DOWN · -1 = UNKNOWN</p>
        </div>

        {/* Snapshots */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-[#0F1F3D] mb-4">
            Snapshots <span className="text-stone-400 font-normal text-sm">({snapshots.length} in last 7 days)</span>
          </h2>
          <SnapshotsTable snapshots={snapshots} />
        </div>

        {/* Alerts */}
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-6">
          <h2 className="text-base font-semibold text-[#0F1F3D] mb-4">Health alerts</h2>
          <AlertsTable envId={envId} />
        </div>
      </div>
    </div>
  );
}
