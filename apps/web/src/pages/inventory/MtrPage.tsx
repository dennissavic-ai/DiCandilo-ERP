import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { inventoryApi, type InventoryItem } from '../../services/api';
import { Plus, Search, FileCheck, Upload, Download, Eye, AlertTriangle } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const BLANK_MTR = {
  heatNumber: '', grade: '', supplier: '', millName: '', certNumber: '',
  testDate: new Date().toISOString().split('T')[0], yieldStrength: '', tensileStrength: '',
  elongation: '', hardness: '', chemistry: '', notes: '', compliant: true,
};

export function MtrPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null);
  const [mtrOpen, setMtrOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK_MTR });
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const { data: itemsData, isLoading } = useQuery({
    queryKey: ['items-mtr', search],
    queryFn: () => inventoryApi.listItems({ limit: 100, requiresMtr: true, search: search || undefined }).then((r) => r.data),
  });

  const { data: mtrsData } = useQuery({
    queryKey: ['mtrs', selectedItem?.id],
    queryFn: () => selectedItem ? inventoryApi.listMTRs(selectedItem.id).then((r) => r.data) : null,
    enabled: !!selectedItem,
  });

  const createMutation = useMutation({
    mutationFn: () => {
      const payload = { ...form, uploadFile };
      return inventoryApi.createMTR(selectedItem!.id, payload);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['mtrs', selectedItem?.id] }); setMtrOpen(false); setForm({ ...BLANK_MTR }); setUploadFile(null); },
  });

  const items: InventoryItem[] = (itemsData?.data ?? []);
  const mtrs: any[] = (mtrsData as any)?.data ?? mtrsData ?? [];

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Mill Test Reports</h1>
          <p className="page-subtitle">Track MTRs / certs for stock requiring material traceability</p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left: Item list */}
        <div className="space-y-3">
          <div className="relative">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm w-full" placeholder="Search items…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="card overflow-hidden">
            <div className="card-header">
              <span className="text-sm font-semibold">Stock Items</span>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>
            <div className="divide-y divide-border max-h-[600px] overflow-y-auto">
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => <div key={i} className="p-3"><div className="skeleton h-10 w-full rounded" /></div>)
                : items.length === 0
                  ? <div className="p-6 text-center text-sm text-muted-foreground">No items requiring MTRs found</div>
                  : items.map((item) => (
                      <button key={item.id}
                        className={`w-full text-left p-3 hover:bg-steel-50 transition-colors ${selectedItem?.id === item.id ? 'bg-primary-50 border-r-2 border-primary-600' : ''}`}
                        onClick={() => setSelectedItem(item)}>
                        <div className="font-medium text-sm">{item.product?.code}</div>
                        <div className="text-xs text-muted-foreground truncate">{item.product?.description}</div>
                        <div className="flex items-center gap-2 mt-1">
                          {item.heatNumber && <span className="text-xs font-mono bg-steel-100 px-1 rounded">{item.heatNumber}</span>}
                          {item.lotNumber && <span className="text-xs text-muted-foreground">Lot: {item.lotNumber}</span>}
                        </div>
                        {!mtrsData && <div className="flex items-center gap-1 text-xs text-amber-600 mt-1"><AlertTriangle size={10} /> No MTR attached</div>}
                      </button>
                    ))}
            </div>
          </div>
        </div>

        {/* Right: MTR detail */}
        <div className="col-span-2">
          {!selectedItem ? (
            <div className="card h-full flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <FileCheck size={40} className="mx-auto mb-3 opacity-20" />
                <p className="text-sm">Select a stock item to view or attach MTRs</p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Item header */}
              <div className="card">
                <div className="card-header">
                  <div>
                    <div className="font-semibold">{selectedItem.product?.code} — {selectedItem.product?.description}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Heat: {selectedItem.heatNumber ?? '—'} · Lot: {selectedItem.lotNumber ?? '—'} · {selectedItem.location?.name}
                    </div>
                  </div>
                  <button className="btn-primary btn-sm" onClick={() => { setForm({ ...BLANK_MTR, heatNumber: selectedItem.heatNumber ?? '', grade: selectedItem.product?.grade ?? '' }); setMtrOpen(true); }}>
                    <Plus size={12} /> Attach MTR
                  </button>
                </div>
              </div>

              {/* MTR list */}
              <div className="card">
                <div className="card-header">
                  <span className="text-sm font-semibold">Attached MTRs</span>
                  <span className="text-xs text-muted-foreground">{mtrs.length} certificate{mtrs.length !== 1 ? 's' : ''}</span>
                </div>
                {mtrs.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-state-icon"><FileCheck size={20} /></div>
                    <p className="text-sm font-medium">No MTRs attached</p>
                    <p className="text-xs text-muted-foreground mt-1">Attach a mill test report for this item</p>
                  </div>
                ) : (
                  <div className="table-container rounded-b-xl">
                    <table className="table">
                      <thead><tr>
                        <th>Cert #</th><th>Heat #</th><th>Mill</th><th>Grade</th>
                        <th className="text-right">Yield (MPa)</th><th className="text-right">UTS (MPa)</th>
                        <th>Test Date</th><th>Compliant</th><th></th>
                      </tr></thead>
                      <tbody>
                        {mtrs.map((m: any) => (
                          <tr key={m.id}>
                            <td className="font-mono text-xs font-bold">{m.certNumber}</td>
                            <td className="font-mono text-xs">{m.heatNumber}</td>
                            <td className="text-xs">{m.millName ?? '—'}</td>
                            <td className="text-xs font-medium">{m.grade ?? '—'}</td>
                            <td className="text-right font-mono text-xs">{m.yieldStrength ?? '—'}</td>
                            <td className="text-right font-mono text-xs">{m.tensileStrength ?? '—'}</td>
                            <td className="text-xs text-steel-500">{m.testDate ? format(new Date(m.testDate), 'dd MMM yyyy') : '—'}</td>
                            <td>
                              <span className={m.compliant !== false ? 'badge-green' : 'badge-red'}>
                                {m.compliant !== false ? 'Pass' : 'Fail'}
                              </span>
                            </td>
                            <td>
                              <div className="flex gap-1">
                                {m.fileUrl && <a href={m.fileUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm p-1"><Eye size={12} /></a>}
                                {m.fileUrl && <a href={m.fileUrl} download className="btn-ghost btn-sm p-1"><Download size={12} /></a>}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add MTR Modal */}
      <Modal open={mtrOpen} onClose={() => setMtrOpen(false)} title="Attach Mill Test Report" size="xl"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setMtrOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.certNumber || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Saving…' : 'Save MTR'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Certificate # *</label>
              <input className="input font-mono" value={form.certNumber} onChange={(e) => setForm({ ...form, certNumber: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Heat Number</label>
              <input className="input font-mono" value={form.heatNumber} onChange={(e) => setForm({ ...form, heatNumber: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">Grade</label>
              <input className="input" value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="e.g. 350L0" />
            </div>
            <div className="form-group">
              <label className="label">Mill / Supplier</label>
              <input className="input" value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Test Date</label>
              <input type="date" className="input" value={form.testDate} onChange={(e) => setForm({ ...form, testDate: e.target.value })} />
            </div>
          </div>
          <hr className="border-border" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Mechanical Properties</p>
          <div className="grid grid-cols-4 gap-4">
            <div className="form-group">
              <label className="label">Yield (MPa)</label>
              <input type="number" className="input" value={form.yieldStrength} onChange={(e) => setForm({ ...form, yieldStrength: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">UTS (MPa)</label>
              <input type="number" className="input" value={form.tensileStrength} onChange={(e) => setForm({ ...form, tensileStrength: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Elongation (%)</label>
              <input type="number" className="input" step="0.1" value={form.elongation} onChange={(e) => setForm({ ...form, elongation: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Hardness (HB)</label>
              <input type="number" className="input" value={form.hardness} onChange={(e) => setForm({ ...form, hardness: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Chemical Composition</label>
              <textarea className="input min-h-[60px] resize-none font-mono text-xs" value={form.chemistry}
                onChange={(e) => setForm({ ...form, chemistry: e.target.value })} placeholder="C: 0.18%, Mn: 1.40%…" />
            </div>
            <div className="form-group">
              <label className="label">Notes</label>
              <textarea className="input min-h-[60px] resize-none" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Compliant</label>
              <select className="select" value={form.compliant ? '1' : '0'} onChange={(e) => setForm({ ...form, compliant: e.target.value === '1' })}>
                <option value="1">Pass — Compliant</option>
                <option value="0">Fail — Non-compliant</option>
              </select>
            </div>
            <div className="form-group">
              <label className="label"><Upload size={12} className="inline mr-1" />Upload PDF / Scan</label>
              <input type="file" accept=".pdf,image/*" className="input py-1.5 text-xs"
                onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
