import { useState } from "react";
import { useListNotifications, useMarkNotificationsRead } from "@workspace/api-client-react";
import { Bell, Check, Ticket, AlertCircle, Info, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDateTime } from "@/lib/utils";
import { Link } from "wouter";
import { queryClient } from "@/lib/queryClient";

export function NotificationsPopover() {
  const [open, setOpen] = useState(false);
  
  const { data: notifications } = useListNotifications({
    query: {
      queryKey: ["notifications"],
      refetchInterval: 30000,
    }
  });

  const markRead = useMarkNotificationsRead({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["notifications"] });
      }
    }
  });

  const unreadCount = notifications?.filter(n => !n.read).length || 0;

  const handleMarkAllRead = () => {
    if (unreadCount === 0) return;
    markRead.mutate({ data: { all: true } });
  };

  const handleMarkAsRead = (id: number) => {
    markRead.mutate({ data: { ids: [id] } });
  };

  const getIcon = (type: string) => {
    switch (type) {
      case "ticket_created":
        return <Ticket className="h-4 w-4 text-blue-500" />;
      case "agent_reply":
        return <MessageSquare className="h-4 w-4 text-emerald-500" />;
      case "sla_warning":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      case "status_changed":
        return <Info className="h-4 w-4 text-indigo-500" />;
      default:
        return <Bell className="h-4 w-4 text-slate-500" />;
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-slate-600 hover:text-[#0F1F3D]">
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0 shadow-lg border-slate-200">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="font-semibold text-sm text-[#0F1F3D]">Notifications</h3>
          {unreadCount > 0 && (
            <Button 
              variant="ghost" 
              className="h-auto p-0 text-xs text-[#2563EB] hover:text-blue-700 hover:bg-transparent"
              onClick={handleMarkAllRead}
              disabled={markRead.isPending}
            >
              <Check className="h-3 w-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[300px]">
          {notifications?.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-500 flex flex-col items-center">
              <Bell className="h-8 w-8 text-slate-200 mb-3" />
              No notifications yet
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications?.map((notification) => (
                <div 
                  key={notification.id} 
                  className={`p-4 hover:bg-slate-50 transition-colors flex gap-3 ${!notification.read ? 'bg-blue-50/30' : ''}`}
                >
                  <div className="mt-1 flex-shrink-0">
                    <div className={`p-1.5 rounded-full ${!notification.read ? 'bg-white shadow-sm' : 'bg-slate-100'}`}>
                      {getIcon(notification.type)}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#0F1F3D] mb-1 leading-snug">
                      {notification.title}
                    </p>
                    <p className="text-xs text-slate-600 mb-2 line-clamp-2 leading-relaxed">
                      {notification.body}
                    </p>
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">
                        {formatDateTime(notification.createdAt)}
                      </span>
                      {notification.ticketId && (
                        <Button 
                          variant="link" 
                          className="h-auto p-0 text-[11px] text-[#2563EB]"
                          onClick={() => {
                            if (!notification.read) handleMarkAsRead(notification.id);
                            setOpen(false);
                          }}
                          asChild
                        >
                          <Link href={`/tickets/${notification.ticketId}`}>
                            View ticket
                          </Link>
                        </Button>
                      )}
                    </div>
                  </div>
                  {!notification.read && (
                    <div className="flex-shrink-0 flex items-center">
                      <div className="h-2 w-2 rounded-full bg-blue-600" />
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
