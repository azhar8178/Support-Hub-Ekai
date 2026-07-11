import { TicketStatus } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

// Severities are admin-editable, so match known keys for colour but fall back
// gracefully (raw key + neutral styling) for custom or retired severities.
const SEVERITY_STYLES: Record<string, { label: string; className: string }> = {
  P1: { label: "P1 Critical", className: "bg-red-100 text-red-700 border-red-200 hover:bg-red-100" },
  P2: { label: "P2 High", className: "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-100" },
  P3: { label: "P3 Normal", className: "bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100" },
  P4: { label: "P4 Low", className: "bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-100" },
};

export function SeverityBadge({ severity, label, className }: { severity: string, label?: string, className?: string }) {
  const s = SEVERITY_STYLES[severity];
  const style = s?.className ?? "bg-stone-100 text-stone-700 border-stone-200 hover:bg-stone-100";
  const text = label ?? s?.label ?? severity;

  return (
    <Badge variant="outline" className={cn("font-medium", style, className)}>
      {text}
    </Badge>
  );
}

export function StatusBadge({ status, className }: { status: TicketStatus, className?: string }) {
  const config = {
    [TicketStatus.new]: { label: "New", className: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50" },
    [TicketStatus.triaged]: { label: "Triaged", className: "bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-50" },
    [TicketStatus.in_progress]: { label: "In Progress", className: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50" },
    [TicketStatus.awaiting_customer]: { label: "Awaiting Customer", className: "bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50" },
    [TicketStatus.resolved]: { label: "Resolved", className: "bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50" },
    [TicketStatus.closed]: { label: "Closed", className: "bg-stone-100 text-stone-600 border-stone-200 hover:bg-stone-100" },
  };

  const s = config[status] || config[TicketStatus.new];

  return (
    <Badge variant="outline" className={cn("font-medium", s.className, className)}>
      {s.label}
    </Badge>
  );
}
