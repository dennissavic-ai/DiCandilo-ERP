import { useQuery } from '@tanstack/react-query';
import { purchasingApi } from '../../services/api';
import { Plus, Search, Truck } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:               'badge-gray',
  SUBMITTED:           'badge-blue',
  APPROVED:            'badge-teal',
  PARTIALLY_RECEIVED:  'badge-amber',
  RECEIVED:            'badge-green',
  INVOICED:            'badge-violet',
  CLOSED:              'badge-green',
  CANCELLED:           'badge-red',
};

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(2)}`;
}

export function PurchaseOrdersPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => purchasingApi.getOrders({ limit: 100 }).then((r) => r.data),
  });

  const orders = (data?.data ?? []).filter((o: any) =>
    !search ||
    o.poNumber?.toLowerCase().includes(search.toLowerCase()) ||
    o.supplier?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Purchase Orders</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total POs</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary btn-sm"><Plus size={13} /> New PO</button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search by PO # or supplier…"
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
                <th>PO #</th>
                <th>Supplier</th>
                <th>Status</th>
                <th>Lines</th>
                <th className="text-right">Value</th>
                <th>Order Date</th>
                <th>Expected</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 7 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : orders.map((o: any) => (
                    <tr key={o.id} className="cursor-pointer">
                      <td className="font-mono text-xs font-semibold text-primary-700">{o.poNumber}</td>
                      <td className="font-medium text-foreground">{o.supplier?.name ?? '—'}</td>
                      <td><span className={STATUS_BADGE[o.status] ?? 'badge-gray'}>{o.status?.replace(/_/g,' ')}</span></td>
                      <td className="text-steel-500 text-xs">{o.lines?.length ?? 0} lines</td>
                      <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtCurrency(o.totalAmount ?? 0)}</td>
                      <td className="text-xs text-steel-500">{o.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-xs">{o.expectedDate ? format(new Date(o.expectedDate), 'dd MMM yyyy') : '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && orders.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Truck size={22} /></div>
            <p className="text-sm font-medium text-foreground">No purchase orders found</p>
          </div>
        )}
      </div>
    </div>
  );
}
