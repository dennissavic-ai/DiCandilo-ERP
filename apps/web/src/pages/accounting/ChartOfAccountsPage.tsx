import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { accountingApi } from '../../services/api';
import { Plus, Search, BookOpen, Edit2, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { Modal } from '../../components/ui/Modal';

const TYPES = ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','COGS'];
const TYPE_BADGE: Record<string, string> = {
  ASSET: 'badge-blue', LIABILITY: 'badge-red', EQUITY: 'badge-violet',
  REVENUE: 'badge-green', EXPENSE: 'badge-orange', COGS: 'badge-amber',
};
const BLANK = { code: '', name: '', type: 'ASSET', parentCode: '', description: '', isActive: true };

export function ChartOfAccountsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...BLANK });

  const { data, isLoading } = useQuery({
    queryKey: ['accounts', typeFilter],
    queryFn: () => accountingApi.listAccounts({ type: typeFilter || undefined, limit: 500 }).then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? accountingApi.updateAccount(editing.id, form)
      : accountingApi.createAccount(form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['accounts'] }); closeModal(); },
  });

  function openCreate() { setEditing(null); setForm({ ...BLANK }); setModalOpen(true); }
  function openEdit(a: any) {
    setEditing(a);
    setForm({ code: a.code, name: a.name, type: a.type, parentCode: a.parent?.code ?? '', description: a.description ?? '', isActive: a.isActive });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  const accounts = ((data as any)?.data ?? []).filter((a: any) =>
    (!search || a.code.toLowerCase().includes(search.toLowerCase()) || a.name.toLowerCase().includes(search.toLowerCase())) &&
    (!typeFilter || a.type === typeFilter),
  );

  // Group by type for summary
  const byType = TYPES.map((t) => ({
    type: t,
    count: accounts.filter((a: any) => a.type === t).length,
  }));

  return (
    <div className="max-w-[1200px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Chart of Accounts</h1>
          <p className="page-subtitle">{accounts.length} accounts · {TYPES.filter((t) => accounts.some((a: any) => a.type === t)).length} categories</p>
        </div>
        <div className="flex gap-2">
          <select className="input h-9 text-xs w-36" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={openCreate}><Plus size={13} /> New Account</button>
        </div>
      </div>

      {/* Type summary pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {byType.map(({ type, count }) => (
          <button key={type}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors
              ${typeFilter === type ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-border text-steel-600 hover:border-primary-400'}`}
            onClick={() => setTypeFilter(typeFilter === type ? '' : type)}>
            <span className={TYPE_BADGE[type]}>{type}</span>
            <span className="text-xs">{count}</span>
          </button>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search by code or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Account Name</th><th>Type</th><th>Parent</th><th>Description</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 7 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : accounts.map((a: any) => (
                    <tr key={a.id}>
                      <td className="font-mono text-xs font-bold text-primary-700">{a.code}</td>
                      <td className="font-medium">{a.name}</td>
                      <td><span className={TYPE_BADGE[a.type] ?? 'badge-gray'}>{a.type}</span></td>
                      <td className="font-mono text-xs text-muted-foreground">{a.parent?.code ?? '—'}</td>
                      <td className="text-xs text-muted-foreground max-w-[200px] truncate">{a.description ?? '—'}</td>
                      <td><span className={a.isActive ? 'badge-green' : 'badge-gray'}>{a.isActive ? 'Active' : 'Inactive'}</span></td>
                      <td><button className="btn-ghost btn-sm p-1" onClick={() => openEdit(a)}><Edit2 size={12} /></button></td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && accounts.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><BookOpen size={22} /></div>
            <p className="text-sm font-medium">No accounts found</p>
            <button className="btn-primary btn-sm mt-3" onClick={openCreate}><Plus size={12} /> Add first account</button>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Account' : 'New Account'}
        footer={<>
          <button className="btn-secondary btn-sm" onClick={closeModal}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.code || !form.name || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Account'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Account Code *</label>
              <input className="input font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. 1100" />
            </div>
            <div className="form-group">
              <label className="label">Type *</label>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Account Name *</label>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Trade Debtors" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Parent Account Code</label>
              <input className="input font-mono" value={form.parentCode} onChange={(e) => setForm({ ...form, parentCode: e.target.value })} placeholder="e.g. 1000" />
            </div>
            <div className="form-group">
              <label className="label">Status</label>
              <select className="select" value={form.isActive ? '1' : '0'} onChange={(e) => setForm({ ...form, isActive: e.target.value === '1' })}>
                <option value="1">Active</option><option value="0">Inactive</option>
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Description</label>
            <textarea className="input min-h-[70px] resize-none" value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional description…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
