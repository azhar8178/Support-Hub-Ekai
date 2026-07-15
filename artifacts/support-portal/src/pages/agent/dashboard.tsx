import { useState, useMemo } from "react";
import { 
  useGetAgentMetrics, 
  getGetAgentMetricsQueryKey,
  useListTickets, 
  getListTicketsQueryKey,
  useBulkUpdateTickets,
  useListAgents,
  useGetTicketConfig,
  TicketStatus 
} from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Search, AlertTriangle, Clock, Activity, Users, LayoutDashboard, CheckSquare, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { SeverityBadge, StatusBadge } from "@/components/ticket-badges";
import { SlaIndicator } from "@/components/sla-indicator";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useDebounce } from "@/hooks/use-debounce";
import { toast } from "sonner";
import { queryClient } from "@/lib/queryClient";
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
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@radix-ui/react-select";

export default function AgentDashboardPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  
  // Filters
  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("open"); // Default to open tickets (not resolved/closed)
  const [unassignedOnly, setUnassignedOnly] = useState(false);
  
  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new window.Set());
  
  const { data: metrics, isLoading: metricsLoading } = useGetAgentMetrics({
    query: { queryKey: getGetAgentMetricsQueryKey(), refetchInterval: 30000 },
  });

  const { data: agents } = useListAgents();
  const { data: ticketConfig } = useGetTicketConfig();

  // Orval's API client handles the translation, but we need to map our "open" meta-status 
  // to omit resolved/closed via the API params if supported, or filter client-side.
  // The API spec expects specific enums. If "open" isn't a valid API enum, we fetch all and filter.
  const apiStatus = ["new", "triaged", "in_progress", "awaiting_customer", "resolved", "closed"].includes(status) ? status as TicketStatus : undefined;

  const ticketParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(severity !== "all" ? { severity } : {}),
    ...(apiStatus ? { status: apiStatus } : {}),
    ...(unassignedOnly ? { unassigned: true } : {}),
  };

  const { data: ticketsData, isLoading: ticketsLoading } = useListTickets(ticketParams, {
    query: {
      queryKey: getListTicketsQueryKey(ticketParams),
      refetchInterval: 30000,
    },
  });

  // Client side filtering for "open" meta status if API doesn't support array statuses
  const displayTickets = useMemo(() => {
    if (!ticketsData) return [];
    if (status === "open") {
      return ticketsData.filter(t => t.status !== "resolved" && t.status !== "closed");
    }
    return ticketsData;
  }, [ticketsData, status]);

  const bulkUpdate = useBulkUpdateTickets();

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedIds(new window.Set(displayTickets.map(t => t.id)));
    } else {
      setSelectedIds(new window.Set());
    }
  };

  const handleSelectOne = (id: number, checked: boolean) => {
    const next = new window.Set(selectedIds);
    if (checked) next.add(id);
    else next.delete(id);
    setSelectedIds(next);
  };

  const handleBulkAction = async (action: { status?: TicketStatus, assignedToId?: number | null }) => {
    if (selectedIds.size === 0) return;
    
    try {
      await bulkUpdate.mutateAsync({
        data: {
          ticketIds: Array.from(selectedIds),
          ...action
        }
      });
      
      toast.success(`Updated ${selectedIds.size} tickets`);
      setSelectedIds(new window.Set());
      queryClient.invalidateQueries({ queryKey: ["tickets"] });
      queryClient.invalidateQueries({ queryKey: ["agentMetrics"] });
    } catch (err: any) {
      toast.error(err?.message || "Bulk update failed");
    }
  };

  return (
    <div className="flex flex-col h-full bg-stone-50">
      <div className="p-6 pb-0 flex-shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D] mb-6">Agent Queue</h1>
        
        {/* Metrics Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <Card className="border-stone-200 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Open P1s</p>
                <div className="text-2xl font-bold text-red-600">
                  {metricsLoading ? "-" : metrics?.openP1Count || 0}
                </div>
              </div>
              <div className="p-2 bg-red-50 rounded-full text-red-600">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
          
          <Card className="border-stone-200 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Breaches Today</p>
                <div className="text-2xl font-bold text-amber-600">
                  {metricsLoading ? "-" : metrics?.slaBreachesToday || 0}
                </div>
              </div>
              <div className="p-2 bg-amber-50 rounded-full text-amber-600">
                <Clock className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Avg 1st Response</p>
                <div className="text-2xl font-bold text-[#0F1F3D]">
                  {metricsLoading ? "-" : metrics?.avgFirstResponseHoursThisWeek ? `${metrics.avgFirstResponseHoursThisWeek.toFixed(1)}h` : "N/A"}
                </div>
              </div>
              <div className="p-2 bg-amber-50 rounded-full text-amber-600">
                <Activity className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200 shadow-sm">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-stone-500 uppercase tracking-wider mb-1">Unassigned</p>
                <div className="text-2xl font-bold text-[#0F1F3D]">
                  {metricsLoading ? "-" : metrics?.unassignedCount || 0}
                </div>
              </div>
              <div className="p-2 bg-stone-100 rounded-full text-stone-600">
                <Users className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-stone-200 shadow-sm bg-amber-50/50 border-amber-100">
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-amber-800 uppercase tracking-wider mb-1">Total Open</p>
                <div className="text-2xl font-bold text-amber-900">
                  {metricsLoading ? "-" : metrics?.openTicketCount || 0}
                </div>
              </div>
              <div className="p-2 bg-amber-100 rounded-full text-amber-700">
                <LayoutDashboard className="h-5 w-5" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Filters & Actions */}
        <div className="flex flex-col sm:flex-row gap-4 mb-4 items-center justify-between">
          <div className="flex items-center gap-3 w-full sm:w-auto">
            <div className="relative w-64 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
              <Input 
                placeholder="Search..." 
                className="pl-9 h-9 text-sm bg-white"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-[140px] h-9 bg-white">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">All Open</SelectItem>
                <SelectItem value="new">New</SelectItem>
                <SelectItem value="triaged">Triaged</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="awaiting_customer">Awaiting Customer</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="all">Any Status</SelectItem>
              </SelectContent>
            </Select>

            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger className="w-[140px] h-9 bg-white">
                <SelectValue placeholder="Severity" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Any Severity</SelectItem>
                {ticketConfig?.severities.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            
            <div className="flex items-center space-x-2 ml-2">
              <Checkbox 
                id="unassigned" 
                checked={unassignedOnly}
                onCheckedChange={(c) => setUnassignedOnly(c as boolean)}
              />
              <label htmlFor="unassigned" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                Unassigned
              </label>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-auto">
            {selectedIds.size > 0 && (
              <div className="flex items-center gap-2 bg-amber-50 px-3 py-1.5 rounded-md border border-amber-100">
                <span className="text-sm font-medium text-amber-700">{selectedIds.size} selected</span>
                <div className="h-4 w-px bg-amber-200 mx-1" />
                
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-amber-700 hover:text-amber-800 hover:bg-amber-100 px-2">
                      Assign...
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Assign to Agent</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleBulkAction({ assignedToId: null })}>
                      Unassigned
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {agents?.map(agent => (
                      <DropdownMenuItem key={agent.id} onClick={() => handleBulkAction({ assignedToId: agent.id })}>
                        {agent.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 text-amber-700 hover:text-amber-800 hover:bg-amber-100 px-2">
                      Status...
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Change Status</DropdownMenuLabel>
                    <DropdownMenuItem onClick={() => handleBulkAction({ status: "triaged" })}>Triaged</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkAction({ status: "in_progress" })}>In Progress</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkAction({ status: "awaiting_customer" })}>Awaiting Customer</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkAction({ status: "resolved" })}>Resolved</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => handleBulkAction({ status: "closed" })}>Closed</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Queue Table */}
      <div className="flex-1 px-6 pb-6 min-h-0">
        <div className="h-full bg-white border border-stone-200 rounded-xl shadow-sm flex flex-col overflow-hidden">
          <div className="overflow-auto flex-1">
            <Table>
              <TableHeader className="bg-stone-50 sticky top-0 z-10 shadow-sm">
                <TableRow>
                  <TableHead className="w-12 text-center">
                    <Checkbox 
                      checked={displayTickets.length > 0 && selectedIds.size === displayTickets.length}
                      onCheckedChange={handleSelectAll}
                    />
                  </TableHead>
                  <TableHead className="w-[80px]">ID</TableHead>
                  <TableHead className="min-w-[300px]">Ticket</TableHead>
                  <TableHead>Org</TableHead>
                  <TableHead>Severity</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Assignee</TableHead>
                  <TableHead>SLA</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Last Activity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ticketsLoading ? (
                  [1, 2, 3, 4, 5, 6].map((i) => (
                    <TableRow key={i} className="animate-pulse">
                      <TableCell><div className="h-4 w-4 bg-stone-200 rounded"></div></TableCell>
                      <TableCell><div className="h-4 bg-stone-200 rounded w-8"></div></TableCell>
                      <TableCell><div className="h-4 bg-stone-200 rounded w-64 mb-1.5"></div><div className="h-3 bg-stone-100 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-4 bg-stone-200 rounded w-24"></div></TableCell>
                      <TableCell><div className="h-6 bg-stone-200 rounded-full w-20"></div></TableCell>
                      <TableCell><div className="h-6 bg-stone-200 rounded-full w-24"></div></TableCell>
                      <TableCell><div className="h-6 bg-stone-200 rounded-full w-8"></div></TableCell>
                      <TableCell><div className="h-4 bg-stone-200 rounded w-24"></div></TableCell>
                      <TableCell className="text-right"><div className="h-4 bg-stone-200 rounded w-20 ml-auto"></div></TableCell>
                    </TableRow>
                  ))
                ) : displayTickets.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center text-stone-500">
                        <CheckSquare className="h-10 w-10 mb-4 text-stone-300" />
                        <p className="text-lg font-medium text-[#0F1F3D]">Queue is empty</p>
                        <p className="text-sm mt-1">No tickets match your current filters.</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  displayTickets.map((ticket) => {
                    const isBreached = ticket.sla.responseBreached || ticket.sla.resolutionBreached;
                    return (
                      <TableRow 
                        key={ticket.id} 
                        className={`group transition-colors ${isBreached ? 'bg-red-50/30 hover:bg-red-50/50' : 'hover:bg-stone-50'}`}
                      >
                        <TableCell className="text-center" onClick={(e) => e.stopPropagation()}>
                          <Checkbox 
                            checked={selectedIds.has(ticket.id)}
                            onCheckedChange={(c) => handleSelectOne(ticket.id, c as boolean)}
                          />
                        </TableCell>
                        <TableCell className="font-medium text-stone-500 text-xs">#{ticket.id}</TableCell>
                        <TableCell>
                          <Link href={`/tickets/${ticket.id}`} className="block">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-[#0F1F3D] group-hover:text-amber-600 transition-colors line-clamp-1">{ticket.title}</span>
                              {ticket.bundleCount > 0 && (
                                <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${
                                  ticket.latestBundleStatus === "down"
                                    ? "bg-red-50 text-red-600 border-red-200"
                                    : ticket.latestBundleStatus === "degraded"
                                      ? "bg-amber-50 text-amber-700 border-amber-200"
                                      : "bg-stone-100 text-stone-500 border-stone-200"
                                }`}>
                                  <Package className="h-2.5 w-2.5" />
                                  {ticket.bundleCount}
                                </span>
                              )}
                            </div>
                            <div className="text-xs text-stone-500 mt-0.5">{ticket.category} • {ticket.environment}</div>
                          </Link>
                        </TableCell>
                        <TableCell className="text-sm font-medium text-[#0F1F3D]">{ticket.orgName}</TableCell>
                        <TableCell><SeverityBadge severity={ticket.severity} /></TableCell>
                        <TableCell><StatusBadge status={ticket.status} /></TableCell>
                        <TableCell>
                          {ticket.assignedToName ? (
                            <div className="flex items-center gap-1.5">
                              <div className="h-5 w-5 rounded-full bg-stone-200 flex items-center justify-center text-[10px] font-medium text-[#0F1F3D]">
                                {ticket.assignedToName.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm text-stone-700">{ticket.assignedToName.split(' ')[0]}</span>
                            </div>
                          ) : (
                            <span className="text-xs italic text-stone-400">Unassigned</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <SlaIndicator sla={ticket.sla} type="combined" />
                        </TableCell>
                        <TableCell className="text-right text-xs text-stone-500 whitespace-nowrap">
                          {formatDateTime(ticket.updatedAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </div>
    </div>
  );
}
