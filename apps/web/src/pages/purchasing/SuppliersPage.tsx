import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { purchasingApi, type Supplier } from '../../services/api';
import { Plus, Search, Factory, Phone, Mail, Globe, Edit2 } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

const BLANK = { code: '', name: '', legalName: '', taxId: '', paymentTerms: 30, currencyCode: 'AUD', isActive: true, contactName: '', contactEmail: '', contactPhone: '', website: '' };

export function SuppliersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [form, setForm] = useState({ ...BLANK });

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => purchasingApi.listSuppliers({ limit: 200 }).then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? purchasingApi.updateSupplier(editing.id, form)
      : purchasingApi.createSupplier(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['suppliers'] }); closeModal(); },
  });

  function openCreate() { setEditing(null); setForm({ ...BLANK }); setModalOpen(true); }
  function openEdit(s: Supplier) {
    setEditing(s);
    setForm({ code: s.code, name: s.name, legalName: (s as any).legalName ?? '', taxId: (s as any).taxId ?? '',
      paymentTerms: s.paymentTerms, currencyCode: s.currencyCode, isActive: s.isActive,
      contactName: (s as any).contactName ?? '', contactEmail: (s as any).contactEmail ?? '',
      contactPhone: (s as any).contactPhone ?? '', website: (s as any).website ?? '' });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  const suppliers: Supplier[] = (data?.data ?? []).filter((s: Supplier) =>
    !search || s.name.toLowerCase().includes(search.toLowerCase()) || s.code.toLowerCase().includes(search.toLowerCase()),
  );

  const activeCount = suppliers.filter((s) => s.isActive).length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Suppliers</h1>
          <p className="page-subtitle">{data?.meta?.total ?? 0} total · {activeCount} active</p>
        </div>
        <button className="btn-primary btn-sm" onClick={openCreate}><Plus size={13} /> New Supplier</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
        <div className="stat-card"><div className="text-xl font-bold">{data?.meta?.total ?? 0}</div><div className="text-xs text-muted-foreground">Total Suppliers</div></div>
        <div className="stat-card"><div className="text-xl font-bold text-green-600">{activeCount}</div><div className="text-xs text-muted-foreground">Active</div></div>
        <div className="stat-card"><div className="text-xl font-bold text-steel-400">{(data?.meta?.total ?? 0) - activeCount}</div><div className="text-xs text-muted-foreground">Inactive</div></div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search suppliers…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Code</th><th>Supplier Name</th><th>Legal Name</th><th>Payment Terms</th>
                <th>Currency</th><th>Contact</th><th>Status</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : suppliers.map((s) => (
                    <tr key={s.id}>
                      <td className="font-mono text-xs font-semibold text-primary-700">{s.code}</td>
                      <td className="font-medium">{s.name}</td>
                      <td className="text-xs text-muted-foreground">{(s as any).legalName ?? '—'}</td>
                      <td className="text-xs">Net {s.paymentTerms}</td>
                      <td className="text-xs">{s.currencyCode}</td>
                      <td>
                        <div className="text-xs text-muted-foreground space-y-0.5">
                          {(s as any).contactEmail && <div className="flex items-center gap-1"><Mail size={10} />{(s as any).contactEmail}</div>}
                          {(s as any).contactPhone && <div className="flex items-center gap-1"><Phone size={10} />{(s as any).contactPhone}</div>}
                        </div>
                      </td>
                      <td>
                        <span className={s.isActive ? 'badge-green' : 'badge-gray'}>{s.isActive ? 'Active' : 'Inactive'}</span>
                      </td>
                      <td>
                        <button className="btn-ghost btn-sm p-1" onClick={() => openEdit(s)}><Edit2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && suppliers.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Factory size={22} /></div>
            <p className="text-sm font-medium">No suppliers found</p>
            <button className="btn-primary btn-sm mt-3" onClick={openCreate}><Plus size={12} /> Add supplier</button>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Supplier' : 'New Supplier'} size="lg"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={closeModal}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.code || !form.name || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Supplier'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Code *</label>
              <input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SUP001" />
            </div>
            <div className="form-group">
              <label className="label">Currency</label>
              <select className="select" value={form.currencyCode} onChange={(e) => setForm({ ...form, currencyCode: e.target.value })}>
                {['AUD','USD','NZD','EUR','GBP'].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Supplier Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Trading name…" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Legal Name</label>
              <input className="input" value={form.legalName} onChange={(e) => setForm({ ...form, legalName: e.target.value })} placeholder="ACN / Pty Ltd name…" />
            </div>
            <div className="form-group">
              <label className="label">ABN / Tax ID</label>
              <input className="input" value={form.taxId} onChange={(e) => setForm({ ...form, taxId: e.target.value })} placeholder="XX XXX XXX XXX" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Payment Terms (days)</label>
              <input type="number" className="input" value={form.paymentTerms} min={0}
                onChange={(e) => setForm({ ...form, paymentTerms: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label className="label">Status</label>
              <select className="select" value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
          </div>
          <hr className="border-border" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Primary Contact</p>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Contact Name</label>
              <input className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Phone</label>
              <input className="input" value={form.contactPhone} onChange={(e) => setForm({ ...form, contactPhone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Email</label>
              <input type="email" className="input" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Website</label>
              <input className="input" value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="https://…" />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
