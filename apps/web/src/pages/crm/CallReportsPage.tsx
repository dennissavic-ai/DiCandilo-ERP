import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api, salesApi } from '../../services/api';
import { Plus, Search, Phone, CheckSquare, Clock, User } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const TYPE_BADGE: Record<string, string> = {
  CALL:    'badge-blue',
  VISIT:   'badge-teal',
  EMAIL:   'badge-gray',
  MEETING: 'badge-violet',
  DEMO:    'badge-amber',
};

const OUTCOMES = ['FOLLOW_UP','QUOTE_REQUESTED','ORDER_PLACED','NOT_INTERESTED','CALLBACK','NO_ANSWER'];
const OUTCOME_BADGE: Record<string, string> = {
  FOLLOW_UP: 'badge-yellow', QUOTE_REQUESTED: 'badge-blue', ORDER_PLACED: 'badge-green',
  NOT_INTERESTED: 'badge-red', CALLBACK: 'badge-orange', NO_ANSWER: 'badge-gray',
};

const today = new Date().toISOString().split('T')[0];
const BLANK = { customerId: '', type: 'CALL', callDate: today, durationMinutes: '', subject: '', notes: '', outcome: 'FOLLOW_UP', followUpDate: '' };

export function CallReportsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ ...BLANK });

  const { data, isLoading } = useQuery({
    queryKey: ['call-reports', typeFilter],
    queryFn: () => api.get('/crm/call-reports', { params: { limit: 200, type: typeFilter || undefined } }).then((r) => r.data),
  });

  const { data: customersData } = useQuery({
    queryKey: ['customers-dd'],
    queryFn: () => salesApi.listCustomers({ limit: 500 }).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => api.post('/crm/call-reports', form),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['call-reports'] }); setModalOpen(false); setForm({ ...BLANK }); },
  });

  const reports: any[] = ((data as any)?.data ?? []).filter((r: any) =>
    !search ||
    r.subject?.toLowerCase().includes(search.toLowerCase()) ||
    r.customer?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  const thisWeek  = reports.filter((r) => {
    const d = new Date(r.callDate);
    const now = new Date();
    return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  }).length;

  const followUps = reports.filter((r) => r.outcome === 'FOLLOW_UP' && r.followUpDate && new Date(r.followUpDate) >= new Date()).length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Call Reports</h1>
          <p className="page-subtitle">{reports.length} records · {thisWeek} this week · {followUps} pending follow-ups</p>
        </div>
        <div className="flex gap-2">
          <select className="input h-9 text-xs w-32" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {['CALL','VISIT','EMAIL','MEETING','DEMO'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button className="btn-primary btn-sm" onClick={() => setModalOpen(true)}><Plus size={13} /> Log Activity</button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'This Week',       value: thisWeek,  color: 'text-blue-600' },
          { label: 'Follow-ups Due',  value: followUps, color: followUps > 0 ? 'text-amber-600' : 'text-foreground' },
          { label: 'Orders Placed',   value: reports.filter((r) => r.outcome === 'ORDER_PLACED').length, color: 'text-green-600' },
          { label: 'Total Records',   value: reports.length, color: 'text-foreground' },
        ].map((s) => (
          <div key={s.label} className="stat-card">
            <div className={`text-xl font-bold tabular-nums ${s.color}`}>{s.value}</div>
            <div className="text-xs text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input className="input pl-8 h-9 text-sm" placeholder="Search by subject or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Type</th><th>Customer</th><th>Subject</th><th>Outcome</th><th>Duration</th><th>Follow-up</th><th>By</th></tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((__, j) => <td key={j}><div className="skeleton h-4 w-20" /></td>)}</tr>
                  ))
                : reports.map((r) => (
                    <tr key={r.id}>
                      <td className="text-xs text-steel-500">{r.callDate ? format(new Date(r.callDate), 'dd MMM yyyy') : '—'}</td>
                      <td><span className={TYPE_BADGE[r.type] ?? 'badge-gray'}>{r.type}</span></td>
                      <td className="font-medium text-sm">{r.customer?.name ?? r.prospect?.companyName ?? '—'}</td>
                      <td>
                        <div className="text-sm max-w-[200px] truncate">{r.subject}</div>
                        {r.notes && <div className="text-xs text-muted-foreground max-w-[200px] truncate">{r.notes}</div>}
                      </td>
                      <td><span className={OUTCOME_BADGE[r.outcome] ?? 'badge-gray'}>{r.outcome?.replace(/_/g,' ')}</span></td>
                      <td className="text-xs text-muted-foreground">
                        {r.durationMinutes ? <span className="flex items-center gap-1"><Clock size={10} />{r.durationMinutes}m</span> : '—'}
                      </td>
                      <td className="text-xs">
                        {r.followUpDate ? (
                          <span className={new Date(r.followUpDate) < new Date() ? 'text-red-500 font-medium' : 'text-steel-500'}>
                            {format(new Date(r.followUpDate), 'dd MMM yyyy')}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><User size={10} />{r.user?.name ?? '—'}</span>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && reports.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Phone size={22} /></div>
            <p className="text-sm font-medium">No activity logged yet</p>
            <button className="btn-primary btn-sm mt-3" onClick={() => setModalOpen(true)}><Plus size={12} /> Log first activity</button>
          </div>
        )}
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Log Activity" size="lg"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setModalOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.customerId || !form.subject || createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Saving…' : 'Log Activity'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="form-group">
              <label className="label">Customer *</label>
              <select className="select" value={form.customerId} onChange={(e) => setForm({ ...form, customerId: e.target.value })}>
                <option value="">Select customer…</option>
                {(customersData?.data ?? []).map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label className="label">Type</label>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {['CALL','VISIT','EMAIL','MEETING','DEMO'].map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label className="label">Subject *</label>
            <input className="input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Brief description of the activity…" />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="form-group">
              <label className="label">Date</label>
              <input type="date" className="input" value={form.callDate} onChange={(e) => setForm({ ...form, callDate: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Duration (min)</label>
              <input type="number" className="input" value={form.durationMinutes} min={1}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })} placeholder="e.g. 30" />
            </div>
            <div className="form-group">
              <label className="label">Outcome</label>
              <select className="select" value={form.outcome} onChange={(e) => setForm({ ...form, outcome: e.target.value })}>
                {OUTCOMES.map((o) => <option key={o} value={o}>{o.replace(/_/g,' ')}</option>)}
              </select>
            </div>
          </div>
          {form.outcome === 'FOLLOW_UP' && (
            <div className="form-group">
              <label className="label">Follow-up Date</label>
              <input type="date" className="input" value={form.followUpDate} onChange={(e) => setForm({ ...form, followUpDate: e.target.value })} />
            </div>
          )}
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[90px] resize-none" value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Key discussion points, action items…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
