import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasingApi, inventoryApi } from '../../services/api';
import { Plus, Search, Truck, X, Trash2, ChevronUp, ChevronDown } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray',
  SUBMITTED: 'badge-blue',
  APPROVED: 'badge-teal',
  PARTIALLY_RECEIVED: 'badge-amber',
  RECEIVED: 'badge-green',
  INVOICED: 'badge-violet',
  CLOSED: 'badge-green',
  CANCELLED: 'badge-red',
};

function fmtCurrency(cents: number) {
  const d = cents / 100;
  if (d >= 1_000_000) return `$${(d / 1_000_000).toFixed(2)}M`;
  if (d >= 1_000) return `$${(d / 1_000).toFixed(0)}K`;
  return `$${d.toFixed(2)}`;
}

const EMPTY_LINE = { productId: '', description: '', qty: '', unitPrice: '' };

function ProductSearchSelect({ products, value, onChange }: { products: any[]; value: string; onChange: (id: string, description: string) => void }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      const p = products.find(p => p.id === value);
      if (p) setSearch(p.code);
    } else {
      setSearch('');
    }
  }, [value, products]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = search ? products.filter(p => p.code.toLowerCase().includes(search.toLowerCase()) || p.description?.toLowerCase().includes(search.toLowerCase())) : products;

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input text-sm w-full"
        placeholder="Search product..."
        value={search}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={e => {
          setSearch(e.target.value);
          if (!e.target.value) onChange('', '');
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filtered.length > 0 ? filtered.map(p => (
            <div
              key={p.id}
              className="px-3 py-2 text-sm hover:bg-steel-50 cursor-pointer border-b border-border last:border-b-0"
              onClick={() => {
                onChange(p.id, p.description ?? '');
                setSearch(p.code);
                setOpen(false);
              }}
            >
              <div className="font-semibold text-primary-700">{p.code}</div>
              <div className="text-xs text-muted-foreground truncate">{p.description}</div>
            </div>
          )) : (
            <div className="px-3 py-4 text-sm text-center text-muted-foreground">No products found</div>
          )}
        </div>
      )}
    </div>
  );
}

