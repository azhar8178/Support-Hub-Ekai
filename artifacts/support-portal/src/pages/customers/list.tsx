import { useState } from "react";
import { useListCustomers, getListCustomersQueryKey } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { Search, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import { useDebounce } from "@/hooks/use-debounce";

export default function CustomersListPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);

  const customerParams = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
  };

  const { data: customers, isLoading } = useListCustomers(customerParams, {
    query: {
      queryKey: getListCustomersQueryKey(customerParams),
    },
  });

  return (
    <div className="p-8 max-w-7xl mx-auto h-full flex flex-col">
      <div className="mb-6 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-[#0F1F3D]">Customers</h1>
        <p className="text-sm text-stone-500 mt-1">Everyone who raises support with you.</p>
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
                <TableHead className="text-right">Tickets</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Last activity</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                [1, 2, 3, 4, 5].map((i) => (
                  <TableRow key={i} className="animate-pulse">
                    <TableCell><div className="h-4 bg-stone-200 rounded w-40 mb-2"></div><div className="h-3 bg-stone-100 rounded w-24"></div></TableCell>
                    <TableCell><div className="h-4 bg-stone-200 rounded w-48"></div></TableCell>
                    <TableCell><div className="h-4 bg-stone-200 rounded w-32"></div></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-stone-200 rounded w-8 ml-auto"></div></TableCell>
                    <TableCell className="text-right"><div className="h-6 bg-stone-200 rounded-full w-8 ml-auto"></div></TableCell>
                    <TableCell className="text-right"><div className="h-4 bg-stone-200 rounded w-24 ml-auto"></div></TableCell>
                  </TableRow>
                ))
              ) : customers?.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-64 text-center">
                    <div className="flex flex-col items-center justify-center text-stone-500">
                      <Users className="h-8 w-8 mb-4 text-stone-300" />
                      <p className="text-lg font-medium text-[#0F1F3D]">
                        {debouncedSearch ? "No customers match your search" : "No customers yet"}
                      </p>
                      <p className="text-sm mt-1">
                        {debouncedSearch
                          ? "Try adjusting your search query."
                          : "Customers will appear here once they raise support with you."}
                      </p>
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
                      <div className="text-xs text-stone-500">Customer since {formatDate(customer.createdAt)}</div>
                    </TableCell>
                    <TableCell className="text-sm text-stone-600">{customer.email}</TableCell>
                    <TableCell className="text-sm text-stone-600">
                      {customer.orgName || <span className="text-stone-400">—</span>}
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
    </div>
  );
}
