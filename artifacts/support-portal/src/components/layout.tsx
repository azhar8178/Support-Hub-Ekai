import { type PortalUser, useGetPublicBranding } from "@workspace/api-client-react";
import { Link, useLocation } from "wouter";
import { useAuthActions } from "@/contexts/auth-context";
import { 
  Bell, 
  LayoutDashboard, 
  Ticket, 
  BookOpen, 
  Settings,
  LogOut,
  User as UserIcon,
  ShieldAlert,
  Search,
  Users,
  FolderOpen,
  SlidersHorizontal,
  ChevronLeft,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useState, useEffect } from "react";
import { NotificationsPopover } from "./notifications-popover";

interface LayoutProps {
  user: PortalUser;
  children: React.ReactNode;
}

const SIDEBAR_KEY = "sidebar_collapsed";

export default function Layout({ user, children }: LayoutProps) {
  const [location] = useLocation();
  const { signOut } = useAuthActions();
  const { data: brandingData } = useGetPublicBranding();

  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_KEY) === "1"; } catch { return false; }
  });

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, next ? "1" : "0"); } catch {}
      return next;
    });
  };

  const isCustomer = user.role === "customer";
  const isAgent = user.role === "ekai_agent";
  const isAdmin = user.role === "admin";

  const navigation = [
    { 
      name: "Dashboard", 
      href: isCustomer ? "/dashboard" : "/agent", 
      icon: LayoutDashboard,
      current: location === "/dashboard" || location === "/agent",
    },
    { 
      name: "Tickets", 
      href: "/tickets", 
      icon: Ticket,
      current: location.startsWith("/tickets"),
    },
    { 
      name: "Knowledge Base", 
      href: "/kb", 
      icon: BookOpen,
      current: location.startsWith("/kb"),
    },
  ];

  if (isAgent || isAdmin) {
    navigation.push({
      name: "Customers",
      href: "/customers",
      icon: Users,
      current: location.startsWith("/customers"),
    });
    navigation.push({
      name: "File Manager",
      href: "/admin/files",
      icon: FolderOpen,
      current: location.startsWith("/admin/files"),
    });
  }

  const settingsActive = isAdmin && (
    location.startsWith("/admin/settings") ||
    (location.startsWith("/admin") && !location.startsWith("/admin/files"))
  );

  const companyName = brandingData?.companyName || "Ekai.ai";

  return (
    <div className="flex h-screen bg-stone-50 font-sans text-[#0F1F3D]">
      {/* Sidebar */}
      <div className={`flex flex-col bg-[#0F1F3D] border-r border-[#1a2f52] shadow-xl z-10 transition-all duration-200 shrink-0 ${collapsed ? "w-16" : "w-64"}`}>
        {/* Logo */}
        <div className={`h-16 flex items-center border-b border-[#1a2f52] shrink-0 ${collapsed ? "justify-center px-2" : "justify-center px-4"}`}>
          <Link href="/" className="flex items-center justify-center gap-2 min-w-0">
            {brandingData?.logoUrl ? (
              <img
                src={brandingData.logoUrl}
                alt={companyName}
                className={`object-contain transition-all duration-200 ${collapsed ? "h-7 max-w-[2rem]" : "h-8 max-w-[160px]"}`}
              />
            ) : (
              <>
                <img src="/logo.svg" alt="Ekai Logo" className="h-7 w-7 shrink-0" />
                {!collapsed && (
                  <span className="font-bold text-lg tracking-tight text-white truncate">{companyName}</span>
                )}
              </>
            )}
          </Link>
        </div>

        {/* Nav */}
        <div className="flex-1 overflow-y-auto py-4">
          <nav className={`space-y-1 ${collapsed ? "px-2" : "px-3"}`}>
            {navigation.map((item) => {
              const Icon = item.icon;
              return (
                <Link
                  key={item.name}
                  href={item.href}
                  title={collapsed ? item.name : undefined}
                  className={`
                    flex items-center py-2.5 text-sm font-medium rounded-md transition-colors
                    border-l-2
                    ${collapsed ? "justify-center pl-0 pr-0" : "pl-[10px] pr-3"}
                    ${item.current 
                      ? "bg-white/10 text-[#EFB323] border-[#EFB323]" 
                      : "text-stone-300 hover:bg-white/10 hover:text-white border-transparent"
                    }
                  `}
                >
                  <Icon 
                    className={`shrink-0 h-5 w-5 ${!collapsed ? "mr-3" : ""} ${item.current ? "text-[#EFB323]" : "text-stone-400"}`}
                    aria-hidden="true" 
                  />
                  {!collapsed && item.name}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Bottom: settings + user info + collapse toggle */}
        <div className={`border-t border-[#1a2f52] shrink-0 ${collapsed ? "p-2 space-y-1" : "p-3 space-y-1"}`}>
          {/* Settings — admin only, pinned above user */}
          {isAdmin && (
            <Link
              href="/admin/settings"
              title={collapsed ? "Settings" : undefined}
              className={`
                flex items-center py-2 text-sm font-medium rounded-md transition-colors border-l-2
                ${collapsed ? "justify-center pl-0 pr-0" : "pl-[10px] pr-3"}
                ${settingsActive
                  ? "bg-white/10 text-[#EFB323] border-[#EFB323]"
                  : "text-stone-300 hover:bg-white/10 hover:text-white border-transparent"
                }
              `}
            >
              <SlidersHorizontal
                className={`shrink-0 h-5 w-5 ${!collapsed ? "mr-3" : ""} ${settingsActive ? "text-[#EFB323]" : "text-stone-400"}`}
              />
              {!collapsed && "Settings"}
            </Link>
          )}

          {/* User info */}
          {!collapsed && (
            <div className="flex items-center pt-2 mt-1 border-t border-[#1a2f52]">
              <div className="h-8 w-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center text-white font-semibold text-xs shrink-0">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="ml-2.5 min-w-0 flex-1">
                <p className="text-sm font-medium text-white truncate">{user.name}</p>
                <p className="text-xs text-stone-400 truncate">{user.orgName || user.role}</p>
              </div>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center justify-center w-full rounded-md py-1.5 text-stone-400 hover:text-white hover:bg-white/10 transition-colors ${collapsed ? "" : "gap-2 text-xs mt-1"}`}
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <>
                <PanelLeftClose className="h-4 w-4" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Header */}
        <header className="h-16 flex items-center justify-between px-6 border-b border-stone-200 bg-white shrink-0">
          <div className="flex-1 flex items-center">
            <div className="max-w-md w-full relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                <Search className="h-4 w-4 text-stone-400" />
              </div>
              <input
                type="text"
                placeholder="Search tickets or articles... (⌘K)"
                className="block w-full pl-10 pr-3 py-2 border border-stone-200 rounded-md leading-5 bg-stone-50 text-sm placeholder-stone-400 focus:outline-none focus:bg-white focus:ring-1 focus:ring-[#EFB323] focus:border-[#EFB323] transition-colors"
                disabled
              />
            </div>
          </div>
          
          <div className="ml-4 flex items-center gap-4">
            <NotificationsPopover />
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="h-9 w-9 p-0 rounded-full">
                  <UserIcon className="h-5 w-5 text-stone-600" />
                  <span className="sr-only">Open user menu</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none text-[#0F1F3D]">{user.name}</p>
                    <p className="text-xs leading-none text-stone-500">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-stone-600 cursor-pointer">
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span>Profile</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  className="text-red-600 cursor-pointer focus:text-red-600" 
                  onClick={() => signOut()}
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

      {/* WhatsApp floating button — customers only */}
      {isCustomer && brandingData?.whatsappNumber && (
        <a
          href={`https://wa.me/${brandingData.whatsappNumber.replace(/[^0-9]/g, "")}?text=Hi, I need urgent support`}
          target="_blank"
          rel="noopener noreferrer"
          className="fixed bottom-6 right-6 z-50 flex items-center gap-2 bg-[#25D366] hover:bg-[#1DA851] text-white px-4 py-3 rounded-full shadow-lg transition-all hover:shadow-xl hover:scale-105"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
            <path d="M12 0C5.373 0 0 5.373 0 12c0 2.136.561 4.14 1.535 5.874L0 24l6.332-1.518C8.031 23.455 9.974 24 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818c-1.9 0-3.677-.52-5.198-1.42l-.373-.22-3.758.901.955-3.658-.242-.378C2.614 15.44 2.182 13.77 2.182 12 2.182 6.58 6.58 2.182 12 2.182S21.818 6.58 21.818 12 17.42 21.818 12 21.818z"/>
          </svg>
          <span className="font-medium text-sm">Chat on WhatsApp</span>
        </a>
      )}
    </div>
  );
}
