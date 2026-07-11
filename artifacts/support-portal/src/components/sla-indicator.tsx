import { SlaInfo } from "@workspace/api-client-react";
import { Clock, CheckCircle2, AlertTriangle, PauseCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateTime } from "@/lib/utils";

interface SlaIndicatorProps {
  sla: SlaInfo;
  type: "response" | "resolution" | "combined";
}

export function SlaIndicator({ sla, type }: SlaIndicatorProps) {
  if (sla.resolutionPlanned && type !== "response") {
    if (type === "combined" && sla.responseMet) {
      return (
        <div className="flex items-center text-xs font-medium text-slate-500">
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          Planned
        </div>
      );
    } else if (type === "resolution") {
      return (
        <div className="flex items-center text-xs font-medium text-slate-500">
          <Clock className="mr-1.5 h-3.5 w-3.5" />
          Planned
        </div>
      );
    }
  }

  const renderIndicator = (
    met: boolean | null,
    breached: boolean,
    pctElapsed: number | null,
    deadline: string | null,
    labelPrefix: string
  ) => {
    if (met) {
      return (
        <div className="flex items-center text-xs font-medium text-emerald-600">
          <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
          {labelPrefix} Met
        </div>
      );
    }

    if (breached || (pctElapsed !== null && pctElapsed >= 100)) {
      return (
        <Tooltip>
          <TooltipTrigger className="flex items-center text-xs font-medium text-red-600">
            <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
            Breached
          </TooltipTrigger>
          <TooltipContent>
            Deadline was {formatDateTime(deadline)}
          </TooltipContent>
        </Tooltip>
      );
    }

    if (sla.paused && type !== "response") {
      return (
        <div className="flex items-center text-xs font-medium text-slate-500">
          <PauseCircle className="mr-1.5 h-3.5 w-3.5" />
          Paused
        </div>
      );
    }

    if (pctElapsed === null || !deadline) return null;

    let colorClass = "text-emerald-600";
    let Icon = Clock;
    
    if (pctElapsed > 75) {
      colorClass = "text-amber-600";
    }

    // Time remaining text logic
    const d = new Date(deadline);
    const now = new Date();
    const diffMs = d.getTime() - now.getTime();
    
    if (diffMs < 0) {
      return (
        <div className="flex items-center text-xs font-medium text-red-600">
           <AlertTriangle className="mr-1.5 h-3.5 w-3.5" />
           Breached
        </div>
      );
    }

    const diffHrs = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    
    let timeText = "";
    if (diffHrs > 24) {
      timeText = `${Math.floor(diffHrs / 24)}d left`;
    } else if (diffHrs > 0) {
      timeText = `${diffHrs}h ${diffMins}m`;
    } else {
      timeText = `${diffMins}m left`;
    }

    return (
      <Tooltip>
        <TooltipTrigger className={`flex items-center text-xs font-medium ${colorClass}`}>
          <Icon className="mr-1.5 h-3.5 w-3.5" />
          {timeText}
        </TooltipTrigger>
        <TooltipContent>
          {labelPrefix} target: {formatDateTime(deadline)}
        </TooltipContent>
      </Tooltip>
    );
  };

  if (type === "response") {
    return renderIndicator(sla.responseMet, sla.responseBreached, sla.responsePctElapsed, sla.responseDeadline, "Response");
  }

  if (type === "resolution") {
    return renderIndicator(sla.resolutionMet, sla.resolutionBreached, sla.resolutionPctElapsed, sla.resolutionDeadline, "Resolution");
  }

  // Combined: show response if not met, else show resolution
  if (!sla.responseMet) {
    return renderIndicator(false, sla.responseBreached, sla.responsePctElapsed, sla.responseDeadline, "Response");
  }
  
  return renderIndicator(sla.resolutionMet, sla.resolutionBreached, sla.resolutionPctElapsed, sla.resolutionDeadline, "Resolution");
}