function SearchSelect({ items, value, onChange, placeholder }: { items: { id: string; label: string; sub?: string }[]; value: string; onChange: (id: string) => void; placeholder?: string }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (value) {
      const item = items.find(i => i.id === value);
      if (item) setSearch(item.label);
    } else {
      setSearch('');
    }
  }, [value, items]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = search
    ? items.filter(i => i.label.toLowerCase().includes(search.toLowerCase()) || i.sub?.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input w-full"
        placeholder={placeholder ?? 'Search...'}
        value={search}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={e => {
          setSearch(e.target.value);
          if (!e.target.value) onChange('');
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filtered.length > 0 ? filtered.map(i => (
            <div
              key={i.id}
              className="px-3 py-2 text-sm hover:bg-steel-50 cursor-pointer border-b border-border last:border-b-0"
              onClick={() => { onChange(i.id); setSearch(i.label); setOpen(false); }}
            >
              <div className="font-medium">{i.label}</div>
              {i.sub && <div className="text-xs text-muted-foreground">{i.sub}</div>}
            </div>
          )) : (
            <div className="px-3 py-4 text-sm text-center text-muted-foreground">No results found</div>
          )}
        </div>
      )}
    </div>
  );
}

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

  const [sortField, setSortField] = useState('orderDate');
  const [sortDesc, setSortDesc] = useState(true);

  function toggleSort(field: string) {
    if (sortField === field) setSortDesc(!sortDesc);
    else { setSortField(field); setSortDesc(false); }
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return null;
    return sortDesc ? <ChevronDown size={14} className="inline ml-1" /> : <ChevronUp size={14} className="inline ml-1" />;
  }

  const { data, isLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => purchasingApi.listOrders({ limit: 100 }).then((r: any) => r.data),
  });

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => purchasingApi.listSuppliers({ limit: 200 }).then((r) => r.data),
    enabled: newOpen,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => inventoryApi.listProducts({ limit: 500 }).then((r: any) => r.data),
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
    if (lines.some(l => !l.productId || !l.qty || !l.unitPrice)) {
      setFormError('All line items require a product, qty, and unit price.'); return;
    }
    setFormError('');
    createMutation.mutate({
      supplierId: form.supplierId,
      currencyCode: form.currency,
      orderDate: form.orderDate ? new Date(form.orderDate).toISOString() : undefined,
      expectedDate: form.expectedDate ? new Date(form.expectedDate).toISOString() : undefined,
      notes: form.notes || undefined,
      lines: lines.map(l => ({
        productId: l.productId,
        description: l.description,
        uom: 'EA',
        qtyOrdered: parseFloat(l.qty),
        unitPrice: Math.round(parseFloat(l.unitPrice) * 100),
      })),
    });
  }

  const orders = (data?.data ?? [])
    .filter((o: any) =>
      !search ||
      o.poNumber?.toLowerCase().includes(search.toLowerCase()) ||
      o.supplier?.name?.toLowerCase().includes(search.toLowerCase()),
    )
    .sort((a: any, b: any) => {
      let cmp = 0;
      if (sortField === 'poNumber') cmp = (a.poNumber || '').localeCompare(b.poNumber || '');
      else if (sortField === 'supplier') cmp = (a.supplier?.name || '').localeCompare(b.supplier?.name || '');
      else if (sortField === 'status') cmp = (a.status || '').localeCompare(b.status || '');
      else if (sortField === 'lines') cmp = (a._count?.lines || 0) - (b._count?.lines || 0);
      else if (sortField === 'value') cmp = (a.totalCost || 0) - (b.totalCost || 0);
      else if (sortField === 'orderDate') cmp = new Date(a.orderDate || 0).getTime() - new Date(b.orderDate || 0).getTime();
      else if (sortField === 'expectedDate') cmp = new Date(a.expectedDate || 0).getTime() - new Date(b.expectedDate || 0).getTime();
      return sortDesc ? -cmp : cmp;
    });

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
                <th className="cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('poNumber')}>PO #<SortIcon field="poNumber" /></th>
                <th className="cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('supplier')}>Supplier<SortIcon field="supplier" /></th>
                <th className="cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('status')}>Status<SortIcon field="status" /></th>
                <th className="cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('lines')}>Lines<SortIcon field="lines" /></th>
                <th className="text-right cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('value')}>Value<SortIcon field="value" /></th>
                <th className="cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('orderDate')}>Order Date<SortIcon field="orderDate" /></th>
                <th className="cursor-pointer hover:bg-steel-50 select-none" onClick={() => toggleSort('expectedDate')}>Expected<SortIcon field="expectedDate" /></th>
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
                    <td><span className={STATUS_BADGE[o.status] ?? 'badge-gray'}>{o.status?.replace(/_/g, ' ')}</span></td>
                    <td className="text-steel-500 text-xs">{o._count?.lines ?? 0} lines</td>
                    <td className="text-right font-mono text-sm font-semibold tabular-nums">{fmtCurrency(o.totalCost ?? 0)}</td>
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
                  <SearchSelect
                    items={(suppliersData?.data ?? []).map((s: any) => ({ id: s.id, label: s.name, sub: s.code }))}
                    value={form.supplierId}
                    onChange={id => setForm(f => ({ ...f, supplierId: id }))}
                    placeholder="Search supplier..."
                  />
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
                    <div key={i} className="grid grid-cols-[1fr_1fr_80px_100px_32px] gap-2 items-center">
                      <ProductSearchSelect
                        products={productsData?.data ?? []}
                        value={line.productId}
                        onChange={(id, desc) => {
                          setLines(ls => ls.map((l, j) => j === i ? { ...l, productId: id, description: desc } : l));
                        }}
                      />
                      <input
                        className="input text-sm"
                        placeholder="Description (opt)"
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
