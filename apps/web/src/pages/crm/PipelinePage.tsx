import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { crmApi, automationApi, PipelineStage, EmailAutomationRule } from '../../services/api';
import {
  Plus, Mail, Phone, Calendar, Edit2, DollarSign,
  TrendingUp, Percent, Kanban, Settings2, Trash2,
  ChevronUp, ChevronDown, CheckCircle, AlertCircle, UserPlus,
} from 'lucide-react';
import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

// ── Color helpers ─────────────────────────────────────────────────────────────

const COLOR_OPTIONS = [
  { value: 'gray',   bg: 'bg-steel-100',   dot: 'bg-steel-400',   text: 'text-steel-600'  },
  { value: 'blue',   bg: 'bg-blue-50',     dot: 'bg-blue-500',    text: 'text-blue-700'   },
  { value: 'teal',   bg: 'bg-teal-50',     dot: 'bg-teal-500',    text: 'text-teal-700'   },
  { value: 'amber',  bg: 'bg-amber-50',    dot: 'bg-amber-500',   text: 'text-amber-700'  },
  { value: 'orange', bg: 'bg-orange-50',   dot: 'bg-orange-500',  text: 'text-orange-700' },
  { value: 'green',  bg: 'bg-green-50',    dot: 'bg-green-500',   text: 'text-green-700'  },
  { value: 'red',    bg: 'bg-red-50',      dot: 'bg-red-400',     text: 'text-red-700'    },
  { value: 'violet', bg: 'bg-violet-50',   dot: 'bg-violet-500',  text: 'text-violet-700' },
];

function colorMeta(color: string) {
  return COLOR_OPTIONS.find((c) => c.value === color) ?? COLOR_OPTIONS[0];
}

// ── Stage Editor Modal ────────────────────────────────────────────────────────

interface EditableStage {
  key: string; // local temp id
  name: string;
  color: string;
  isWon: boolean;
  isLost: boolean;
  emailEnabled: boolean;
  emailSubject: string;
}

