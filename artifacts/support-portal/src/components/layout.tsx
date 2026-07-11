import { type PortalUser } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useClerk } from "@clerk/react";
import { 
  Bell, 
  LayoutDashboard, 
  Ticket, 
  BookOpen, 
  Settings,
  LogOut,
  User as UserIcon,
  ShieldAlert,
  Search
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useState } from "react";
import { NotificationsPopover } from "./notifications-popover";

interface LayoutProps {
  user: PortalUser;
  children: React.ReactNode;
}

export default function Layout({ user, children }: LayoutProps) {
  const [location] = useLocation();
  const { signOut } = useClerk();

  const isCustomer = user.role === "customer";
  const isAgent = user.role === "ekai_agent";
  const isAdmin = user.role === "admin";

  const navigation = [
    { 
      name: "Dashboard", 
      href: isCustomer ? "/dashboard" : "/agent", 
      icon: LayoutDashboard,
      current: location === "/dashboard" || location === "/agent"
    },
    { 
      name: "Tickets", 
      href: "/tickets", 
      icon: Ticket,
      current: location.startsWith("/tickets")
    },
    { 
      name: "Knowledge Base", 
      href: "/kb", 
      icon: BookOpen,
      current: location.startsWith("/kb")
    },
  ];

  if (isAdmin) {
    navigation.push({
      name: "Administration",
      href: "/admin",
      icon: Settings,
      current: location.startsWith("/admin")
    });
  }

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-[#0F1F3D]">
      {/* Sidebar */}
      <div className="w-64 flex flex-col border-r border-slate-200 bg-white shadow-sm z-10">
        <div className="h-16 flex items-center px-6 border-b border-slate-200 shrink-0">
          <Link href="/" className="flex items-center gap-2">
            <img src="/logo.svg" alt="Ekai Logo" className="h-7 w-7" />
            <span className="font-bold text-lg tracking-tight text-[#0F1F3D]">Ekai.ai</span>
          </Link>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          <nav className="px-3 space-y-1">
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  className={`
                    flex items-center px-3 py-2.5 text-sm font-medium rounded-md transition-colors
                    ${item.current 
                      ? "bg-blue-50 text-[#2563EB]" 
                      : "text-slate-600 hover:bg-slate-100 hover:text-[#0F1F3D]"
                    }
                  `}
                >
                  <Icon 
                    className={`mr-3 h-5 w-5 shrink-0 ${item.current ? "text-[#2563EB]" : "text-slate-400"}`} 
                    aria-hidden="true" 
                  />
                  {item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-slate-200 shrink-0">
          <div className="flex items-center">
            <div className="flex-shrink-0">
              <div className="h-9 w-9 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[#0F1F3D] font-semibold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>
            </div>
            <div className="ml-3 min-w-0 flex-1">
              <p className="text-sm font-medium text-[#0F1F3D] truncate">{user.name}</p>
              <p className="text-xs text-slate-500 truncate">{user.orgName || user.role}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-slate-200 bg-white shrink-0">
          <div className="flex-1 flex items-center">
            <div className="max-w-md w-full relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-slate-400" />
              </div>
              <input
                type="text"
                placeholder="Search tickets or articles... (⌘K)"
                className="block w-full pl-10 pr-3 py-2 border border-slate-200 rounded-md leading-5 bg-slate-50 text-sm placeholder-slate-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#2563EB] focus:border-[#2563EB] transition-colors"
                disabled // Mocked for design
              />
            </div>
          </div>
          
          <div className="ml-4 flex items-center gap-4">
            <NotificationsPopover />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 w-9 p-0 rounded-full">
                  <UserIcon className="h-5 w-5 text-slate-600" />
                  <span className="sr-only">Open user menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none text-[#0F1F3D]">{user.name}</p>
                    <p className="text-xs leading-none text-slate-500">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-slate-600 cursor-pointer">
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-red-600 cursor-pointer focus:text-red-600" 
                  onClick={() => signOut({ redirectUrl: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" })}
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>
      </div>
    </div>
  );
}
