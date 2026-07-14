import { useState } from "react";
import { 
  useListUsers, 
  useUpdateUser,
  useListInvites,
  useCreateInvite,
  useRevokeInvite,
  useResendInvite,
  useListOrgs,
  useCreateOrg,
  useUpdateOrg,
  useListSeverities,
  useCreateSeverity,
  useUpdateSeverity,
  useListCategories,
  useCreateCategory,
  useUpdateCategory,
  useListEnvironments,
  useCreateEnvironment,
  useUpdateEnvironment,
  useGetReports,
  useGetKbDeflectionStats,
  useGetBootstrapStatus,
  useRotateBootstrap,
  getGetBootstrapStatusQueryKey,
  getTaxonomyUsage,
  getListInvitesQueryKey,
  getListOrgsQueryKey,
  getListSeveritiesQueryKey,
  getListCategoriesQueryKey,
  getListEnvironmentsQueryKey,
  getGetTicketConfigQueryKey,
  PortalUserRole,
  InviteRole,
  type Severity,
  type TaxonomyOption,
} from "@workspace/api-client-react";
import { SetupWizard } from "@/components/SetupWizard";
import { queryClient } from "@/lib/queryClient";
import { 
  Users, Building, Mail, SlidersHorizontal, BarChart3, Plus, Search, 
  Check, X, Loader2, Copy, AlertTriangle, TrendingUp, Clock, BookOpen,
  Pencil, RotateCcw, Archive, Send, ShieldAlert, ShieldCheck, RefreshCw
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatDateTime, formatDate } from "@/lib/utils";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

// ─── Bootstrap Security Banner ────────────────────────────────────────────────