function StageEditorModal({
  open,
  onClose,
  stages,
  automationRules,
}: {
  open: boolean;
  onClose: () => void;
  stages: PipelineStage[];
  automationRules: EmailAutomationRule[];
}) {
  const qc = useQueryClient();

  const rulesByTrigger = new Map(automationRules.map((r) => [r.trigger, r]));

  const [rows, setRows] = useState<EditableStage[]>(() =>
    stages.map((s) => {
      const trigger = `CRM_STAGE_${s.name.toUpperCase()}`;
      const rule    = rulesByTrigger.get(trigger);
      return {
        key:          s.id,
        name:         s.name,
        color:        s.color,
        isWon:        s.isWon,
        isLost:       s.isLost,
        emailEnabled: rule?.isEnabled ?? false,
        emailSubject: rule?.subject   ?? '',
      };
    }),
  );

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState<string | null>(null);
  const [saved,  setSaved]  = useState(false);

  function addStage() {
    setRows((r) => [...r, {
      key:          `new-${Date.now()}`,
      name:         '',
      color:        'gray',
      isWon:        false,
      isLost:       false,
      emailEnabled: false,
      emailSubject: '',
    }]);
  }

  function removeStage(key: string) {
    setRows((r) => r.filter((s) => s.key !== key));
  }

  function moveUp(idx: number) {
    if (idx === 0) return;
    setRows((r) => {
      const n = [...r];
      [n[idx - 1], n[idx]] = [n[idx], n[idx - 1]];
      return n;
    });
  }

  function moveDown(idx: number) {
    setRows((r) => {
      if (idx >= r.length - 1) return r;
      const n = [...r];
      [n[idx], n[idx + 1]] = [n[idx + 1], n[idx]];
      return n;
    });
  }

  function update(key: string, patch: Partial<EditableStage>) {
    setRows((r) => r.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  async function handleSave() {
    setError(null);
    const names = rows.map((r) => r.name.trim());
    if (names.some((n) => !n)) { setError('All stages must have a name.'); return; }
    if (new Set(names).size !== names.length) { setError('Stage names must be unique.'); return; }

    setSaving(true);
    try {
      // 1. Save stage order/config
      await crmApi.saveStages(rows.map((s, i) => ({
        name:   s.name.trim(),
        color:  s.color,
        order:  i,
        isWon:  s.isWon,
        isLost: s.isLost,
      })));

      // 2. Save automation rules (one per stage, in parallel)
      await Promise.all(
        rows.map((s) =>
          automationApi.updateRule(`CRM_STAGE_${s.name.trim().toUpperCase()}`, {
            isEnabled:  s.emailEnabled,
            subject:    s.emailSubject || `Update on your enquiry — ${s.name}`,
            delayHours: 0,
          }),
        ),
      );

      qc.invalidateQueries({ queryKey: ['pipeline-stages'] });
      qc.invalidateQueries({ queryKey: ['automation-rules'] });

      setSaved(true);
      setTimeout(() => { setSaved(false); onClose(); }, 1000);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Failed to save stages.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Pipeline Stages"
      size="2xl"
      footer={
        <>
          <button type="button" onClick={onClose} className="btn-secondary btn-sm">Cancel</button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="btn-primary btn-sm flex items-center gap-1.5"
          >
            {saving ? (
              <><span className="w-3.5 h-3.5 border border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
            ) : saved ? (
              <><CheckCircle size={13} /> Saved</>
            ) : (
              'Save Stages'
            )}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div className="flex items-center gap-2 text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-lg">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Column headers */}
        <div className="grid grid-cols-[24px_1fr_130px_80px_80px_auto] gap-2 items-center text-[10px] font-semibold uppercase tracking-wide text-steel-400 px-1">
          <span></span>
          <span>Stage Name</span>
          <span>Colour</span>
          <span className="text-center">Won</span>
          <span className="text-center">Lost</span>
          <span></span>
        </div>

        {rows.map((s, idx) => {
          const meta = colorMeta(s.color);
          return (
            <div key={s.key} className="border border-steel-200 rounded-xl overflow-hidden">
              {/* Stage row */}
              <div className="grid grid-cols-[24px_1fr_130px_80px_80px_auto] gap-2 items-center px-3 py-2.5 bg-white">
                {/* Order buttons */}
                <div className="flex flex-col gap-0.5">
                  <button onClick={() => moveUp(idx)} disabled={idx === 0} className="text-steel-300 hover:text-steel-600 disabled:opacity-20">
                    <ChevronUp size={12} />
                  </button>
                  <button onClick={() => moveDown(idx)} disabled={idx === rows.length - 1} className="text-steel-300 hover:text-steel-600 disabled:opacity-20">
                    <ChevronDown size={12} />
                  </button>
                </div>

                {/* Name */}
                <input
                  className="input h-8 text-sm font-medium"
                  value={s.name}
                  onChange={(e) => update(s.key, { name: e.target.value })}
                  placeholder="Stage name…"
                />

                {/* Color */}
                <div className="flex items-center gap-1">
                  <select
                    className="select h-8 text-xs flex-1"
                    value={s.color}
                    onChange={(e) => update(s.key, { color: e.target.value })}
                  >
                    {COLOR_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.value.charAt(0).toUpperCase() + c.value.slice(1)}
                      </option>
                    ))}
                  </select>
                  <span className={`w-3 h-3 rounded-full flex-shrink-0 ${meta.dot}`} />
                </div>

                {/* Won toggle */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => update(s.key, { isWon: !s.isWon, isLost: s.isWon ? s.isLost : false })}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      s.isWon ? 'bg-green-500 border-green-500' : 'border-steel-300 bg-white'
                    }`}
                  >
                    {s.isWon && <CheckCircle size={11} className="text-white" />}
                  </button>
                </div>

                {/* Lost toggle */}
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => update(s.key, { isLost: !s.isLost, isWon: s.isLost ? s.isWon : false })}
                    className={`w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
                      s.isLost ? 'bg-red-400 border-red-400' : 'border-steel-300 bg-white'
                    }`}
                  >
                    {s.isLost && <CheckCircle size={11} className="text-white" />}
                  </button>
                </div>

                {/* Delete */}
                <button
                  onClick={() => removeStage(s.key)}
                  disabled={rows.length <= 1}
                  className="p-1 text-steel-300 hover:text-red-500 disabled:opacity-20 transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {/* Email notification row */}
              <div className={`px-3 py-2 border-t border-steel-100 flex items-center gap-3 ${s.emailEnabled ? 'bg-blue-50' : 'bg-steel-50'}`}>
                <Mail size={12} className={s.emailEnabled ? 'text-blue-500' : 'text-steel-400'} />
                <button
                  type="button"
                  role="switch"
                  aria-checked={s.emailEnabled}
                  onClick={() => update(s.key, { emailEnabled: !s.emailEnabled })}
                  className={`relative inline-flex h-4 w-7 flex-shrink-0 items-center rounded-full transition-colors ${
                    s.emailEnabled ? 'bg-blue-500' : 'bg-steel-300'
                  }`}
                >
                  <span className={`inline-block h-3 w-3 transform rounded-full bg-white shadow transition-transform ${
                    s.emailEnabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
                  }`} />
                </button>
                <span className={`text-xs ${s.emailEnabled ? 'text-blue-700 font-medium' : 'text-steel-400'}`}>
                  Email prospect when deal enters this stage
                </span>
                {s.emailEnabled && (
                  <input
                    className="input h-7 text-xs flex-1 ml-2"
                    value={s.emailSubject}
                    onChange={(e) => update(s.key, { emailSubject: e.target.value })}
                    placeholder={`Update on your enquiry — ${s.name}`}
                  />
                )}
              </div>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addStage}
          className="w-full flex items-center justify-center gap-1.5 py-2 border-2 border-dashed border-steel-200 rounded-xl text-sm text-steel-400 hover:border-primary-300 hover:text-primary-600 transition-colors"
        >
          <Plus size={13} /> Add Stage
        </button>

        <p className="text-xs text-steel-400 bg-steel-50 rounded-lg px-3 py-2">
          <strong>Won</strong> and <strong>Lost</strong> stages are special — they appear at the end of the board and are excluded from pipeline value calculations.
          Email notifications send automatically when a deal is dragged into that stage (if the prospect has an email address on file).
        </p>
      </div>
    </Modal>
  );
}

// ── Prospect Card ─────────────────────────────────────────────────────────────

function ProspectCard({
  p,
  onEdit,
  onDragStart,
  isWon,
  onConvert,
  isConverting,
}: {
  p: any;
  onEdit: () => void;
  onDragStart: (id: string) => void;
  isWon?: boolean;
  onConvert?: (id: string) => void;
  isConverting?: boolean;
}) {
  const navigate = useNavigate();
  const overdue  = p.nextFollowUp && new Date(p.nextFollowUp) < new Date();
  const value    = p.estimatedValue
    ? `$${(Number(p.estimatedValue) / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })}`
    : null;

  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onDragStart(p.id); }}
      className="group bg-white border border-steel-200 rounded-xl p-3 cursor-grab active:cursor-grabbing
                 hover:border-primary-300 hover:shadow-md transition-all duration-150 select-none"
    >
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

      {p.contactName && <div className="text-xs text-steel-500 mb-2">{p.contactName}</div>}

      {(value || p.probability != null) && (
        <div className="flex items-center justify-between gap-2 mb-2">
          <span className="text-xs font-mono font-semibold text-steel-800">{value ?? '—'}</span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <div className="w-14 h-1.5 bg-steel-100 rounded-full overflow-hidden">
              <div className="h-full bg-primary-500 rounded-full" style={{ width: `${p.probability ?? 0}%` }} />
            </div>
            <span className="text-[10px] text-steel-400 font-mono">{p.probability ?? 0}%</span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        {p.email && (
          <a href={`mailto:${p.email}`} onClick={(e) => e.stopPropagation()} className="text-steel-300 hover:text-blue-500 transition-colors"><Mail size={11} /></a>
        )}
        {p.phone && (
          <a href={`tel:${p.phone}`} onClick={(e) => e.stopPropagation()} className="text-steel-300 hover:text-green-500 transition-colors"><Phone size={11} /></a>
        )}
        {p.nextFollowUp && (
          <span className={`ml-auto flex items-center gap-1 text-[10px] font-medium ${overdue ? 'text-red-500' : 'text-steel-400'}`}>
            <Calendar size={9} />
            {format(new Date(p.nextFollowUp), 'dd MMM')}
          </span>
        )}
      </div>

      {isWon && onConvert && (
        <button
          onClick={(e) => { e.stopPropagation(); onConvert(p.id); }}
          disabled={isConverting}
          className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium text-green-700 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 transition-colors disabled:opacity-50"
        >
          <UserPlus size={11} /> {isConverting ? 'Converting…' : 'Convert to Customer'}
        </button>
      )}
    </div>
  );
}

// ── Kanban Column ─────────────────────────────────────────────────────────────

function KanbanColumn({
  stage, prospects, isDragOver,
  onDragOver, onDragLeave, onDrop, onEdit, onDragStart,
  onConvert, convertingId,
}: {
  stage: PipelineStage;
  prospects: any[];
  isDragOver: boolean;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onEdit: (p: any) => void;
  onDragStart: (id: string) => void;
  onConvert?: (id: string) => void;
  convertingId?: string | null;
}) {
  const meta    = colorMeta(stage.color);
  const total   = prospects.reduce((s, p) => s + Number(p.estimatedValue ?? 0), 0);
  const weighted = prospects.reduce((s, p) => s + Number(p.estimatedValue ?? 0) * (p.probability ?? 50) / 100, 0);

  return (
    <div className="flex flex-col flex-shrink-0 w-64">
      <div className={`${meta.bg} rounded-xl px-3 py-2.5 mb-2`}>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${meta.dot} flex-shrink-0`} />
            <span className={`text-xs font-semibold uppercase tracking-wide ${meta.text}`}>{stage.name}</span>
          </div>
          <span className="text-xs font-bold text-steel-500 bg-white/70 px-1.5 py-0.5 rounded-md">{prospects.length}</span>
        </div>
        {total > 0 && (
          <div className="text-[10px] text-steel-500 pl-4">
            ${(total / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} total
            {weighted !== total && (
              <span className="text-steel-400"> · ${(weighted / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} weighted</span>
            )}
          </div>
        )}
      </div>

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
            isWon={stage.isWon}
            onConvert={stage.isWon ? onConvert : undefined}
            isConverting={convertingId === p.id}
          />
        ))}
      </div>
    </div>
  );
}

