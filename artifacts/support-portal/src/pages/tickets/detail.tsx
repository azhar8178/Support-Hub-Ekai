import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { 
  useGetTicket, 
  useAddTicketMessage,
  useAddTicketAttachment,
  useGetAttachmentContent,
  useChangeTicketStatus,
  useAssignTicket,
  useGetCurrentUser,
  useListAgents,
  useListTicketBundles,
  TicketStatus
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

import { 
  ArrowLeft, Paperclip, Send, Download, Loader2, User as UserIcon, Lock, Globe,
  Package, CheckCircle2, AlertTriangle, XCircle, HelpCircle, ChevronDown, ChevronUp, Upload
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SeverityBadge, StatusBadge } from "@/components/ticket-badges";
import { SlaIndicator } from "@/components/sla-indicator";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Link } from "wouter";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_BUNDLE_SIZE = 50 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Bundle health status helpers
// ---------------------------------------------------------------------------
type BundleStatus = "healthy" | "degraded" | "down" | "unknown" | "parsing" | "error";

function resolveBundleStatus(b: { overallStatus?: string | null; parsedAt?: string | null; parseError?: string | null }): BundleStatus {
  if (b.parseError) return "error";
  if (!b.parsedAt) return "parsing";
  return (b.overallStatus ?? "unknown") as BundleStatus;
}

