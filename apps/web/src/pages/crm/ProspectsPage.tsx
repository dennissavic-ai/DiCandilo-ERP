import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import { Plus, Search, TrendingUp, Phone, Mail, Edit2, User, Calendar } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STAGE_BADGE: Record<string, string> = {
  LEAD:        'badge-gray',
  CONTACTED:   'badge-blue',
  QUALIFIED:   'badge-teal',
  PROPOSAL:    'badge-amber',
  NEGOTIATION: 'badge-orange',
  WON:         'badge-green',
  LOST:        'badge-red',
};

const STAGES = ['LEAD','CONTACTED','QUALIFIED','PROPOSAL','NEGOTIATION','WON','LOST'];

const BLANK = {
  companyName: '', contactName: '', email: '', phone: '', stage: 'LEAD',
  estimatedValue: '', probability: 50, nextFollowUp: '', notes: '', industry: '',
};

export function ProspectsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState({ ...BLANK });

  const { data, isLoading } = useQuery({
    queryKey: ['prospects', stageFilter],
    queryFn: () => api.get('/crm/prospects', { params: { limit: 200, stage: stageFilter || undefined } }).then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () => editing
      ? api.put(`/crm/prospects/${editing.id}`, form)
      : api.post('/crm/prospects', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prospects'] }); closeModal(); },
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) => api.patch(`/crm/prospects/${id}/stage`, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospects'] }),
  });

  function openCreate() { setEditing(null); setForm({ ...BLANK }); setModalOpen(true); }
  function openEdit(p: any) {
    setEditing(p);
    setForm({ companyName: p.companyName, contactName: p.contactName ?? '', email: p.email ?? '',
      phone: p.phone ?? '', stage: p.stage, estimatedValue: p.estimatedValue ? (p.estimatedValue / 100).toFixed(2) : '',
      probability: p.probability ?? 50, nextFollowUp: p.nextFollowUp?.split('T')[0] ?? '',
      notes: p.notes ?? '', industry: p.industry ?? '' });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  const prospects: any[] = ((data as any)?.data ?? []).filter((p: any) =>
    !search ||
    p.companyName?.toLowerCase().includes(search.toLowerCase()) ||
    p.contactName?.toLowerCase().includes(search.toLowerCase()),
  );

  const pipeline = prospects.filter((p) => !['WON','LOST'].includes(p.stage))
    .reduce((s, p) => s + (p.estimatedValue ?? 0) * (p.probability ?? 50) / 100, 0);

  const byStage = STAGES.map((s) => ({ stage: s, count: prospects.filter((p) => p.stage === s).length }));

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Prospects & Pipeline</h1>
          <p className="page-subtitle">{prospects.length} prospects · ${(pipeline / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} weighted pipeline</p>
        </div>
        <div className="flex gap-2">
          <select className="input h-9 text-xs w-36" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)}>
            <option value="">All stages</option>
            {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={openCreate}><Plus size={13} /> New Prospect</button>
        </div>
      </div>

      {/* Kanban-style stage pills */}
      <div className="flex flex-wrap gap-2 mb-6">
        {byStage.map(({ stage, count }) => (
          <button key={stage}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded border text-xs font-medium transition-colors
              ${stageFilter === stage ? 'bg-primary-600 text-white border-primary-600' : 'bg-white border-border text-steel-600 hover:border-primary-400'}`}
            onClick={() => setStageFilter(stageFilter === stage ? '' : stage)}>
            <span className={STAGE_BADGE[stage]}>{stage}</span>
            <span>{count}</span>
          </button>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search by company or contact…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Company</th><th>Contact</th><th>Stage</th><th>Industry</th>
                <th className="text-right">Est. Value</th><th className="text-right">Probability</th>
                <th>Next Follow-up</th><th></th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : prospects.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="font-medium">{p.companyName}</div>
                        <div className="text-xs text-muted-foreground">{p.industry ?? ''}</div>
                      </td>
                      <td>
                        <div className="text-sm">{p.contactName ?? '—'}</div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {p.email && <a href={`mailto:${p.email}`} className="text-xs text-blue-600 flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}><Mail size={10} />{p.email}</a>}
                          {p.phone && <span className="text-xs text-muted-foreground flex items-center gap-0.5"><Phone size={10} />{p.phone}</span>}
                        </div>
                      </td>
                      <td>
                        <select className="select h-7 text-xs w-28" value={p.stage}
                          onChange={(e) => stageMutation.mutate({ id: p.id, stage: e.target.value })}>
                          {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                      <td className="text-xs text-muted-foreground">{p.industry ?? '—'}</td>
                      <td className="text-right font-mono text-sm tabular-nums">
                        {p.estimatedValue ? `$${(p.estimatedValue / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}` : '—'}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <div className="w-16 h-1.5 bg-steel-100 rounded-full overflow-hidden">
                            <div className="h-full bg-primary-500 rounded-full" style={{ width: `${p.probability ?? 0}%` }} />
                          </div>
                          <span className="text-xs font-mono">{p.probability ?? 0}%</span>
                        </div>
                      </td>
                      <td className="text-xs">
                        {p.nextFollowUp ? (
                          <span className={`flex items-center gap-1 ${new Date(p.nextFollowUp) < new Date() ? 'text-red-500 font-medium' : 'text-steel-500'}`}>
                            <Calendar size={10} />{format(new Date(p.nextFollowUp), 'dd MMM')}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <button className="btn-ghost btn-sm p-1" onClick={() => openEdit(p)}><Edit2 size={12} /></button>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && prospects.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><TrendingUp size={22} /></div>
            <p className="text-sm font-medium">No prospects yet</p>
            <button className="btn-primary btn-sm mt-3" onClick={openCreate}><Plus size={12} /> Add first prospect</button>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={closeModal} title={editing ? 'Edit Prospect' : 'New Prospect'} size="lg"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={closeModal}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.companyName || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Prospect'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Company Name *</label>
              <input className="input" value={form.companyName} onChange={(e) => setForm({ ...form, companyName: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Industry</label>
              <input className="input" value={form.industry} onChange={(e) => setForm({ ...form, industry: e.target.value })} placeholder="Manufacturing, Construction…" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Contact Name</label>
              <input className="input" value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Stage</label>
              <select className="select" value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value })}>
                {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Email</label>
              <input type="email" className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">Est. Value ($)</label>
              <input type="number" className="input" step="1000" value={form.estimatedValue}
                onChange={(e) => setForm({ ...form, estimatedValue: e.target.value })} placeholder="50000" />
            </div>
            <div className="form-group">
              <label className="label">Probability (%)</label>
              <input type="number" className="input" min={0} max={100} value={form.probability}
                onChange={(e) => setForm({ ...form, probability: Number(e.target.value) })} />
            </div>
            <div className="form-group">
              <label className="label">Next Follow-up</label>
              <input type="date" className="input" value={form.nextFollowUp} onChange={(e) => setForm({ ...form, nextFollowUp: e.target.value })} />
            </div>
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[80px] resize-none" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Meeting notes, requirements, key contacts…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
