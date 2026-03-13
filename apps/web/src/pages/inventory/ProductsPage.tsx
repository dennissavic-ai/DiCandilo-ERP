import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi } from '../../services/api';
import { Plus, Search, SlidersHorizontal, Package, Tag, Layers, Upload, X } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImportModal } from '../../components/ui/ImportModal';

const SHAPE_BADGE: Record<string, string> = {
  plate:      'badge-blue',
  sheet:      'badge-blue',
  'flat':     'badge-teal',
  RHS:        'badge-violet',
  tube:       'badge-violet',
  pipe:       'badge-violet',
  'round bar': 'badge-orange',
  structural: 'badge-amber',
};

const MAT_BADGE: Record<string, string> = {
  steel:    'badge-gray',
  stainless:'badge-teal',
  aluminum: 'badge-blue',
  aluminium:'badge-blue',
};

function fmtCost(cents: number) {
  return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}`;
}

const PRODUCT_COLUMNS = [
  { key: 'code',         label: 'SKU Code',       required: true,  example: 'MS-PLATE-6-2400' },
  { key: 'description',  label: 'Description',    required: true,  example: '6mm Mild Steel Plate 2400x1200' },
  { key: 'uom',          label: 'Unit of Measure', required: true,  example: 'M2' },
  { key: 'materialType', label: 'Material Type',  required: false, example: 'steel' },
  { key: 'grade',        label: 'Grade',          required: false, example: '350' },
  { key: 'shape',        label: 'Shape',          required: false, example: 'plate' },
  { key: 'standardCost', label: 'Std Cost ($)',   required: false, example: '85.00' },
  { key: 'listPrice',    label: 'List Price ($)', required: false, example: '120.00' },
  { key: 'isBought',     label: 'Is Bought',      required: false, example: 'true' },
  { key: 'isSold',       label: 'Is Sold',        required: false, example: 'true' },
  { key: 'isStocked',    label: 'Is Stocked',     required: false, example: 'true' },
  { key: 'reorderPoint', label: 'Reorder Point',  required: false, example: '5' },
  { key: 'trackByHeat',  label: 'Track by Heat',  required: false, example: 'false' },
  { key: 'requiresMtr',  label: 'Requires MTR',   required: false, example: 'false' },
];

const EMPTY_FORM = {
  code: '', description: '', uom: '', materialType: '', grade: '', shape: '',
  standardCost: '', listPrice: '',
  isBought: true, isSold: true, isStocked: true, trackByHeat: false, requiresMtr: false,
};

export function ProductsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: () => inventoryApi.getProducts({ limit: 100 }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: (payload: object) => inventoryApi.createProduct(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setNewOpen(false);
      setForm({ ...EMPTY_FORM });
      setFormError('');
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? 'Failed to create product.');
    },
  });

  const products = (data?.data ?? []).filter(
    (p: any) =>
      !search ||
      p.code.toLowerCase().includes(search.toLowerCase()) ||
      p.description.toLowerCase().includes(search.toLowerCase()),
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.code || !form.description || !form.uom) {
      setFormError('Code, Description, and UOM are required.');
      return;
    }
    setFormError('');
    createMutation.mutate({
      ...form,
      standardCost: form.standardCost ? Math.round(parseFloat(form.standardCost) * 100) : 0,
      listPrice:    form.listPrice    ? Math.round(parseFloat(form.listPrice)    * 100) : 0,
    });
  }

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Products</h1>
          <p className="page-subtitle">Master product catalogue — {data?.meta?.total ?? '—'} items</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary btn-sm" onClick={() => setImportOpen(true)}>
            <Upload size={13} /> Import CSV
          </button>
          <button className="btn-secondary btn-sm">
            <SlidersHorizontal size={13} /> Filters
          </button>
          <button className="btn-primary btn-sm" onClick={() => setNewOpen(true)}>
            <Plus size={14} /> New Product
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search by code or description…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th>
                <th>Description</th>
                <th>Material</th>
                <th>Shape</th>
                <th>Grade</th>
                <th>UOM</th>
                <th className="text-right">Std Cost</th>
                <th className="text-right">List Price</th>
                <th>Flags</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 9 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : products.map((p: any) => (
                    <tr
                      key={p.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/inventory/products/${p.id}`)}
                    >
                      <td className="font-mono text-xs font-semibold text-primary-700 whitespace-nowrap">
                        {p.code}
                      </td>
                      <td className="max-w-[280px] truncate font-medium text-foreground" title={p.description}>
                        {p.description}
                      </td>
                      <td>
                        <span className={MAT_BADGE[p.materialType] ?? 'badge-gray'}>
                          {p.materialType}
                        </span>
                      </td>
                      <td>
                        <span className={SHAPE_BADGE[p.shape] ?? 'badge-gray'}>
                          {p.shape}
                        </span>
                      </td>
                      <td className="text-steel-600 text-xs">{p.grade ?? '—'}</td>
                      <td className="text-steel-500 text-xs font-medium">{p.uom}</td>
                      <td className="text-right font-mono text-xs">{fmtCost(p.standardCost)}</td>
                      <td className="text-right font-mono text-xs font-semibold text-foreground">{fmtCost(p.listPrice)}</td>
                      <td>
                        <div className="flex gap-1 flex-wrap">
                          {p.trackByHeat && <span className="badge badge-amber" title="Heat tracked"><Tag size={9} />Heat</span>}
                          {p.requiresMtr  && <span className="badge badge-blue"  title="Requires MTR"><Layers size={9} />MTR</span>}
                          {p.isSold       && <span className="badge badge-green text-[10px]">Sold</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!isLoading && products.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Package size={22} /></div>
            <p className="text-sm font-medium text-foreground">No products found</p>
            <p className="text-xs text-muted-foreground mt-1">Try adjusting your search or add a new product.</p>
          </div>
        )}
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title="Import Products (SKUs)"
        description="Upload a CSV to bulk-create or update products. Existing SKU codes will be updated; new codes will be created."
        endpoint="/inventory/products/import"
        columns={PRODUCT_COLUMNS}
        queryKey="products"
      />

      {/* New Product Modal */}
      {newOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-base">New Product</h2>
              <button onClick={() => { setNewOpen(false); setFormError(''); }} className="text-steel-400 hover:text-foreground"><X size={16} /></button>
            </div>
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3">
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">SKU Code *</label>
                  <input className="input" value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="MS-PLATE-6-2400" />
                </div>
                <div>
                  <label className="form-label">UOM *</label>
                  <input className="input" value={form.uom} onChange={e => setForm(f => ({ ...f, uom: e.target.value }))} placeholder="EA / M2 / KG" />
                </div>
              </div>
              <div>
                <label className="form-label">Description *</label>
                <input className="input" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="6mm Mild Steel Plate 2400x1200" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="form-label">Material Type</label>
                  <input className="input" value={form.materialType} onChange={e => setForm(f => ({ ...f, materialType: e.target.value }))} placeholder="steel" />
                </div>
                <div>
                  <label className="form-label">Grade</label>
                  <input className="input" value={form.grade} onChange={e => setForm(f => ({ ...f, grade: e.target.value }))} placeholder="350" />
                </div>
                <div>
                  <label className="form-label">Shape</label>
                  <input className="input" value={form.shape} onChange={e => setForm(f => ({ ...f, shape: e.target.value }))} placeholder="plate" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Std Cost ($)</label>
                  <input className="input" type="number" step="0.01" value={form.standardCost} onChange={e => setForm(f => ({ ...f, standardCost: e.target.value }))} placeholder="85.00" />
                </div>
                <div>
                  <label className="form-label">List Price ($)</label>
                  <input className="input" type="number" step="0.01" value={form.listPrice} onChange={e => setForm(f => ({ ...f, listPrice: e.target.value }))} placeholder="120.00" />
                </div>
              </div>
              <div className="flex flex-wrap gap-4 pt-1">
                {(['isBought', 'isSold', 'isStocked', 'trackByHeat', 'requiresMtr'] as const).map(key => (
                  <label key={key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="checkbox" checked={form[key] as boolean} onChange={e => setForm(f => ({ ...f, [key]: e.target.checked }))} />
                    {key === 'isBought' ? 'Is Bought' : key === 'isSold' ? 'Is Sold' : key === 'isStocked' ? 'Is Stocked' : key === 'trackByHeat' ? 'Track by Heat' : 'Requires MTR'}
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setNewOpen(false); setFormError(''); }}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