function BundleStatusBadge({ status }: { status: BundleStatus }) {
  const map: Record<BundleStatus, { label: string; className: string; icon: React.ReactNode }> = {
    healthy:  { label: "Healthy",  className: "bg-emerald-100 text-emerald-700 border-emerald-200", icon: <CheckCircle2 className="h-3 w-3" /> },
    degraded: { label: "Degraded", className: "bg-amber-100 text-amber-700 border-amber-200",   icon: <AlertTriangle className="h-3 w-3" /> },
    down:     { label: "Down",     className: "bg-red-100 text-red-700 border-red-200",           icon: <XCircle className="h-3 w-3" /> },
    unknown:  { label: "Unknown",  className: "bg-stone-100 text-stone-600 border-stone-200",     icon: <HelpCircle className="h-3 w-3" /> },
    parsing:  { label: "Parsing…", className: "bg-blue-100 text-blue-700 border-blue-200",        icon: <Loader2 className="h-3 w-3 animate-spin" /> },
    error:    { label: "Parse Error", className: "bg-red-100 text-red-700 border-red-200",        icon: <XCircle className="h-3 w-3" /> },
  };
  const { label, className, icon } = map[status] ?? map.unknown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded border ${className}`}>
      {icon}{label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Parsed summary types (mirrors bundleParser.ts)
// ---------------------------------------------------------------------------
interface ServiceEntry { name: string; status: string; latency_ms?: number }
interface ParsedSummary {
  health: { overall_status: string; collected_at: string | null; services: ServiceEntry[] };
  versions: { ekai_version: string; agent_version: string; runtime: string; host_os: string };
  preflight: { issue_count: number; failures: string[] };
  connectivity: { portal_reachable: boolean; failed_checks: string[] };
  environment: { cloud: string; region: string; runtime: string; version: string };
  infra: { container_count: number; unhealthy_containers: string[] };
  logs: { total_lines: number; error_lines: string[]; fatal_lines: string[] };
  parse_warnings: string[];
}

// ---------------------------------------------------------------------------
// Agent bundle analysis panel
// ---------------------------------------------------------------------------
function AgentBundlePanel({
  bundle,
  ticketId,
  basePath,
}: {
  bundle: {
    id: number;
    filename: string;
    fileSizeBytes: number;
    parsedSummary?: string | null;
    overallStatus?: string | null;
    issueCount: number;
    parsedAt?: string | null;
    parseError?: string | null;
    uploadedAt: string;
  };
  ticketId: number;
  basePath: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const status = resolveBundleStatus(bundle);

  let parsed: ParsedSummary | null = null;
  if (bundle.parsedSummary) {
    try { parsed = JSON.parse(bundle.parsedSummary); } catch { /* ignore */ }
  }

  const handleDownload = async () => {
    try {
      setIsDownloading(true);
      const res = await fetch(
        `${basePath}/api/tickets/${ticketId}/bundles/${bundle.id}/download`,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = bundle.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <div className="border border-stone-200 rounded-lg bg-white overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 p-3 bg-stone-50/60">
        <Package className="h-4 w-4 text-amber-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-[#0F1F3D] truncate">{bundle.filename}</p>
          <p className="text-xs text-stone-400">
            {formatBytes(bundle.fileSizeBytes)} · uploaded {formatDateTime(bundle.uploadedAt)}
          </p>
        </div>
        <BundleStatusBadge status={status} />
        {parsed && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-stone-500 shrink-0"
            onClick={() => setExpanded(v => !v)}
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 px-2 shrink-0 text-stone-600"
          onClick={handleDownload}
          disabled={isDownloading}
        >
          {isDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
        </Button>
      </div>

      {bundle.parseError && (
        <div className="px-3 py-2 bg-red-50 border-t border-red-100 text-xs text-red-700">
          <strong>Parse error:</strong> {bundle.parseError}
        </div>
      )}

      {/* Expanded analysis */}
      {expanded && parsed && (
        <div className="border-t border-stone-100 p-4 space-y-5 text-sm">

          {/* Environment Health */}
          <section>
            <h5 className="font-semibold text-[#0F1F3D] mb-2">Environment Health</h5>
            {parsed.health.services.length > 0 ? (
              <div className="overflow-x-auto rounded border border-stone-100">
                <table className="w-full text-xs">
                  <thead className="bg-stone-50">
                    <tr>
                      <th className="text-left px-3 py-2 text-stone-500 font-medium">Service</th>
                      <th className="text-left px-3 py-2 text-stone-500 font-medium">Status</th>
                      <th className="text-right px-3 py-2 text-stone-500 font-medium">Latency</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {parsed.health.services.map((svc, i) => (
                      <tr key={i} className={svc.status !== "ok" && svc.status !== "healthy" ? "bg-red-50/40" : ""}>
                        <td className="px-3 py-2 font-medium text-[#0F1F3D]">{svc.name}</td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 ${
                            svc.status === "ok" || svc.status === "healthy"
                              ? "text-emerald-600"
                              : "text-red-600 font-medium"
                          }`}>
                            {svc.status === "ok" || svc.status === "healthy"
                              ? <CheckCircle2 className="h-3 w-3" />
                              : <XCircle className="h-3 w-3" />}
                            {svc.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right text-stone-500">
                          {svc.latency_ms != null ? `${svc.latency_ms} ms` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-stone-400 text-xs">No service data in this bundle.</p>
            )}
          </section>

          {/* Versions */}
          <section>
            <h5 className="font-semibold text-[#0F1F3D] mb-2">Versions</h5>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
              {[
                ["Ekai", parsed.versions.ekai_version],
                ["Fleet Agent", parsed.versions.agent_version],
                ["Runtime", parsed.versions.runtime],
                ["Host OS", parsed.versions.host_os],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <span className="text-stone-500 shrink-0">{k}</span>
                  <span className="font-mono text-[#0F1F3D] truncate">{v}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Pre-flight */}
          {parsed.preflight.failures.length > 0 && (
            <section>
              <h5 className="font-semibold text-[#0F1F3D] mb-2">
                Pre-flight Issues
                <span className="ml-2 text-xs font-normal text-red-600">({parsed.preflight.failures.length})</span>
              </h5>
              <ul className="space-y-1">
                {parsed.preflight.failures.map((f, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-red-700">
                    <XCircle className="h-3 w-3 mt-0.5 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Connectivity */}
          {parsed.connectivity.failed_checks.length > 0 && (
            <section>
              <h5 className="font-semibold text-[#0F1F3D] mb-2">Connectivity Failures</h5>
              <ul className="space-y-1">
                {parsed.connectivity.failed_checks.map((f, i) => (
                  <li key={i} className="text-xs text-red-700 flex items-start gap-2">
                    <XCircle className="h-3 w-3 mt-0.5 shrink-0" />{f}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* Log Errors */}
          {(parsed.logs.error_lines.length > 0 || parsed.logs.fatal_lines.length > 0) && (
            <section>
              <h5 className="font-semibold text-[#0F1F3D] mb-2">
                Log Errors
                <span className="ml-2 text-xs font-normal text-stone-500">
                  (last {parsed.logs.fatal_lines.length + parsed.logs.error_lines.length} of {parsed.logs.total_lines.toLocaleString()} lines)
                </span>
              </h5>
              <div className="bg-stone-900 rounded-md p-3 max-h-48 overflow-auto">
                <pre className="text-[11px] text-stone-200 font-mono leading-relaxed whitespace-pre-wrap break-all">
                  {[...parsed.logs.fatal_lines, ...parsed.logs.error_lines].join("\n")}
                </pre>
              </div>
            </section>
          )}

          {/* Parse warnings */}
          {parsed.parse_warnings.length > 0 && (
            <p className="text-xs text-stone-400 italic">
              Parse warnings: {parsed.parse_warnings.join(" · ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Customer bundle row
// ---------------------------------------------------------------------------
function CustomerBundleRow({ bundle }: {
  bundle: {
    id: number;
    filename: string;
    fileSizeBytes: number;
    overallStatus?: string | null;
    issueCount: number;
    uploadedAt: string;
    parsedAt?: string | null;
    parseError?: string | null;
  };
}) {
  const status = resolveBundleStatus(bundle);
  return (
    <div className="flex items-center gap-3 py-2 border-b border-stone-100 last:border-0">
      <Package className="h-4 w-4 text-stone-400 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-[#0F1F3D] truncate">{bundle.filename}</p>
        <p className="text-xs text-stone-400">{formatBytes(bundle.fileSizeBytes)} · {formatDateTime(bundle.uploadedAt)}</p>
      </div>
      <BundleStatusBadge status={status} />
      {bundle.issueCount > 0 && (
        <span className="text-xs text-red-600 font-medium shrink-0">{bundle.issueCount} issue{bundle.issueCount !== 1 ? "s" : ""}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Support Bundles section (inline in the ticket thread column)
// ---------------------------------------------------------------------------
function SupportBundlesSection({
  ticketId,
  isAgentOrAdmin,
  isClosed,
  basePath,
}: {
  ticketId: number;
  isAgentOrAdmin: boolean;
  isClosed: boolean;
  basePath: string;
}) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: bundles, refetch } = useListTicketBundles(ticketId, {
    query: {
      queryKey: ["bundles", ticketId],
      refetchInterval: (data) =>
        Array.isArray(data) && data.some((b) => !b.parsedAt && !b.parseError) ? 5000 : false,
    },
  });

  const handleUpload = async (file: File) => {
    const lower = file.name.toLowerCase();
    const validExt = lower.endsWith(".zip") || lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz");
    if (!validExt) {
      toast.error("Only ZIP or TAR bundles are accepted (.zip, .tar, .tar.gz, .tgz)"); return;
    }
    if (file.size > MAX_BUNDLE_SIZE) {
      toast.error("Bundle exceeds 50 MB limit"); return;
    }
    try {
      setUploading(true);
      const formData = new FormData();
      formData.append("bundle", file);
      const res = await fetch(
        `${basePath}/api/tickets/${ticketId}/bundles`,
        { method: "POST", body: formData },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.message ?? `Upload failed (${res.status})`);
      }
      toast.success("Bundle uploaded — parsing in progress");
      refetch();
    } catch (err: any) {
      toast.error(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Card className="shadow-sm border-stone-200">
      <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/50 flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-amber-600" />
          <h3 className="font-semibold text-[#0F1F3D]">Support Bundles</h3>
          {bundles && bundles.length > 0 && (
            <Badge variant="secondary" className="text-xs">{bundles.length}</Badge>
          )}
        </div>
        {!isClosed && (
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-amber-700 border-amber-200 hover:bg-amber-50"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Upload className="h-3.5 w-3.5" />
            }
            Upload Bundle
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".zip,.tar,.tar.gz,.tgz,application/zip,application/x-tar,application/gzip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleUpload(f);
            e.target.value = "";
          }}
        />
      </CardHeader>
      <CardContent className="pt-4">
        {(!bundles || bundles.length === 0) ? (
          <div
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragOver ? "border-amber-400 bg-amber-50" : "border-stone-200"
            } ${isClosed ? "opacity-50 cursor-not-allowed" : "cursor-pointer hover:border-amber-300 hover:bg-amber-50/30"}`}
            onDragOver={(e) => { if (!isClosed) { e.preventDefault(); setDragOver(true); } }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              if (isClosed) return;
              e.preventDefault(); setDragOver(false);
              const f = e.dataTransfer.files[0]; if (f) handleUpload(f);
            }}
            onClick={() => { if (!isClosed) fileInputRef.current?.click(); }}
          >
            <Package className="h-7 w-7 text-stone-300 mx-auto mb-2" />
            <p className="text-sm text-stone-500">No bundles yet.</p>
            {!isClosed && (
              <p className="text-xs text-stone-400 mt-1">
                Run <code className="font-mono bg-stone-100 px-1 py-0.5 rounded text-[11px]">support-bundle.sh</code> and drag &amp; drop the ZIP here.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {isAgentOrAdmin
              ? bundles.map((b) => (
                  <AgentBundlePanel key={b.id} bundle={b} ticketId={ticketId} basePath={basePath} />
                ))
              : bundles.map((b) => (
                  <CustomerBundleRow key={b.id} bundle={b} />
                ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export default function TicketDetailPage() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { data: user } = useGetCurrentUser();
  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [attachments, setAttachments] = useState<{file: File, base64: string}[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: detail, isLoading, error } = useGetTicket(ticketId, {
    query: {
      enabled: !!ticketId,
      queryKey: ["ticket", ticketId],
      refetchInterval: 30000,
    }
  });

  const { data: agents } = useListAgents({
    query: {
      enabled: user?.role === "admin" || user?.role === "ekai_agent",
      queryKey: ["agents"]
    }
  });

  const addMessage = useAddTicketMessage();
  const addAttachment = useAddTicketAttachment();
  const changeStatus = useChangeTicketStatus();
  const assignTicket = useAssignTicket();

  const isAgentOrAdmin = user?.role === "ekai_agent" || user?.role === "admin";
  const isClosed = detail?.ticket.status === "closed";

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;

    const validFiles = files.filter(f => {
      if (f.size > MAX_FILE_SIZE) {
        toast.error(`File ${f.name} exceeds 5MB`);
        return false;
      }
      return true;
    });

    for (const file of validFiles) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const base64String = event.target?.result as string;
        const base64Data = base64String.split(',')[1];
        setAttachments(prev => [...prev, { file, base64: base64Data }]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  };

  const handleReply = async () => {
    if (!replyContent.trim() && attachments.length === 0) return;
    
    try {
      setIsSubmitting(true);
      
      const msg = await addMessage.mutateAsync({
        id: ticketId,
        data: {
          content: replyContent,
          isInternal,
        }
      });

      for (const att of attachments) {
        await addAttachment.mutateAsync({
          id: ticketId,
          data: {
            filename: att.file.name,
            contentType: att.file.type || "application/octet-stream",
            data: att.base64,
            messageId: msg.id
          }
        });
      }

      setReplyContent("");
      setAttachments([]);
      setIsInternal(false);
      queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
      toast.success("Reply sent");
      
    } catch (err: any) {
      toast.error(err?.message || "Failed to send reply");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleStatusChange = (newStatus: TicketStatus) => {
    changeStatus.mutate({
      id: ticketId,
      data: { status: newStatus }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
        queryClient.invalidateQueries({ queryKey: ["tickets"] });
        toast.success(`Status changed to ${newStatus}`);
      },
      onError: (err: any) => toast.error(err?.message || "Failed to change status")
    });
  };

  const handleAssign = (agentId: string) => {
    assignTicket.mutate({
      id: ticketId,
      data: { assignedToId: agentId === "unassigned" ? null : Number(agentId) }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["ticket", ticketId] });
        toast.success("Ticket reassigned");
      },
      onError: (err: any) => toast.error(err?.message || "Failed to assign")
    });
  };

  const AttachmentDownload = ({ id, filename, sizeBytes }: { id: number, filename: string, sizeBytes: number }) => {
    const [isDownloading, setIsDownloading] = useState(false);
    
    const { refetch } = useGetAttachmentContent(id, {
      query: { enabled: false, queryKey: ["attachment", id] }
    });
    
    const handleDownload = async () => {
      try {
        setIsDownloading(true);
        const { data } = await refetch();
        if (!data) throw new Error("Failed to download");
        
        const byteCharacters = atob(data.data);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
          byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        const byteArray = new Uint8Array(byteNumbers);
        const blob = new Blob([byteArray], { type: data.contentType });
        
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = data.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } catch {
        toast.error("Download failed");
      } finally {
        setIsDownloading(false);
      }
    };

    return (
      <button 
        onClick={handleDownload} 
        disabled={isDownloading}
        className="flex items-center gap-2 px-3 py-2 bg-white border border-stone-200 rounded-md hover:bg-stone-50 transition-colors group"
      >
        {isDownloading ? <Loader2 className="h-4 w-4 animate-spin text-stone-400" /> : <Paperclip className="h-4 w-4 text-stone-400 group-hover:text-amber-600" />}
        <span className="text-sm font-medium text-[#0F1F3D] truncate max-w-[200px]">{filename}</span>
        <span className="text-xs text-stone-400 ml-1">{(sizeBytes / 1024).toFixed(1)} KB</span>
        <Download className="h-3.5 w-3.5 text-stone-300 group-hover:text-amber-600 ml-auto" />
      </button>
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center">
        <h2 className="text-xl font-bold text-[#0F1F3D]">Ticket Not Found</h2>
        <p className="text-stone-500 mt-2">The ticket you're looking for doesn't exist or you don't have access.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/tickets">Return to Tickets</Link>
        </Button>
      </div>
    );
  }

  const { ticket, messages, attachments: allAttachments, statusHistory } = detail;
  const ticketAttachments = allAttachments.filter(a => !a.messageId);

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Header bar */}
      <div className="bg-white border-b border-stone-200 px-4 sm:px-6 py-3 flex-shrink-0 sticky top-0 z-10 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" asChild className="text-stone-500 hover:text-[#0F1F3D] -ml-2 shrink-0">
            <Link href="/tickets">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-lg font-bold text-[#0F1F3D] tracking-tight shrink-0">#{ticket.id}</h1>
              <SeverityBadge severity={ticket.severity} />
              <StatusBadge status={ticket.status} />
              {ticket.bundleCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-100 px-1.5 py-0.5 rounded">
                  <Package className="h-3 w-3" />{ticket.bundleCount}
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500 truncate mt-0.5">{ticket.title}</p>
          </div>
        </div>

        {isAgentOrAdmin && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Select 
              value={ticket.assignedToId?.toString() || "unassigned"} 
              onValueChange={handleAssign}
            >
              <SelectTrigger className="w-[160px] h-8 text-sm">
                <UserIcon className="h-3.5 w-3.5 mr-1.5 text-stone-400 shrink-0" />
                <SelectValue placeholder="Assignee" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassigned" className="text-stone-500 italic">Unassigned</SelectItem>
                {agents?.map(agent => (
                  <SelectItem key={agent.id} value={agent.id.toString()}>{agent.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select 
              value={ticket.status} 
              onValueChange={(val) => handleStatusChange(val as TicketStatus)}
            >
              <SelectTrigger className="w-[150px] h-8 text-sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="triaged">Triaged</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="awaiting_customer">Awaiting Customer</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          
          {/* Main Content (Thread) */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Original Request */}
            <Card className="shadow-sm border-stone-200">
              <CardHeader className="bg-stone-50/50 pb-4 border-b border-stone-100">
                <h2 className="text-lg font-semibold text-[#0F1F3D]">{ticket.title}</h2>
                <div className="flex items-center gap-2 text-sm text-stone-500 mt-2">
                  <span className="font-medium text-[#0F1F3D]">{ticket.raisedByName}</span>
                  <span>•</span>
                  <span>{formatDateTime(ticket.createdAt)}</span>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <div className="prose prose-stone max-w-none text-sm whitespace-pre-wrap">
                  {ticket.description}
                </div>
                
                {ticketAttachments.length > 0 && (
                  <div className="mt-6 pt-4 border-t border-stone-100 flex flex-wrap gap-2">
                    {ticketAttachments.map(att => (
                      <AttachmentDownload key={att.id} {...att} />
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Conversation Thread */}
            {messages.length > 0 && (
              <div className="space-y-4">
                {messages.map((msg) => {
                  const msgAttachments = allAttachments.filter(a => a.messageId === msg.id);
                  const isAgent = msg.authorRole !== "customer";
                  
                  return (
                    <div 
                      key={msg.id} 
                      className={`flex gap-4 ${msg.isInternal ? 'ml-8' : ''}`}
                    >
                      <div className="flex-shrink-0 mt-1">
                        <div className={`h-8 w-8 rounded-full flex items-center justify-center font-semibold text-xs border ${
                          msg.isInternal ? 'bg-amber-100 text-amber-700 border-amber-200' :
                          isAgent ? 'bg-amber-100 text-amber-700 border-amber-200' : 
                          'bg-stone-100 text-stone-700 border-stone-200'
                        }`}>
                          {(msg.authorName ?? "S").charAt(0).toUpperCase()}
                        </div>
                      </div>
                      
                      <div className={`flex-1 rounded-xl p-4 border ${
                        msg.isInternal ? 'bg-amber-50/50 border-amber-200 shadow-sm' :
                        isAgent ? 'bg-white border-amber-100 shadow-sm' : 
                        'bg-white border-stone-200 shadow-sm'
                      }`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-[#0F1F3D] text-sm">{msg.authorName}</span>
                            {msg.isInternal && (
                              <span className="flex items-center text-[10px] font-bold tracking-wider uppercase text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                                <Lock className="h-3 w-3 mr-1" /> Internal Note
                              </span>
                            )}
                            {isAgent && !msg.isInternal && (
                              <span className="flex items-center text-[10px] font-bold tracking-wider uppercase text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-100">
                                Ekai Support
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-stone-400">{formatDateTime(msg.createdAt)}</span>
                        </div>
                        
                        <div className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed">
                          {msg.content}
                        </div>

                        {msgAttachments.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-black/5 flex flex-wrap gap-2">
                            {msgAttachments.map(att => (
                              <AttachmentDownload key={att.id} {...att} />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Reply Box */}
            {!isClosed ? (
              <div className={`rounded-xl border shadow-sm mt-8 ${isInternal ? 'border-amber-200 bg-amber-50/30' : 'border-stone-200 bg-white'}`}>
                <div className={`px-4 py-2.5 border-b flex items-center justify-between rounded-t-xl ${isInternal ? 'border-amber-200 bg-amber-50' : 'border-stone-100 bg-stone-50'}`}>
                  <div className="flex items-center gap-2">
                    {isInternal ? <Lock className="h-4 w-4 text-amber-600" /> : <Globe className="h-4 w-4 text-stone-400" />}
                    <span className={`text-sm font-medium ${isInternal ? 'text-amber-800' : 'text-stone-600'}`}>
                      {isInternal ? "Internal Note — hidden from customer" : "Reply to Customer"}
                    </span>
                  </div>
                  {isAgentOrAdmin && (
                    <div className="flex items-center gap-2">
                      <Label htmlFor="internal-toggle" className="text-xs text-stone-500 cursor-pointer select-none">Internal only</Label>
                      <Switch 
                        id="internal-toggle" 
                        checked={isInternal} 
                        onCheckedChange={setIsInternal}
                        className="data-[state=checked]:bg-amber-500"
                      />
                    </div>
                  )}
                </div>

                <div className="p-4">
                  <Textarea 
                    value={replyContent}
                    onChange={e => setReplyContent(e.target.value)}
                    placeholder={isInternal ? "Add an internal note for the team..." : "Type your reply..."}
                    className="min-h-[120px] border-0 focus-visible:ring-0 px-0 resize-y bg-transparent"
                  />
                </div>

                {attachments.length > 0 && (
                  <div className="px-4 pb-3 flex flex-wrap gap-2">
                    {attachments.map((att, idx) => (
                      <div key={idx} className="flex items-center bg-white border border-stone-200 rounded-md px-3 py-1.5 text-sm shadow-sm">
                        <Paperclip className="h-3 w-3 text-stone-400 mr-2 shrink-0" />
                        <span className="truncate max-w-[180px] text-stone-700">{att.file.name}</span>
                        <button 
                          type="button" 
                          onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))}
                          className="ml-2 text-stone-400 hover:text-red-500 transition-colors"
                          aria-label="Remove attachment"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className={`px-4 py-3 border-t flex items-center justify-between rounded-b-xl ${isInternal ? 'border-amber-100' : 'border-stone-100'}`}>
                  <div className="flex items-center gap-2">
                    <input 
                      id="reply-file" 
                      type="file" 
                      className="hidden" 
                      multiple 
                      accept="*/*"
                      onChange={handleFileChange}
                    />
                    <Button 
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 text-stone-600 border-stone-200 hover:border-stone-300 hover:bg-stone-50 gap-1.5"
                      onClick={() => document.getElementById("reply-file")?.click()}
                    >
                      <Paperclip className="h-3.5 w-3.5" />
                      Attach file
                    </Button>
                    {attachments.length > 0 && (
                      <span className="text-xs text-stone-400">{attachments.length} file{attachments.length > 1 ? 's' : ''} attached</span>
                    )}
                  </div>
                  <Button 
                    onClick={handleReply}
                    disabled={isSubmitting || (!replyContent.trim() && attachments.length === 0)}
                    className={`gap-2 ${isInternal ? 'bg-amber-600 hover:bg-amber-700 text-white' : 'bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D]'}`}
                  >
                    {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    {isInternal ? 'Save Note' : 'Send Reply'}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-stone-100 rounded-xl p-6 text-center text-stone-500 text-sm border border-stone-200 mt-8">
                This ticket is closed. If you need further assistance, please raise a new ticket.
              </div>
            )}

            {/* Support Bundles */}
            <SupportBundlesSection
              ticketId={ticketId}
              isAgentOrAdmin={isAgentOrAdmin}
              isClosed={!!isClosed}
              basePath={basePath}
            />
            
          </div>

          {/* Sidebar Properties */}
          <div className="space-y-6">
            <Card className="shadow-sm border-stone-200">
              <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/50">
                <h3 className="font-semibold text-[#0F1F3D]">Ticket Details</h3>
              </CardHeader>
              <CardContent className="pt-4 space-y-4 text-sm">
                
                <div className="grid grid-cols-2 gap-y-4">
                  <div className="text-stone-500">Organization</div>
                  <div className="font-medium text-[#0F1F3D]">{ticket.orgName}</div>
                  
                  <div className="text-stone-500">Category</div>
                  <div className="font-medium text-[#0F1F3D] capitalize">{ticket.category}</div>
                  
                  <div className="text-stone-500">Environment</div>
                  <div className="font-medium text-[#0F1F3D] capitalize">{ticket.environment}</div>
                  
                  <div className="text-stone-500">Assignee</div>
                  <div className="font-medium text-[#0F1F3D]">
                    {ticket.assignedToName || <span className="text-stone-400 italic">Unassigned</span>}
                  </div>
                </div>

                <Separator />

                <div>
                  <h4 className="font-medium text-[#0F1F3D] mb-3">Service Level Agreement</h4>
                  <div className="space-y-3">
                    <div className="bg-stone-50 p-3 rounded-lg border border-stone-100">
                      <SlaIndicator sla={ticket.sla} type="response" />
                    </div>
                    <div className="bg-stone-50 p-3 rounded-lg border border-stone-100">
                      <SlaIndicator sla={ticket.sla} type="resolution" />
                    </div>
                  </div>
                </div>

              </CardContent>
            </Card>

            {/* Status Timeline */}
            <Card className="shadow-sm border-stone-200">
              <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/50">
                <h3 className="font-semibold text-[#0F1F3D]">Activity History</h3>
              </CardHeader>
              <CardContent className="pt-4">
                <ol className="relative border-l border-stone-200 ml-2 space-y-4">
                  <li className="ml-4">
                    <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-amber-400 border-2 border-white ring-1 ring-amber-200" />
                    <p className="text-xs font-semibold text-[#0F1F3D]">{ticket.raisedByName}</p>
                    <p className="text-xs text-stone-500 mt-0.5">Ticket created</p>
                    <time className="text-[11px] text-stone-400">{formatDateTime(ticket.createdAt)}</time>
                  </li>
                  {statusHistory.map((entry) => (
                    <li key={entry.id} className="ml-4">
                      <div className="absolute -left-1.5 w-3 h-3 rounded-full bg-stone-300 border-2 border-white ring-1 ring-stone-200" />
                      <p className="text-xs font-semibold text-[#0F1F3D]">{entry.changedByName}</p>
                      <p className="text-xs text-stone-500 mt-0.5">
                        Status → <span className="font-medium text-[#0F1F3D]">{entry.toStatus.replace(/_/g, " ")}</span>
                      </p>
                      <time className="text-[11px] text-stone-400">{formatDateTime(entry.createdAt)}</time>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>

          </div>
        </div>
      </div>
    </div>
  );
}
