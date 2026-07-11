import { TicketSeverity, TicketStatus } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export function SeverityBadge({ severity, className }: { severity: TicketSeverity, className?: string }) {
  const config = {
    [TicketSeverity.P1]: { label: "P1 Critical", className: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100" },
    [TicketSeverity.P2]: { label: "P2 High", className: "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100" },
    [TicketSeverity.P3]: { label: "P3 Normal", className: "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100" },
    [TicketSeverity.P4]: { label: "P4 Low", className: "bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100" },
  };

  const s = config[severity] || config[TicketSeverity.P4];

  return (
    <Badge variant="outline" className={cn("font-medium", s.className, className)}>
      {s.label}
    </Badge>
  );
}

export function StatusBadge({ status, className }: { status: TicketStatus, className?: string }) {
  const config = {
    [TicketStatus.new]: { label: "New", className: "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50" },
    [TicketStatus.triaged]: { label: "Triaged", className: "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-50" },
    [TicketStatus.in_progress]: { label: "In Progress", className: "bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-50" },
    [TicketStatus.awaiting_customer]: { label: "Awaiting Customer", className: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50" },
    [TicketStatus.resolved]: { label: "Resolved", className: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50" },
    [TicketStatus.closed]: { label: "Closed", className: "bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-100" },
  };

  const s = config[status] || config[TicketStatus.new];

  return (
    <Badge variant="outline" className={cn("font-medium", s.className, className)}>
      {s.label}
    </Badge>
  );
}
