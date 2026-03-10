import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { processingApi } from '../../services/api';
import { ArrowLeft, Play, Pause, CheckCircle, XCircle, Clock, Wrench } from 'lucide-react';
import { useState } from 'react';
import { format } from 'date-fns';
import { Modal } from '../../components/ui/Modal';

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'badge-gray', SCHEDULED: 'badge-blue', IN_PROGRESS: 'badge-amber',
  ON_HOLD: 'badge-yellow', COMPLETED: 'badge-green', CANCELLED: 'badge-red',
};

const STATUS_TRANSITIONS: Record<string, string[]> = {
  DRAFT:       ['SCHEDULED','CANCELLED'],
  SCHEDULED:   ['IN_PROGRESS','ON_HOLD','CANCELLED'],
  IN_PROGRESS: ['ON_HOLD','COMPLETED','CANCELLED'],
  ON_HOLD:     ['IN_PROGRESS','CANCELLED'],
  COMPLETED:   [],
  CANCELLED:   [],
};

function fmtMoney(cents: number) { return `$${(cents / 100).toLocaleString('en-AU', { minimumFractionDigits: 2 })}` }

export function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: wo, isLoading } = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => processingApi.getWorkOrder(id!).then((r) => r.data),
    enabled: !!id,
  });

  const [statusModal, setStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeForm, setTimeForm] = useState({ hours: '', notes: '' });

  const statusMutation = useMutation({
    mutationFn: (status: string) => processingApi.updateStatus(id!, status),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-order', id] }); setStatusModal(false); },
  });

  const timeMutation = useMutation({
    mutationFn: () => processingApi.addTimeEntry({ workOrderId: id!, ...timeForm }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['work-order', id] }); setTimeOpen(false); setTimeForm({ hours: '', notes: '' }); },
  });

  if (isLoading) return (
    <div className="max-w-[1100px] mx-auto animate-fade-in space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded" />)}
    </div>
  );

  const w = wo as any;
  const status = w?.status ?? 'DRAFT';
  const transitions = STATUS_TRANSITIONS[status] ?? [];
  const operations: any[] = w?.operations ?? [];
  const timeLogs: any[] = w?.timeLogs ?? [];
  const totalHours = timeLogs.reduce((s: number, t: any) => s + (t.hours ?? 0), 0);

  return (
    <div className="max-w-[1100px] mx-auto animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <button className="btn-ghost btn-sm" onClick={() => navigate('/processing/work-orders')}><ArrowLeft size={13} /> Work Orders</button>
      </div>

      <div className="page-header mt-2">
        <div>
          <h1 className="page-title">{w?.workOrderNumber ?? '—'}</h1>
          <p className="page-subtitle">
            {w?.salesOrder?.customer?.name ?? 'Internal'} · {w?.salesOrder?.orderNumber ?? ''}
            {w?.scheduledDate ? ` · scheduled ${format(new Date(w.scheduledDate), 'dd MMM yyyy')}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={STATUS_BADGE[status] ?? 'badge-gray'}>{status.replace(/_/g,' ')}</span>
          {transitions.includes('IN_PROGRESS') && status !== 'IN_PROGRESS' && (
            <button className="btn-amber btn-sm" onClick={() => statusMutation.mutate('IN_PROGRESS')} disabled={statusMutation.isPending}>
              <Play size={12} /> Start
            </button>
          )}
          {transitions.includes('ON_HOLD') && (
            <button className="btn-secondary btn-sm" onClick={() => statusMutation.mutate('ON_HOLD')} disabled={statusMutation.isPending}>
              <Pause size={12} /> Hold
            </button>
          )}
          {transitions.includes('COMPLETED') && (
            <button className="btn-primary btn-sm" onClick={() => statusMutation.mutate('COMPLETED')} disabled={statusMutation.isPending}>
              <CheckCircle size={12} /> Complete
            </button>
          )}
          {transitions.length > 0 && (
            <button className="btn-secondary btn-sm" onClick={() => { setNewStatus(transitions[0]); setStatusModal(true); }}>
              Update Status
            </button>
          )}
          <button className="btn-secondary btn-sm" onClick={() => setTimeOpen(true)}>
            <Clock size={12} /> Log Time
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Operations */}
        <div className="col-span-2 space-y-4">
          {operations.length > 0 && (
            <div className="card">
              <div className="card-header"><span className="text-sm font-semibold">Operations</span></div>
              <div className="table-container rounded-b-xl">
                <table className="table">
                  <thead><tr><th>#</th><th>Operation</th><th>Work Centre</th><th>Est. Hours</th><th>Actual Hrs</th><th>Status</th></tr></thead>
                  <tbody>
                    {operations.map((op: any, i: number) => (
                      <tr key={op.id ?? i}>
                        <td className="text-xs text-muted-foreground">{i + 1}</td>
                        <td className="font-medium text-sm">{op.name ?? op.operation}</td>
                        <td className="text-xs text-muted-foreground">{op.workCenter?.name ?? '—'}</td>
                        <td className="text-right font-mono text-xs">{op.estimatedHours?.toFixed(1) ?? '—'}</td>
                        <td className="text-right font-mono text-xs">{op.actualHours?.toFixed(1) ?? '0.0'}</td>
                        <td><span className={STATUS_BADGE[op.status] ?? 'badge-gray'}>{op.status?.replace(/_/g,' ') ?? '—'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Time Logs */}
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Time Logs</span>
              <span className="text-xs text-muted-foreground">{totalHours.toFixed(1)} hrs total</span>
            </div>
            {timeLogs.length === 0 ? (
              <div className="card-body text-center text-sm text-muted-foreground py-8">No time logged yet</div>
            ) : (
              <div className="table-container rounded-b-xl">
                <table className="table">
                  <thead><tr><th>Date</th><th>User</th><th className="text-right">Hours</th><th>Notes</th></tr></thead>
                  <tbody>
                    {timeLogs.map((t: any, i: number) => (
                      <tr key={t.id ?? i}>
                        <td className="text-xs text-steel-500">{t.logDate ? format(new Date(t.logDate), 'dd MMM yyyy') : '—'}</td>
                        <td className="text-sm">{t.user?.name ?? t.userName ?? '—'}</td>
                        <td className="text-right font-mono text-sm font-semibold">{t.hours?.toFixed(1)}</td>
                        <td className="text-xs text-muted-foreground">{t.notes ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {w?.notes && (
            <div className="card">
              <div className="card-header"><span className="text-sm font-semibold">Notes</span></div>
              <div className="card-body text-sm text-steel-700 whitespace-pre-wrap">{w.notes}</div>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          <div className="card">
            <div className="card-header"><span className="text-sm font-semibold">Details</span></div>
            <div className="card-body space-y-2 text-xs">
              <div className="flex justify-between"><span className="text-muted-foreground">WO #</span><span className="font-mono">{w?.workOrderNumber}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Priority</span>
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white ${(w?.priority ?? 3) <= 2 ? 'bg-green-500' : (w?.priority ?? 3) === 3 ? 'bg-amber-500' : 'bg-red-500'}`}>
                  {w?.priority ?? 3}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{w?.salesOrder?.customer?.name ?? 'Internal'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sales Order</span><span className="font-mono">{w?.salesOrder?.orderNumber ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Scheduled</span><span>{w?.scheduledDate ? format(new Date(w.scheduledDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Due</span><span>{w?.dueDate ? format(new Date(w.dueDate), 'dd MMM yyyy') : '—'}</span></div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><Wrench size={13} /><span className="text-sm font-semibold ml-1">Time Summary</span></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Estimated</span><span className="font-mono">{w?.estimatedHours?.toFixed(1) ?? '—'} hrs</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Actual</span><span className="font-mono font-bold">{totalHours.toFixed(1)} hrs</span></div>
              {w?.estimatedHours && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Progress</span>
                    <span>{Math.min(100, Math.round((totalHours / w.estimatedHours) * 100))}%</span>
                  </div>
                  <div className="h-2 bg-steel-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-600 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (totalHours / w.estimatedHours) * 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Status Modal */}
      <Modal open={statusModal} onClose={() => setStatusModal(false)} title="Update Status"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setStatusModal(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={() => statusMutation.mutate(newStatus)} disabled={statusMutation.isPending}>
            {statusMutation.isPending ? 'Updating…' : 'Update'}
          </button>
        </>}>
        <div className="form-group">
          <label className="label">New Status</label>
          <select className="select" value={newStatus} onChange={(e) => setNewStatus(e.target.value)}>
            {transitions.map((s) => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </select>
        </div>
      </Modal>

      {/* Time Log Modal */}
      <Modal open={timeOpen} onClose={() => setTimeOpen(false)} title="Log Time"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setTimeOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!timeForm.hours || timeMutation.isPending} onClick={() => timeMutation.mutate()}>
            {timeMutation.isPending ? 'Logging…' : 'Log Time'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Hours *</label>
            <input type="number" className="input" step="0.25" min="0.25" value={timeForm.hours}
              onChange={(e) => setTimeForm({ ...timeForm, hours: e.target.value })} placeholder="e.g. 2.5" />
          </div>
          <div className="form-group">
            <label className="label">Notes</label>
            <textarea className="input min-h-[70px] resize-none" value={timeForm.notes}
              onChange={(e) => setTimeForm({ ...timeForm, notes: e.target.value })} placeholder="What was done…" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