// ── Prospect Form Modal ───────────────────────────────────────────────────────

const BLANK = {
  companyName: '', contactName: '', email: '', phone: '', stage: '',
  estimatedValue: '', probability: 50, nextFollowUp: '', notes: '', industry: '',
};

function ProspectModal({
  open, onClose, editing, stages,
}: {
  open: boolean;
  onClose: () => void;
  editing: any | null;
  stages: PipelineStage[];
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({ ...BLANK, stage: stages[0]?.name ?? 'LEAD' });

  // sync when editing changes
  useState(() => {
    if (editing) {
      setForm({
        companyName:    editing.companyName,
        contactName:    editing.contactName ?? '',
        email:          editing.email       ?? '',
        phone:          editing.phone       ?? '',
        stage:          editing.stage,
        estimatedValue: editing.estimatedValue
          ? (Number(editing.estimatedValue) / 100).toFixed(0)
          : '',
        probability:    editing.probability ?? 50,
        nextFollowUp:   editing.nextFollowUp?.split('T')[0] ?? '',
        notes:          editing.notes ?? '',
        industry:       editing.industry ?? '',
      });
    } else {
      setForm({ ...BLANK, stage: stages[0]?.name ?? 'LEAD' });
    }
  });

  const { mutate: save, isPending } = useMutation({
    mutationFn: () => editing
      ? crmApi.updateProspect(editing.id, form)
      : crmApi.createProspect(form),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      onClose();
    },
  });

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit Deal' : 'New Deal'}
      size="lg"
      footer={
        <>
          <button className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!form.companyName || isPending} onClick={() => save()}>
            {isPending ? 'Saving…' : editing ? 'Save Changes' : 'Create Deal'}
          </button>
        </>
      }
    >
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
              {stages.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
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
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            placeholder="Meeting notes, requirements, key contacts…" />
        </div>
      </div>
    </Modal>
  );
}

