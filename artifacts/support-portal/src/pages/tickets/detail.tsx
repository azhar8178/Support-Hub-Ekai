import { useEffect, useState, useRef } from "react";
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
  TicketStatus
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";

import { 
  ArrowLeft, Paperclip, Send, Download, Loader2, User as UserIcon, Lock, Globe 
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

export default function TicketDetailPage() {
  const { id } = useParams();
  const ticketId = Number(id);
  const { data: user } = useGetCurrentUser();
  const [replyContent, setReplyContent] = useState("");
  const [isInternal, setIsInternal] = useState(false);
  const [attachments, setAttachments] = useState<{file: File, base64: string}[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      } catch (err: any) {
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
  
  // Attachments not tied to a specific message are ticket-level (from creation)
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
                          {msg.authorName.charAt(0).toUpperCase()}
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
                {/* Toolbar top */}
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

                {/* Text area */}
                <div className="p-4">
                  <Textarea 
                    value={replyContent}
                    onChange={e => setReplyContent(e.target.value)}
                    placeholder={isInternal ? "Add an internal note for the team..." : "Type your reply..."}
                    className="min-h-[120px] border-0 focus-visible:ring-0 px-0 resize-y bg-transparent"
                  />
                </div>

                {/* Attached files */}
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

                {/* Footer actions */}
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
                  {/* Created entry — always at top */}
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
