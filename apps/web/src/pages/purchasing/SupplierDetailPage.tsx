import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { purchasingApi } from '../../services/api';
import { ArrowLeft, Plus, X, Phone, Mail, Globe, Factory } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';

const INTERACTION_TYPES = ['CALL', 'EMAIL', 'VISIT', 'MEETING'] as const;

const TYPE_BADGE: Record<string, string> = {
  CALL:    'badge-blue',
  EMAIL:   'badge-teal',
  VISIT:   'badge-amber',
  MEETING: 'badge-violet',
};

export function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [logOpen, setLogOpen] = useState(false);
  const [logForm, setLogForm] = useState({ type: 'CALL', date: new Date().toISOString().split('T')[0], subject: '', body: '' });
  const [formError, setFormError] = useState('');

  const { data: supplierData, isLoading } = useQuery({
    queryKey: ['supplier', id],
    queryFn: () => purchasingApi.getSupplier(id!).then((r) => r.data),
    enabled: !!id,
  });

  const supplier = supplierData as any;

  const logMutation = useMutation({
    mutationFn: (note: object) => {
      const existing: any[] = supplier?.interactionNotes ?? [];
      return purchasingApi.updateSupplier(id!, {
        interactionNotes: [{ ...note, id: crypto.randomUUID(), createdAt: new Date().toISOString() }, ...existing],
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier', id] });
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
      setLogOpen(false);
      setLogForm({ type: 'CALL', date: new Date().toISOString().split('T')[0], subject: '', body: '' });
      setFormError('');
    },
    onError: (err: any) => {
      setFormError(err?.response?.data?.message ?? 'Failed to log interaction.');
    },
  });

  function handleLogSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!logForm.subject) { setFormError('Subject is required.'); return; }
    setFormError('');
    logMutation.mutate(logForm);
  }

  if (isLoading) {
    return (
      <div className="max-w-[900px] mx-auto animate-fade-in">
        <div className="skeleton h-8 w-48 mb-4" />
        <div className="card p-6 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="skeleton h-4 w-full" />)}
        </div>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="max-w-[900px] mx-auto">
        <p className="text-muted-foreground">Supplier not found.</p>
      </div>
    );
  }

  const notes: any[] = supplier.interactionNotes ?? [];

  return (
    <div className="max-w-[900px] mx-auto animate-fade-in">
      <div className="flex items-center gap-3 mb-5">
        <button className="btn-ghost btn-sm p-1" onClick={() => navigate('/purchasing/suppliers')}>
          <ArrowLeft size={16} />
        </button>
        <div>
          <h1 className="page-title">{supplier.name}</h1>
          <p className="page-subtitle">{supplier.code} · {supplier.currencyCode} · Net {supplier.paymentTerms}</p>
        </div>
        <span className={`ml-auto ${supplier.isActive ? 'badge-green' : 'badge-gray'}`}>
          {supplier.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      {/* Info Card */}
      <div className="card mb-5">
        <div className="card-body grid grid-cols-2 gap-4 text-sm">
          {supplier.legalName && (
            <div><p className="text-xs text-muted-foreground">Legal Name</p><p className="font-medium">{supplier.legalName}</p></div>
          )}
          {supplier.taxId && (
            <div><p className="text-xs text-muted-foreground">ABN / Tax ID</p><p className="font-medium">{supplier.taxId}</p></div>
          )}
          {supplier.contactName && (
            <div><p className="text-xs text-muted-foreground">Contact</p><p className="font-medium">{supplier.contactName}</p></div>
          )}
          {supplier.contactEmail && (
            <div className="flex items-center gap-1.5">
              <Mail size={12} className="text-muted-foreground" />
              <a href={`mailto:${supplier.contactEmail}`} className="text-primary-700 hover:underline text-sm">{supplier.contactEmail}</a>
            </div>
          )}
          {supplier.contactPhone && (
            <div className="flex items-center gap-1.5">
              <Phone size={12} className="text-muted-foreground" />
              <span className="text-sm">{supplier.contactPhone}</span>
            </div>
          )}
          {supplier.website && (
            <div className="flex items-center gap-1.5">
              <Globe size={12} className="text-muted-foreground" />
              <a href={supplier.website} target="_blank" rel="noreferrer" className="text-primary-700 hover:underline text-sm truncate">{supplier.website}</a>
            </div>
          )}
        </div>
      </div>

      {/* Interaction Notes */}
      <div className="card">
        <div className="card-header flex items-center justify-between">
          <h2 className="font-semibold text-sm">Interaction History</h2>
          <button className="btn-primary btn-sm" onClick={() => setLogOpen(true)}>
            <Plus size={12} /> Log Interaction
          </button>
        </div>
        <div className="divide-y">
          {notes.length === 0 ? (
            <div className="empty-state py-8">
              <div className="empty-state-icon"><Factory size={20} /></div>
              <p className="text-sm font-medium text-foreground">No interactions logged yet</p>
              <p className="text-xs text-muted-foreground mt-1">Log calls, emails, visits, and meetings with this supplier.</p>
            </div>
          ) : (
            notes.map((note: any, i: number) => (
              <div key={note.id ?? i} className="px-5 py-3">
                <div className="flex items-start gap-3">
                  <span className={`${TYPE_BADGE[note.type] ?? 'badge-gray'} flex-shrink-0 mt-0.5`}>{note.type}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{note.subject}</p>
                    {note.body && <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">{note.body}</p>}
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap flex-shrink-0">
                    {note.date ? format(new Date(note.date), 'dd MMM yyyy') : ''}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Log Interaction Modal */}
      {logOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <h2 className="font-semibold text-base">Log Interaction</h2>
              <button onClick={() => { setLogOpen(false); setFormError(''); }} className="text-steel-400 hover:text-foreground"><X size={16} /></button>
            </div>
            <form onSubmit={handleLogSubmit} className="px-5 py-4 space-y-3">
              {formError && <p className="text-sm text-red-600">{formError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="form-label">Type</label>
                  <select className="input" value={logForm.type} onChange={e => setLogForm(f => ({ ...f, type: e.target.value }))}>
                    {INTERACTION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Date</label>
                  <input className="input" type="date" value={logForm.date} onChange={e => setLogForm(f => ({ ...f, date: e.target.value }))} />
                </div>
              </div>
              <div>
                <label className="form-label">Subject *</label>
                <input className="input" value={logForm.subject} onChange={e => setLogForm(f => ({ ...f, subject: e.target.value }))} placeholder="Discussed pricing for Q2…" />
              </div>
              <div>
                <label className="form-label">Notes</label>
                <textarea className="input" rows={3} value={logForm.body} onChange={e => setLogForm(f => ({ ...f, body: e.target.value }))} placeholder="Additional details…" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" className="btn-secondary btn-sm" onClick={() => { setLogOpen(false); setFormError(''); }}>Cancel</button>
                <button type="submit" className="btn-primary btn-sm" disabled={logMutation.isPending}>
                  {logMutation.isPending ? 'Saving…' : 'Log Interaction'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
