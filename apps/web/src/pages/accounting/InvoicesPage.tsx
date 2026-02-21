import { useQuery } from '@tanstack/react-query';
import { accountingApi } from '../../services/api';
import { Plus, Search, FileText } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:           'badge-gray',
  ISSUED:          'badge-blue',
  PARTIALLY_PAID:  'badge-amber',
  PAID:            'badge-green',
  OVERDUE:         'badge-red',
  VOIDED:          'badge-red',
  CANCELLED:       'badge-red',
};

function fmtCurrency(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
}

export function InvoicesPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: () => accountingApi.getInvoices({ limit: 100 }).then((r) => r.data),
  });

  const invoices = (data?.data ?? []).filter((inv: any) =>
    !search ||
    inv.invoiceNumber?.toLowerCase().includes(search.toLowerCase()) ||
    inv.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Invoices</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total invoices</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary btn-sm"><Plus size={13} /> New Invoice</button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search by invoice # or customer…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Customer</th>
                <th>Status</th>
                <th className="text-right">Amount</th>
                <th className="text-right">Balance Due</th>
                <th>Invoice Date</th>
                <th>Due Date</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : invoices.map((inv: any) => (
                    <tr key={inv.id} className="cursor-pointer">
                      <td className="font-mono text-xs font-semibold text-primary-700">{inv.invoiceNumber}</td>
                      <td className="font-medium text-foreground">{inv.customer?.name ?? '—'}</td>
                      <td><span className={STATUS_BADGE[inv.status] ?? 'badge-gray'}>{inv.status}</span></td>
                      <td className="text-right font-mono text-sm tabular-nums">{fmtCurrency(inv.totalAmount ?? 0)}</td>
                      <td className="text-right font-mono text-sm font-semibold tabular-nums text-red-600">{fmtCurrency(inv.balanceDue ?? 0)}</td>
                      <td className="text-xs text-steel-500">{inv.invoiceDate ? format(new Date(inv.invoiceDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-xs">{inv.dueDate ? format(new Date(inv.dueDate), 'dd MMM yyyy') : '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && invoices.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><FileText size={22} /></div>
            <p className="text-sm font-medium text-foreground">No invoices found</p>
          </div>
        )}
      </div>
    </div>
  );
}
