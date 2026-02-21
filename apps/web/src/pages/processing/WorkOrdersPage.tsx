import { useQuery } from '@tanstack/react-query';
import { processingApi } from '../../services/api';
import { Plus, Search, Wrench } from 'lucide-react';
import { useState } from 'react';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:      'badge-gray',
  SCHEDULED:  'badge-blue',
  IN_PROGRESS:'badge-amber',
  ON_HOLD:    'badge-yellow',
  COMPLETED:  'badge-green',
  CANCELLED:  'badge-red',
};

const PRIORITY_BADGE: Record<string, string> = {
  1: 'badge-green',
  2: 'badge-blue',
  3: 'badge-amber',
  4: 'badge-orange',
  5: 'badge-red',
};

export function WorkOrdersPage() {
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => processingApi.listWorkOrders({ limit: 100 }).then((r) => r.data),
  });

  const orders = (data?.data ?? []).filter((wo: any) =>
    !search ||
    wo.workOrderNumber?.toLowerCase().includes(search.toLowerCase()) ||
    wo.salesOrder?.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Work Orders</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total work orders</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary btn-sm"><Plus size={13} /> New Work Order</button>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search work orders…"
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
                <th>WO #</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Sales Order</th>
                <th>Customer</th>
                <th>Scheduled</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : orders.map((wo: any) => (
                    <tr key={wo.id} className="cursor-pointer">
                      <td className="font-mono text-xs font-semibold text-primary-700">{wo.workOrderNumber}</td>
                      <td><span className={STATUS_BADGE[wo.status] ?? 'badge-gray'}>{wo.status?.replace(/_/g,' ')}</span></td>
                      <td><span className={PRIORITY_BADGE[wo.priority] ?? 'badge-gray'}>P{wo.priority}</span></td>
                      <td className="font-mono text-xs text-steel-600">{wo.salesOrder?.orderNumber ?? '—'}</td>
                      <td className="text-sm font-medium text-foreground">{wo.salesOrder?.customer?.name ?? '—'}</td>
                      <td className="text-xs text-steel-500">
                        {wo.scheduledDate ? new Date(wo.scheduledDate).toLocaleDateString('en-AU') : '—'}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && orders.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Wrench size={22} /></div>
            <p className="text-sm font-medium text-foreground">No work orders found</p>
          </div>
        )}
      </div>
    </div>
  );
}
