import { useQuery } from '@tanstack/react-query';
import { salesApi } from '../../services/api';
import { Plus, Search, Filter, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:             'badge-gray',
  CONFIRMED:         'badge-blue',
  IN_PRODUCTION:     'badge-amber',
  READY_TO_SHIP:     'badge-teal',
  PARTIALLY_SHIPPED: 'badge-yellow',
  SHIPPED:           'badge-green',
  INVOICED:          'badge-violet',
  CLOSED:            'badge-green',
  CANCELLED:         'badge-red',
};

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000)     return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(2)}`;
}

export function SalesOrdersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => salesApi.getOrders({ limit: 100 }).then((r) => r.data),
  });

  const orders = (data?.data ?? []).filter((o: any) =>
    !search ||
    o.orderNumber?.toLowerCase().includes(search.toLowerCase()) ||
    o.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const totalOpen   = orders.filter((o: any) => !['CLOSED','CANCELLED','INVOICED'].includes(o.status)).length;
  const totalValue  = orders.reduce((s: number, o: any) => s + (o.totalAmount ?? 0), 0);

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales Orders</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total orders · {totalOpen} open</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm"><Filter size={12} /> Filter</button>
          <button className="btn-primary btn-sm"><Plus size={13} /> New Order</button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="text-xl font-bold tabular-nums">{totalOpen}</div>
          <div className="text-xs text-muted-foreground">Open Orders</div>
        </div>
        <div className="stat-card">
          <div className="text-xl font-bold tabular-nums">{fmtCurrency(totalValue)}</div>
          <div className="text-xs text-muted-foreground">Total Value (all)</div>
        </div>
        <div className="stat-card">
          <div className="text-xl font-bold tabular-nums">
            {orders.filter((o: any) => o.status === 'IN_PRODUCTION').length}
          </div>
          <div className="text-xs text-muted-foreground">In Production</div>
        </div>
      </div>

      {/* Search */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search by order # or customer…"
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
                <th>Order #</th>
                <th>Customer</th>
                <th>Status</th>
                <th>Lines</th>
                <th className="text-right">Value</th>
                <th>Order Date</th>
                <th>Required</th>
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
                : orders.map((o: any) => (
                    <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/sales/orders/${o.id}`)}>
                      <td className="font-mono text-xs font-semibold text-primary-700">{o.orderNumber}</td>
                      <td className="font-medium text-foreground">{o.customer?.name ?? '—'}</td>
                      <td><span className={STATUS_BADGE[o.status] ?? 'badge-gray'}>{o.status?.replace(/_/g,' ')}</span></td>
                      <td className="text-steel-500 text-xs">{o.lines?.length ?? 0} lines</td>
                      <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtCurrency(o.totalAmount ?? 0)}</td>
                      <td className="text-steel-500 text-xs">{o.orderDate ? format(new Date(o.orderDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-xs">{o.requiredDate ? format(new Date(o.requiredDate), 'dd MMM yyyy') : '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && orders.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><ShoppingCart size={22} /></div>
            <p className="text-sm font-medium text-foreground">No orders found</p>
          </div>
        )}
      </div>
    </div>
  );
}
