import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasingApi } from '../../services/api';
import { Plus, Search, Truck, X, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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

const EMPTY_LINE = { description: '', qty: '', unitPrice: '' };

export function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({
    supplierId: '', orderDate: '', expectedDate: '', currency: 'AUD', notes: '',
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => purchasingApi.listOrders({ limit: 100 }).then((r: any) => r.data),
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => purchasingApi.listSuppliers({ limit: 200 }).then((r) => r.data),
    enabled: newOpen,
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => purchasingApi.createOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });
      setNewOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? 'Failed to create PO.');
    },
  });

  function resetForm() {
    setForm({ supplierId: '', orderDate: '', expectedDate: '', currency: 'AUD', notes: '' });
    setLines([{ ...EMPTY_LINE }]);
    setFormError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplierId) { setFormError('Supplier is required.'); return; }
    if (lines.some(l => !l.description || !l.qty || !l.unitPrice)) {
      setFormError('All line items require description, qty, and unit price.'); return;
    }
    setFormError('');
    createMutation.mutate({
      ...form,
      lines: lines.map(l => ({
        description: l.description,
        quantity: parseFloat(l.qty),
        unitPrice: Math.round(parseFloat(l.unitPrice) * 100),
      })),
    });
  }

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
          <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={13} /> New PO</button>
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
                    <tr key={o.id} className="cursor-pointer" onClick={() => navigate(`/purchasing/orders/${o.id}`)}>
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

      {/* New PO Modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-base">New Purchase Order</h2>
              <button onClick={() => { setNewOpen(false); resetForm(); }} className="text-steel-400 hover:text-foreground"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Supplier *</label>
                  <select className="input" value={form.supplierId} onChange={e => setForm(f => ({ ...f, supplierId: e.target.value }))}>
                    <option value="">Select supplier…</option>
                    {(suppliersData?.data ?? []).map((s: any) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="form-label">Currency</label>
                  <select className="input" value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}>
                    <option value="AUD">AUD</option>
                    <option value="USD">USD</option>
                    <option value="EUR">EUR</option>
                    <option value="NZD">NZD</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Order Date</label>
                  <input className="input" type="date" value={form.orderDate} onChange={e => setForm(f => ({ ...f, orderDate: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Expected Date</label>
                  <input className="input" type="date" value={form.expectedDate} onChange={e => setForm(f => ({ ...f, expectedDate: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="input" rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>

              {/* Line Items */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="form-label mb-0">Line Items</label>
                  <button type="button" className="btn-secondary btn-sm text-xs" onClick={() => setLines(l => [...l, { ...EMPTY_LINE }])}>
                    <Plus size={11} /> Add Line
                  </button>
                </div>
                <div className="space-y-2">
                  {lines.map((line, i) => (
                    <div key={i} className="grid grid-cols-[1fr_80px_100px_32px] gap-2 items-center">
                      <input
                        className="input text-sm"
                        placeholder="Description"
                        value={line.description}
                        onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, description: e.target.value } : l))}
                      />
                      <input
                        className="input text-sm"
                        type="number"
                        placeholder="Qty"
                        value={line.qty}
                        onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, qty: e.target.value } : l))}
                      />
                      <input
                        className="input text-sm"
                        type="number"
                        step="0.01"
                        placeholder="Unit $"
                        value={line.unitPrice}
                        onChange={e => setLines(ls => ls.map((l, j) => j === i ? { ...l, unitPrice: e.target.value } : l))}
                      />
                      <button type="button" className="text-steel-400 hover:text-red-500 flex-shrink-0" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setNewOpen(false); resetForm(); }}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create PO'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
