import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, type InventoryItem } from '../../services/api';
import { Plus, Search, ArrowRight, ArrowLeftRight, CheckCircle, Package } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const BLANK = { fromLocationId: '', toLocationId: '', itemId: '', qty: '', notes: '', reference: '' };

export function StockTransferPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [transferOpen, setTransferOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [fromFilter, setFromFilter] = useState('');

  const { data: locationsData } = useQuery({
    queryKey: ['locations'],
    queryFn: () => inventoryApi.listLocations().then((r) => r.data),
  });

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['items-transfer', fromFilter, search],
    queryFn: () => inventoryApi.listItems({ limit: 100, locationId: fromFilter || undefined, search: search || undefined }).then((r) => r.data),
  });

  const { data: transfersData } = useQuery({
    queryKey: ['transfers'],
    queryFn: () => inventoryApi.listTransfers({ limit: 100 }).then((r) => r.data),
  });

  const transferMutation = useMutation({
    mutationFn: () => inventoryApi.createTransfer({
      fromLocationId: form.fromLocationId,
      toLocationId: form.toLocationId,
      lines: [{ itemId: form.itemId, qty: form.qty }],
      notes: form.notes,
      reference: form.reference,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['items-transfer'] }); qc.invalidateQueries({ queryKey: ['transfers'] }); setTransferOpen(false); setForm({ ...BLANK }); },
  });

  const locations: any[] = (locationsData as any) ?? [];
  const items: InventoryItem[] = (itemsData?.data ?? []);
  const transfers: any[] = ((transfersData as any)?.data ?? []).filter((t: any) =>
    !search || t.reference?.toLowerCase().includes(search.toLowerCase()),
  );

  function openTransfer(item?: InventoryItem) {
    setForm({
      ...BLANK,
      fromLocationId: item?.locationId ?? fromFilter,
      itemId: item?.id ?? '',
    });
    setTransferOpen(true);
  }

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Stock Transfer</h1>
          <p className="page-subtitle">Move stock between locations and warehouses</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => openTransfer()}><Plus size={13} /> New Transfer</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Stock on hand by location */}
        <div className="space-y-3">
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Stock On Hand</span>
              <select className="input h-7 text-xs w-40" value={fromFilter} onChange={(e) => setFromFilter(e.target.value)}>
                <option value="">All locations</option>
                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="card-body py-2 border-b border-border">
              <div className="relative">
                <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
                <input className="input pl-8 h-8 text-xs w-full" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
            </div>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Product</th><th>Location</th><th className="text-right">Avail</th><th>UOM</th><th></th></tr></thead>
                <tbody>
                  {isLoading
                    ? Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>{Array.from({ length: 5 }).map((__, j) => <td key={j}><div className="skeleton h-3 w-16" /></td>)}</tr>
                      ))
                    : items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <div className="font-mono text-xs font-bold">{item.product?.code}</div>
                            <div className="text-xs text-muted-foreground truncate max-w-[140px]">{item.product?.description}</div>
                            {item.heatNumber && <div className="text-xs text-muted-foreground">Heat: {item.heatNumber}</div>}
                          </td>
                          <td className="text-xs text-muted-foreground">{item.location?.name}</td>
                          <td className="text-right font-mono text-xs font-semibold">{parseFloat(item.qtyAvailable).toFixed(2)}</td>
                          <td className="text-xs">{item.product?.uom}</td>
                          <td>
                            <button className="btn-ghost btn-sm p-1" onClick={() => openTransfer(item)} title="Transfer">
                              <ArrowRight size={12} />
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
            {!isLoading && items.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">No stock found</div>
            )}
          </div>
        </div>

        {/* Transfer history */}
        <div className="space-y-3">
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Recent Transfers</span>
              <span className="text-xs text-muted-foreground">{transfers.length}</span>
            </div>
            <div className="table-container">
              <table className="table">
                <thead><tr><th>Reference</th><th>From</th><th>To</th><th>Lines</th><th>Date</th><th>Status</th></tr></thead>
                <tbody>
                  {transfers.length === 0
                    ? <tr><td colSpan={6} className="text-center text-sm text-muted-foreground py-8">No transfers yet</td></tr>
                    : transfers.map((t: any) => (
                        <tr key={t.id}>
                          <td className="font-mono text-xs font-semibold text-primary-700">{t.reference ?? t.transferNumber}</td>
                          <td className="text-xs">{t.fromLocation?.name}</td>
                          <td className="text-xs">
                            <span className="flex items-center gap-1"><ArrowRight size={10} />{t.toLocation?.name}</span>
                          </td>
                          <td className="text-xs text-muted-foreground">{t.lines?.length ?? 0}</td>
                          <td className="text-xs text-steel-500">{t.createdAt ? format(new Date(t.createdAt), 'dd MMM') : '—'}</td>
                          <td><span className={t.status === 'COMPLETED' ? 'badge-green' : 'badge-blue'}>{t.status}</span></td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Transfer Modal */}
      <Modal open={transferOpen} onClose={() => setTransferOpen(false)} title="Transfer Stock" size="lg"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setTransferOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm"
            disabled={!form.fromLocationId || !form.toLocationId || !form.itemId || !form.qty || transferMutation.isPending}
            onClick={() => transferMutation.mutate()}>
            {transferMutation.isPending ? 'Transferring…' : 'Transfer Stock'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">From Location *</label>
              <select className="select" value={form.fromLocationId} onChange={(e) => setForm({ ...form, fromLocationId: e.target.value, itemId: '' })}>
                <option value="">Select…</option>
                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">To Location *</label>
              <select className="select" value={form.toLocationId} onChange={(e) => setForm({ ...form, toLocationId: e.target.value })}>
                <option value="">Select…</option>
                {locations.filter((l: any) => l.id !== form.fromLocationId).map((l: any) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Stock Item *</label>
            <select className="select" value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
              <option value="">Select item…</option>
              {items
                .filter((item) => !form.fromLocationId || item.locationId === form.fromLocationId)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.product?.code} — {item.product?.description}
                    {item.heatNumber ? ` (Heat: ${item.heatNumber})` : ''}
                    {' '}[{parseFloat(item.qtyAvailable).toFixed(2)} {item.product?.uom}]
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Quantity *</label>
              <input type="number" className="input" step="0.001" min="0.001" value={form.qty}
                onChange={(e) => setForm({ ...form, qty: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Reference</label>
              <input className="input" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="e.g. WO-1234" />
            </div>
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
