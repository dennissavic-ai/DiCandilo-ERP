import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../services/api';
import {
  Plus, Mail, Phone, Calendar, Edit2, DollarSign,
  TrendingUp, Percent, Kanban,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

// ── Constants ─────────────────────────────────────────────────────────────────

const STAGES = ['LEAD', 'CONTACTED', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST'] as const;
type Stage = typeof STAGES[number];

const STAGE_META: Record<Stage, { label: string; color: string; headerBg: string; dot: string }> = {
  LEAD:        { label: 'Lead',        color: 'text-steel-600',  headerBg: 'bg-steel-100',   dot: 'bg-steel-400' },
  CONTACTED:   { label: 'Contacted',   color: 'text-blue-700',   headerBg: 'bg-blue-50',     dot: 'bg-blue-500' },
  QUALIFIED:   { label: 'Qualified',   color: 'text-teal-700',   headerBg: 'bg-teal-50',     dot: 'bg-teal-500' },
  PROPOSAL:    { label: 'Proposal',    color: 'text-amber-700',  headerBg: 'bg-amber-50',    dot: 'bg-amber-500' },
  NEGOTIATION: { label: 'Negotiation', color: 'text-orange-700', headerBg: 'bg-orange-50',   dot: 'bg-orange-500' },
  WON:         { label: 'Won',         color: 'text-green-700',  headerBg: 'bg-green-50',    dot: 'bg-green-500' },
  LOST:        { label: 'Lost',        color: 'text-red-700',    headerBg: 'bg-red-50',      dot: 'bg-red-400' },
};

const BLANK = {
  companyName: '', contactName: '', email: '', phone: '', stage: 'LEAD' as Stage,
  estimatedValue: '', probability: 50, nextFollowUp: '', notes: '', industry: '',
};

// ── Prospect Card ─────────────────────────────────────────────────────────────

function ProspectCard({
  p,
  onEdit,
  onDragStart,
}: {
  p: any;
  onEdit: () => void;
  onDragStart: (id: string) => void;
}) {
  const navigate = useNavigate();
  const overdue = p.nextFollowUp && new Date(p.nextFollowUp) < new Date();
  const valueDisplay = p.estimatedValue
    ? `$${(p.estimatedValue / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStart(p.id);
      }}
      className="group bg-white border border-steel-200 rounded-xl p-3 cursor-grab active:cursor-grabbing
                 hover:border-primary-300 hover:shadow-md transition-all duration-150 select-none"
    >
      {/* Company + edit */}
      <div className="flex items-start justify-between gap-1 mb-1">
        <button
          className="text-sm font-semibold text-steel-900 hover:text-primary-700 text-left leading-snug"
          onClick={() => navigate(`/crm/contacts/prospect/${p.id}`)}
        >
          {p.companyName}
        </button>
        <button
          className="opacity-0 group-hover:opacity-100 p-0.5 rounded text-steel-400 hover:text-primary-600 transition-all flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onEdit(); }}
        >
          <Edit2 size={11} />
        </button>
      </div>

      {/* Contact name */}
      {p.contactName && (
        <div className="text-xs text-steel-500 mb-2">{p.contactName}</div>
      )}

      {/* Value + probability */}
      {(valueDisplay || p.probability != null) && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-mono font-semibold text-steel-800">
            {valueDisplay ?? '—'}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-14 h-1.5 bg-steel-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary-500 rounded-full"
                style={{ width: `${p.probability ?? 0}%` }}
              />
            </div>
            <span className="text-[10px] text-steel-400 font-mono">{p.probability ?? 0}%</span>
          </div>
        </div>
      )}

      {/* Contact icons */}
      <div className="flex items-center gap-2">
        {p.email && (
          <a
            href={`mailto:${p.email}`}
            onClick={(e) => e.stopPropagation()}
            className="text-steel-300 hover:text-blue-500 transition-colors"
          >
            <Mail size={11} />
          </a>
        )}
        {p.phone && (
          <a
            href={`tel:${p.phone}`}
            onClick={(e) => e.stopPropagation()}
            className="text-steel-300 hover:text-green-500 transition-colors"
          >
            <Phone size={11} />
          </a>
        )}
        {p.nextFollowUp && (
          <span
            className={`ml-auto flex items-center gap-1 text-[10px] font-medium ${
              overdue ? 'text-red-500' : 'text-steel-400'
            }`}
          >
            <Calendar size={9} />
            {format(new Date(p.nextFollowUp), 'dd MMM')}
          </span>
        )}
      </div>
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage,
  prospects,
  isDragOver,
  onDragOver,
  onDragLeave,
  onDrop,
  onEdit,
  onDragStart,
}: {
  stage: Stage;
  prospects: any[];
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onEdit: (p: any) => void;
  onDragStart: (id: string) => void;
}) {
  const meta = STAGE_META[stage];
  const total = prospects.reduce((s, p) => s + (p.estimatedValue ?? 0), 0);
  const weighted = prospects.reduce(
    (s, p) => s + (p.estimatedValue ?? 0) * (p.probability ?? 50) / 100,
    0,
  );

  return (
    <div className="flex flex-col flex-shrink-0 w-64">
      {/* Column header */}
      <div className={`${meta.headerBg} rounded-xl px-3 py-2.5 mb-2`}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${meta.dot} flex-shrink-0`} />
            <span className={`text-xs font-semibold uppercase tracking-wide ${meta.color}`}>
              {meta.label}
            </span>
          </div>
          <span className="text-xs font-bold text-steel-500 bg-white/70 px-1.5 py-0.5 rounded-md">
            {prospects.length}
          </span>
        </div>
        {total > 0 && (
          <div className="text-[10px] text-steel-500 pl-4">
            ${(total / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} total
            {weighted !== total && (
              <span className="text-steel-400">
                {' '}· ${(weighted / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} weighted
              </span>
            )}
          </div>
        )}
      </div>

      {/* Drop zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`flex-1 min-h-[120px] space-y-2 p-1.5 rounded-xl transition-colors duration-150 ${
          isDragOver ? 'bg-primary-50 border-2 border-dashed border-primary-300' : 'border-2 border-transparent'
        }`}
      >
        {prospects.map((p) => (
          <ProspectCard
            key={p.id}
            p={p}
            onEdit={() => onEdit(p)}
            onDragStart={onDragStart}
          />
        ))}
      </div>
    </div>
  );
}

// ── Prospect Modal ─────────────────────────────────────────────────────────────

function ProspectModal({
  open,
  onClose,
  editing,
  form,
  setForm,
  onSave,
  isSaving,
}: {
  open: boolean;
  onClose: () => void;
  editing: any | null;
  form: typeof BLANK;
  setForm: React.Dispatch<React.SetStateAction<typeof BLANK>>;
  onSave: () => void;
  isSaving: boolean;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Prospect' : 'New Prospect'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary btn-sm"
            disabled={!form.companyName || isSaving}
            onClick={onSave}
          >
            {isSaving ? 'Saving…' : editing ? 'Save Changes' : 'Create Prospect'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Company Name *</label>
            <input className="input" value={form.companyName}
              onChange={(e) => setForm((f) => ({ ...f, companyName: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Industry</label>
            <input className="input" value={form.industry}
              onChange={(e) => setForm((f) => ({ ...f, industry: e.target.value }))}
              placeholder="Manufacturing, Construction…" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Contact Name</label>
            <input className="input" value={form.contactName}
              onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Stage</label>
            <select className="select" value={form.stage}
              onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as Stage }))}>
              {STAGES.map((s) => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="form-group">
            <label className="label">Email</label>
            <input type="email" className="input" value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </div>
          <div className="form-group">
            <label className="label">Phone</label>
            <input className="input" value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="form-group">
            <label className="label">Est. Value ($)</label>
            <input type="number" className="input" step="1000" value={form.estimatedValue}
              onChange={(e) => setForm((f) => ({ ...f, estimatedValue: e.target.value }))}
              placeholder="50000" />
          </div>
          <div className="form-group">
            <label className="label">Probability (%)</label>
            <input type="number" className="input" min={0} max={100} value={form.probability}
              onChange={(e) => setForm((f) => ({ ...f, probability: Number(e.target.value) }))} />
          </div>
          <div className="form-group">
            <label className="label">Next Follow-up</label>
            <input type="date" className="input" value={form.nextFollowUp}
              onChange={(e) => setForm((f) => ({ ...f, nextFollowUp: e.target.value }))} />
          </div>
        </div>
        <div className="form-group">
          <label className="label">Notes</label>
          <textarea className="input min-h-[80px] resize-none" value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Meeting notes, requirements, key contacts…" />
        </div>
      </div>
    </Modal>
  );
}

// ── PipelinePage ──────────────────────────────────────────────────────────────

export function PipelinePage() {
  const qc = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState({ ...BLANK });
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);
  const draggingId = useRef<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['prospects'],
    queryFn: () => api.get('/crm/prospects', { params: { limit: 500 } }).then((r) => r.data),
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? api.put(`/crm/prospects/${editing.id}`, form)
        : api.post('/crm/prospects', form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      closeModal();
    },
  });

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      api.patch(`/crm/prospects/${id}/stage`, { stage }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospects'] }),
  });

  function openCreate() { setEditing(null); setForm({ ...BLANK }); setModalOpen(true); }
  function openEdit(p: any) {
    setEditing(p);
    setForm({
      companyName:    p.companyName,
      contactName:    p.contactName ?? '',
      email:          p.email ?? '',
      phone:          p.phone ?? '',
      stage:          p.stage,
      estimatedValue: p.estimatedValue ? (p.estimatedValue / 100).toFixed(0) : '',
      probability:    p.probability ?? 50,
      nextFollowUp:   p.nextFollowUp?.split('T')[0] ?? '',
      notes:          p.notes ?? '',
      industry:       p.industry ?? '',
    });
    setModalOpen(true);
  }
  function closeModal() { setModalOpen(false); setEditing(null); }

  const allProspects: any[] = (data as any)?.data ?? [];

  // Partition by stage
  const byStage = Object.fromEntries(
    STAGES.map((s) => [s, allProspects.filter((p) => p.stage === s)]),
  ) as Record<Stage, any[]>;

  // KPI: weighted pipeline (exclude WON/LOST)
  const activeProspects = allProspects.filter((p) => !['WON', 'LOST'].includes(p.stage));
  const weightedPipeline = activeProspects.reduce(
    (s, p) => s + (p.estimatedValue ?? 0) * (p.probability ?? 50) / 100,
    0,
  );
  const totalPipeline = activeProspects.reduce((s, p) => s + (p.estimatedValue ?? 0), 0);

  function handleDrop(stage: Stage) {
    const id = draggingId.current;
    if (id) {
      stageMutation.mutate({ id, stage });
      draggingId.current = null;
    }
    setDragOverStage(null);
  }

  return (
    <div className="flex flex-col h-full animate-fade-in">
      {/* Header */}
      <div className="page-header flex-shrink-0">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <Kanban size={20} className="text-primary-600" />
            Pipeline
          </h1>
          <p className="page-subtitle">
            {activeProspects.length} active deals
            {totalPipeline > 0 && (
              <>
                {' '}·{' '}
                <span className="inline-flex items-center gap-1">
                  <DollarSign size={11} />
                  {(totalPipeline / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} total
                </span>
                {' '}·{' '}
                <span className="inline-flex items-center gap-1">
                  <Percent size={11} />
                  {(weightedPipeline / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} weighted
                </span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn-primary btn-sm" onClick={openCreate}>
            <Plus size={13} /> New Deal
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="flex gap-3 mb-4 flex-shrink-0 flex-wrap">
        {STAGES.map((stage) => {
          const count = byStage[stage].length;
          const meta = STAGE_META[stage];
          return (
            <div key={stage} className={`stat-card flex-1 min-w-[90px] ${meta.headerBg} border-0`}>
              <div className={`text-lg font-bold tabular-nums ${meta.color}`}>{count}</div>
              <div className="text-xs text-steel-500">{meta.label}</div>
            </div>
          );
        })}
      </div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {STAGES.map((s) => (
            <div key={s} className="flex-shrink-0 w-64">
              <div className="skeleton h-16 w-full rounded-xl mb-2" />
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="skeleton h-24 w-full rounded-xl mb-2" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-start">
          {STAGES.map((stage) => (
            <KanbanColumn
              key={stage}
              stage={stage}
              prospects={byStage[stage]}
              isDragOver={dragOverStage === stage}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage); }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={() => handleDrop(stage)}
              onEdit={openEdit}
              onDragStart={(id) => { draggingId.current = id; }}
            />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!isLoading && allProspects.length === 0 && (
        <div className="empty-state mt-8">
          <div className="empty-state-icon"><TrendingUp size={22} /></div>
          <p className="text-sm font-medium">No deals in the pipeline yet</p>
          <button className="btn-primary btn-sm mt-3" onClick={openCreate}>
            <Plus size={12} /> Add first deal
          </button>
        </div>
      )}

      <ProspectModal
        open={modalOpen}
        onClose={closeModal}
        editing={editing}
        form={form}
        setForm={setForm}
        onSave={() => saveMutation.mutate()}
        isSaving={saveMutation.isPending}
      />
    </div>
  );
}