function BootstrapSecurityBanner() {
  const { data: status, isLoading } = useGetBootstrapStatus();
  const rotate = useRotateBootstrap();
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Don't render until we know the status; hide entirely when not active
  if (isLoading || !status?.active) return null;

  const handleRotate = async () => {
    try {
      await rotate.mutateAsync();
      queryClient.invalidateQueries({ queryKey: getGetBootstrapStatusQueryKey() });
      toast.success("Bootstrap token rotated — endpoint is now locked");
      setConfirmOpen(false);
    } catch (err: any) {
      toast.error(err?.message || "Failed to rotate token");
    }
  };

  return (
    <>
      <div className="bg-amber-50 border border-amber-300 rounded-lg px-5 py-4 flex items-start gap-4">
        <ShieldAlert className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-amber-900">
            Bootstrap setup token not yet revoked
          </p>
          <p className="text-sm text-amber-800 mt-0.5">
            The initial setup token is still in server memory. The{" "}
            <code className="bg-amber-100 px-1 rounded text-xs">/api/bootstrap-admin</code>{" "}
            endpoint is already blocked because you&apos;re signed in, but explicitly revoking the
            token prevents it from becoming usable again after a server restart (before all admin
            accounts are fully provisioned).
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0 border-amber-400 text-amber-800 hover:bg-amber-100"
          onClick={() => setConfirmOpen(true)}
          disabled={rotate.isPending}
        >
          {rotate.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Revoke Token
        </Button>
      </div>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke bootstrap token?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately clears the setup token and saves a permanent disabled flag to the
              database. The{" "}
              <code className="bg-stone-100 px-1 rounded text-xs">/api/bootstrap-admin</code>{" "}
              endpoint will return 404 for all callers — even after a server restart or
              redeployment. This cannot be undone without a direct database change.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-600 hover:bg-amber-700"
              onClick={handleRotate}
            >
              Revoke Token
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ─── Main Page ─────────────────────────────────────────────────────────────────

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="flex flex-col h-full bg-stone-50">
      <div className="bg-white border-b border-stone-200 px-8 py-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Administration</h1>
        <p className="text-stone-500 mt-1">Manage users, organizations, invites, and system configuration.</p>
      </div>

      <SetupWizard onNavigateToTab={setActiveTab} />

      <div className="flex-1 overflow-auto p-8 max-w-[1400px] mx-auto w-full space-y-6">
        <BootstrapSecurityBanner />
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-stone-200 shadow-sm p-1 rounded-lg h-12">
            <TabsTrigger value="users" className="data-[state=active]:bg-stone-100 rounded-md px-4"><Users className="h-4 w-4 mr-2" /> Users</TabsTrigger>
            <TabsTrigger value="invites" className="data-[state=active]:bg-stone-100 rounded-md px-4"><Mail className="h-4 w-4 mr-2" /> Invites</TabsTrigger>
            <TabsTrigger value="orgs" className="data-[state=active]:bg-stone-100 rounded-md px-4"><Building className="h-4 w-4 mr-2" /> Organizations</TabsTrigger>
            <TabsTrigger value="config" className="data-[state=active]:bg-stone-100 rounded-md px-4"><SlidersHorizontal className="h-4 w-4 mr-2" /> Ticket Config</TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-stone-100 rounded-md px-4"><BarChart3 className="h-4 w-4 mr-2" /> Reports</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4 m-0 border-0 p-0">
            <UsersTab />
          </TabsContent>

          <TabsContent value="invites" className="space-y-4 m-0 border-0 p-0">
            <InvitesTab />
          </TabsContent>

          <TabsContent value="orgs" className="space-y-4 m-0 border-0 p-0">
            <OrganizationsTab />
          </TabsContent>

          <TabsContent value="config" className="space-y-6 m-0 border-0 p-0">
            <TicketConfigTab />
          </TabsContent>

          <TabsContent value="reports" className="space-y-4 m-0 border-0 p-0">
            <ReportsTab />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

// --- USERS TAB ---
function UsersTab() {
  const { data: users, isLoading } = useListUsers();
  const { data: orgs } = useListOrgs();
  const updateUser = useUpdateUser();
  const [search, setSearch] = useState("");

  const filteredUsers = users?.filter(u => 
    u.email.toLowerCase().includes(search.toLowerCase()) || 
    u.name.toLowerCase().includes(search.toLowerCase())
  ) || [];

  const handleRoleChange = async (userId: number, role: PortalUserRole) => {
    try {
      await updateUser.mutateAsync({ id: userId, data: { role } });
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to update role");
    }
  };

  const handleOrgChange = async (userId: number, orgId: number | null) => {
    try {
      await updateUser.mutateAsync({ id: userId, data: { orgId } });
      toast.success("Organization updated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to update organization");
    }
  };

  const handleActiveToggle = async (userId: number, active: boolean) => {
    try {
      await updateUser.mutateAsync({ id: userId, data: { active } });
      toast.success(active ? "User activated" : "User deactivated");
      queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to update status");
    }
  };

  return (
    <Card className="border-stone-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-stone-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Portal Users</CardTitle>
          <CardDescription>Manage access, roles, and organization mapping.</CardDescription>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-stone-400" />
          <Input 
            placeholder="Search users..." 
            className="pl-9 h-9"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-stone-50">
            <TableRow>
              <TableHead className="pl-6">User</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Organization</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Last Login</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-500" /></TableCell></TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-stone-500">No users found</TableCell></TableRow>
            ) : (
              filteredUsers.map(user => (
                <TableRow key={user.id}>
                  <TableCell className="pl-6">
                    <div className="font-medium text-[#0F1F3D]">{user.name}</div>
                    <div className="text-xs text-stone-500">{user.email}</div>
                  </TableCell>
                  <TableCell>
                    <Select value={user.role} onValueChange={(v) => handleRoleChange(user.id, v as PortalUserRole)}>
                      <SelectTrigger className="w-[140px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="customer">Customer</SelectItem>
                        <SelectItem value="ekai_agent">Ekai Agent</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={user.orgId?.toString() || "none"} onValueChange={(v) => handleOrgChange(user.id, v === "none" ? null : Number(v))}>
                      <SelectTrigger className="w-[180px] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none" className="italic text-stone-500">No Organization</SelectItem>
                        {orgs?.map(org => (
                          <SelectItem key={org.id} value={org.id.toString()}>{org.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch 
                        checked={user.active} 
                        onCheckedChange={(c) => handleActiveToggle(user.id, c)}
                        className="data-[state=checked]:bg-emerald-500"
                      />
                      <span className={`text-xs font-medium ${user.active ? 'text-emerald-700' : 'text-stone-400'}`}>
                        {user.active ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-stone-500">
                    {user.lastLogin ? formatDateTime(user.lastLogin) : "Never"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// --- INVITES TAB ---
const inviteSchema = z.object({
  email: z.string().email("Invalid email address"),
  role: z.nativeEnum(InviteRole),
  orgId: z.string().optional(),
});

function InvitesTab() {
  const { data: invites, isLoading } = useListInvites();
  const { data: orgs } = useListOrgs();
  const createInvite = useCreateInvite();
  const revokeInvite = useRevokeInvite();
  const resendInvite = useResendInvite();
  const [isOpen, setIsOpen] = useState(false);
  const [lastCreatedUrl, setLastCreatedUrl] = useState<string | null>(null);

  const form = useForm<z.infer<typeof inviteSchema>>({
    resolver: zodResolver(inviteSchema),
    defaultValues: {
      email: "",
      role: InviteRole.customer,
      orgId: "none"
    }
  });

  const onSubmit = async (values: z.infer<typeof inviteSchema>) => {
    try {
      const orgId = values.orgId !== "none" && values.orgId ? Number(values.orgId) : null;
      if (values.role === "customer" && !orgId) {
        toast.error("Customers must be assigned to an organization");
        return;
      }

      const res = await createInvite.mutateAsync({
        data: {
          email: values.email,
          role: values.role,
          orgId: orgId
        }
      });
      
      setLastCreatedUrl(res.inviteUrl);
      form.reset();
      queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
      toast.success("Invite created");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create invite");
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Invite URL copied to clipboard");
  };

  const handleRevoke = async (id: number) => {
    try {
      await revokeInvite.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
      toast.success("Invite revoked");
    } catch (err: any) {
      toast.error(err?.message || "Failed to revoke invite");
    }
  };

  const handleResend = async (id: number) => {
    try {
      const res = await resendInvite.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListInvitesQueryKey() });
      if (res.inviteUrl) {
        navigator.clipboard.writeText(res.inviteUrl);
        toast.success("Fresh link generated and copied to clipboard");
      } else {
        toast.success("Fresh link generated");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to resend invite");
    }
  };

  return (
    <Card className="border-stone-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-stone-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Pending Invites</CardTitle>
          <CardDescription>Generate magic links to onboard new users.</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#EFB323] hover:bg-[#D69E1E]">
              <Plus className="mr-2 h-4 w-4" /> Create Invite
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Invitation</DialogTitle>
              <DialogDescription>
                Generate an invite link for a new user. The email provider is not wired up, so you must share the link manually.
              </DialogDescription>
            </DialogHeader>
            
            {lastCreatedUrl ? (
              <div className="py-6 space-y-4">
                <div className="bg-emerald-50 text-emerald-700 p-4 rounded-lg flex items-start gap-3 border border-emerald-200">
                  <Check className="h-5 w-5 shrink-0 mt-0.5" />
                  <div>
                    <h4 className="font-semibold text-sm">Invite Generated</h4>
                    <p className="text-sm mt-1 mb-3">Copy this link and send it to the user. It expires in 7 days.</p>
                    <div className="flex items-center gap-2">
                      <Input value={lastCreatedUrl} readOnly className="bg-white text-xs h-9 font-mono" />
                      <Button onClick={() => copyUrl(lastCreatedUrl)} size="icon" className="shrink-0 h-9 w-9 bg-[#0F1F3D]">
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
                <Button variant="outline" className="w-full" onClick={() => { setLastCreatedUrl(null); setIsOpen(false); }}>Close</Button>
              </div>
            ) : (
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email Address</FormLabel>
                        <FormControl><Input placeholder="user@company.com" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="role"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Role</FormLabel>
                        <Select onValueChange={field.onChange} defaultValue={field.value}>
                          <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="customer">Customer</SelectItem>
                            <SelectItem value="ekai_agent">Ekai Agent</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {form.watch("role") === "customer" && (
                    <FormField
                      control={form.control}
                      name="orgId"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Organization (Required for Customers)</FormLabel>
                          <Select onValueChange={field.onChange} defaultValue={field.value}>
                            <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                            <SelectContent>
                              <SelectItem value="none" disabled>Select an organization</SelectItem>
                              {orgs?.map(org => <SelectItem key={org.id} value={org.id.toString()}>{org.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  )}
                  <Button type="submit" className="w-full bg-[#EFB323]" disabled={createInvite.isPending}>
                    {createInvite.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Generate Link"}
                  </Button>
                </form>
              </Form>
            )}
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-stone-50">
            <TableRow>
              <TableHead className="pl-6">Email</TableHead>
              <TableHead>Role / Org</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right pr-6">Action</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-500" /></TableCell></TableRow>
            ) : invites?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-stone-500">No active invites</TableCell></TableRow>
            ) : (
              invites?.map(inv => {
                const isAccepted = !!inv.usedAt;
                const isRevoked = !!inv.revokedAt;
                const isExpired = !isAccepted && !isRevoked && new Date(inv.expiresAt) < new Date();
                const canManage = !isAccepted && !isRevoked;
                const isBusy = revokeInvite.isPending || resendInvite.isPending;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-6 font-medium text-[#0F1F3D]">{inv.email}</TableCell>
                    <TableCell>
                      <div className="text-sm capitalize">{inv.role.replace('_', ' ')}</div>
                      <div className="text-xs text-stone-500">{inv.orgName || '-'}</div>
                    </TableCell>
                    <TableCell>
                      {isAccepted ? <Badge variant="outline" className="bg-emerald-50 text-emerald-700">Accepted</Badge> :
                       isRevoked ? <Badge variant="outline" className="bg-stone-100 text-stone-600">Revoked</Badge> :
                       isExpired ? <Badge variant="outline" className="bg-red-50 text-red-700">Expired</Badge> :
                       <Badge variant="outline" className="bg-amber-50 text-amber-700">Pending</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-stone-500">{formatDate(inv.createdAt)}</TableCell>
                    <TableCell className="text-right pr-6">
                      {canManage && (
                        <div className="flex items-center justify-end gap-1">
                          {inv.inviteUrl && (
                            <Button variant="ghost" size="sm" onClick={() => copyUrl(inv.inviteUrl!)} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" data-testid={`button-copy-invite-${inv.id}`}>
                              <Copy className="h-4 w-4 mr-2" /> Copy Link
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => handleResend(inv.id)} className="text-stone-600 hover:text-[#0F1F3D] hover:bg-stone-50" data-testid={`button-resend-invite-${inv.id}`}>
                            <Send className="h-4 w-4 mr-2" /> Resend
                          </Button>
                          <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => handleRevoke(inv.id)} className="text-red-600 hover:text-red-800 hover:bg-red-50" data-testid={`button-revoke-invite-${inv.id}`}>
                            <X className="h-4 w-4 mr-2" /> Revoke
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// --- ORGANIZATIONS TAB ---
const orgSchema = z.object({
  name: z.string().min(2, "Name required"),
  domain: z.string().optional(),
});

function OrganizationsTab() {
  const { data: orgs, isLoading } = useListOrgs();
  const createOrg = useCreateOrg();
  const updateOrg = useUpdateOrg();
  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDomain, setEditDomain] = useState("");

  const form = useForm<z.infer<typeof orgSchema>>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: "", domain: "" }
  });

  const onSubmit = async (values: z.infer<typeof orgSchema>) => {
    try {
      await createOrg.mutateAsync({ data: values });
      toast.success("Organization created");
      queryClient.invalidateQueries({ queryKey: getListOrgsQueryKey() });
      setIsOpen(false);
      form.reset();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create organization");
    }
  };

  const startEdit = (id: number, name: string, domain: string | null) => {
    setEditingId(id);
    setEditName(name);
    setEditDomain(domain ?? "");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName("");
    setEditDomain("");
  };

  const saveEdit = async (id: number) => {
    const name = editName.trim();
    if (name.length < 2) {
      toast.error("Name required");
      return;
    }
    try {
      await updateOrg.mutateAsync({
        id,
        data: { name, domain: editDomain.trim() ? editDomain.trim() : null },
      });
      toast.success("Organization updated");
      queryClient.invalidateQueries({ queryKey: getListOrgsQueryKey() });
      cancelEdit();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update organization");
    }
  };

  return (
    <Card className="border-stone-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-stone-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>Customer companies that access the portal.</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#EFB323] hover:bg-[#D69E1E]">
              <Plus className="mr-2 h-4 w-4" /> Add Org
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Organization</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Company Name</FormLabel>
                      <FormControl><Input placeholder="Acme Corp" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domain (Optional)</FormLabel>
                      <FormControl><Input placeholder="acme.com" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full bg-[#EFB323]" disabled={createOrg.isPending}>
                  {createOrg.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Create"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-stone-50">
            <TableRow>
              <TableHead className="pl-6 w-[100px]">ID</TableHead>
              <TableHead>Organization Name</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead className="text-center">Users</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="text-right pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-500" /></TableCell></TableRow>
            ) : orgs?.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-stone-500">No organizations found</TableCell></TableRow>
            ) : (
              orgs?.map(org => {
                const isEditing = editingId === org.id;
                return (
                  <TableRow key={org.id}>
                    <TableCell className="pl-6 font-medium text-stone-500">#{org.id}</TableCell>
                    <TableCell className="font-semibold text-[#0F1F3D]">
                      {isEditing ? (
                        <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-8 w-48" data-testid={`input-org-name-${org.id}`} />
                      ) : org.name}
                    </TableCell>
                    <TableCell className="text-sm text-stone-600">
                      {isEditing ? (
                        <Input value={editDomain} onChange={e => setEditDomain(e.target.value)} placeholder="acme.com" className="h-8 w-40" data-testid={`input-org-domain-${org.id}`} />
                      ) : (org.domain || '-')}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary" className="bg-stone-100">{org.userCount}</Badge>
                    </TableCell>
                    <TableCell className="text-sm text-stone-500">{formatDate(org.createdAt)}</TableCell>
                    <TableCell className="text-right pr-6">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={updateOrg.isPending} onClick={() => saveEdit(org.id)} className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50" data-testid={`button-save-org-${org.id}`}>
                            <Check className="h-4 w-4 mr-2" /> Save
                          </Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-stone-500 hover:text-stone-700" data-testid={`button-cancel-org-${org.id}`}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button variant="ghost" size="sm" onClick={() => startEdit(org.id, org.name, org.domain)} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" data-testid={`button-edit-org-${org.id}`}>
                          <Pencil className="h-4 w-4 mr-2" /> Rename
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// --- TICKET CONFIG TAB (severities, categories, environments) ---
const RESOLUTION_OPTIONS = [
  { value: "planned", label: "Planned / no target" },
  { value: "60", label: "1 Hour (60m)" },
  { value: "120", label: "2 Hours (120m)" },
  { value: "240", label: "4 Hours (240m)" },
  { value: "480", label: "8 Hours (480m)" },
  { value: "1440", label: "24 Hours (1440m)" },
  { value: "2880", label: "48 Hours (2880m)" },
];

function TicketConfigTab() {
  return (
    <div className="space-y-6">
      <SeveritiesSection />
      <TaxonomySection
        title="Categories"
        description="Categories customers pick when raising a ticket."
        usageType="category"
        useList={useListCategories}
        useCreate={useCreateCategory}
        useUpdate={useUpdateCategory}
        listQueryKey={getListCategoriesQueryKey()}
      />
      <TaxonomySection
        title="Environments"
        description="Affected environments customers can choose from."
        usageType="environment"
        useList={useListEnvironments}
        useCreate={useCreateEnvironment}
        useUpdate={useUpdateEnvironment}
        listQueryKey={getListEnvironmentsQueryKey()}
      />
    </div>
  );
}

// Shown before retiring a taxonomy option that open tickets still depend on, so
// admins see the impact (retiring stays allowed — this is informed consent).
type RetireTarget = { id: number; label: string; count: number };
type TaxonomyUsageType = "category" | "environment" | "severity";

function RetireConfirmDialog({
  target,
  noun,
  isPending,
  onCancel,
  onConfirm,
}: {
  target: RetireTarget | null;
  noun: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const count = target?.count ?? 0;
  return (
    <AlertDialog open={!!target} onOpenChange={(open) => { if (!open && !isPending) onCancel(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Retire "{target?.label}"?</AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-semibold text-amber-700">{count} open {count === 1 ? "ticket" : "tickets"}</span> still use this {noun}. Retiring it hides it from new tickets and filters, but those tickets keep it and still display correctly. You can restore it any time.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending} data-testid="button-cancel-retire">Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={isPending} onClick={onConfirm} className="bg-amber-600 hover:bg-amber-700 focus:ring-amber-600" data-testid="button-confirm-retire">
            {isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />} Retire anyway
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// --- SEVERITIES ---
type SeverityDraft = {
  label: string;
  firstResponseMinutes: string;
  resolutionMinutes: string; // "planned" or minutes
  rank: string;
  isUrgent: boolean;
  resolutionOptional: boolean;
  use24x7: boolean;
};

function severityToDraft(s: Severity): SeverityDraft {
  return {
    label: s.label,
    firstResponseMinutes: s.firstResponseMinutes.toString(),
    resolutionMinutes: s.resolutionMinutes === null ? "planned" : s.resolutionMinutes.toString(),
    rank: s.rank.toString(),
    isUrgent: s.isUrgent,
    resolutionOptional: s.resolutionOptional,
    use24x7: s.use24x7,
  };
}

function SeveritiesSection() {
  const { data: severities, isLoading, isError } = useListSeverities();
  const createSeverity = useCreateSeverity();
  const updateSeverity = useUpdateSeverity();

  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<SeverityDraft | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [newDraft, setNewDraft] = useState<SeverityDraft>({
    label: "",
    firstResponseMinutes: "60",
    resolutionMinutes: "planned",
    rank: "",
    isUrgent: false,
    resolutionOptional: false,
    use24x7: false,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListSeveritiesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetTicketConfigQueryKey() });
  };

  const parseResolution = (v: string) => (v === "planned" ? null : parseInt(v) || null);

  const startEdit = (s: Severity) => {
    setEditingId(s.id);
    setDraft(severityToDraft(s));
  };
  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (id: number) => {
    if (!draft) return;
    const fr = parseInt(draft.firstResponseMinutes);
    if (!draft.label.trim() || !fr || fr < 1) {
      toast.error("Label and a first-response target (min 1) are required");
      return;
    }
    try {
      await updateSeverity.mutateAsync({
        id,
        data: {
          label: draft.label.trim(),
          firstResponseMinutes: fr,
          resolutionMinutes: parseResolution(draft.resolutionMinutes),
          rank: draft.rank.trim() ? parseInt(draft.rank) : undefined,
          isUrgent: draft.isUrgent,
          resolutionOptional: draft.resolutionOptional,
          use24x7: draft.use24x7,
        },
      });
      toast.success("Severity updated");
      invalidate();
      cancelEdit();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update severity");
    }
  };

  const [retireTarget, setRetireTarget] = useState<RetireTarget | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);

  const doRetire = async (id: number) => {
    try {
      await updateSeverity.mutateAsync({ id, data: { active: false } });
      toast.success("Severity retired");
      invalidate();
      setRetireTarget(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update severity");
    }
  };

  // Retiring: check open-ticket usage first and warn if any depend on it.
  const requestRetire = async (s: Severity) => {
    setCheckingId(s.id);
    try {
      const usage = await getTaxonomyUsage("severity", s.id);
      if (usage.openTicketCount > 0) {
        setRetireTarget({ id: s.id, label: s.label, count: usage.openTicketCount });
      } else {
        await doRetire(s.id);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to check ticket usage");
    } finally {
      setCheckingId(null);
    }
  };

  const restore = async (s: Severity) => {
    try {
      await updateSeverity.mutateAsync({ id: s.id, data: { active: true } });
      toast.success("Severity restored");
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update severity");
    }
  };

  const handleCreate = async () => {
    const fr = parseInt(newDraft.firstResponseMinutes);
    if (!newDraft.label.trim() || !fr || fr < 1) {
      toast.error("Label and a first-response target (min 1) are required");
      return;
    }
    try {
      await createSeverity.mutateAsync({
        data: {
          label: newDraft.label.trim(),
          firstResponseMinutes: fr,
          resolutionMinutes: parseResolution(newDraft.resolutionMinutes),
          rank: newDraft.rank.trim() ? parseInt(newDraft.rank) : undefined,
          isUrgent: newDraft.isUrgent,
          resolutionOptional: newDraft.resolutionOptional,
          use24x7: newDraft.use24x7,
        },
      });
      toast.success("Severity added");
      invalidate();
      setIsOpen(false);
      setNewDraft({ label: "", firstResponseMinutes: "60", resolutionMinutes: "planned", rank: "", isUrgent: false, resolutionOptional: false, use24x7: false });
    } catch (err: any) {
      toast.error(err?.message || "Failed to add severity");
    }
  };

  const severityFields = (d: SeverityDraft, set: (patch: Partial<SeverityDraft>) => void, idPrefix: string) => (
    <div className="space-y-4 py-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>Label</Label>
          <Input value={d.label} onChange={e => set({ label: e.target.value })} placeholder="P1 Critical" data-testid={`${idPrefix}-label`} />
        </div>
        <div className="space-y-1.5">
          <Label>Rank (lower = more severe)</Label>
          <Input type="number" min="1" value={d.rank} onChange={e => set({ rank: e.target.value })} placeholder="auto" data-testid={`${idPrefix}-rank`} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label>First response (mins)</Label>
          <Input type="number" min="1" value={d.firstResponseMinutes} onChange={e => set({ firstResponseMinutes: e.target.value })} data-testid={`${idPrefix}-firstresponse`} />
        </div>
        <div className="space-y-1.5">
          <Label>Resolution target</Label>
          <Select value={d.resolutionMinutes} onValueChange={v => set({ resolutionMinutes: v })}>
            <SelectTrigger data-testid={`${idPrefix}-resolution`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {RESOLUTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-3 pt-1">
        <div className="flex items-center justify-between">
          <div>
            <Label>Schedule</Label>
            <p className="text-xs text-stone-500">{d.use24x7 ? "24x7 (wall clock)" : "Business hours (M-F)"}</p>
          </div>
          <Switch checked={d.use24x7} onCheckedChange={c => set({ use24x7: c })} className="data-[state=checked]:bg-amber-500" />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Urgent</Label>
            <p className="text-xs text-stone-500">Drives urgent alerts for new tickets</p>
          </div>
          <Switch checked={d.isUrgent} onCheckedChange={c => set({ isUrgent: c })} className="data-[state=checked]:bg-red-500" />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <Label>Resolution optional</Label>
            <p className="text-xs text-stone-500">No resolution SLA is enforced</p>
          </div>
          <Switch checked={d.resolutionOptional} onCheckedChange={c => set({ resolutionOptional: c })} className="data-[state=checked]:bg-emerald-500" />
        </div>
      </div>
    </div>
  );

  return (
    <Card className="border-stone-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-stone-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Severities</CardTitle>
          <CardDescription>Severity levels and their SLA response/resolution targets.</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#EFB323] hover:bg-[#D69E1E]" data-testid="button-add-severity"><Plus className="mr-2 h-4 w-4" /> Add Severity</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Severity</DialogTitle>
              <DialogDescription>Leave rank blank to append at the end.</DialogDescription>
            </DialogHeader>
            {severityFields(newDraft, patch => setNewDraft(prev => ({ ...prev, ...patch })), "input-new-severity")}
            <Button className="w-full bg-[#EFB323]" disabled={createSeverity.isPending} onClick={handleCreate} data-testid="button-save-new-severity">
              {createSeverity.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Add Severity"}
            </Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-stone-50">
            <TableRow>
              <TableHead className="pl-6">Severity</TableHead>
              <TableHead>Rank</TableHead>
              <TableHead>First Response</TableHead>
              <TableHead>Resolution</TableHead>
              <TableHead>Schedule</TableHead>
              <TableHead>Flags</TableHead>
              <TableHead className="text-right pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-500" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-red-600">Failed to load severities</TableCell></TableRow>
            ) : severities?.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="h-24 text-center text-stone-500">No severities configured</TableCell></TableRow>
            ) : (
              severities?.map(s => {
                const isEditing = editingId === s.id && draft;
                const set = (patch: Partial<SeverityDraft>) => setDraft(prev => (prev ? { ...prev, ...patch } : prev));
                return (
                  <TableRow key={s.id} className={s.active ? "" : "bg-stone-50/60"}>
                    {isEditing ? (
                      <>
                        <TableCell className="pl-6"><Input value={draft!.label} onChange={e => set({ label: e.target.value })} className="h-8 w-40" data-testid={`input-severity-label-${s.id}`} /></TableCell>
                        <TableCell><Input type="number" min="1" value={draft!.rank} onChange={e => set({ rank: e.target.value })} className="h-8 w-16" data-testid={`input-severity-rank-${s.id}`} /></TableCell>
                        <TableCell><Input type="number" min="1" value={draft!.firstResponseMinutes} onChange={e => set({ firstResponseMinutes: e.target.value })} className="h-8 w-20" data-testid={`input-severity-fr-${s.id}`} /></TableCell>
                        <TableCell>
                          <Select value={draft!.resolutionMinutes} onValueChange={v => set({ resolutionMinutes: v })}>
                            <SelectTrigger className="h-8 w-40" data-testid={`select-severity-res-${s.id}`}><SelectValue /></SelectTrigger>
                            <SelectContent>{RESOLUTION_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}</SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Switch checked={draft!.use24x7} onCheckedChange={c => set({ use24x7: c })} className="data-[state=checked]:bg-amber-500" />
                            <span className="text-xs text-stone-500">{draft!.use24x7 ? "24x7" : "Bus hrs"}</span>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1.5">
                            <label className="flex items-center gap-2 text-xs text-stone-600"><Switch checked={draft!.isUrgent} onCheckedChange={c => set({ isUrgent: c })} className="data-[state=checked]:bg-red-500 scale-90" /> Urgent</label>
                            <label className="flex items-center gap-2 text-xs text-stone-600"><Switch checked={draft!.resolutionOptional} onCheckedChange={c => set({ resolutionOptional: c })} className="data-[state=checked]:bg-emerald-500 scale-90" /> Res. optional</label>
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" disabled={updateSeverity.isPending} onClick={() => saveEdit(s.id)} className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50" data-testid={`button-save-severity-${s.id}`}><Check className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-stone-500" data-testid={`button-cancel-severity-${s.id}`}><X className="h-4 w-4" /></Button>
                          </div>
                        </TableCell>
                      </>
                    ) : (
                      <>
                        <TableCell className="pl-6">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${s.active ? "text-[#0F1F3D]" : "text-stone-400"}`}>{s.label}</span>
                            <span className="text-xs text-stone-400">{s.key}</span>
                            {!s.active && <Badge variant="outline" className="bg-stone-100 text-stone-500">Retired</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-stone-600">{s.rank}</TableCell>
                        <TableCell className="text-sm text-stone-600">{s.firstResponseMinutes}m</TableCell>
                        <TableCell className="text-sm text-stone-600">{s.resolutionMinutes === null ? <span className="italic text-stone-500">Planned</span> : `${s.resolutionMinutes}m`}</TableCell>
                        <TableCell className="text-sm text-stone-600">{s.use24x7 ? "24x7" : "Bus hrs"}</TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {s.isUrgent && <Badge variant="outline" className="bg-red-50 text-red-700">Urgent</Badge>}
                            {s.resolutionOptional && <Badge variant="outline" className="bg-emerald-50 text-emerald-700">Res. optional</Badge>}
                          </div>
                        </TableCell>
                        <TableCell className="text-right pr-6">
                          <div className="flex items-center justify-end gap-1">
                            <Button variant="ghost" size="sm" onClick={() => startEdit(s)} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" data-testid={`button-edit-severity-${s.id}`}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
                            {s.active ? (
                              <Button variant="ghost" size="sm" disabled={updateSeverity.isPending || checkingId === s.id} onClick={() => requestRetire(s)} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" data-testid={`button-retire-severity-${s.id}`}>{checkingId === s.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />} Retire</Button>
                            ) : (
                              <Button variant="ghost" size="sm" disabled={updateSeverity.isPending} onClick={() => restore(s)} className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50" data-testid={`button-restore-severity-${s.id}`}><RotateCcw className="h-4 w-4 mr-2" /> Restore</Button>
                            )}
                          </div>
                        </TableCell>
                      </>
                    )}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
        <div className="p-4 bg-amber-50 border-t border-stone-100 flex gap-3 text-amber-800 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>Business hours are 09:00 - 18:00 UTC, Monday through Friday. Retiring a severity hides it from new tickets but keeps existing tickets intact — restore it any time.</p>
        </div>
      </CardContent>
      <RetireConfirmDialog
        target={retireTarget}
        noun="severity"
        isPending={updateSeverity.isPending}
        onCancel={() => setRetireTarget(null)}
        onConfirm={() => retireTarget && doRetire(retireTarget.id)}
      />
    </Card>
  );
}

// --- TAXONOMY (categories / environments) ---
type TaxonomyListHook = typeof useListCategories;
type TaxonomyCreateHook = typeof useCreateCategory;
type TaxonomyUpdateHook = typeof useUpdateCategory;

function TaxonomySection({
  title,
  description,
  usageType,
  useList,
  useCreate,
  useUpdate,
  listQueryKey,
}: {
  title: string;
  description: string;
  usageType: TaxonomyUsageType;
  useList: TaxonomyListHook;
  useCreate: TaxonomyCreateHook;
  useUpdate: TaxonomyUpdateHook;
  listQueryKey: readonly unknown[];
}) {
  const { data: items, isLoading, isError } = useList();
  const createItem = useCreate();
  const updateItem = useUpdate();

  const [isOpen, setIsOpen] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editSortOrder, setEditSortOrder] = useState("");

  const singular = title.replace(/ies$/, "y").replace(/s$/, "");

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: listQueryKey as unknown[] });
    queryClient.invalidateQueries({ queryKey: getGetTicketConfigQueryKey() });
  };

  const handleCreate = async () => {
    if (!newLabel.trim()) {
      toast.error("Label required");
      return;
    }
    try {
      await createItem.mutateAsync({ data: { label: newLabel.trim() } });
      toast.success(`${singular} added`);
      invalidate();
      setIsOpen(false);
      setNewLabel("");
    } catch (err: any) {
      toast.error(err?.message || "Failed to add");
    }
  };

  const startEdit = (item: TaxonomyOption) => {
    setEditingId(item.id);
    setEditLabel(item.label);
    setEditSortOrder(item.sortOrder.toString());
  };
  const cancelEdit = () => {
    setEditingId(null);
    setEditLabel("");
    setEditSortOrder("");
  };

  const saveEdit = async (id: number) => {
    if (!editLabel.trim()) {
      toast.error("Label required");
      return;
    }
    try {
      await updateItem.mutateAsync({
        id,
        data: { label: editLabel.trim(), sortOrder: editSortOrder.trim() ? parseInt(editSortOrder) : undefined },
      });
      toast.success(`${singular} updated`);
      invalidate();
      cancelEdit();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update");
    }
  };

  const [retireTarget, setRetireTarget] = useState<RetireTarget | null>(null);
  const [checkingId, setCheckingId] = useState<number | null>(null);

  const doRetire = async (id: number) => {
    try {
      await updateItem.mutateAsync({ id, data: { active: false } });
      toast.success(`${singular} retired`);
      invalidate();
      setRetireTarget(null);
    } catch (err: any) {
      toast.error(err?.message || "Failed to update");
    }
  };

  // Retiring: check open-ticket usage first and warn if any depend on it.
  const requestRetire = async (item: TaxonomyOption) => {
    setCheckingId(item.id);
    try {
      const usage = await getTaxonomyUsage(usageType, item.id);
      if (usage.openTicketCount > 0) {
        setRetireTarget({ id: item.id, label: item.label, count: usage.openTicketCount });
      } else {
        await doRetire(item.id);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to check ticket usage");
    } finally {
      setCheckingId(null);
    }
  };

  const restore = async (item: TaxonomyOption) => {
    try {
      await updateItem.mutateAsync({ id: item.id, data: { active: true } });
      toast.success(`${singular} restored`);
      invalidate();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update");
    }
  };

  return (
    <Card className="border-stone-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-stone-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#EFB323] hover:bg-[#D69E1E]" data-testid={`button-add-${title.toLowerCase()}`}><Plus className="mr-2 h-4 w-4" /> Add {singular}</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add {singular}</DialogTitle>
              <DialogDescription>The stable key is derived from the label automatically.</DialogDescription>
            </DialogHeader>
            <div className="space-y-1.5 py-2">
              <Label>Label</Label>
              <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder={`New ${singular.toLowerCase()}`} data-testid={`input-new-${title.toLowerCase()}`} />
            </div>
            <Button className="w-full bg-[#EFB323]" disabled={createItem.isPending} onClick={handleCreate} data-testid={`button-save-new-${title.toLowerCase()}`}>
              {createItem.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : `Add ${singular}`}
            </Button>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-stone-50">
            <TableRow>
              <TableHead className="pl-6">Label</TableHead>
              <TableHead>Key</TableHead>
              <TableHead className="w-[120px]">Sort Order</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right pr-6">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-500" /></TableCell></TableRow>
            ) : isError ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-red-600">Failed to load</TableCell></TableRow>
            ) : items?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-stone-500">Nothing configured yet</TableCell></TableRow>
            ) : (
              items?.map(item => {
                const isEditing = editingId === item.id;
                return (
                  <TableRow key={item.id} className={item.active ? "" : "bg-stone-50/60"}>
                    <TableCell className="pl-6">
                      {isEditing ? (
                        <Input value={editLabel} onChange={e => setEditLabel(e.target.value)} className="h-8 w-48" data-testid={`input-taxonomy-label-${item.id}`} />
                      ) : (
                        <span className={`font-medium ${item.active ? "text-[#0F1F3D]" : "text-stone-400"}`}>{item.label}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-stone-400">{item.key}</TableCell>
                    <TableCell>
                      {isEditing ? (
                        <Input type="number" value={editSortOrder} onChange={e => setEditSortOrder(e.target.value)} className="h-8 w-20" data-testid={`input-taxonomy-sort-${item.id}`} />
                      ) : (
                        <span className="text-sm text-stone-600">{item.sortOrder}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.active ? (
                        <Badge variant="outline" className="bg-emerald-50 text-emerald-700">Active</Badge>
                      ) : (
                        <Badge variant="outline" className="bg-stone-100 text-stone-500">Retired</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right pr-6">
                      {isEditing ? (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" disabled={updateItem.isPending} onClick={() => saveEdit(item.id)} className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50" data-testid={`button-save-taxonomy-${item.id}`}><Check className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="sm" onClick={cancelEdit} className="text-stone-500" data-testid={`button-cancel-taxonomy-${item.id}`}><X className="h-4 w-4" /></Button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="sm" onClick={() => startEdit(item)} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" data-testid={`button-edit-taxonomy-${item.id}`}><Pencil className="h-4 w-4 mr-2" /> Edit</Button>
                          {item.active ? (
                            <Button variant="ghost" size="sm" disabled={updateItem.isPending || checkingId === item.id} onClick={() => requestRetire(item)} className="text-amber-600 hover:text-amber-800 hover:bg-amber-50" data-testid={`button-retire-taxonomy-${item.id}`}>{checkingId === item.id ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />} Retire</Button>
                          ) : (
                            <Button variant="ghost" size="sm" disabled={updateItem.isPending} onClick={() => restore(item)} className="text-emerald-600 hover:text-emerald-800 hover:bg-emerald-50" data-testid={`button-restore-taxonomy-${item.id}`}><RotateCcw className="h-4 w-4 mr-2" /> Restore</Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </CardContent>
      <RetireConfirmDialog
        target={retireTarget}
        noun={singular.toLowerCase()}
        isPending={updateItem.isPending}
        onCancel={() => setRetireTarget(null)}
        onConfirm={() => retireTarget && doRetire(retireTarget.id)}
      />
    </Card>
  );
}

// --- REPORTS TAB ---
function KbDeflectionSection() {
  const { data: stats, isLoading } = useGetKbDeflectionStats();

  if (isLoading || !stats) return null;

  const cards = [
    {
      label: "Drafts Shown Articles",
      value: stats.draftsWithSuggestions,
      hint: "Ticket drafts where suggestions appeared",
    },
    {
      label: "Article Clicks",
      value: stats.draftsWithClicks,
      hint: "Drafts where a suggested article was opened",
    },
    {
      label: "Likely Deflected",
      value: stats.draftsAbandonedAfterClick,
      hint: "Read an article, never filed the ticket",
    },
    {
      label: "Filed Anyway",
      value: stats.ticketsFiledAfterSuggestions,
      hint: `${stats.ticketsFiledAfterClick} of these clicked an article first`,
    },
  ];

  return (
    <Card className="border-stone-200 shadow-sm" data-testid="kb-deflection-card">
      <CardHeader className="pb-2 border-b border-stone-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[#EFB323]" />
              Self-Service Deflection
            </CardTitle>
            <CardDescription className="mt-1">
              Do suggested KB articles stop tickets from being filed?
            </CardDescription>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-[#0F1F3D]" data-testid="deflection-rate">
              {stats.deflectionRatePct !== null ? `${stats.deflectionRatePct.toFixed(0)}%` : "N/A"}
            </div>
            <p className="text-xs text-stone-500">Deflection rate</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-stone-200 p-4">
              <div className="text-2xl font-bold text-[#0F1F3D]">{c.value}</div>
              <div className="text-sm font-medium text-stone-700 mt-1">{c.label}</div>
              <p className="text-xs text-stone-500 mt-0.5">{c.hint}</p>
            </div>
          ))}
        </div>

        {stats.topArticles.length > 0 && (
          <div>
            <h4 className="text-sm font-semibold text-[#0F1F3D] mb-2">Most-Clicked Suggestions</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Article</TableHead>
                  <TableHead className="text-right">Shown (drafts)</TableHead>
                  <TableHead className="text-right">Opened (drafts)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.topArticles.map((a) => (
                  <TableRow key={a.articleId}>
                    <TableCell className="font-medium text-stone-700">{a.title}</TableCell>
                    <TableCell className="text-right">{a.impressions}</TableCell>
                    <TableCell className="text-right">{a.clicks}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {stats.uncoveredQueries.length > 0 && (
          <div data-testid="uncovered-topics">
            <h4 className="text-sm font-semibold text-[#0F1F3D] mb-1">Top Uncovered Topics</h4>
            <p className="text-xs text-stone-500 mb-2">
              What people searched while drafting a ticket, where no article helped — write these next.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Search query</TableHead>
                  <TableHead className="text-right">Drafts</TableHead>
                  <TableHead className="text-right">Coverage</TableHead>
                  <TableHead className="text-right">Last searched</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stats.uncoveredQueries.map((q) => (
                  <TableRow key={q.query}>
                    <TableCell className="font-medium text-stone-700">{q.query}</TableCell>
                    <TableCell className="text-right">{q.drafts}</TableCell>
                    <TableCell className="text-right">
                      {q.zeroResultDrafts > 0 ? (
                        <Badge variant="outline" className="bg-red-50 text-red-700 border-red-200">
                          No articles suggested
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                          Suggested, not opened
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-xs text-stone-500">{formatDate(q.lastSearchedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {stats.draftsWithSuggestions === 0 && (
          <p className="text-sm text-stone-500">
            No suggestion activity recorded yet. Metrics appear once customers start drafting tickets.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ReportsTab() {
  const { data: report, isLoading } = useGetReports();

  if (isLoading) {
    return <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-amber-500" /></div>;
  }

  if (!report) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-stone-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-stone-500 uppercase tracking-wider">Total Tickets</h3>
              <div className="p-2 bg-amber-50 rounded-md text-amber-600"><BarChart3 className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">{report.totalTickets}</div>
            <p className="text-xs text-stone-500 mt-1">{report.openTickets} currently open</p>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-stone-500 uppercase tracking-wider">Avg Resolution</h3>
              <div className="p-2 bg-amber-50 rounded-md text-amber-600"><Clock className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">
              {report.avgResolutionHours !== null ? `${report.avgResolutionHours.toFixed(1)}h` : 'N/A'}
            </div>
            <p className="text-xs text-stone-500 mt-1">Across all resolved tickets</p>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-stone-500 uppercase tracking-wider">Response SLA</h3>
              <div className="p-2 bg-emerald-50 rounded-md text-emerald-600"><Check className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">
              {report.slaResponseCompliancePct !== null ? `${report.slaResponseCompliancePct.toFixed(0)}%` : 'N/A'}
            </div>
            <p className="text-xs text-stone-500 mt-1">First response target met</p>
          </CardContent>
        </Card>

        <Card className="border-stone-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-stone-500 uppercase tracking-wider">Resolution SLA</h3>
              <div className="p-2 bg-emerald-50 rounded-md text-emerald-600"><Check className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">
              {report.slaResolutionCompliancePct !== null ? `${report.slaResolutionCompliancePct.toFixed(0)}%` : 'N/A'}
            </div>
            <p className="text-xs text-stone-500 mt-1">Resolution target met</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-stone-200 shadow-sm">
        <CardHeader className="pb-2 border-b border-stone-100">
          <CardTitle>Ticket Volume Trends (Last 8 Weeks)</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-2">
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={report.weeklyVolume} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                <XAxis 
                  dataKey="weekStart" 
                  tickFormatter={(val) => formatDate(val)} 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }} 
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#64748b', fontSize: 12 }}
                  dx={-10}
                />
                <Tooltip 
                  labelFormatter={(val) => `Week of ${formatDate(val)}`}
                  contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                />
                <Line 
                  type="monotone" 
                  dataKey="created" 
                  name="Created" 
                  stroke="#EFB323" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2 }} 
                  activeDot={{ r: 6 }} 
                />
                <Line 
                  type="monotone" 
                  dataKey="resolved" 
                  name="Resolved" 
                  stroke="#10B981" 
                  strokeWidth={3} 
                  dot={{ r: 4, strokeWidth: 2 }} 
                  activeDot={{ r: 6 }} 
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <KbDeflectionSection />
    </div>
  );
}
