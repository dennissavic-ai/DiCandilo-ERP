import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { CheckCircle, AlertCircle, Search } from 'lucide-react';
import { inventoryApi, InventoryItem } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';

interface AdjustForm {
  quantity: number;
  reason: string;
  notes: string;
}

export function StockAdjustPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: items } = useQuery({
    queryKey: ['inventory-items-search', search],
    queryFn: () => inventoryApi.listItems({ search, limit: 20 }).then((r) => r.data),
    enabled: search.length > 1,
  });

  const { register, handleSubmit, reset, formState: { isSubmitting } } = useForm<AdjustForm>({
    defaultValues: { quantity: 0, reason: '', notes: '' },
  });

  const adjustMut = useMutation({
    mutationFn: (data: object) => inventoryApi.adjustStock(data),
    onSuccess: () => {
      setSuccess('Stock adjusted successfully.');
      setSelectedItem(null);
      setSearch('');
      reset();
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      setTimeout(() => setSuccess(null), 4000);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Adjustment failed.');
    },
  });

  const onSubmit = (data: AdjustForm) => {
    if (!selectedItem) return;
    setError(null);
    adjustMut.mutate({
      inventoryItemId: selectedItem.id,
      quantity: Number(data.quantity),
      reason: data.reason,
      notes: data.notes,
      expectedVersion: selectedItem.version,
    });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHeader
        title="Stock Adjustment"
        subtitle="Correct stock quantities with a reason code"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Adjust Stock' }]}
      />

      <div className="space-y-5">
        {/* Step 1: Select item */}
        <div className="card">
          <div className="card-header">
            <h3 className="font-semibold">1. Select Inventory Item</h3>
          </div>
          <div className="card-body space-y-3">
            <div className="relative">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
              <input
                type="search"
                placeholder="Search by product code, description, or heat number…"
                className="input pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            {items && items.data.length > 0 && (
              <div className="border border-steel-200 rounded-lg divide-y divide-steel-100 max-h-64 overflow-y-auto">
                {items.data.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => { setSelectedItem(item); setSearch(''); }}
                    className={`w-full text-left px-4 py-3 hover:bg-steel-50 transition-colors text-sm ${selectedItem?.id === item.id ? 'bg-primary-50' : ''}`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono font-medium text-primary-700">{item.product?.code}</span>
                        <span className="text-steel-500 ml-2 text-xs">{item.product?.description}</span>
                      </div>
                      <div className="text-right ml-4 flex-shrink-0">
                        <div className="font-semibold">{Number(item.qtyOnHand).toLocaleString()} {item.product?.uom}</div>
                        <div className="text-xs text-steel-400">@ {item.location?.code}</div>
                      </div>
                    </div>
                    {item.heatNumber && <div className="text-xs text-steel-400 mt-0.5">Heat: {item.heatNumber}</div>}
                  </button>
                ))}
              </div>
            )}

            {selectedItem && (
              <div className="bg-primary-50 border border-primary-200 rounded-xl p-4">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="font-mono font-bold text-primary-700">{selectedItem.product?.code}</div>
                    <div className="text-sm text-steel-600">{selectedItem.product?.description}</div>
                    {selectedItem.heatNumber && <div className="text-xs text-steel-500 mt-0.5">Heat #: {selectedItem.heatNumber}</div>}
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-steel-900">
                      {Number(selectedItem.qtyOnHand).toLocaleString()} <span className="text-sm font-normal text-steel-500">{selectedItem.product?.uom}</span>
                    </div>
                    <div className="text-xs text-steel-500">Current on hand</div>
                  </div>
                </div>
                <button onClick={() => setSelectedItem(null)} className="text-xs text-primary-600 mt-2 hover:underline">Change item</button>
              </div>
            )}
          </div>
        </div>

        {/* Step 2: Adjustment details */}
        {selectedItem && (
          <div className="card">
            <div className="card-header">
              <h3 className="font-semibold">2. Adjustment Details</h3>
            </div>
            <div className="card-body">
              {success && (
                <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg mb-4 text-sm text-green-700">
                  <CheckCircle size={14} /> {success}
                </div>
              )}
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-sm text-red-700">
                  <AlertCircle size={14} /> {error}
                </div>
              )}

              <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
                <div className="form-group">
                  <label className="label">Adjustment Quantity *</label>
                  <input
                    type="number"
                    step="0.0001"
                    className="input font-mono text-lg"
                    placeholder="Enter +/- quantity (e.g. -5 to remove, +10 to add)"
                    {...register('quantity', { required: true, validate: (v) => Number(v) !== 0 || 'Quantity cannot be zero' })}
                  />
                  <p className="text-xs text-steel-500 mt-1">
                    Positive = add stock, Negative = remove stock. Current: {Number(selectedItem.qtyOnHand).toLocaleString()}
                  </p>
                </div>
                <div className="form-group">
                  <label className="label">Reason *</label>
                  <select className="select" {...register('reason', { required: true })}>
                    <option value="">— Select reason —</option>
                    {['Physical count correction', 'Damage / write-off', 'Processing yield adjustment',
                      'Found stock', 'Returning from quarantine', 'Scrap / offcut',
                      'System correction', 'Opening balance', 'Other'].map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label className="label">Notes</label>
                  <textarea rows={2} className="input resize-none" placeholder="Optional additional details…" {...register('notes')} />
                </div>
                <div className="flex justify-end">
                  <button type="submit" disabled={isSubmitting} className="btn-primary">
                    {isSubmitting ? 'Adjusting…' : 'Submit Adjustment'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
