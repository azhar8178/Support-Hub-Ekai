import { useState } from "react";
import { 
  useListUsers, 
  useUpdateUser,
  useListInvites,
  useCreateInvite,
  useListOrgs,
  useCreateOrg,
  useGetSlaConfig,
  useUpdateSlaConfig,
  useGetReports,
  useGetKbDeflectionStats,
  PortalUserRole,
  InviteRole,
  SlaTargetSeverity
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { 
  Users, Building, Mail, ShieldAlert, BarChart3, Plus, Search, 
  Check, X, Loader2, Copy, AlertTriangle, TrendingUp, Clock, BookOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function AdminDashboardPage() {
  const [activeTab, setActiveTab] = useState("users");

  return (
    <div className="flex flex-col h-full bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-8 py-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Administration</h1>
        <p className="text-slate-500 mt-1">Manage users, organizations, invites, and system configuration.</p>
      </div>

      <div className="flex-1 overflow-auto p-8 max-w-[1400px] mx-auto w-full">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border border-slate-200 shadow-sm p-1 rounded-lg h-12">
            <TabsTrigger value="users" className="data-[state=active]:bg-slate-100 rounded-md px-4"><Users className="h-4 w-4 mr-2" /> Users</TabsTrigger>
            <TabsTrigger value="invites" className="data-[state=active]:bg-slate-100 rounded-md px-4"><Mail className="h-4 w-4 mr-2" /> Invites</TabsTrigger>
            <TabsTrigger value="orgs" className="data-[state=active]:bg-slate-100 rounded-md px-4"><Building className="h-4 w-4 mr-2" /> Organizations</TabsTrigger>
            <TabsTrigger value="sla" className="data-[state=active]:bg-slate-100 rounded-md px-4"><ShieldAlert className="h-4 w-4 mr-2" /> SLA Config</TabsTrigger>
            <TabsTrigger value="reports" className="data-[state=active]:bg-slate-100 rounded-md px-4"><BarChart3 className="h-4 w-4 mr-2" /> Reports</TabsTrigger>
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

          <TabsContent value="sla" className="space-y-4 m-0 border-0 p-0">
            <SlaConfigTab />
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
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Portal Users</CardTitle>
          <CardDescription>Manage access, roles, and organization mapping.</CardDescription>
        </div>
        <div className="relative w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
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
          <TableHeader className="bg-slate-50">
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
              <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" /></TableCell></TableRow>
            ) : filteredUsers.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-slate-500">No users found</TableCell></TableRow>
            ) : (
              filteredUsers.map(user => (
                <TableRow key={user.id}>
                  <TableCell className="pl-6">
                    <div className="font-medium text-[#0F1F3D]">{user.name}</div>
                    <div className="text-xs text-slate-500">{user.email}</div>
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
                        <SelectItem value="none" className="italic text-slate-500">No Organization</SelectItem>
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
                      <span className={`text-xs font-medium ${user.active ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {user.active ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
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
      queryClient.invalidateQueries({ queryKey: ["invites"] });
      toast.success("Invite created");
    } catch (err: any) {
      toast.error(err?.message || "Failed to create invite");
    }
  };

  const copyUrl = (url: string) => {
    navigator.clipboard.writeText(url);
    toast.success("Invite URL copied to clipboard");
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Pending Invites</CardTitle>
          <CardDescription>Generate magic links to onboard new users.</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#2563EB] hover:bg-[#1d4ed8]">
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
                  <Button type="submit" className="w-full bg-[#2563EB]" disabled={createInvite.isPending}>
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
          <TableHeader className="bg-slate-50">
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
              <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" /></TableCell></TableRow>
            ) : invites?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-slate-500">No active invites</TableCell></TableRow>
            ) : (
              invites?.map(inv => {
                const isExpired = new Date(inv.expiresAt) < new Date();
                const isUsed = !!inv.usedAt;
                return (
                  <TableRow key={inv.id}>
                    <TableCell className="pl-6 font-medium text-[#0F1F3D]">{inv.email}</TableCell>
                    <TableCell>
                      <div className="text-sm capitalize">{inv.role.replace('_', ' ')}</div>
                      <div className="text-xs text-slate-500">{inv.orgName || '-'}</div>
                    </TableCell>
                    <TableCell>
                      {isUsed ? <Badge variant="outline" className="bg-slate-100 text-slate-600">Used</Badge> : 
                       isExpired ? <Badge variant="outline" className="bg-red-50 text-red-700">Expired</Badge> : 
                       <Badge variant="outline" className="bg-blue-50 text-blue-700">Pending</Badge>}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">{formatDate(inv.createdAt)}</TableCell>
                    <TableCell className="text-right pr-6">
                      {!isUsed && !isExpired && inv.inviteUrl && (
                        <Button variant="ghost" size="sm" onClick={() => copyUrl(inv.inviteUrl!)} className="text-blue-600 hover:text-blue-800 hover:bg-blue-50">
                          <Copy className="h-4 w-4 mr-2" /> Copy Link
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

// --- ORGANIZATIONS TAB ---
const orgSchema = z.object({
  name: z.string().min(2, "Name required"),
  domain: z.string().optional(),
});

function OrganizationsTab() {
  const { data: orgs, isLoading } = useListOrgs();
  const createOrg = useCreateOrg();
  const [isOpen, setIsOpen] = useState(false);

  const form = useForm<z.infer<typeof orgSchema>>({
    resolver: zodResolver(orgSchema),
    defaultValues: { name: "", domain: "" }
  });

  const onSubmit = async (values: z.infer<typeof orgSchema>) => {
    try {
      await createOrg.mutateAsync({ data: values });
      toast.success("Organization created");
      queryClient.invalidateQueries({ queryKey: ["orgs"] });
      setIsOpen(false);
      form.reset();
    } catch (err: any) {
      toast.error(err?.message || "Failed to create organization");
    }
  };

  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>Organizations</CardTitle>
          <CardDescription>Customer companies that access the portal.</CardDescription>
        </div>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button className="bg-[#2563EB] hover:bg-[#1d4ed8]">
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
                <Button type="submit" className="w-full bg-[#2563EB]" disabled={createOrg.isPending}>
                  {createOrg.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Create"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="pl-6 w-[100px]">ID</TableHead>
              <TableHead>Organization Name</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead className="text-center">Users</TableHead>
              <TableHead className="text-right pr-6">Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" /></TableCell></TableRow>
            ) : orgs?.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="h-24 text-center text-slate-500">No organizations found</TableCell></TableRow>
            ) : (
              orgs?.map(org => (
                <TableRow key={org.id}>
                  <TableCell className="pl-6 font-medium text-slate-500">#{org.id}</TableCell>
                  <TableCell className="font-semibold text-[#0F1F3D]">{org.name}</TableCell>
                  <TableCell className="text-sm text-slate-600">{org.domain || '-'}</TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary" className="bg-slate-100">{org.userCount}</Badge>
                  </TableCell>
                  <TableCell className="text-right pr-6 text-sm text-slate-500">{formatDate(org.createdAt)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

// --- SLA CONFIG TAB ---
function SlaConfigTab() {
  const { data: config, isLoading } = useGetSlaConfig();
  const updateConfig = useUpdateSlaConfig();
  
  // We'll manage the draft state locally
  const [draft, setDraft] = useState<Record<string, { resp: string, res: string, use24x7: boolean }>>({});
  
  // Initialize draft when data loads
  if (config && Object.keys(draft).length === 0) {
    const initial: any = {};
    config.forEach((t) => {
      initial[t.severity] = {
        resp: t.firstResponseMinutes.toString(),
        res: t.resolutionMinutes === null ? "planned" : t.resolutionMinutes.toString(),
        use24x7: t.use24x7
      };
    });
    setDraft(initial);
  }

  const handleSave = async () => {
    const targets = ["P1", "P2", "P3", "P4"].map(sev => ({
      severity: sev as SlaTargetSeverity,
      firstResponseMinutes: parseInt(draft[sev].resp) || 60,
      resolutionMinutes: draft[sev].res === "planned" ? null : (parseInt(draft[sev].res) || 240),
      use24x7: draft[sev].use24x7
    }));

    try {
      await updateConfig.mutateAsync({ data: { targets } });
      toast.success("SLA targets updated");
      queryClient.invalidateQueries({ queryKey: ["sla-config"] });
    } catch (err: any) {
      toast.error(err?.message || "Failed to update SLA config");
    }
  };

  const updateDraft = (sev: string, field: string, val: string | boolean) => {
    setDraft(prev => ({ ...prev, [sev]: { ...prev[sev], [field]: val } }));
  };

  if (isLoading || Object.keys(draft).length === 0) {
    return <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" /></div>;
  }

  return (
    <Card className="border-slate-200 shadow-sm max-w-4xl">
      <CardHeader className="pb-4 border-b border-slate-100 flex flex-row items-center justify-between">
        <div>
          <CardTitle>SLA Configuration</CardTitle>
          <CardDescription>Global targets for ticket response and resolution times.</CardDescription>
        </div>
        <Button onClick={handleSave} disabled={updateConfig.isPending} className="bg-[#2563EB]">
          {updateConfig.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : "Save Changes"}
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow>
              <TableHead className="pl-6 w-[150px]">Severity</TableHead>
              <TableHead>First Response (mins)</TableHead>
              <TableHead>Resolution (mins)</TableHead>
              <TableHead>Schedule</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {["P1", "P2", "P3", "P4"].map(sev => {
              const label = { P1: "P1 Critical", P2: "P2 High", P3: "P3 Normal", P4: "P4 Low" }[sev];
              const colorClass = { P1: "text-red-700 bg-red-50", P2: "text-orange-700 bg-orange-50", P3: "text-amber-700 bg-amber-50", P4: "text-slate-700 bg-slate-100" }[sev];
              return (
                <TableRow key={sev}>
                  <TableCell className="pl-6">
                    <Badge variant="outline" className={`font-medium border-0 ${colorClass}`}>{label}</Badge>
                  </TableCell>
                  <TableCell>
                    <Input 
                      type="number" 
                      min="1" 
                      className="w-32" 
                      value={draft[sev].resp} 
                      onChange={(e) => updateDraft(sev, "resp", e.target.value)}
                    />
                  </TableCell>
                  <TableCell>
                    <Select value={draft[sev].res} onValueChange={(v) => updateDraft(sev, "res", v)}>
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="planned" className="italic text-slate-500">Planned</SelectItem>
                        <SelectItem value="60">1 Hour (60m)</SelectItem>
                        <SelectItem value="120">2 Hours (120m)</SelectItem>
                        <SelectItem value="240">4 Hours (240m)</SelectItem>
                        <SelectItem value="480">8 Hours (480m)</SelectItem>
                        <SelectItem value="1440">24 Hours (1440m)</SelectItem>
                        <SelectItem value="2880">48 Hours (2880m)</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Switch 
                        checked={draft[sev].use24x7} 
                        onCheckedChange={(c) => updateDraft(sev, "use24x7", c)} 
                        className="data-[state=checked]:bg-indigo-500"
                      />
                      <span className="text-xs text-slate-500 font-medium">
                        {draft[sev].use24x7 ? "24x7 (Wall Clock)" : "Business Hrs (M-F)"}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <div className="p-4 bg-amber-50 border-t border-slate-100 flex gap-3 text-amber-800 text-sm">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p>Business hours are calculated as 09:00 - 18:00 UTC, Monday through Friday. Tickets raised outside business hours on non-24x7 SLAs will pause their countdown until the next business day.</p>
        </div>
      </CardContent>
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
    <Card className="border-slate-200 shadow-sm" data-testid="kb-deflection-card">
      <CardHeader className="pb-2 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[#2563EB]" />
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
            <p className="text-xs text-slate-500">Deflection rate</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {cards.map((c) => (
            <div key={c.label} className="rounded-lg border border-slate-200 p-4">
              <div className="text-2xl font-bold text-[#0F1F3D]">{c.value}</div>
              <div className="text-sm font-medium text-slate-700 mt-1">{c.label}</div>
              <p className="text-xs text-slate-500 mt-0.5">{c.hint}</p>
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
                    <TableCell className="font-medium text-slate-700">{a.title}</TableCell>
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
            <p className="text-xs text-slate-500 mb-2">
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
                    <TableCell className="font-medium text-slate-700">{q.query}</TableCell>
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
                    <TableCell className="text-right text-xs text-slate-500">{formatDate(q.lastSearchedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {stats.draftsWithSuggestions === 0 && (
          <p className="text-sm text-slate-500">
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
    return <div className="p-8 text-center"><Loader2 className="h-6 w-6 animate-spin mx-auto text-blue-500" /></div>;
  }

  if (!report) return null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-slate-500 uppercase tracking-wider">Total Tickets</h3>
              <div className="p-2 bg-blue-50 rounded-md text-blue-600"><BarChart3 className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">{report.totalTickets}</div>
            <p className="text-xs text-slate-500 mt-1">{report.openTickets} currently open</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-slate-500 uppercase tracking-wider">Avg Resolution</h3>
              <div className="p-2 bg-indigo-50 rounded-md text-indigo-600"><Clock className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">
              {report.avgResolutionHours !== null ? `${report.avgResolutionHours.toFixed(1)}h` : 'N/A'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Across all resolved tickets</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-slate-500 uppercase tracking-wider">Response SLA</h3>
              <div className="p-2 bg-emerald-50 rounded-md text-emerald-600"><Check className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">
              {report.slaResponseCompliancePct !== null ? `${report.slaResponseCompliancePct.toFixed(0)}%` : 'N/A'}
            </div>
            <p className="text-xs text-slate-500 mt-1">First response target met</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-medium text-sm text-slate-500 uppercase tracking-wider">Resolution SLA</h3>
              <div className="p-2 bg-emerald-50 rounded-md text-emerald-600"><Check className="h-4 w-4" /></div>
            </div>
            <div className="text-3xl font-bold text-[#0F1F3D]">
              {report.slaResolutionCompliancePct !== null ? `${report.slaResolutionCompliancePct.toFixed(0)}%` : 'N/A'}
            </div>
            <p className="text-xs text-slate-500 mt-1">Resolution target met</p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-2 border-b border-slate-100">
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
                  stroke="#2563EB" 
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
