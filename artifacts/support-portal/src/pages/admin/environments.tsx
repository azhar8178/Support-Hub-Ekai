/**
 * Admin — Customer Environment Management
 * /admin/environments
 *
 * Register customer environments, generate & reveal API keys, soft-delete.
 */

import { useState } from "react";
import {
  useListAdminEnvironments,
  useRegisterCustomerEnvironment,
  useDeleteCustomerEnvironment,
  useListOrgs,
  getListAdminEnvironmentsQueryKey,
} from "@workspace/api-client-react";
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
import { Plus, Copy, Check, Loader2, Server, Trash2, AlertTriangle } from "lucide-react";

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

  const set = (key: keyof RegisterFormData) => (val: string) =>
    setForm((f) => ({ ...f, [key]: val }));

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
            <Select value={form.orgId} onValueChange={set("orgId")}>
              <SelectTrigger><SelectValue placeholder="Select organisation" /></SelectTrigger>
              <SelectContent>
                {orgs?.map((o) => (
                  <SelectItem key={o.id} value={String(o.id)}>{o.name}</SelectItem>
                ))}
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
                  {["aws","azure","gcp","other"].map((c) => (
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
                  {["ecs","eks","aks","gke","docker","k8s","vm","other"].map((r) => (
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
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AdminEnvironmentsPage() {
  const { data: envs, isLoading } = useListAdminEnvironments();
  const deleteEnv = useDeleteCustomerEnvironment();

  const [showRegister, setShowRegister] = useState(false);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; name: string } | null>(null);

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
                {envs.map((env) => (
                  <tr key={env.id} className="hover:bg-stone-50 transition-colors">
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-red-500 hover:text-red-600 hover:bg-red-50"
                        onClick={() => setDeleteTarget({ id: env.id, name: env.name })}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modals */}
      {showRegister && <RegisterDialog onClose={() => setShowRegister(false)} />}
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
