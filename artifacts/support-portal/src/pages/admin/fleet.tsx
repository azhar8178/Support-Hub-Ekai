import { useState } from "react";
import {
  useListDeployments,
  useCreateDeployment,
  useDeleteDeployment,
  useUpdateDeployment,
  useListDeploymentHeartbeats,
  getListDeploymentsQueryKey,
} from "@workspace/api-client-react";
import type { Deployment } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import {
  CheckCircle2,
  AlertTriangle,
  WifiOff,
  Loader2,
  Plus,
  Trash2,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  Globe,
  Clock,
  Activity,
  Bell,
  BellOff,
  Pencil,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

function StatusBadge({ status }: { status: string }) {
  if (status === "healthy") {
    return (
      <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-100 gap-1">
        <CheckCircle2 className="h-3 w-3" />
        Healthy
      </Badge>
    );
  }
  if (status === "degraded") {
    return (
      <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 gap-1">
        <AlertTriangle className="h-3 w-3" />
        Degraded
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100 gap-1">
      <WifiOff className="h-3 w-3" />
      Offline
    </Badge>
  );
}

function timeAgo(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "Just now";
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86400_000) return `${Math.floor(diff / 3600_000)}h ago`;
  return `${Math.floor(diff / 86400_000)}d ago`;
}

interface DbHealth {
  status: string;
  latencyMs: number | null;
}

interface SparklineProps {
  data: Array<{ time: string; value: number | null }>;
  color: string;
  label: string;
  unit?: string;
  formatValue?: (v: number) => string;
  warnThreshold?: number; // value >= this turns the line amber/red
}

function Sparkline({ data, color, label, unit = "", formatValue, warnThreshold }: SparklineProps) {
  const hasData = data.some((d) => d.value != null);
  if (!hasData) return null;

  const latest = [...data].reverse().find((d) => d.value != null);
  const latestVal = latest?.value ?? null;
  const overThreshold = warnThreshold != null && latestVal != null && latestVal >= warnThreshold;
  const lineColor = overThreshold ? "#ef4444" : color;

  return (
    <div className="bg-stone-50 rounded-md p-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs text-stone-500">{label}</p>
        {latestVal != null && (
          <p className={`text-xs font-semibold ${overThreshold ? "text-red-600" : "text-[#0F1F3D]"}`}>
            {formatValue ? formatValue(latestVal) : `${latestVal}${unit}`}
          </p>
        )}
      </div>
      <div className="h-12">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
            <YAxis domain={["auto", "auto"]} hide />
            <Tooltip
              contentStyle={{ fontSize: 11, padding: "2px 6px", borderRadius: 4 }}
              labelFormatter={(_, payload) => {
                if (payload && payload[0]) {
                  const entry = payload[0].payload as { time: string };
                  return entry.time;
                }
                return "";
              }}
              formatter={(value: number) => [
                formatValue ? formatValue(value) : `${value}${unit}`,
                label,
              ]}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={lineColor}
              strokeWidth={1.5}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function DeploymentDetail({ deployment }: { deployment: Deployment }) {
  const { data: heartbeats } = useListDeploymentHeartbeats(deployment.id);

  const health = deployment.lastHealthJson as Record<string, unknown> | null;
  const dbHealth = (health?.["db"] ?? null) as DbHealth | null;

  // Build time-series arrays from heartbeat history (oldest → newest)
  const chronological = heartbeats ? [...heartbeats].reverse() : [];

  const dbLatencySeries = chronological.map((hb) => {
    const h = hb.healthJson as Record<string, unknown> | null;
    const db = h?.["db"] as DbHealth | null;
    return {
      time: new Date(hb.recordedAt).toLocaleTimeString(),
      value: db?.latencyMs ?? null,
    };
  });

  const openTicketSeries = chronological.map((hb) => {
    const h = hb.healthJson as Record<string, unknown> | null;
    const v = h?.["openTicketCount"];
    return {
      time: new Date(hb.recordedAt).toLocaleTimeString(),
      value: v != null ? Number(v) : null,
    };
  });

  const slaBreachSeries = chronological.map((hb) => {
    const h = hb.healthJson as Record<string, unknown> | null;
    const v = h?.["slaBreachCount"];
    return {
      time: new Date(hb.recordedAt).toLocaleTimeString(),
      value: v != null ? Number(v) : null,
    };
  });

  const hasSparklines =
    chronological.length > 1 &&
    (dbLatencySeries.some((d) => d.value != null) ||
      openTicketSeries.some((d) => d.value != null) ||
      slaBreachSeries.some((d) => d.value != null));

  return (
    <div className="mt-3 pt-3 border-t border-stone-100 space-y-4">
      {/* Health metrics — current snapshot */}
      {health && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {dbHealth && (
            <div className="bg-stone-50 rounded-md p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Database</p>
              <p
                className={`text-sm font-semibold ${
                  dbHealth.status === "healthy" ? "text-emerald-600" : "text-red-600"
                }`}
              >
                {dbHealth.status}
              </p>
              {dbHealth.latencyMs != null && (
                <p className="text-xs text-stone-400 mt-0.5">{dbHealth.latencyMs}ms</p>
              )}
            </div>
          )}
          {health["openTicketCount"] != null && (
            <div className="bg-stone-50 rounded-md p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Open Tickets</p>
              <p className="text-sm font-semibold text-[#0F1F3D]">
                {String(health["openTicketCount"])}
              </p>
            </div>
          )}
          {health["slaBreachCount"] != null && (
            <div className="bg-stone-50 rounded-md p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">SLA Breaches</p>
              <p
                className={`text-sm font-semibold ${
                  Number(health["slaBreachCount"]) > 0 ? "text-red-600" : "text-emerald-600"
                }`}
              >
                {String(health["slaBreachCount"])}
              </p>
            </div>
          )}
          {health["pushQueueDepth"] != null && (
            <div className="bg-stone-50 rounded-md p-3 text-center">
              <p className="text-xs text-stone-500 mb-1">Push Queue</p>
              <p className="text-sm font-semibold text-[#0F1F3D]">
                {String(health["pushQueueDepth"])}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 24 h trend sparklines */}
      {hasSparklines && (
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            24 h trends
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Sparkline
              data={dbLatencySeries}
              color="#6366f1"
              label="DB Latency"
              formatValue={(v) => `${v} ms`}
              warnThreshold={500}
            />
            <Sparkline
              data={openTicketSeries}
              color="#0ea5e9"
              label="Open Tickets"
              unit=""
            />
            <Sparkline
              data={slaBreachSeries}
              color="#10b981"
              label="SLA Breaches"
              unit=""
              warnThreshold={1}
            />
          </div>
        </div>
      )}

      {/* Heartbeat history bar */}
      {heartbeats && heartbeats.length > 0 && (
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Last 24 h — {heartbeats.length} heartbeats
          </p>
          <div className="flex gap-0.5 h-6 items-end">
            {heartbeats
              .slice(0, 60)
              .reverse()
              .map((hb) => (
                <div
                  key={hb.id}
                  title={`${hb.status} · ${new Date(hb.recordedAt).toLocaleTimeString()}`}
                  className={`flex-1 rounded-sm min-w-[4px] ${
                    hb.status === "healthy"
                      ? "bg-emerald-400"
                      : hb.status === "degraded"
                        ? "bg-amber-400"
                        : "bg-red-400"
                  }`}
                  style={{ height: hb.status === "healthy" ? "100%" : hb.status === "degraded" ? "66%" : "33%" }}
                />
              ))}
          </div>
        </div>
      )}

      {/* Link */}
      <a
        href={deployment.url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-xs text-amber-600 hover:text-amber-700 hover:underline"
      >
        <Globe className="h-3 w-3" />
        Open deployment
      </a>
    </div>
  );
}

function ApiKeyDisplay({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(apiKey).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#0F1F3D]">Deployment registered</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-md bg-amber-50 border border-amber-200 p-3">
            <p className="text-xs text-amber-800 font-medium mb-1">
              ⚠ Copy this API key now — it won't be shown again
            </p>
            <p className="text-xs text-amber-700">
              Set <code className="bg-amber-100 px-1 rounded">FLEET_HUB_URL</code> and{" "}
              <code className="bg-amber-100 px-1 rounded">FLEET_API_KEY</code> on the client
              deployment for it to start sending heartbeats.
            </p>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-stone-500">API Key</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 bg-stone-100 rounded-md px-3 py-2 text-xs font-mono break-all text-[#0F1F3D]">
                {apiKey}
              </code>
              <Button
                variant="outline"
                size="icon"
                className="shrink-0 h-8 w-8"
                onClick={handleCopy}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-emerald-600" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            onClick={onClose}
            className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SlackWebhookBadge({ url }: { url: string | null }) {
  if (url) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium">
        <Bell className="h-3 w-3" />
        Custom alerts
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-stone-400">
      <BellOff className="h-3 w-3" />
      Global alerts
    </span>
  );
}

function WebhookEditDialog({
  deployment,
  onClose,
}: {
  deployment: Deployment;
  onClose: () => void;
}) {
  const updateDeployment = useUpdateDeployment();
  const [value, setValue] = useState(deployment.slackWebhookUrl ?? "");
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDeploymentsQueryKey() });

  const handleSave = () => {
    updateDeployment.mutate(
      { id: deployment.id, data: { slackWebhookUrl: value.trim() || null } },
      {
        onSuccess: () => {
          toast.success("Alert destination updated");
          invalidate();
          onClose();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to update"),
      },
    );
  };

  const handleClear = () => {
    updateDeployment.mutate(
      { id: deployment.id, data: { slackWebhookUrl: null } },
      {
        onSuccess: () => {
          toast.success("Custom alert destination removed");
          invalidate();
          onClose();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to update"),
      },
    );
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-[#0F1F3D]">Alert destination — {deployment.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-stone-500">
            Set a Slack webhook URL to send this deployment's fleet alerts to a dedicated channel.
            Leave blank to use the global webhook from site settings.
          </p>
          <div className="space-y-2">
            <Label htmlFor="webhook-url" className="text-sm font-medium text-[#0F1F3D]">
              Slack Webhook URL
            </Label>
            <Input
              id="webhook-url"
              placeholder="https://hooks.slack.com/services/…"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="bg-white font-mono text-xs"
            />
          </div>
          {deployment.slackWebhookUrl && (
            <div className="rounded-md bg-stone-50 border border-stone-200 p-3 text-xs text-stone-500">
              Currently using a custom webhook. Clear it to fall back to the global setting.
            </div>
          )}
        </div>
        <DialogFooter className="gap-2">
          {deployment.slackWebhookUrl && (
            <Button
              variant="outline"
              onClick={handleClear}
              disabled={updateDeployment.isPending}
              className="text-stone-500 mr-auto"
            >
              Clear custom
            </Button>
          )}
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={updateDeployment.isPending}
            className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
          >
            {updateDeployment.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function FleetTab() {
  const { data: deployments, isLoading } = useListDeployments();
  const createDeployment = useCreateDeployment();
  const deleteDeployment = useDeleteDeployment();

  const [registerOpen, setRegisterOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newUrl, setNewUrl] = useState("");
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Deployment | null>(null);
  const [webhookTarget, setWebhookTarget] = useState<Deployment | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: getListDeploymentsQueryKey() });

  const handleRegister = () => {
    if (!newName.trim() || !newUrl.trim()) {
      toast.error("Name and URL are required");
      return;
    }
    createDeployment.mutate(
      { data: { name: newName.trim(), url: newUrl.trim() } },
      {
        onSuccess: (data) => {
          setNewApiKey(data.apiKey);
          setRegisterOpen(false);
          setNewName("");
          setNewUrl("");
          invalidate();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to register deployment"),
      },
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteDeployment.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast.success(`${deleteTarget.name} removed`);
          setDeleteTarget(null);
          invalidate();
        },
        onError: (err: any) => toast.error(err?.message || "Failed to remove deployment"),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-amber-500" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-stone-500">
          Register client Ekai deployments to monitor their health from this hub.
          Each deployment sends a heartbeat every 5 minutes when configured.
        </p>
        <Button
          onClick={() => setRegisterOpen(true)}
          size="sm"
          className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5 shrink-0"
        >
          <Plus className="h-4 w-4" />
          Register
        </Button>
      </div>

      {(!deployments || deployments.length === 0) ? (
        <div className="text-center py-16 text-stone-400">
          <WifiOff className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="text-sm font-medium">No deployments registered</p>
          <p className="text-xs mt-1">
            Click Register to add a client Ekai instance to monitor.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {deployments.map((dep) => {
            const expanded = expandedId === dep.id;
            return (
              <div
                key={dep.id}
                className="bg-white rounded-lg border border-stone-200 p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={dep.status} />
                      <span className="text-sm font-semibold text-[#0F1F3D]">{dep.name}</span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 flex-wrap">
                      <span className="text-xs text-stone-400 truncate max-w-[240px]">
                        {dep.url}
                      </span>
                      <span className="flex items-center gap-1 text-xs text-stone-400">
                        <Clock className="h-3 w-3" />
                        {timeAgo(dep.lastSeenAt)}
                      </span>
                      <button
                        onClick={() => setWebhookTarget(dep)}
                        className="flex items-center gap-1 hover:opacity-70 transition-opacity"
                        title="Configure alert destination"
                      >
                        <SlackWebhookBadge url={dep.slackWebhookUrl} />
                        <Pencil className="h-2.5 w-2.5 text-stone-300 ml-0.5" />
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-stone-400 hover:text-red-600"
                      onClick={() => setDeleteTarget(dep)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-stone-400 hover:text-[#0F1F3D]"
                      onClick={() => setExpandedId(expanded ? null : dep.id)}
                    >
                      {expanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                {expanded && <DeploymentDetail deployment={dep} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Register dialog */}
      <Dialog open={registerOpen} onOpenChange={setRegisterOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#0F1F3D]">Register deployment</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dep-name" className="text-sm font-medium text-[#0F1F3D]">
                Name
              </Label>
              <Input
                id="dep-name"
                placeholder="Acme Corp Production"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="dep-url" className="text-sm font-medium text-[#0F1F3D]">
                Deployment URL
              </Label>
              <Input
                id="dep-url"
                placeholder="https://support.acme.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                className="bg-white"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegisterOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleRegister}
              disabled={createDeployment.isPending}
              className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold gap-1.5"
            >
              {createDeployment.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Register
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* API key reveal */}
      {newApiKey && (
        <ApiKeyDisplay apiKey={newApiKey} onClose={() => setNewApiKey(null)} />
      )}

      {/* Webhook edit dialog */}
      {webhookTarget && (
        <WebhookEditDialog
          deployment={webhookTarget}
          onClose={() => setWebhookTarget(null)}
        />
      )}

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove deployment?</AlertDialogTitle>
            <AlertDialogDescription>
              <strong>{deleteTarget?.name}</strong> will be removed from the fleet monitor.
              The client deployment itself is not affected — only monitoring stops.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