// ── PipelinePage ──────────────────────────────────────────────────────────────

export function PipelinePage() {
  const qc = useQueryClient();
  const [dealModalOpen,  setDealModalOpen]  = useState(false);
  const [stageModalOpen, setStageModalOpen] = useState(false);
  const [editing,        setEditing]        = useState<any | null>(null);
  const [dragOverStage,  setDragOverStage]  = useState<string | null>(null);
  const draggingId = useRef<string | null>(null);

  const { data: stagesData, isLoading: stagesLoading } = useQuery({
    queryKey: ['pipeline-stages'],
    queryFn:  () => crmApi.listStages().then((r) => r.data as PipelineStage[]),
  });

  const { data: prospectsData, isLoading: prospectsLoading } = useQuery({
    queryKey: ['prospects'],
    queryFn:  () => crmApi.listProspects({ limit: 500 }).then((r) => r.data),
  });

  const { data: rulesData } = useQuery({
    queryKey: ['automation-rules'],
    queryFn:  () => automationApi.listRules().then((r) => r.data as EmailAutomationRule[]),
  });

  const [convertingId, setConvertingId] = useState<string | null>(null);

  const stageMutation = useMutation({
    mutationFn: ({ id, stage }: { id: string; stage: string }) =>
      crmApi.changeStage(id, stage),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prospects'] }),
  });

  const convertMutation = useMutation({
    mutationFn: (id: string) => crmApi.convertProspect(id),
    onMutate: (id) => setConvertingId(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prospects'] });
      setConvertingId(null);
    },
    onError: () => setConvertingId(null),
  });

  const stages:    PipelineStage[]   = stagesData    ?? [];
  const prospects: any[]             = (prospectsData as any)?.data ?? [];
  const rules:     EmailAutomationRule[] = rulesData ?? [];

  const isLoading = stagesLoading || prospectsLoading;

  function openCreate() { setEditing(null); setDealModalOpen(true); }
  function openEdit(p: any) { setEditing(p); setDealModalOpen(true); }

  // Partition prospects by stage
  const byStage = Object.fromEntries(
    stages.map((s) => [s.name, prospects.filter((p) => p.stage === s.name)]),
  );
  // Active = not won/lost
  const activeProspects   = prospects.filter((p) => !stages.find((s) => s.name === p.stage)?.isWon && !stages.find((s) => s.name === p.stage)?.isLost);
  const weightedPipeline  = activeProspects.reduce((s, p) => s + Number(p.estimatedValue ?? 0) * (p.probability ?? 50) / 100, 0);
  const totalPipeline     = activeProspects.reduce((s, p) => s + Number(p.estimatedValue ?? 0), 0);

  function handleDrop(stageName: string) {
    const id = draggingId.current;
    if (id) stageMutation.mutate({ id, stage: stageName });
    draggingId.current = null;
    setDragOverStage(null);
  }

  // Stages with email configured
  const stagesWithEmail = stages.filter((s) => {
    const trigger = `CRM_STAGE_${s.name.toUpperCase()}`;
    return rules.find((r) => r.trigger === trigger)?.isEnabled;
  });

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
                <span className="inline-flex items-center gap-1"><DollarSign size={11} />{(totalPipeline / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} total</span>
                {' '}·{' '}
                <span className="inline-flex items-center gap-1"><Percent size={11} />{(weightedPipeline / 100).toLocaleString('en-AU', { maximumFractionDigits: 0 })} weighted</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Email notification indicator */}
          {stagesWithEmail.length > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 border border-blue-200 px-2.5 py-1.5 rounded-lg">
              <Mail size={11} />
              Emails active on {stagesWithEmail.length} stage{stagesWithEmail.length !== 1 ? 's' : ''}
            </div>
          )}
          <button className="btn-secondary btn-sm flex items-center gap-1.5" onClick={() => setStageModalOpen(true)}>
            <Settings2 size={13} /> Edit Stages
          </button>
          <button className="btn-primary btn-sm" onClick={openCreate}>
            <Plus size={13} /> New Deal
          </button>
        </div>
      </div>

      {/* KPI strip */}
      <div className="flex gap-3 mb-4 flex-shrink-0 flex-wrap">
        {stages.map((stage) => {
          const meta  = colorMeta(stage.color);
          const count = (byStage[stage.name] ?? []).length;
          return (
            <div key={stage.name} className={`stat-card flex-1 min-w-[80px] ${meta.bg} border-0`}>
              <div className={`text-lg font-bold tabular-nums ${meta.text}`}>{count}</div>
              <div className="text-xs text-steel-500 truncate">{stage.name}</div>
            </div>
          );
        })}
      </div>

      {/* Board */}
      {isLoading ? (
        <div className="flex gap-3 overflow-x-auto pb-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-64">
              <div className="skeleton h-16 w-full rounded-xl mb-2" />
              {Array.from({ length: 2 }).map((__, j) => <div key={j} className="skeleton h-24 w-full rounded-xl mb-2" />)}
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-3 overflow-x-auto pb-4 flex-1 items-start">
          {stages.map((stage) => (
            <KanbanColumn
              key={stage.name}
              stage={stage}
              prospects={byStage[stage.name] ?? []}
              isDragOver={dragOverStage === stage.name}
              onDragOver={(e) => { e.preventDefault(); setDragOverStage(stage.name); }}
              onDragLeave={() => setDragOverStage(null)}
              onDrop={() => handleDrop(stage.name)}
              onEdit={openEdit}
              onDragStart={(id) => { draggingId.current = id; }}
              onConvert={(id) => convertMutation.mutate(id)}
              convertingId={convertingId}
            />
          ))}
        </div>
      )}

      {!isLoading && prospects.length === 0 && (
        <div className="empty-state mt-8">
          <div className="empty-state-icon"><TrendingUp size={22} /></div>
          <p className="text-sm font-medium">No deals in the pipeline yet</p>
          <button className="btn-primary btn-sm mt-3" onClick={openCreate}><Plus size={12} /> Add first deal</button>
        </div>
      )}

      <ProspectModal
        open={dealModalOpen}
        onClose={() => { setDealModalOpen(false); setEditing(null); }}
        editing={editing}
        stages={stages}
      />

      {stageModalOpen && (
        <StageEditorModal
          open={stageModalOpen}
          onClose={() => setStageModalOpen(false)}
          stages={stages}
          automationRules={rules}
        />
      )}
    </div>
  );
}
