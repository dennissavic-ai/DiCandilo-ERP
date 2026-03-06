import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, inventoryApi, salesApi } from '../../services/api';
import { Plus, Search, DollarSign, Edit2, Percent, Tag } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

const BLANK_BOOK = { name: '', description: '', currencyCode: 'AUD', isDefault: false, customerGroupId: '' };
const BLANK_ITEM = { productId: '', unitPrice: '', discountPct: 0, minQty: 1 };

export function PriceBooksPage() {
  const qc = useQueryClient();
  const [selectedBook, setSelectedBook] = useState<any>(null);
  const [bookModal, setBookModal] = useState(false);
  const [bookForm, setBookForm] = useState({ ...BLANK_BOOK });
  const [itemModal, setItemModal] = useState(false);
  const [itemForm, setItemForm] = useState({ ...BLANK_ITEM });
  const [search, setSearch] = useState('');
  const [editingBook, setEditingBook] = useState<any>(null);

  const { data: booksData, isLoading: booksLoading } = useQuery({
    queryKey: ['price-books'],
    queryFn: () => api.get('/sales/price-books', { params: { limit: 100 } }).then((r) => r.data),
  });

  const { data: itemsData, isLoading: itemsLoading } = useQuery({
    queryKey: ['price-book-items', selectedBook?.id],
    queryFn: () => selectedBook ? api.get(`/sales/price-books/${selectedBook.id}/items`, { params: { limit: 500 } }).then((r) => r.data) : null,
    enabled: !!selectedBook,
  });

  const { data: productsData } = useQuery({
    queryKey: ['products-dd'],
    queryFn: () => inventoryApi.listProducts({ limit: 500, isSold: true }).then((r) => r.data),
  });

  const saveBookMutation = useMutation({
    mutationFn: () => editingBook
      ? api.put(`/sales/price-books/${editingBook.id}`, bookForm)
      : api.post('/sales/price-books', bookForm),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-books'] }); setBookModal(false); },
  });

  const saveItemMutation = useMutation({
    mutationFn: () => api.post(`/sales/price-books/${selectedBook!.id}/items`, { ...itemForm, unitPrice: Math.round(Number(itemForm.unitPrice) * 100) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['price-book-items', selectedBook?.id] }); setItemModal(false); setItemForm({ ...BLANK_ITEM }); },
  });

  const deleteItemMutation = useMutation({
    mutationFn: (itemId: string) => api.delete(`/sales/price-books/${selectedBook!.id}/items/${itemId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['price-book-items', selectedBook?.id] }),
  });

  const books: any[] = (booksData as any)?.data ?? booksData ?? [];
  const priceItems: any[] = ((itemsData as any)?.data ?? itemsData ?? []).filter((i: any) =>
    !search || i.product?.code?.toLowerCase().includes(search.toLowerCase()) || i.product?.description?.toLowerCase().includes(search.toLowerCase()),
  );

  function openBookEdit(book?: any) {
    setEditingBook(book ?? null);
    setBookForm(book ? { name: book.name, description: book.description ?? '', currencyCode: book.currencyCode, isDefault: book.isDefault, customerGroupId: book.customerGroupId ?? '' } : { ...BLANK_BOOK });
    setBookModal(true);
  }

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Price Books</h1>
          <p className="page-subtitle">Manage customer-specific pricing and discounts</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => openBookEdit()}><Plus size={13} /> New Price Book</button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Price book list */}
        <div>
          <div className="card overflow-hidden">
            <div className="card-header"><span className="text-sm font-semibold">Price Books</span></div>
            <div className="divide-y divide-border">
              {booksLoading
                ? Array.from({ length: 4 }).map((_, i) => <div key={i} className="p-3"><div className="skeleton h-12 w-full rounded" /></div>)
                : books.length === 0
                  ? (
                    <div className="p-6 text-center">
                      <Tag size={24} className="mx-auto mb-2 text-muted-foreground/30" />
                      <p className="text-sm text-muted-foreground">No price books yet</p>
                      <button className="btn-secondary btn-sm mt-2" onClick={() => openBookEdit()}><Plus size={11} /> Create one</button>
                    </div>
                  )
                  : books.map((b) => (
                      <button key={b.id}
                        className={`w-full text-left p-3 hover:bg-steel-50 transition-colors ${selectedBook?.id === b.id ? 'bg-primary-50 border-r-2 border-primary-600' : ''}`}
                        onClick={() => setSelectedBook(b)}>
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="font-medium text-sm">{b.name}</div>
                            {b.isDefault && <span className="badge-blue text-[10px]">Default</span>}
                            <div className="text-xs text-muted-foreground mt-0.5">{b.currencyCode} · {b.itemCount ?? 0} items</div>
                          </div>
                          <button className="btn-ghost btn-sm p-1" onClick={(e) => { e.stopPropagation(); openBookEdit(b); }}><Edit2 size={11} /></button>
                        </div>
                      </button>
                    ))}
            </div>
          </div>
        </div>

        {/* Price items */}
        <div className="col-span-2">
          {!selectedBook ? (
            <div className="card h-full flex items-center justify-center min-h-[400px]">
              <div className="text-center text-muted-foreground">
                <DollarSign size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a price book to view and edit items</p>
              </div>
            </div>
          ) : (
            <div className="card">
              <div className="card-header">
                <div>
                  <span className="text-sm font-semibold">{selectedBook.name}</span>
                  {selectedBook.description && <p className="text-xs text-muted-foreground mt-0.5">{selectedBook.description}</p>}
                </div>
                <div className="flex gap-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-steel-400" />
                    <input className="input pl-7 h-7 text-xs w-40" placeholder="Filter…" value={search} onChange={(e) => setSearch(e.target.value)} />
                  </div>
                  <button className="btn-primary btn-sm" onClick={() => setItemModal(true)}><Plus size={12} /> Add Item</button>
                </div>
              </div>
              <div className="table-container rounded-b-xl">
                <table className="table">
                  <thead><tr>
                    <th>Product Code</th><th>Description</th><th>List Price</th>
                    <th className="text-right">Book Price</th><th className="text-right">Disc %</th>
                    <th className="text-right">Min Qty</th><th></th>
                  </tr></thead>
                  <tbody>
                    {itemsLoading
                      ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 7 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-16" /></td>)}</tr>)
                      : priceItems.length === 0
                        ? <tr><td colSpan={7} className="text-center text-sm text-muted-foreground py-8">No items in this price book</td></tr>
                        : priceItems.map((item: any) => (
                            <tr key={item.id}>
                              <td className="font-mono text-xs font-bold text-primary-700">{item.product?.code}</td>
                              <td className="text-sm text-muted-foreground max-w-[180px] truncate">{item.product?.description}</td>
                              <td className="font-mono text-xs text-muted-foreground">${(item.product?.listPrice / 100).toFixed(2)}</td>
                              <td className="text-right font-mono text-sm font-bold tabular-nums">${(item.unitPrice / 100).toFixed(2)}</td>
                              <td className="text-right text-xs">
                                {item.discountPct > 0 && (
                                  <span className="badge-red">{item.discountPct}%</span>
                                )}
                              </td>
                              <td className="text-right text-xs tabular-nums">{item.minQty ?? 1}</td>
                              <td>
                                <button className="btn-ghost btn-sm p-1 text-red-500" onClick={() => deleteItemMutation.mutate(item.id)}>×</button>
                              </td>
                            </tr>
                          ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Price Book Modal */}
      <Modal open={bookModal} onClose={() => setBookModal(false)} title={editingBook ? 'Edit Price Book' : 'New Price Book'}
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setBookModal(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!bookForm.name || saveBookMutation.isPending} onClick={() => saveBookMutation.mutate()}>
            {saveBookMutation.isPending ? 'Saving…' : editingBook ? 'Save Changes' : 'Create'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Name *</label>
            <input className="input" value={bookForm.name} onChange={(e) => setBookForm({ ...bookForm, name: e.target.value })} placeholder="e.g. Trade, Retail, Export…" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Currency</label>
              <select className="select" value={bookForm.currencyCode} onChange={(e) => setBookForm({ ...bookForm, currencyCode: e.target.value })}>
                {['AUD','USD','NZD','EUR'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Default?</label>
              <select className="select" value={bookForm.isDefault ? '1' : '0'} onChange={(e) => setBookForm({ ...bookForm, isDefault: e.target.value === '1' })}>
                <option value="0">No</option><option value="1">Yes — make default</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Description</label>
            <textarea className="input min-h-[60px] resize-none" value={bookForm.description}
              onChange={(e) => setBookForm({ ...bookForm, description: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* Add Item Modal */}
      <Modal open={itemModal} onClose={() => setItemModal(false)} title="Add Price Book Item"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setItemModal(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!itemForm.productId || !itemForm.unitPrice || saveItemMutation.isPending} onClick={() => saveItemMutation.mutate()}>
            {saveItemMutation.isPending ? 'Adding…' : 'Add Item'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Product *</label>
            <select className="select" value={itemForm.productId} onChange={(e) => {
              const p = (productsData?.data ?? []).find((pr: any) => pr.id === e.target.value);
              setItemForm((f) => ({ ...f, productId: e.target.value, unitPrice: p ? (p.listPrice / 100).toFixed(2) : '' }));
            }}>
              <option value="">Select product…</option>
              {(productsData?.data ?? []).map((p: any) => <option key={p.id} value={p.id}>{p.code} — {p.description}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">Unit Price (ex GST) *</label>
              <input type="number" className="input" step="0.01" value={itemForm.unitPrice}
                onChange={(e) => setItemForm({ ...itemForm, unitPrice: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Discount %</label>
              <input type="number" className="input" min={0} max={100} value={itemForm.discountPct}
                onChange={(e) => setItemForm({ ...itemForm, discountPct: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label className="label">Min Qty</label>
              <input type="number" className="input" min={1} value={itemForm.minQty}
                onChange={(e) => setItemForm({ ...itemForm, minQty: Number(e.target.value) })} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
