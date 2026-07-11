import { useState } from "react";
import {
  useListCustomers,
  useCreateInvite,
  useListOrgs,
  getListCustomersQueryKey,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Search, Users, UserPlus, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";
import { queryClient } from "@/lib/queryClient";
import { toast } from "sonner";

export default function CustomersListPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteOrgId, setInviteOrgId] = useState<string>("none");

  const customerParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };

  const { data: customers, isLoading } = useListCustomers(customerParams, {
    query: { queryKey: getListCustomersQueryKey(customerParams) },
  });

  const { data: orgs } = useListOrgs();
  const createInvite = useCreateInvite();

  const handleInvite = () => {
    if (!inviteEmail.trim()) return;
    createInvite.mutate(
      {
        data: {
          email: inviteEmail.trim(),
          role: "customer",
          orgId: inviteOrgId !== "none" ? Number(inviteOrgId) : null,
        },
      },
      {
        onSuccess: (invite) => {
          queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
          toast.success(`Invite sent to ${invite.email}`, {
            description: "They'll receive a link to create their account.",
          });
          setInviteOpen(false);
          setInviteEmail("");
          setInviteOrgId("none");
        },
        onError: (err: any) =>
          toast.error(err?.message || "Failed to send invite"),
      },
    );
  };

  return (
    <div className="p-8 max-w-7xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Customers</h1>
          <p className="text-sm text-stone-500 mt-1">Everyone who raises support with you.</p>
        </div>
        <Button
          className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D] font-semibold shrink-0"
          onClick={() => setInviteOpen(true)}
        >
          <UserPlus className="h-4 w-4 mr-2" />
          Invite Customer
        </Button>
      </div>

      <div className="flex flex-col sm:flex-row gap-4 mb-6 shrink-0">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
          <Input
            placeholder="Search customers by name or email..."
            className="pl-9 bg-white"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-white border border-stone-200 rounded-xl shadow-sm flex flex-col">
        <div className="overflow-auto flex-1">
          <Table>
            <TableHeader className="bg-stone-50 sticky top-0 z-10 shadow-sm">
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell><div className="h-4 bg-stone-200 rounded w-40 mb-2" /><div className="h-3 bg-stone-100 rounded w-24" /></TableCell>
                    <TableCell><div className="h-4 bg-stone-200 rounded w-48" /></TableCell>
                    <TableCell><div className="h-4 bg-stone-200 rounded w-32" /></TableCell>
                    <TableCell><div className="h-5 bg-stone-200 rounded-full w-16" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-stone-200 rounded w-8 ml-auto" /></TableCell>
                    <TableCell className="text-right"><div className="h-6 bg-stone-200 rounded-full w-8 ml-auto" /></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-stone-200 rounded w-24 ml-auto" /></TableCell>
                  </TableRow>
                ))
              ) : customers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-stone-500">
                      <Users className="h-8 w-8 mb-4 text-stone-300" />
                      <p className="text-lg font-medium text-[#0F1F3D]">
                        {debouncedSearch ? "No customers match your search" : "No customers yet"}
                      </p>
                      <p className="text-sm mt-1 mb-4">
                        {debouncedSearch
                          ? "Try adjusting your search query."
                          : "Invite your first customer to get started."}
                      </p>
                      {!debouncedSearch && (
                        <Button
                          size="sm"
                          className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D]"
                          onClick={() => setInviteOpen(true)}
                        >
                          <UserPlus className="h-4 w-4 mr-2" />
                          Invite Customer
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ) : (
                customers?.map((customer) => (
                  <TableRow
                    key={customer.id}
                    className="cursor-pointer hover:bg-stone-50 transition-colors"
                    onClick={() => setLocation(`/customers/${customer.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium text-[#0F1F3D]">{customer.name}</div>
                      <div className="text-xs text-stone-500">Since {formatDate(customer.createdAt)}</div>
                    </TableCell>
                    <TableCell className="text-sm text-stone-600">{customer.email}</TableCell>
                    <TableCell className="text-sm text-stone-600">
                      {customer.orgName || <span className="text-stone-400">—</span>}
                    </TableCell>
                    <TableCell>
                      {customer.active ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-stone-100 text-stone-500 border-stone-200 text-xs">Inactive</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-stone-600">{customer.ticketCount}</TableCell>
                    <TableCell className="text-right">
                      {customer.openTicketCount > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-[1.5rem] px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                          {customer.openTicketCount}
                        </span>
                      ) : (
                        <span className="text-sm text-stone-400">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm text-stone-500 whitespace-nowrap">
                      {customer.lastActivityAt ? formatDate(customer.lastActivityAt) : <span className="text-stone-400">—</span>}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Invite Customer dialog */}
      <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#0F1F3D]">Invite a Customer</DialogTitle>
            <DialogDescription>
              Send an invite link so they can create their portal account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="invite-email" className="text-sm font-medium text-[#0F1F3D]">
                Email address <span className="text-red-500">*</span>
              </Label>
              <Input
                id="invite-email"
                type="email"
                placeholder="customer@company.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                className="bg-white"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-org" className="text-sm font-medium text-[#0F1F3D]">
                Company <span className="text-stone-400 font-normal">(optional)</span>
              </Label>
              <Select value={inviteOrgId} onValueChange={setInviteOrgId}>
                <SelectTrigger id="invite-org" className="bg-white">
                  <SelectValue placeholder="Select a company..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No company</SelectItem>
                  {orgs?.map((org) => (
                    <SelectItem key={org.id} value={String(org.id)}>
                      {org.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInviteOpen(false)} disabled={createInvite.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleInvite}
              disabled={!inviteEmail.trim() || createInvite.isPending}
              className="bg-[#EFB323] hover:bg-[#D69E1E] text-[#0F1F3D]"
            >
              {createInvite.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <UserPlus className="h-4 w-4 mr-2" />
              )}
              Send Invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
