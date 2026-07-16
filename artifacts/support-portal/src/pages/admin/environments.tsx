/**
 * Admin — Customer Environment Management
 * /admin/environments
 *
 * Register customer environments, generate & reveal API keys, soft-delete.
 */

import { Fragment, useState } from "react";
import {
  useListAdminEnvironments,
  useListAdminEnvironmentSnapshots,
  useRegisterCustomerEnvironment,
  useDeleteCustomerEnvironment,
  useUpdateCustomerEnvironment,
  useRegenerateEnvironmentKey,
  useListOrgs,
  useCreateOrg,
  getListAdminEnvironmentsQueryKey,
  getListOrgsQueryKey,
} from "@workspace/api-client-react";
import type { CustomerEnvironment, HealthSnapshot, ServiceHealth } from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, Copy, Check, Loader2, Server, Trash2, AlertTriangle, Pencil, RefreshCw, BellOff, ChevronDown, ChevronUp, Activity } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  Tooltip,
  YAxis,
} from "recharts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function statusBadge(status: string) {
  const map: Record<string, string> = {
    HEALTHY:  "bg-emerald-100 text-emerald-800 border-emerald-200",
    DEGRADED: "bg-amber-100 text-amber-800 border-amber-200",
    DOWN:     "bg-red-100 text-red-800 border-red-200",
    OFFLINE:  "bg-red-100 text-red-800 border-red-200",
    UNKNOWN:  "bg-stone-100 text-stone-600 border-stone-200",
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${map[status] ?? map.UNKNOWN}`}>
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
// Health detail helpers
// ---------------------------------------------------------------------------

interface SparklineProps {
  data: Array<{ time: string; value: number | null }>;
  color: string;
  label: string;
  unit?: string;
  formatValue?: (v: number) => string;
  warnThreshold?: number;
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

function dbServiceFromSnapshot(s: HealthSnapshot): ServiceHealth | null {
  if (!s.services) return null;
  return s.services.find((svc) => svc.name === "db" || svc.type === "database") ?? null;
}

function platformMetrics(s: HealthSnapshot): Record<string, unknown> {
  try {
    return typeof s.platformJson === "string" ? JSON.parse(s.platformJson) : (s.platformJson as Record<string, unknown> ?? {});
  } catch {
    return {};
  }
}

function EnvironmentDetail({ envId }: { envId: number }) {
  const { data: snapshots, isLoading } = useListAdminEnvironmentSnapshots(envId);

  if (isLoading) {
    return (
      <div className="py-6 flex justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-stone-300" />
      </div>
    );
  }

  if (!snapshots || snapshots.length === 0) {
    return (
      <div className="py-6 text-center text-sm text-stone-400">
        No telemetry received yet. Deploy the fleet agent with <code className="bg-stone-100 px-1 rounded text-xs">FLEET_HUB_URL</code> and <code className="bg-stone-100 px-1 rounded text-xs">FLEET_API_KEY</code> set.
      </div>
    );
  }

  // Oldest → newest for charts
  const chronological = [...snapshots].reverse();
  const latest = snapshots[0];
  const latestDb = dbServiceFromSnapshot(latest);
  const latestPlatform = platformMetrics(latest);

  // Build sparkline series
  const dbLatencySeries = chronological.map((s) => ({
    time: new Date(s.timestamp).toLocaleTimeString(),
    value: dbServiceFromSnapshot(s)?.latency_ms ?? null,
  }));

  const openTicketSeries = chronological.map((s) => {
    const p = platformMetrics(s);
    const v = p["openTicketCount"];
    return { time: new Date(s.timestamp).toLocaleTimeString(), value: v != null ? Number(v) : null };
  });

  const slaBreachSeries = chronological.map((s) => {
    const p = platformMetrics(s);
    const v = p["slaBreachCount"];
    return { time: new Date(s.timestamp).toLocaleTimeString(), value: v != null ? Number(v) : null };
  });

  const hasSparklines =
    chronological.length > 1 &&
    (dbLatencySeries.some((d) => d.value != null) ||
      openTicketSeries.some((d) => d.value != null) ||
      slaBreachSeries.some((d) => d.value != null));

  return (
    <div className="space-y-4">
      {/* Current health snapshot tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {latestDb && (
          <div className="bg-stone-50 rounded-md p-3 text-center">
            <p className="text-xs text-stone-500 mb-1">Database</p>
            <p className={`text-sm font-semibold ${latestDb.status === "healthy" ? "text-emerald-600" : "text-red-600"}`}>
              {latestDb.status}
            </p>
            {latestDb.latency_ms != null && (
              <p className="text-xs text-stone-400 mt-0.5">{latestDb.latency_ms} ms</p>
            )}
          </div>
        )}
        {latestPlatform["openTicketCount"] != null && (
          <div className="bg-stone-50 rounded-md p-3 text-center">
            <p className="text-xs text-stone-500 mb-1">Open Tickets</p>
            <p className="text-sm font-semibold text-[#0F1F3D]">{String(latestPlatform["openTicketCount"])}</p>
          </div>
        )}
        {latestPlatform["slaBreachCount"] != null && (
          <div className="bg-stone-50 rounded-md p-3 text-center">
            <p className="text-xs text-stone-500 mb-1">SLA Breaches</p>
            <p className={`text-sm font-semibold ${Number(latestPlatform["slaBreachCount"]) > 0 ? "text-red-600" : "text-emerald-600"}`}>
              {String(latestPlatform["slaBreachCount"])}
            </p>
          </div>
        )}
        {latestPlatform["pushQueueDepth"] != null && (
          <div className="bg-stone-50 rounded-md p-3 text-center">
            <p className="text-xs text-stone-500 mb-1">Push Queue</p>
            <p className="text-sm font-semibold text-[#0F1F3D]">{String(latestPlatform["pushQueueDepth"])}</p>
          </div>
        )}
      </div>

      {/* 24 h trend sparklines */}
      {hasSparklines && (
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            24 h trends
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Sparkline data={dbLatencySeries} color="#6366f1" label="DB Latency" formatValue={(v) => `${v} ms`} warnThreshold={500} />
            <Sparkline data={openTicketSeries} color="#0ea5e9" label="Open Tickets" unit="" />
            <Sparkline data={slaBreachSeries} color="#10b981" label="SLA Breaches" unit="" warnThreshold={1} />
          </div>
        </div>
      )}

      {/* Heartbeat history bar */}
      {snapshots.length > 0 && (
        <div>
          <p className="text-xs font-medium text-stone-500 mb-2 flex items-center gap-1">
            <Activity className="h-3 w-3" />
            Last 24 h — {snapshots.length} heartbeats
          </p>
          <div className="flex gap-0.5 h-6 items-end">
            {snapshots
              .slice(0, 60)
              .reverse()
              .map((s, i) => {
                const st = s.overallStatus.toUpperCase();
                const color =
                  st === "HEALTHY" ? "bg-emerald-400" :
                  st === "DEGRADED" ? "bg-amber-400" : "bg-red-400";
                const height =
                  st === "HEALTHY" ? "100%" : st === "DEGRADED" ? "66%" : "33%";
                return (
                  <div
                    key={s.id ?? i}
                    title={`${s.overallStatus} · ${new Date(s.timestamp).toLocaleTimeString()}`}
                    className={`flex-1 rounded-sm min-w-[4px] ${color}`}
                    style={{ height }}
                  />
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Key Reveal Modal
// ---------------------------------------------------------------------------

function ApiKeyReveal({ apiKey, onClose }: { apiKey: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            Save your API key now
          </DialogTitle>
          <DialogDescription>
            This key will not be shown again. Copy it and provide it to your
            deployment team to configure the health agent.
          </DialogDescription>
        </DialogHeader>

        <div className="bg-stone-950 rounded-lg p-4 font-mono text-sm text-emerald-400 break-all select-all">
          {apiKey}
        </div>

        <div className="flex gap-2">
          <Button onClick={handleCopy} variant="outline" className="flex-1">
            {copied ? <Check className="h-4 w-4 mr-2 text-emerald-600" /> : <Copy className="h-4 w-4 mr-2" />}
            {copied ? "Copied!" : "Copy key"}
          </Button>
          <Button onClick={onClose} className="flex-1 bg-[#EFB323] hover:bg-amber-500 text-[#0F1F3D]">
            I've saved it
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Register Form
// ---------------------------------------------------------------------------

interface RegisterFormData {
  orgId: string;
  name: string;
  cloud: string;
  region: string;
  runtime: string;
  environment: string;
}

/** Small dialog to create a new organisation inline from the Register form. */
function NewOrgDialog({
  onCreated,
  onClose,
}: {
  onCreated: (id: string) => void;
  onClose: () => void;
}) {
  const createOrg = useCreateOrg();
  const [name, setName] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { toast.error("Organisation name is required"); return; }
    try {
      const org = await createOrg.mutateAsync({ data: { name: name.trim() } });
      await queryClient.invalidateQueries({ queryKey: getListOrgsQueryKey() });
      onCreated(String(org.id));
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to create organisation");
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New Organisation</DialogTitle>
          <DialogDescription>Create a new customer organisation.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>Name *</Label>
            <Input
              autoFocus
              placeholder="Acme Corp"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={onClose} disabled={createOrg.isPending}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 bg-[#EFB323] hover:bg-amber-500 text-[#0F1F3D]" disabled={createOrg.isPending}>
              {createOrg.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Edit Dialog
// ---------------------------------------------------------------------------

function EditDialog({
  env,
  onClose,
  onApiKey,
}: {
  env: CustomerEnvironment;
  onClose: () => void;
  onApiKey: (key: string) => void;
}) {
  const { data: orgs } = useListOrgs();
  const update = useUpdateCustomerEnvironment();
  const regenKey = useRegenerateEnvironmentKey();

  const [form, setForm] = useState({
    orgId: String(env.orgId),
    name: env.name,
    cloud: env.cloud,
    region: env.region,
    runtime: env.runtime,
    environment: env.environment,
    heartbeatMode: env.heartbeatMode,
    alertsEnabled: env.alertsEnabled,
    slackWebhookUrl: env.slackWebhookUrl ?? "",
  });
  const [showNewOrg, setShowNewOrg] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);

  const set = (key: keyof typeof form) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleOrgChange = (val: string) => {
    if (val === "__new__") { setShowNewOrg(true); return; }
    set("orgId")(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.region.trim()) {
      toast.error("Name and region are required");
      return;
    }
    try {
      await update.mutateAsync({
        id: env.id,
        data: {
          orgId: Number(form.orgId),
          name: form.name.trim(),
          cloud: form.cloud,
          region: form.region.trim(),
          runtime: form.runtime,
          environment: form.environment,
          heartbeatMode: form.heartbeatMode,
          alertsEnabled: form.alertsEnabled,
          slackWebhookUrl: form.slackWebhookUrl.trim() || null,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListAdminEnvironmentsQueryKey() });
      toast.success("Environment updated");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update environment");
    }
  };

  const handleRegen = async () => {
    try {
      const result = await regenKey.mutateAsync({ id: env.id });
      queryClient.invalidateQueries({ queryKey: getListAdminEnvironmentsQueryKey() });
      setConfirmRegen(false);
      onClose();
      onApiKey(result.apiKey);
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to regenerate key");
    }
  };

  return (
    <>
      {showNewOrg && (
        <NewOrgDialog
          onCreated={(id) => { set("orgId")(id); setShowNewOrg(false); }}
          onClose={() => setShowNewOrg(false)}
        />
      )}

      {/* Regenerate key confirmation */}
      <AlertDialog open={confirmRegen} onOpenChange={(o) => !o && setConfirmRegen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Regenerate API Key?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The current key for <strong>{env.name}</strong> will be invalidated immediately.
              Any agent using it will stop sending telemetry until reconfigured with the new key.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={regenKey.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRegen}
              disabled={regenKey.isPending}
              className="bg-amber-500 hover:bg-amber-600 text-white"
            >
              {regenKey.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
              Regenerate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Environment</DialogTitle>
            <DialogDescription>
              Update settings for <strong>{env.name}</strong>. API key prefix: <code className="font-mono text-xs bg-stone-100 px-1 rounded">{env.apiKeyPrefix}…</code>
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <Label>Organisation</Label>
              <Select value={form.orgId} onValueChange={handleOrgChange}>
                <SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger>
                <SelectContent modal={false}>
                  {orgs?.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                  ))}
                  <SelectItem value="__new__" className="text-[#EFB323] font-medium border-t mt-1 pt-1">
                    <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />Add new organisation…</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Environment name *</Label>
              <Input value={form.name} onChange={(e) => set("name")(e.target.value)} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Cloud</Label>
                <Select value={form.cloud} onValueChange={set("cloud")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent modal={false}>
                    {["aws","azure","gcp","snowflake","other"].map((c) => (
                      <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Region *</Label>
                <Input value={form.region} onChange={(e) => set("region")(e.target.value)} />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Runtime</Label>
                <Select value={form.runtime} onValueChange={set("runtime")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent modal={false}>
                    {["ecs","eks","aks","gke","docker","k8s","vm","spcs","other"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Environment type</Label>
                <Select value={form.environment} onValueChange={set("environment")}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent modal={false}>
                    {["production","staging","dev"].map((e) => (
                      <SelectItem key={e} value={e}>{e}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Heartbeat mode</Label>
              <Select value={form.heartbeatMode} onValueChange={set("heartbeatMode")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent modal={false}>
                  <SelectItem value="push">Client Push</SelectItem>
                  <SelectItem value="poll">Hub Poll</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Alerts toggle */}
            <div className="flex items-center justify-between gap-4 rounded-lg border border-stone-200 bg-stone-50 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-[#0F1F3D] flex items-center gap-1.5">
                  {!form.alertsEnabled && <BellOff className="h-3.5 w-3.5 text-stone-400" />}
                  Health alerts
                </p>
                <p className="text-xs text-stone-500 mt-0.5">
                  {form.alertsEnabled
                    ? "Alert records and auto-tickets are created for this environment"
                    : "Alerts suppressed — status still updates but no records or emails are sent"}
                </p>
              </div>
              <Switch
                checked={form.alertsEnabled}
                onCheckedChange={(v) => setForm((f) => ({ ...f, alertsEnabled: v }))}
                className="data-[state=checked]:bg-[#EFB323]"
              />
            </div>

            {/* Slack Webhook Override */}
            <div className="space-y-1">
              <Label>Slack Webhook Override</Label>
              <Input
                placeholder="https://hooks.slack.com/services/…"
                value={form.slackWebhookUrl}
                onChange={(e) => setForm((f) => ({ ...f, slackWebhookUrl: e.target.value }))}
              />
              <p className="text-xs text-stone-500">
                When set, fleet alerts for this environment go to this channel instead of the global webhook.
              </p>
            </div>

            {/* Regenerate key — separated visually */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-amber-900">API Key</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  Current prefix: <code className="font-mono">{env.apiKeyPrefix}…</code>
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="border-amber-400 text-amber-800 hover:bg-amber-100 shrink-0"
                onClick={() => setConfirmRegen(true)}
              >
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                Regenerate
              </Button>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={update.isPending}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1 bg-[#EFB323] hover:bg-amber-500 text-[#0F1F3D]" disabled={update.isPending}>
                {update.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Save changes
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

function RegisterDialog({ onClose }: { onClose: () => void }) {
  const { data: orgs } = useListOrgs();
  const create = useRegisterCustomerEnvironment();

  const [form, setForm] = useState<RegisterFormData>({
    orgId: "",
    name: "",
    cloud: "aws",
    region: "",
    runtime: "docker",
    environment: "production",
  });
  const [showNewOrg, setShowNewOrg] = useState(false);

  const set = (key: keyof RegisterFormData) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

  const handleOrgChange = (val: string) => {
    if (val === "__new__") { setShowNewOrg(true); return; }
    set("orgId")(val);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.orgId || !form.name.trim() || !form.region.trim()) {
      toast.error("Organisation, name, and region are required");
      return;
    }
    try {
      const result = await create.mutateAsync({
        data: {
          orgId: Number(form.orgId),
          name: form.name.trim(),
          cloud: form.cloud,
          region: form.region.trim(),
          runtime: form.runtime,
          environment: form.environment,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListAdminEnvironmentsQueryKey() });
      onClose();
      // Show the API key reveal modal — pass it up via event
      window.dispatchEvent(new CustomEvent("ekai:api-key-reveal", { detail: result.apiKey }));
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to register environment");
    }
  };

  return (
    <>
    {showNewOrg && (
      <NewOrgDialog
        onCreated={(id) => { set("orgId")(id); setShowNewOrg(false); }}
        onClose={() => setShowNewOrg(false)}
      />
    )}
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Register Customer Environment</DialogTitle>
          <DialogDescription>
            A cryptographic API key will be generated and shown once after creation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label>Organisation *</Label>
            {/* modal={false} prevents SelectContent from conflicting with the
                parent Dialog's focus trap, which caused the dropdown to close
                immediately on open. */}
            <Select value={form.orgId} onValueChange={handleOrgChange}>
              <SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger>
              <SelectContent modal={false}>
                {orgs?.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                ))}
                <SelectItem value="__new__" className="text-[#EFB323] font-medium border-t mt-1 pt-1">
                  <span className="flex items-center gap-1.5"><Plus className="h-3.5 w-3.5" />Add new organisation…</span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Environment name *</Label>
            <Input placeholder="e.g. Production" value={form.name} onChange={(e) => set("name")(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Cloud</Label>
              <Select value={form.cloud} onValueChange={set("cloud")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["aws","azure","gcp","snowflake","other"].map((c) => (
                    <SelectItem key={c} value={c}>{c.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Region *</Label>
              <Input placeholder="e.g. eu-west-1" value={form.region} onChange={(e) => set("region")(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Runtime</Label>
              <Select value={form.runtime} onValueChange={set("runtime")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["ecs","eks","aks","gke","docker","k8s","vm","spcs","other"].map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Environment type</Label>
              <Select value={form.environment} onValueChange={set("environment")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["production","staging","dev"].map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} className="flex-1" disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1 bg-[#EFB323] hover:bg-amber-500 text-[#0F1F3D]" disabled={create.isPending}>
              {create.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Plus className="h-4 w-4 mr-2" />}
              Register
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AdminEnvironmentsPage() {
  const { data: envs, isLoading } = useListAdminEnvironments();
  const deleteEnv = useDeleteCustomerEnvironment();

  const [showRegister, setShowRegister] = useState(false);
  const [editTarget, setEditTarget] = useState<CustomerEnvironment | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Listen for the api-key-reveal event fired from RegisterDialog
  useState(() => {
    const handler = (e: Event) => setRevealKey((e as CustomEvent).detail as string);
    window.addEventListener("ekai:api-key-reveal", handler);
    return () => window.removeEventListener("ekai:api-key-reveal", handler);
  });

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteEnv.mutateAsync({ id: deleteTarget.id });
      queryClient.invalidateQueries({ queryKey: getListAdminEnvironmentsQueryKey() });
      toast.success(`${deleteTarget.name} decommissioned`);
    } catch {
      toast.error("Failed to delete environment");
    } finally {
      setDeleteTarget(null);
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-8 py-6 shrink-0 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Customer Environments</h1>
          <p className="text-stone-500 mt-1">Register environments and manage telemetry API keys.</p>
        </div>
        <Button
          onClick={() => setShowRegister(true)}
          className="bg-[#EFB323] hover:bg-amber-500 text-[#0F1F3D] font-semibold"
        >
          <Plus className="h-4 w-4 mr-2" />
          Register Environment
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-8">
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-8 w-8 animate-spin text-stone-300" />
          </div>
        ) : !envs?.length ? (
          <div className="bg-white rounded-xl border border-stone-200 p-12 text-center">
            <Server className="h-12 w-12 text-stone-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[#0F1F3D] mb-1">No environments registered</h3>
            <p className="text-stone-500 mb-4">Register a customer environment to start receiving health telemetry.</p>
            <Button onClick={() => setShowRegister(true)} className="bg-[#EFB323] hover:bg-amber-500 text-[#0F1F3D]">
              <Plus className="h-4 w-4 mr-2" /> Register Environment
            </Button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-stone-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-stone-50 border-b border-stone-200">
                <tr>
                  {["Organisation", "Environment", "Mode", "Cloud / Region", "Runtime", "Status", "Last seen", "Key prefix", ""].map((h) => (
                    <th key={h} className="text-left text-xs font-semibold text-stone-500 uppercase tracking-wider px-4 py-3">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {envs.map((env) => {
                  const expanded = expandedId === env.id;
                  return (
                    <Fragment key={env.id}>
                      <tr className={`transition-colors ${expanded ? "bg-stone-50" : "hover:bg-stone-50"}`}>
                        <td className="px-4 py-3 font-medium text-[#0F1F3D]">{env.orgName ?? "—"}</td>
                        <td className="px-4 py-3">
                          <div className="font-medium">{env.name}</div>
                          <div className="text-xs text-stone-400">{env.environment}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${env.heartbeatMode === "poll" ? "bg-stone-100 text-stone-600 border-stone-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
                            {env.heartbeatMode === "poll" ? "Hub Poll" : "Client Push"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-medium uppercase">{env.cloud}</div>
                          <div className="text-xs text-stone-400">{env.region}</div>
                        </td>
                        <td className="px-4 py-3 text-stone-600">{env.runtime}</td>
                        <td className="px-4 py-3">{statusBadge(env.status)}</td>
                        <td className="px-4 py-3 text-stone-600">{relativeTime(env.lastSeen)}</td>
                        <td className="px-4 py-3 font-mono text-xs text-stone-500">{env.apiKeyPrefix}…</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-stone-500 hover:text-[#0F1F3D] hover:bg-stone-100"
                              onClick={() => setEditTarget(env)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                              onClick={() => setDeleteTarget({ id: env.id, name: env.name })}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-stone-400 hover:text-[#0F1F3D] hover:bg-stone-100"
                              onClick={() => setExpandedId(expanded ? null : env.id)}
                              title={expanded ? "Collapse" : "Show health details"}
                            >
                              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="bg-stone-50/80">
                          <td colSpan={9} className="px-6 py-4 border-t border-stone-100">
                            <EnvironmentDetail envId={env.id} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showRegister && <RegisterDialog onClose={() => setShowRegister(false)} />}
      {editTarget && (
        <EditDialog
          env={editTarget}
          onClose={() => setEditTarget(null)}
          onApiKey={(key) => { setEditTarget(null); setRevealKey(key); }}
        />
      )}
      {revealKey && <ApiKeyReveal apiKey={revealKey} onClose={() => setRevealKey(null)} />}

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Decommission "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The environment will be marked inactive and stop appearing in health dashboards.
              Historical snapshots are preserved. This cannot be undone from the UI.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={handleDelete}
              disabled={deleteEnv.isPending}
            >
              {deleteEnv.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Decommission
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
