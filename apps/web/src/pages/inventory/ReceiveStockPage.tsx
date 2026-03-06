import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { Plus, Trash2, CheckCircle, AlertCircle, Package } from 'lucide-react';
import { inventoryApi } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';

interface ReceiveLine {
  productId: string;
  qtyReceived: number;
  unitCost: number; // in dollars (converted to cents on submit)
  heatNumber: string;
  certNumber: string;
  thickness: number | '';
  width: number | '';
  length: number | '';
}

interface ReceiveForm {
  locationId: string;
  purchaseOrderId: string;
  notes: string;
  lines: ReceiveLine[];
}

export function ReceiveStockPage() {
  const queryClient = useQueryClient();
  const [success, setSuccess] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: locations } = useQuery({ queryKey: ['locations'], queryFn: () => inventoryApi.listLocations().then((r) => r.data) });
  const { data: products } = useQuery({ queryKey: ['products-all'], queryFn: () => inventoryApi.listProducts({ limit: 200 }).then((r) => r.data) });

  const { register, handleSubmit, control, reset, formState: { isSubmitting } } = useForm<ReceiveForm>({
    defaultValues: {
      locationId: '', purchaseOrderId: '', notes: '',
      lines: [{ productId: '', qtyReceived: 1, unitCost: 0, heatNumber: '', certNumber: '', thickness: '', width: '', length: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'lines' });

  const receiveMut = useMutation({
    mutationFn: (data: object) => inventoryApi.receiveStock(data),
    onSuccess: () => {
      setSuccess('Stock received and added to inventory.');
      reset();
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      setTimeout(() => setSuccess(null), 5000);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Failed to receive stock.');
    },
  });

  const onSubmit = (data: ReceiveForm) => {
    setError(null);
    receiveMut.mutate({
      locationId: data.locationId,
      purchaseOrderId: data.purchaseOrderId || undefined,
      notes: data.notes || undefined,
      lines: data.lines.map((l) => ({
        productId: l.productId,
        qtyReceived: Number(l.qtyReceived),
        unitCost: Math.round(Number(l.unitCost) * 100), // convert to cents
        heatNumber: l.heatNumber || undefined,
        certNumber: l.certNumber || undefined,
        thickness: l.thickness ? Number(l.thickness) : undefined,
        width: l.width ? Number(l.width) : undefined,
        length: l.length ? Number(l.length) : undefined,
      })),
    });
  };

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Receive Stock"
        subtitle="Receive material into inventory from a purchase order or direct receipt"
        breadcrumbs={[{ label: 'Inventory', href: '/inventory' }, { label: 'Receive Stock' }]}
      />

      {success && (
        <div className="flex items-center gap-2 p-4 bg-green-50 border border-green-200 rounded-xl mb-5 text-sm text-green-700">
          <CheckCircle size={15} /> {success}
        </div>
      )}
      {error && (
        <div className="flex items-center gap-2 p-4 bg-red-50 border border-red-200 rounded-xl mb-5 text-sm text-red-700">
          <AlertCircle size={15} /> {error}
        </div>
      )}

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* Header */}
        <div className="card mb-5">
          <div className="card-header">
            <h3 className="font-semibold">Receipt Details</h3>
          </div>
          <div className="card-body">
            <div className="grid grid-cols-3 gap-4">
              <div className="form-group">
                <label className="label">Receiving Location *</label>
                <select className="select" {...register('locationId', { required: true })}>
                  <option value="">— Select location —</option>
                  {(locations as { id: string; code: string; name: string; type?: string }[] | undefined)?.filter((l) => ['RECEIVING', 'STORAGE'].includes(l.type ?? '')).map((l) => (
                    <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                  ))}
                  {(locations as { id: string; code: string; name: string; type?: string }[] | undefined)?.map((l) => (
                    <option key={l.id} value={l.id}>{l.code} — {l.name}</option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="label">Purchase Order # (optional)</label>
                <input className="input font-mono" placeholder="PO-000001" {...register('purchaseOrderId')} />
              </div>
              <div className="form-group">
                <label className="label">Notes</label>
                <input className="input" placeholder="Delivery note, truck reference…" {...register('notes')} />
              </div>
            </div>
          </div>
        </div>

        {/* Lines */}
        <div className="card mb-5">
          <div className="card-header flex items-center justify-between">
            <h3 className="font-semibold">Material Lines</h3>
            <button
              type="button"
              onClick={() => append({ productId: '', qtyReceived: 1, unitCost: 0, heatNumber: '', certNumber: '', thickness: '', width: '', length: '' })}
              className="btn-secondary btn-sm"
            >
              <Plus size={13} /> Add Line
            </button>
          </div>
          <div className="card-body p-0">
            {fields.map((field, index) => (
              <div key={field.id} className="border-b border-steel-100 last:border-0 p-4">
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0 w-6 h-6 bg-steel-100 rounded-full flex items-center justify-center text-xs font-semibold text-steel-600 mt-1">
                    {index + 1}
                  </div>
                  <div className="flex-1 space-y-3">
                    <div className="grid grid-cols-3 gap-3">
                      <div className="form-group col-span-2">
                        <label className="label text-xs">Product *</label>
                        <select className="select text-sm" {...register(`lines.${index}.productId`, { required: true })}>
                          <option value="">— Select product —</option>
                          {(products?.data ?? []).map((p) => (
                            <option key={p.id} value={p.id}>{p.code} — {p.description}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="form-group">
                          <label className="label text-xs">Qty *</label>
                          <input type="number" step="0.0001" min="0.0001" className="input text-sm font-mono" {...register(`lines.${index}.qtyReceived`, { required: true, min: 0.0001 })} />
                        </div>
                        <div className="form-group">
                          <label className="label text-xs">Unit Cost ($) *</label>
                          <input type="number" step="0.01" min="0" className="input text-sm font-mono" {...register(`lines.${index}.unitCost`, { required: true, min: 0 })} />
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-5 gap-3">
                      <div className="form-group">
                        <label className="label text-xs">Heat #</label>
                        <input className="input text-sm font-mono" placeholder="Optional" {...register(`lines.${index}.heatNumber`)} />
                      </div>
                      <div className="form-group">
                        <label className="label text-xs">Cert #</label>
                        <input className="input text-sm font-mono" placeholder="Optional" {...register(`lines.${index}.certNumber`)} />
                      </div>
                      <div className="form-group">
                        <label className="label text-xs">Thickness (mm)</label>
                        <input type="number" min="0" className="input text-sm font-mono" {...register(`lines.${index}.thickness`)} />
                      </div>
                      <div className="form-group">
                        <label className="label text-xs">Width (mm)</label>
                        <input type="number" min="0" className="input text-sm font-mono" {...register(`lines.${index}.width`)} />
                      </div>
                      <div className="form-group">
                        <label className="label text-xs">Length (mm)</label>
                        <input type="number" min="0" className="input text-sm font-mono" {...register(`lines.${index}.length`)} />
                      </div>
                    </div>
                  </div>
                  {fields.length > 1 && (
                    <button type="button" onClick={() => remove(index)} className="btn-ghost btn-sm p-1.5 text-red-400 hover:bg-red-50 flex-shrink-0 mt-1">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Submit */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-steel-500 flex items-center gap-1.5">
            <Package size={13} />
            {fields.length} line{fields.length !== 1 ? 's' : ''} to receive
          </p>
          <button type="submit" disabled={isSubmitting} className="btn-primary">
            {isSubmitting ? 'Receiving…' : 'Post Receipt to Inventory'}
          </button>
        </div>
      </form>
    </div>
  );
}
