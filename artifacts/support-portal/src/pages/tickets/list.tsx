import { useState } from "react";
import { useListTickets, getListTicketsQueryKey, TicketSeverity, TicketStatus } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { Search, Filter, PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { SeverityBadge, StatusBadge } from "@/components/ticket-badges";
import { SlaIndicator } from "@/components/sla-indicator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDebounce } from "@/hooks/use-debounce"; // We need to create this

export default function TicketsListPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [severity, setSeverity] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");

  const ticketParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(severity !== "all" ? { severity: severity as TicketSeverity } : {}),
    ...(status !== "all" ? { status: status as TicketStatus } : {}),
  };

  const { data: tickets, isLoading } = useListTickets(ticketParams, {
    query: {
      queryKey: getListTicketsQueryKey(ticketParams),
    },
  });

  return (
    <div className="p-8 max-w-7xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between mb-6 shrink-0">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Tickets</h1>
        </div>
        <Button asChild className="bg-[#2563EB] hover:bg-[#1d4ed8]">
          <Link href="/tickets/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            Raise New Ticket
          </Link>
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
          <Input 
            placeholder="Search tickets by ID, title, or description..." 
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[180px] bg-white">
            <Filter className="w-4 h-4 mr-2 text-slate-400" />
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="triaged">Triaged</SelectItem>
            <SelectItem value="in_progress">In Progress</SelectItem>
            <SelectItem value="awaiting_customer">Awaiting Customer</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severity} onValueChange={setSeverity}>
          <SelectTrigger className="w-[180px] bg-white">
            <Filter className="w-4 h-4 mr-2 text-slate-400" />
            <SelectValue placeholder="Severity" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Severities</SelectItem>
            <SelectItem value="P1">P1 Critical</SelectItem>
            <SelectItem value="P2">P2 High</SelectItem>
            <SelectItem value="P3">P3 Normal</SelectItem>
            <SelectItem value="P4">P4 Low</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-hidden bg-white border border-slate-200 rounded-xl shadow-sm flex flex-col">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="bg-slate-50 sticky top-0 z-10 shadow-sm">
              <TableRow>
                <TableHead className="w-[100px]">ID</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Severity</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Environment</TableHead>
                <TableHead>SLA</TableHead>
                <TableHead className="text-right">Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell><div className="h-4 bg-slate-200 rounded w-8"></div></TableCell>
                    <TableCell><div className="h-4 bg-slate-200 rounded w-48 mb-2"></div><div className="h-3 bg-slate-100 rounded w-24"></div></TableCell>
                    <TableCell><div className="h-6 bg-slate-200 rounded-full w-20"></div></TableCell>
                    <TableCell><div className="h-6 bg-slate-200 rounded-full w-24"></div></TableCell>
                    <TableCell><div className="h-4 bg-slate-200 rounded w-16"></div></TableCell>
                    <TableCell><div className="h-4 bg-slate-200 rounded w-24"></div></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-slate-200 rounded w-24 ml-auto"></div></TableCell>
                  </TableRow>
                ))
              ) : tickets?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-slate-500">
                      <Search className="h-8 w-8 mb-4 text-slate-300" />
                      <p className="text-lg font-medium text-[#0F1F3D]">No tickets found</p>
                      <p className="text-sm mt-1">Try adjusting your filters or search query.</p>
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                tickets?.map((ticket) => (
                  <TableRow 
                    key={ticket.id} 
                    className="cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setLocation(`/tickets/${ticket.id}`)}
                  >
                    <TableCell className="font-medium text-slate-500">#{ticket.id}</TableCell>
                    <TableCell>
                      <div className="font-medium text-[#0F1F3D]">{ticket.title}</div>
                      <div className="text-xs text-slate-500">{ticket.category}</div>
                    </TableCell>
                    <TableCell><SeverityBadge severity={ticket.severity} /></TableCell>
                    <TableCell><StatusBadge status={ticket.status} /></TableCell>
                    <TableCell>
                      <span className="capitalize text-sm text-slate-600">{ticket.environment}</span>
                    </TableCell>
                    <TableCell>
                      <SlaIndicator sla={ticket.sla} type="combined" />
                    </TableCell>
                    <TableCell className="text-right text-sm text-slate-500 whitespace-nowrap">
                      {formatDateTime(ticket.updatedAt)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
