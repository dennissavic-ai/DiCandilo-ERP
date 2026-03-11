import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { salesApi, inventoryApi } from '../../services/api';
import { Plus, Search, Filter, ShoppingCart, X, Trash2, FileText } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray',
  CONFIRMED: 'badge-blue',
  IN_PRODUCTION: 'badge-amber',
  READY_TO_SHIP: 'badge-teal',
  PARTIALLY_SHIPPED: 'badge-yellow',
  SHIPPED: 'badge-green',
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


type CreateMode = 'blank' | 'from_quote';

export function SalesOrdersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newOpen, setNewOpen] = useState(false);
  const [mode, setMode] = useState<CreateMode>('blank');
  const [selectedQuoteId, setSelectedQuoteId] = useState('');
  const [form, setForm] = useState({
    customerId: '', customerPoNumber: '', requiredDate: '', currency: 'AUD', notes: '',
  });
  const [lines, setLines] = useState([{ ...EMPTY_LINE }]);
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['sales-orders'],
    queryFn: () => salesApi.getOrders({ limit: 100 }).then((r) => r.data),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers'],
    queryFn: () => salesApi.listCustomers({ limit: 200 }).then((r) => r.data),
    enabled: newOpen,
  });

  const { data: quotesData } = useQuery({
    queryKey: ['quotes-dd'],
    queryFn: () => salesApi.listQuotes({ limit: 200, status: 'ACCEPTED' }).then((r) => r.data),
    enabled: newOpen && mode === 'from_quote',
  });

  const { data: productsData } = useQuery({
    queryKey: ['products'],
    queryFn: () => inventoryApi.listProducts({ limit: 500 }).then((r: any) => r.data),
    enabled: newOpen && mode === 'blank',
  });

  const convertMutation = useMutation({
    mutationFn: (quoteId: string) => salesApi.convertQuote(quoteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      setNewOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? 'Failed to convert quote.');
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => salesApi.createOrder(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales-orders'] });
      setNewOpen(false);
      resetForm();
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? 'Failed to create order.');
    },
  });

  function resetForm() {
    setMode('blank');
    setSelectedQuoteId('');
    setForm({ customerId: '', customerPoNumber: '', requiredDate: '', currency: 'AUD', notes: '' });
    setLines([{ ...EMPTY_LINE }]);
    setFormError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError('');
    if (mode === 'from_quote') {
      if (!selectedQuoteId) { setFormError('Please select a quote.'); return; }
      convertMutation.mutate(selectedQuoteId);
      return;
    }
    if (!form.customerId) { setFormError('Customer is required.'); return; }
    if (lines.some(l => !l.description || !l.qty || !l.unitPrice)) {
      setFormError('All line items require description, qty, and unit price.'); return;
    }
    createMutation.mutate({
      customerId: form.customerId,
      customerPoNumber: form.customerPoNumber || undefined,
      currencyCode: form.currency,
      requiredDate: form.requiredDate ? new Date(form.requiredDate).toISOString() : undefined,
      notes: form.notes || undefined,
      lines: lines.map(l => ({
        productId: l.productId || undefined,
        description: l.description,
        uom: 'EA',
        qty: parseFloat(l.qty),
        unitPrice: Math.round(parseFloat(l.unitPrice) * 100),
      })),
    });
  }

  const orders = (data?.data ?? []).filter((o: any) =>
    !search ||
    o.orderNumber?.toLowerCase().includes(search.toLowerCase()) ||
    o.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const totalOpen = orders.filter((o: any) => !['CLOSED', 'CANCELLED', 'INVOICED'].includes(o.status)).length;
  const totalValue = orders.reduce((s: number, o: any) => s + (o.totalAmount ?? 0), 0);
  const isPending = createMutation.isPending || convertMutation.isPending;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Sales Orders</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total orders · {totalOpen} open</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm"><Filter size={12} /> Filter</button>
          <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}><Plus size={13} /> New Order</button>
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
                    <td><span className={STATUS_BADGE[o.status] ?? 'badge-gray'}>{o.status?.replace(/_/g, ' ')}</span></td>
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

      {/* New Order Modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-base">New Sales Order</h2>
              <button onClick={() => { setNewOpen(false); resetForm(); }} className="text-steel-400 hover:text-foreground"><X size={16} /></button>
            </div>

            {/* Mode selector */}
            <div className="px-5 pt-4 flex gap-2">
              <button
                type="button"
                onClick={() => { setMode('blank'); setFormError(''); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors ${mode === 'blank' ? 'bg-primary-600 text-white border-primary-600' : 'border-steel-200 text-steel-600 hover:bg-steel-50'}`}
              >
                <Plus size={14} /> New Order
              </button>
              <button
                type="button"
                onClick={() => { setMode('from_quote'); setFormError(''); }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg text-sm font-medium border transition-colors ${mode === 'from_quote' ? 'bg-primary-600 text-white border-primary-600' : 'border-steel-200 text-steel-600 hover:bg-steel-50'}`}
              >
                <FileText size={14} /> From Quote
              </button>
            </div>

            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">
              {formError && <p className="text-sm text-red-600">{formError}</p>}

              {mode === 'from_quote' ? (
                <div>
                  <label className="form-label">Select Accepted Quote *</label>
                  <select className="input" value={selectedQuoteId} onChange={e => setSelectedQuoteId(e.target.value)}>
                    <option value="">Select quote…</option>
                    {(quotesData?.data ?? []).map((q: any) => (
                      <option key={q.id} value={q.id}>
                        {q.quoteNumber} — {q.customer?.name} — {fmtCurrency(q.totalAmount ?? 0)}
                      </option>
                    ))}
                  </select>
                  {(quotesData?.data ?? []).length === 0 && (
                    <p className="text-xs text-muted-foreground mt-1">No accepted quotes found. Accept a quote first, or create a new order directly.</p>
                  )}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Customer *</label>
                      <select className="input" value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}>
                        <option value="">Select customer…</option>
                        {(customersData?.data ?? []).map((c: any) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="form-label">Customer PO #</label>
                      <input className="input" value={form.customerPoNumber} onChange={e => setForm(f => ({ ...f, customerPoNumber: e.target.value }))} placeholder="Customer's PO number" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="form-label">Required Date</label>
                      <input className="input" type="date" value={form.requiredDate} onChange={e => setForm(f => ({ ...f, requiredDate: e.target.value }))} />
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
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setNewOpen(false); resetForm(); }}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
                  {isPending ? (mode === 'from_quote' ? 'Converting…' : 'Creating…') : (mode === 'from_quote' ? 'Convert Quote to Order' : 'Create Order')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
