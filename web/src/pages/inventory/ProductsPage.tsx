import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, AlertCircle } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { inventoryApi, Product } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { DataTable, Column } from '../../components/ui/DataTable';
import { Modal } from '../../components/ui/Modal';
import { useAuthStore } from '../../store/authStore';

interface ProductForm {
  code: string; description: string; uom: string;
  categoryId?: string; materialType?: string; grade?: string;
  alloy?: string; shape?: string; finish?: string;
  standardLength?: number; standardWidth?: number; standardThickness?: number;
  weightPerMeter?: number; costMethod: string;
  standardCost?: number; listPrice?: number;
  reorderPoint?: number;
  isBought: boolean; isSold: boolean; isStocked: boolean;
  trackByHeat: boolean; requiresMtr: boolean;
}

export function ProductsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const hasPermission = useAuthStore((s) => s.hasPermission);

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editProduct, setEditProduct] = useState<Product | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: categories } = useQuery({ queryKey: ['categories'], queryFn: () => inventoryApi.listCategories().then((r) => r.data) });
  const { data, isLoading } = useQuery({
    queryKey: ['products', page, search],
    queryFn: () => inventoryApi.listProducts({ page, limit: 25, search: search || undefined }).then((r) => r.data),
  });

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<ProductForm>({
    defaultValues: { uom: 'EA', costMethod: 'AVERAGE', isBought: true, isSold: true, isStocked: true, trackByHeat: false, requiresMtr: false },
  });

  const createMut = useMutation({
    mutationFn: (d: object) => inventoryApi.createProduct(d),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowModal(false); reset(); },
    onError: (e: { response?: { data?: { message?: string } } }) => setError(e.response?.data?.message ?? 'Failed to create product'),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: object }) => inventoryApi.updateProduct(id, data),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setShowModal(false); setEditProduct(null); },
    onError: (e: { response?: { data?: { message?: string } } }) => setError(e.response?.data?.message ?? 'Failed to update product'),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => inventoryApi.deleteProduct(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['products'] }); setDeleteConfirm(null); },
  });

  const openCreate = () => {
    setEditProduct(null);
    reset({ uom: 'EA', costMethod: 'AVERAGE', isBought: true, isSold: true, isStocked: true, trackByHeat: false, requiresMtr: false });
    setError(null);
    setShowModal(true);
  };

  const openEdit = (p: Product) => {
    setEditProduct(p);
    reset({ ...p, standardCost: p.standardCost / 100, listPrice: p.listPrice / 100 });
    setError(null);
    setShowModal(true);
  };

  const onSubmit = (data: ProductForm) => {
    setError(null);
    const payload = {
      ...data,
      standardCost: Math.round((data.standardCost ?? 0) * 100),
      listPrice: Math.round((data.listPrice ?? 0) * 100),
      standardLength: data.standardLength ? Number(data.standardLength) : undefined,
      standardWidth: data.standardWidth ? Number(data.standardWidth) : undefined,
      standardThickness: data.standardThickness ? Number(data.standardThickness) : undefined,
      weightPerMeter: data.weightPerMeter ? Number(data.weightPerMeter) : undefined,
      reorderPoint: data.reorderPoint ? Number(data.reorderPoint) : undefined,
    };
    if (editProduct) {
      updateMut.mutate({ id: editProduct.id, data: payload });
    } else {
      createMut.mutate(payload);
    }
  };

  const columns: Column<Product & Record<string, unknown>>[] = [
    {
      header: 'Code',
      cell: (row) => <span className="font-mono font-medium text-primary-700">{row.code}</span>,
    },
    {
      header: 'Description',
      cell: (row) => (
        <div>
          <div className="text-sm text-steel-900">{row.description}</div>
          {row.category && <div className="text-xs text-steel-400">{(row.category as { name: string }).name}</div>}
        </div>
      ),
    },
    { header: 'Material', cell: (row) => <span className="text-sm">{row.materialType ?? '—'}</span> },
    {
      header: 'Grade',
      cell: (row) => row.grade ? <span className="badge-blue">{row.grade as string}{row.alloy ? `-${row.alloy}` : ''}</span> : <span className="text-steel-400">—</span>,
    },
    { header: 'UOM', cell: (row) => <span className="badge-gray font-mono">{row.uom as string}</span> },
    {
      header: 'List Price',
      className: 'text-right',
      cell: (row) => <span className="font-mono">${((row.listPrice as number) / 100).toFixed(2)}</span>,
    },
    {
      header: 'Cost Method',
      cell: (row) => <span className="badge-gray text-xs">{row.costMethod as string}</span>,
    },
    {
      header: '',
      cell: (row) => (
        <div className="flex items-center gap-1">
          {hasPermission('inventory', 'edit') && (
            <button onClick={(e) => { e.stopPropagation(); openEdit(row as unknown as Product); }} className="btn-ghost btn-sm p-1.5">
              <Edit size={13} />
            </button>
          )}
          {hasPermission('inventory', 'delete') && (
            <button onClick={(e) => { e.stopPropagation(); setDeleteConfirm(row as unknown as Product); }} className="btn-ghost btn-sm p-1.5 text-red-500 hover:bg-red-50">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="max-w-7xl mx-auto">
      <PageHeader
        title="Products"
        subtitle="Product catalogue with metal-specific attributes"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Products' }]}
        actions={
          hasPermission('inventory', 'create') ? (
            <button className="btn-primary btn-sm" onClick={openCreate}>
              <Plus size={14} /> New Product
            </button>
          ) : undefined
        }
      />

      {/* Search */}
      <div className="card mb-5">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              type="search" placeholder="Search code, description, grade…"
              className="input pl-9 py-1.5 text-sm"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>
        </div>
      </div>

      <DataTable
        columns={columns as Column<Record<string, unknown>>[]}
        data={(data?.data ?? []) as unknown as Record<string, unknown>[]}
        isLoading={isLoading}
        pagination={data?.meta}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/inventory/products/${(row as unknown as Product).id}`)}
        keyField="id"
        emptyMessage="No products found. Create your first product."
      />

      {/* Create / Edit Modal */}
      <Modal
        open={showModal}
        onClose={() => { setShowModal(false); setEditProduct(null); }}
        title={editProduct ? `Edit: ${editProduct.code}` : 'New Product'}
        size="2xl"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => { setShowModal(false); setEditProduct(null); }}>Cancel</button>
            <button className="btn-primary btn-sm" onClick={handleSubmit(onSubmit)} disabled={isSubmitting}>
              {editProduct ? 'Save Changes' : 'Create Product'}
            </button>
          </>
        }
      >
        {error && (
          <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-sm text-red-700">
            <AlertCircle size={13} /> {error}
          </div>
        )}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Product Code *</label>
              <input className="input font-mono" {...register('code', { required: true })} />
            </div>
            <div className="form-group">
              <label className="label">Category</label>
              <select className="select" {...register('categoryId')}>
                <option value="">— None —</option>
                {(categories as { id: string; name: string }[] | undefined)?.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Description *</label>
            <input className="input" {...register('description', { required: true })} />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">UOM</label>
              <select className="select" {...register('uom')}>
                {['EA', 'M', 'FT', 'KG', 'LB', 'TON', 'SHT', 'PC'].map((u) => <option key={u}>{u}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Material Type</label>
              <select className="select" {...register('materialType')}>
                <option value="">—</option>
                {['steel', 'stainless', 'aluminum', 'copper', 'brass', 'titanium'].map((m) => (
                  <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Shape</label>
              <select className="select" {...register('shape')}>
                <option value="">—</option>
                {['plate', 'sheet', 'coil', 'bar', 'rod', 'tube', 'pipe', 'RHS', 'SHS', 'CHS', 'angle', 'channel', 'beam', 'flat', 'hex', 'round bar'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">Grade</label>
              <input className="input font-mono" placeholder="e.g. A36, 304, 6061" {...register('grade')} />
            </div>
            <div className="form-group">
              <label className="label">Alloy / Temper</label>
              <input className="input font-mono" placeholder="e.g. T6, L, H" {...register('alloy')} />
            </div>
            <div className="form-group">
              <label className="label">Finish</label>
              <input className="input" placeholder="e.g. hot rolled, pickled" {...register('finish')} />
            </div>
          </div>
          <p className="text-xs font-semibold text-steel-500 uppercase tracking-wider pt-1">Standard Dimensions (mm)</p>
          <div className="grid grid-cols-4 gap-3">
            <div className="form-group">
              <label className="label">Thickness</label>
              <input type="number" className="input" {...register('standardThickness', { valueAsNumber: true })} />
            </div>
            <div className="form-group">
              <label className="label">Width</label>
              <input type="number" className="input" {...register('standardWidth', { valueAsNumber: true })} />
            </div>
            <div className="form-group">
              <label className="label">Length</label>
              <input type="number" className="input" {...register('standardLength', { valueAsNumber: true })} />
            </div>
            <div className="form-group">
              <label className="label">Wt/m (g)</label>
              <input type="number" className="input" {...register('weightPerMeter', { valueAsNumber: true })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">Cost Method</label>
              <select className="select" {...register('costMethod')}>
                <option value="AVERAGE">Average Cost</option>
                <option value="FIFO">FIFO</option>
                <option value="STANDARD">Standard Cost</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label">Standard Cost ($/UOM)</label>
              <input type="number" step="0.01" className="input" {...register('standardCost', { valueAsNumber: true })} />
            </div>
            <div className="form-group">
              <label className="label">List Price ($/UOM)</label>
              <input type="number" step="0.01" className="input" {...register('listPrice', { valueAsNumber: true })} />
            </div>
          </div>
          <div className="flex flex-wrap gap-6 text-sm pt-1">
            {([
              { name: 'isBought', label: 'Purchased' },
              { name: 'isSold', label: 'Sold' },
              { name: 'isStocked', label: 'Stocked' },
              { name: 'trackByHeat', label: 'Track by Heat #' },
              { name: 'requiresMtr', label: 'Requires MTR' },
            ] as const).map((f) => (
              <label key={f.name} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded text-primary-600" {...register(f.name)} />
                {f.label}
              </label>
            ))}
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Product"
        size="sm"
        footer={
          <>
            <button className="btn-secondary btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
            <button className="btn-danger btn-sm" onClick={() => deleteConfirm && deleteMut.mutate(deleteConfirm.id)}>
              Delete
            </button>
          </>
        }
      >
        <p className="text-sm text-steel-600">
          Are you sure you want to delete <strong>{deleteConfirm?.code}</strong>? This action cannot be undone.
        </p>
      </Modal>
    </div>
  );
}
