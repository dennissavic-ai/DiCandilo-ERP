import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { processingApi, salesApi } from '../../services/api';
import { Plus, Search, Wrench, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';

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
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({
    salesOrderId: '', priority: '3', scheduledDate: '', notes: '',
  });
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['work-orders'],
    queryFn: () => processingApi.listWorkOrders({ limit: 100 }).then((r) => r.data),
  });

  const { data: salesOrdersData } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => salesApi.listOrders({ limit: 200 }).then((r) => r.data),
    enabled: newOpen,
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => processingApi.createWorkOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['work-orders'] });
      setNewOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? 'Failed to create work order.');
    },
  });

  function resetForm() {
    setForm({ salesOrderId: '', priority: '3', scheduledDate: '', notes: '' });
    setFormError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    createMutation.mutate({
      salesOrderId: form.salesOrderId || undefined,
      priority: parseInt(form.priority),
      scheduledDate: form.scheduledDate || undefined,
      notes: form.notes || undefined,
    });
  }

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
          <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={13} /> New Work Order</button>
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
                    <tr key={wo.id} className="cursor-pointer" onClick={() => navigate(`/processing/work-orders/${wo.id}`)}>
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

      {/* New Work Order Modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-base">New Work Order</h2>
              <button onClick={() => { setNewOpen(false); resetForm(); }} className="text-steel-400 hover:text-foreground"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div>
                <label className="form-label">Sales Order (optional)</label>
                <select className="input" value={form.salesOrderId} onChange={e => setForm(f => ({ ...f, salesOrderId: e.target.value }))}>
                  <option value="">— No linked sales order —</option>
                  {(salesOrdersData?.data ?? []).map((o: any) => (
                    <option key={o.id} value={o.id}>{o.orderNumber} — {o.customer?.name}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Priority (1=Low, 5=High)</label>
                  <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                    {[1,2,3,4,5].map(p => <option key={p} value={p}>P{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Scheduled Date</label>
                  <input className="input" type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setNewOpen(false); resetForm(); }}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create Work Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
