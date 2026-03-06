import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { Plus, Search, Truck, Package, CheckCircle, Printer, MapPin } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';
import { salesApi } from '../../services/api';

const STATUS_BADGE: Record<string, string> = {
  DRAFT:      'badge-gray',
  CONFIRMED:  'badge-blue',
  DISPATCHED: 'badge-amber',
  DELIVERED:  'badge-green',
  CANCELLED:  'badge-red',
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

const today = new Date().toISOString().split('T')[0];
const BLANK = { salesOrderId: '', dispatchDate: today, carrier: '', trackingNumber: '', notes: '', deliveryAddress: '' };

export function ShippingPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });

  const { data, isLoading } = useQuery({
    queryKey: ['shipments', statusFilter],
    queryFn: () => api.get('/shipping/manifests', { params: { limit: 200, status: statusFilter || undefined } }).then((r) => r.data),
  });

  const { data: ordersData } = useQuery({
    queryKey: ['orders-dd'],
    queryFn: () => salesApi.listOrders({ limit: 500, status: 'READY_TO_SHIP' }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/shipping/manifests', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['shipments'] }); setNewOpen(false); setForm({ ...BLANK }); },
  });

  const dispatchMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/shipping/manifests/${id}/dispatch`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });

  const deliverMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/shipping/manifests/${id}/deliver`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['shipments'] }),
  });

  const manifests: any[] = ((data as any)?.data ?? []).filter((m: any) =>
    !search ||
    m.manifestNumber?.toLowerCase().includes(search.toLowerCase()) ||
    m.salesOrder?.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const dispatched = manifests.filter((m) => m.status === 'DISPATCHED').length;
  const pending    = manifests.filter((m) => ['DRAFT','CONFIRMED'].includes(m.status)).length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Shipping Manifests</h1>
          <p className="page-subtitle">{manifests.length} manifests · {pending} pending dispatch · {dispatched} in transit</p>
        </div>
        <div className="flex gap-2">
          <select className="input h-9 text-xs w-36" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT','CONFIRMED','DISPATCHED','DELIVERED','CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={13} /> New Manifest</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Pending Dispatch', value: pending,             color: 'text-blue-600' },
          { label: 'In Transit',       value: dispatched,          color: 'text-amber-600' },
          { label: 'Delivered',        value: manifests.filter((m) => m.status === 'DELIVERED').length, color: 'text-green-600' },
          { label: 'Total',            value: manifests.length,    color: 'text-foreground' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search manifests…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Manifest #</th><th>Customer</th><th>Sales Order</th><th>Status</th>
                <th>Carrier</th><th>Tracking</th><th>Dispatch Date</th><th>Delivered</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 9 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : manifests.map((m) => (
                    <tr key={m.id}>
                      <td className="font-mono text-xs font-semibold text-primary-700">{m.manifestNumber}</td>
                      <td className="font-medium">{m.salesOrder?.customer?.name ?? '—'}</td>
                      <td className="font-mono text-xs">{m.salesOrder?.orderNumber ?? '—'}</td>
                      <td><span className={STATUS_BADGE[m.status] ?? 'badge-gray'}>{m.status}</span></td>
                      <td className="text-xs">{m.carrier ?? '—'}</td>
                      <td className="font-mono text-xs text-blue-600">{m.trackingNumber ?? '—'}</td>
                      <td className="text-xs text-steel-500">{m.dispatchDate ? format(new Date(m.dispatchDate), 'dd MMM yyyy') : '—'}</td>
                      <td className="text-xs text-steel-500">{m.deliveredDate ? format(new Date(m.deliveredDate), 'dd MMM yyyy') : '—'}</td>
                      <td>
                        <div className="flex gap-1">
                          {m.status === 'CONFIRMED' && (
                            <button className="btn-amber btn-sm" onClick={() => dispatchMutation.mutate(m.id)}><Truck size={11} /> Dispatch</button>
                          )}
                          {m.status === 'DISPATCHED' && (
                            <button className="btn-secondary btn-sm text-green-600" onClick={() => deliverMutation.mutate(m.id)}><CheckCircle size={11} /> Delivered</button>
                          )}
                          <button className="btn-ghost btn-sm p-1"><Printer size={12} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && manifests.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Truck size={22} /></div>
            <p className="text-sm font-medium">No shipping manifests</p>
            <button className="btn-primary btn-sm mt-3" onClick={() => setNewOpen(true)}><Plus size={12} /> Create manifest</button>
          </div>
        )}
      </div>

      {/* New Manifest Modal */}
      <Modal open={newOpen} onClose={() => setNewOpen(false)} title="New Shipping Manifest" size="lg"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setNewOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.salesOrderId || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating…' : 'Create Manifest'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Sales Order *</label>
            <select className="select" value={form.salesOrderId} onChange={(e) => setForm({ ...form, salesOrderId: e.target.value })}>
              <option value="">Select sales order (Ready to Ship)…</option>
              {(ordersData?.data ?? []).map((o: any) => (
                <option key={o.id} value={o.id}>{o.orderNumber} — {o.customer?.name}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label className="label">Dispatch Date</label>
            <input type="date" className="input" value={form.dispatchDate} onChange={(e) => setForm({ ...form, dispatchDate: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Carrier</label>
              <input className="input" value={form.carrier} onChange={(e) => setForm({ ...form, carrier: e.target.value })} placeholder="TNT, Toll, Startrack…" />
            </div>
            <div className="form-group">
              <label className="label">Tracking Number</label>
              <input className="input font-mono" value={form.trackingNumber} onChange={(e) => setForm({ ...form, trackingNumber: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="label"><MapPin size={12} className="inline mr-1" />Delivery Address</label>
            <textarea className="input min-h-[70px] resize-none" value={form.deliveryAddress}
              onChange={(e) => setForm({ ...form, deliveryAddress: e.target.value })} placeholder="Full delivery address…" />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[60px] resize-none" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
