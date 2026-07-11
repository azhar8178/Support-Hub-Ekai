import { useGetDashboardSummary } from "@workspace/api-client-react";
import { Link } from "wouter";
import { PlusCircle, Ticket as TicketIcon, Clock, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/lib/utils";
import { SeverityBadge, StatusBadge } from "@/components/ticket-badges";
import { SlaIndicator } from "@/components/sla-indicator";

export default function DashboardPage() {
  const { data: summary, isLoading } = useGetDashboardSummary();

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="h-8 w-64 bg-slate-200 rounded animate-pulse mb-8"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardContent className="h-32"></CardContent>
            </Card>
          ))}
        </div>
        <div className="h-64 bg-slate-100 rounded-xl animate-pulse"></div>
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Dashboard</h1>
          <p className="text-slate-500 mt-1">Overview of your support tickets and recent activity.</p>
        </div>
        <Button asChild className="bg-[#2563EB] hover:bg-[#1d4ed8]">
          <Link href="/tickets/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            Raise New Ticket
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-blue-50 rounded-full">
                <TicketIcon className="h-6 w-6 text-[#2563EB]" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Open Tickets</p>
                <h3 className="text-3xl font-bold text-[#0F1F3D]">{summary.openCount}</h3>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-indigo-50 rounded-full">
                <Clock className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">In Progress</p>
                <h3 className="text-3xl font-bold text-[#0F1F3D]">{summary.inProgressCount}</h3>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center space-x-4">
              <div className="p-3 bg-emerald-50 rounded-full">
                <CheckCircle2 className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-500">Resolved (30d)</p>
                <h3 className="text-3xl font-bold text-[#0F1F3D]">{summary.resolvedLast30Days}</h3>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-lg text-[#0F1F3D]">Recent Tickets</CardTitle>
          <Button variant="link" className="text-[#2563EB]" asChild>
            <Link href="/tickets">View all</Link>
          </Button>
        </CardHeader>
        <CardContent>
          {summary.recentTickets.length === 0 ? (
            <div className="text-center py-12">
              <TicketIcon className="mx-auto h-12 w-12 text-slate-300 mb-4" />
              <h3 className="text-lg font-medium text-[#0F1F3D]">No recent tickets</h3>
              <p className="text-slate-500 mt-1 mb-6">You don't have any recent support tickets.</p>
              <Button asChild variant="outline">
                <Link href="/tickets/new">Create your first ticket</Link>
              </Button>
            </div>
          ) : (
            <div className="rounded-md border border-slate-200">
              <Table>
                <TableHeader className="bg-slate-50">
                  <TableRow>
                    <TableHead>Ticket</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Environment</TableHead>
                    <TableHead>SLA</TableHead>
                    <TableHead className="text-right">Last Updated</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.recentTickets.map((ticket) => (
                    <TableRow key={ticket.id} className="cursor-pointer hover:bg-slate-50 transition-colors" onClick={() => window.location.href = `/tickets/${ticket.id}`}>
                      <TableCell>
                        <div className="font-medium text-[#0F1F3D]">{ticket.title}</div>
                        <div className="text-xs text-slate-500">#{ticket.id} • {ticket.category}</div>
                      </TableCell>
                      <TableCell><SeverityBadge severity={ticket.severity} /></TableCell>
                      <TableCell><StatusBadge status={ticket.status} /></TableCell>
                      <TableCell>
                        <span className="capitalize text-sm text-slate-600">{ticket.environment}</span>
                      </TableCell>
                      <TableCell>
                        <SlaIndicator sla={ticket.sla} type="combined" />
                      </TableCell>
                      <TableCell className="text-right text-sm text-slate-500">
                        {formatDateTime(ticket.updatedAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
