import { useRef, useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { Plus, Trash2, CheckCircle, AlertCircle, Package, Upload, FileText } from 'lucide-react';
import { inventoryApi, purchasingApi } from '../../services/api';
import { PageHeader } from '../../components/ui/PageHeader';

function POSearchSelect({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: poData } = useQuery({
    queryKey: ['purchase-orders-all'],
    queryFn: () => purchasingApi.listOrders({ limit: 200 }).then((r) => r.data),
  });

  const items = (poData?.data ?? []).map((po: any) => ({
    id: po.id,
    label: po.poNumber,
    sub: [po.supplier?.name, po.status].filter(Boolean).join(' · '),
  }));

  useEffect(() => {
    if (value) {
      const item = items.find((i) => i.id === value);
      if (item) setSearch(item.label);
    } else {
      setSearch('');
    }
  }, [value, items.length]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filtered = search
    ? items.filter((i) => i.label.toLowerCase().includes(search.toLowerCase()) || i.sub?.toLowerCase().includes(search.toLowerCase()))
    : items;

  return (
    <div className="relative" ref={containerRef}>
      <input
        className="input font-mono w-full"
        placeholder="Search PO number…"
        value={search}
        onFocus={() => { setOpen(true); setSearch(''); }}
        onChange={(e) => {
          setSearch(e.target.value);
          if (!e.target.value) onChange('');
          setOpen(true);
        }}
      />
      {open && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
          {filtered.length > 0 ? filtered.map((i) => (
            <div
              key={i.id}
              className="px-3 py-2 text-sm hover:bg-steel-50 cursor-pointer border-b border-border last:border-b-0"
              onClick={() => { onChange(i.id); setSearch(i.label); setOpen(false); }}
            >
              <div className="font-semibold font-mono text-primary-700">{i.label}</div>
              {i.sub && <div className="text-xs text-muted-foreground">{i.sub}</div>}
            </div>
          )) : (
            <div className="px-3 py-4 text-sm text-center text-muted-foreground">No purchase orders found</div>
          )}
        </div>
      )}
    </div>
  );
}

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
  const [showUpload, setShowUpload] = useState(false);
  const [lastPoId, setLastPoId] = useState('');
  const [uploadedFiles, setUploadedFiles] = useState<{ name: string; url: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setShowUpload(true);
      reset();
      queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
      setTimeout(() => setSuccess(null), 8000);
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e.response?.data?.message ?? 'Failed to receive stock.');
    },
  });

  const uploadMut = useMutation({
    mutationFn: ({ file, poId }: { file: File; poId: string }) =>
      inventoryApi.uploadDocument(file, 'PO_RECEIPT', poId),
    onSuccess: (res: any) => {
      setUploadedFiles(f => [...f, { name: res.data.fileName, url: res.data.fileUrl }]);
    },
    onError: () => {
      setError('Failed to upload document.');
    },
  });

  const onSubmit = (data: ReceiveForm) => {
    setError(null);
    setLastPoId(data.purchaseOrderId || '');
    receiveMut.mutate({
      locationId: data.locationId,
      purchaseOrderId: data.purchaseOrderId || undefined,
      notes: data.notes || undefined,
      lines: data.lines.map((l) => ({
        productId: l.productId,
        qtyReceived: Number(l.qtyReceived),
        unitCost: Math.round(Number(l.unitCost) * 100),
        heatNumber: l.heatNumber || undefined,
        certNumber: l.certNumber || undefined,
        thickness: l.thickness ? Number(l.thickness) : undefined,
        width: l.width ? Number(l.width) : undefined,
        length: l.length ? Number(l.length) : undefined,
      })),
    });
  };

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadMut.mutate({ file, poId: lastPoId });
    e.target.value = '';
  }

  return (
    <div className="max-w-5xl mx-auto">
      <PageHeader
        title="Receive Stock"
        subtitle="Receive material into inventory from a purchase order or direct receipt"
        breadcrumbs={[{ label: 'Operations', href: '/processing/dashboard' }, { label: 'Receive Stock' }]}
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
                <Controller
                  control={control}
                  name="purchaseOrderId"
                  render={({ field }) => (
                    <POSearchSelect value={field.value} onChange={field.onChange} />
                  )}
                />
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

      {/* Document Upload — shown after successful receipt */}
      {showUpload && (
        <div className="card mt-6">
          <div className="card-header">
            <h3 className="font-semibold">Attach Documents</h3>
            <p className="text-xs text-muted-foreground mt-0.5">Upload delivery dockets, test certificates, or mill certs (PDF, JPG, PNG)</p>
          </div>
          <div className="card-body space-y-3">
            <div className="flex items-center gap-3">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleFileChange}
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={uploadMut.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload size={13} /> {uploadMut.isPending ? 'Uploading…' : 'Upload Document'}
              </button>
            </div>
            {uploadedFiles.length > 0 && (
              <div className="space-y-1">
                {uploadedFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-foreground">
                    <FileText size={13} className="text-steel-400 flex-shrink-0" />
                    <span>{f.name}</span>
                    <span className="badge-green text-[10px] ml-auto">Uploaded</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
