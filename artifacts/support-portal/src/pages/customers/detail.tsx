import { useEffect, useState } from "react";
import { useParams } from "wouter";
import {
  useGetCustomer,
  useUpdateCustomer,
  getGetCustomerQueryKey,
  getListCustomersQueryKey,
} from "@workspace/api-client-react";
import { queryClient } from "@/lib/queryClient";
import { ArrowLeft, Loader2, Save, Mail, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SeverityBadge, StatusBadge } from "@/components/ticket-badges";
import { formatDate, formatDateTime } from "@/lib/utils";
import { toast } from "sonner";
import { Link } from "wouter";

export default function CustomerDetailPage() {
  const { id } = useParams();
  const customerId = Number(id);

  const { data: customer, isLoading, error } = useGetCustomer(customerId, {
    query: {
      enabled: !!customerId,
      queryKey: getGetCustomerQueryKey(customerId),
    },
  });

  const updateCustomer = useUpdateCustomer();

  const [name, setName] = useState("");
  const [internalNotes, setInternalNotes] = useState("");

  useEffect(() => {
    if (customer) {
      setName(customer.name);
      setInternalNotes(customer.internalNotes ?? "");
    }
  }, [customer]);

  const handleSave = () => {
    updateCustomer.mutate(
      {
        id: customerId,
        data: { name, internalNotes },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCustomerQueryKey(customerId) });
          // Also refresh the directory so an edited name/activity shows immediately on return.
          queryClient.invalidateQueries({ queryKey: getListCustomersQueryKey() });
          toast.success("Customer updated");
        },
        onError: (err: any) => toast.error(err?.message || "Failed to update customer"),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-5xl mx-auto flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-amber-600" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <div className="p-8 max-w-5xl mx-auto text-center">
        <h2 className="text-xl font-bold text-[#0F1F3D]">Customer Not Found</h2>
        <p className="text-stone-500 mt-2">The customer you're looking for doesn't exist or you don't have access.</p>
        <Button asChild className="mt-4" variant="outline">
          <Link href="/customers">Return to Customers</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-stone-50/50">
      {/* Header bar */}
      <div className="bg-white border-b border-stone-200 px-6 py-4 flex-shrink-0 flex items-center gap-4 sticky top-0 z-10">
        <Button variant="ghost" size="icon" asChild className="text-stone-500 hover:text-[#0F1F3D] -ml-2">
          <Link href="/customers">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-[#0F1F3D] tracking-tight">{customer.name}</h1>
          {customer.active ? (
            <Badge variant="outline" className="font-medium bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-50">
              Active
            </Badge>
          ) : (
            <Badge variant="outline" className="font-medium bg-stone-100 text-stone-600 border-stone-200 hover:bg-stone-100">
              Inactive
            </Badge>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Main column */}
          <div className="lg:col-span-2 space-y-6">
            {/* Profile card */}
            <Card className="shadow-sm border-stone-200">
              <CardHeader className="pb-4 border-b border-stone-100 bg-stone-50/50">
                <h2 className="text-lg font-semibold text-[#0F1F3D]">Profile</h2>
              </CardHeader>
              <CardContent className="pt-6 space-y-4 text-sm">
                <div className="flex items-center gap-2 text-stone-600">
                  <Mail className="h-4 w-4 text-stone-400" />
                  <span>{customer.email}</span>
                </div>
                <div className="flex items-center gap-2 text-stone-600">
                  <Building2 className="h-4 w-4 text-stone-400" />
                  <span>{customer.orgName || <span className="text-stone-400">No company</span>}</span>
                </div>
                <div className="grid grid-cols-2 gap-y-3 pt-2">
                  <div className="text-stone-500">Customer since</div>
                  <div className="font-medium text-[#0F1F3D]">{formatDate(customer.createdAt)}</div>
                  <div className="text-stone-500">Last active</div>
                  <div className="font-medium text-[#0F1F3D]">
                    {customer.lastActivityAt ? formatDateTime(customer.lastActivityAt) : <span className="text-stone-400 italic">Never</span>}
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <div className="flex-1 bg-stone-50 border border-stone-100 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-[#0F1F3D]">{customer.ticketCount}</div>
                    <div className="text-xs text-stone-500 mt-1">Total tickets</div>
                  </div>
                  <div className="flex-1 bg-amber-50 border border-amber-100 rounded-lg p-3 text-center">
                    <div className="text-2xl font-bold text-amber-700">{customer.openTicketCount}</div>
                    <div className="text-xs text-amber-600 mt-1">Open tickets</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Ticket history */}
            <Card className="shadow-sm border-stone-200">
              <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/50">
                <h3 className="font-semibold text-[#0F1F3D]">Ticket History</h3>
              </CardHeader>
              <CardContent className="pt-4">
                {customer.tickets.length === 0 ? (
                  <div className="text-center text-sm text-stone-500 py-8">
                    This customer hasn't raised any tickets yet.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customer.tickets.map((ticket) => (
                      <Link
                        key={ticket.id}
                        href={`/tickets/${ticket.id}`}
                        className="flex items-center justify-between gap-4 p-3 rounded-lg border border-stone-100 hover:bg-stone-50 transition-colors"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-[#0F1F3D] truncate">{ticket.title}</div>
                          <div className="text-xs text-stone-500 mt-1">
                            #{ticket.id} • {formatDate(ticket.createdAt)}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <SeverityBadge severity={ticket.severity} />
                          <StatusBadge status={ticket.status} />
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Sidebar — editable record */}
          <div className="space-y-6">
            <Card className="shadow-sm border-stone-200">
              <CardHeader className="pb-3 border-b border-stone-100 bg-stone-50/50">
                <h3 className="font-semibold text-[#0F1F3D]">Customer Record</h3>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="customer-name" className="text-sm font-medium text-[#0F1F3D]">Name</Label>
                  <Input
                    id="customer-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="bg-white"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="internal-notes" className="text-sm font-medium text-[#0F1F3D]">Internal notes</Label>
                  <Textarea
                    id="internal-notes"
                    value={internalNotes}
                    onChange={(e) => setInternalNotes(e.target.value)}
                    placeholder="Staff-only notes to help recognise this customer..."
                    className="min-h-[140px] bg-white resize-y"
                  />
                  <p className="text-xs text-stone-500">Only visible to Ekai staff.</p>
                </div>
                <Button
                  onClick={handleSave}
                  disabled={updateCustomer.isPending}
                  className="w-full bg-[#EFB323] hover:bg-[#D69E1E]"
                >
                  {updateCustomer.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4 mr-2" />
                  )}
                  Save
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
