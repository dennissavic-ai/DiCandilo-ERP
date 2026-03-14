import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import { processingApi } from '../../services/api';
import { ArrowLeft, Play, Pause, CheckCircle, XCircle, Clock, Wrench, Truck, Plus, Trash2 } from 'lucide-react';
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

export function WorkOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: wo, isLoading } = useQuery({
    queryKey: ['work-order', id],
    queryFn: () => processingApi.getWorkOrder(id!).then((r) => r.data),
    enabled: !!id,
  });

  const { data: workCentersRaw } = useQuery({
    queryKey: ['work-centers'],
    queryFn: () => processingApi.listWorkCenters().then((r) => r.data),
  });
  const workCenters: any[] = (workCentersRaw as any) ?? [];

  const [statusModal, setStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState('');
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeForm, setTimeForm] = useState({ hours: '', notes: '' });
  const [shipmentModalOpen, setShipmentModalOpen] = useState(false);
  const [shipmentSuccess, setShipmentSuccess] = useState<{ id: string } | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const [actionForm, setActionForm] = useState({ operation: '', description: '', workCenterId: '', estimatedMinutes: '', qtyRequired: '1' });

  const invalidateWO = () => qc.invalidateQueries({ queryKey: ['work-order', id] });

  const statusMutation = useMutation({
    mutationFn: (status: string) => processingApi.updateStatus(id!, status),
    onSuccess: () => { invalidateWO(); setStatusModal(false); },
  });

  const timeMutation = useMutation({
    mutationFn: () => processingApi.addTimeEntry({ workOrderId: id!, ...timeForm }),
    onSuccess: () => { invalidateWO(); setTimeOpen(false); setTimeForm({ hours: '', notes: '' }); },
  });

  const shipmentMutation = useMutation({
    mutationFn: () => processingApi.createShipment({
      workOrderId: id,
      salesOrderId: (wo as any)?.salesOrder?.id,
    }),
    onSuccess: (res) => {
      invalidateWO();
      setShipmentModalOpen(false);
      setShipmentSuccess({ id: (res.data as any).id });
    },
  });

  const addLineMutation = useMutation({
    mutationFn: () => processingApi.addLine(id!, {
      operation: actionForm.operation,
      description: actionForm.description || undefined,
      workCenterId: actionForm.workCenterId || undefined,
      estimatedMinutes: actionForm.estimatedMinutes ? Number(actionForm.estimatedMinutes) : undefined,
      qtyRequired: Number(actionForm.qtyRequired) || 1,
    }),
    onSuccess: () => {
      invalidateWO();
      setActionOpen(false);
      setActionForm({ operation: '', description: '', workCenterId: '', estimatedMinutes: '', qtyRequired: '1' });
    },
  });

  const deleteLineMutation = useMutation({
    mutationFn: (lineId: string) => processingApi.deleteLine(id!, lineId),
    onSuccess: invalidateWO,
  });

  if (isLoading) return (
    <div className="max-w-[1100px] mx-auto animate-fade-in space-y-4">
      {[...Array(3)].map((_, i) => <div key={i} className="skeleton h-16 w-full rounded" />)}
    </div>
  );

  const w = wo as any;
  const status = w?.status ?? 'DRAFT';
  const transitions = STATUS_TRANSITIONS[status] ?? [];
  const canShip = status === 'COMPLETED';
  const lines: any[] = w?.lines ?? [];
  const timeLogs: any[] = w?.timeEntries ?? [];
  const totalEstMins = lines.reduce((s: number, l: any) => s + (l.estimatedMinutes ?? 0), 0);
  const totalActMins = lines.reduce((s: number, l: any) => s + (l.actualMinutes ?? 0), 0);
  const totalEstHours = totalEstMins / 60;
  const totalActHours = totalActMins / 60;

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
          {canShip && (
            <button className="btn-amber btn-sm" onClick={() => setShipmentModalOpen(true)}>
              <Truck size={12} /> Create Shipment
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Actions / Operations */}
        <div className="lg:col-span-2 space-y-4">
          <div className="card">
            <div className="card-header flex items-center justify-between">
              <span className="text-sm font-semibold">Actions</span>
              <button className="btn-secondary btn-sm" onClick={() => setActionOpen(true)}>
                <Plus size={12} /> Add Action
              </button>
            </div>
            {lines.length === 0 ? (
              <div className="card-body text-center text-sm text-muted-foreground py-8">
                No actions yet. Add actions to define the steps required to complete this job.
              </div>
            ) : (
              <div className="table-container rounded-b-xl">
                <table className="table">
                  <thead><tr><th>#</th><th>Action</th><th>Work Centre</th><th>Qty</th><th>Est. Time</th><th>Actual</th><th></th></tr></thead>
                  <tbody>
                    {lines.map((line: any, i: number) => (
                      <tr key={line.id}>
                        <td className="text-xs text-muted-foreground">{line.lineNumber ?? i + 1}</td>
                        <td>
                          <div className="font-medium text-sm">{line.operation}</div>
                          {line.description && <div className="text-xs text-muted-foreground mt-0.5">{line.description}</div>}
                        </td>
                        <td className="text-xs text-muted-foreground">{line.workCenter?.name ?? '—'}</td>
                        <td className="text-right font-mono text-xs">{Number(line.qtyRequired)}</td>
                        <td className="text-right font-mono text-xs">
                          {line.estimatedMinutes ? `${line.estimatedMinutes}m` : '—'}
                        </td>
                        <td className="text-right font-mono text-xs">
                          {line.actualMinutes ? `${line.actualMinutes}m` : '—'}
                        </td>
                        <td className="text-right">
                          <button
                            className="text-steel-300 hover:text-red-500 transition-colors"
                            onClick={() => deleteLineMutation.mutate(line.id)}
                            disabled={deleteLineMutation.isPending}
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Time Logs */}
          <div className="card">
            <div className="card-header">
              <span className="text-sm font-semibold">Time Logs</span>
              <span className="text-xs text-muted-foreground">{totalActHours.toFixed(1)} hrs total</span>
            </div>
            {timeLogs.length === 0 ? (
              <div className="card-body text-center text-sm text-muted-foreground py-8">No time logged yet</div>
            ) : (
              <div className="table-container rounded-b-xl">
                <table className="table">
                  <thead><tr><th>Date</th><th>Type</th><th className="text-right">Duration</th><th>Notes</th></tr></thead>
                  <tbody>
                    {timeLogs.map((t: any, i: number) => (
                      <tr key={t.id ?? i}>
                        <td className="text-xs text-steel-500">{t.startTime ? format(new Date(t.startTime), 'dd MMM yyyy HH:mm') : '—'}</td>
                        <td className="text-sm"><span className={t.eventType === 'CHECK_IN' ? 'badge-green' : 'badge-gray'}>{t.eventType?.replace('_', ' ') ?? '—'}</span></td>
                        <td className="text-right font-mono text-sm">{t.durationMinutes ? `${t.durationMinutes}m` : '—'}</td>
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
                <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[11px] font-bold text-white ${(w?.priority ?? 5) <= 3 ? 'bg-green-500' : (w?.priority ?? 5) <= 6 ? 'bg-amber-500' : 'bg-red-500'}`}>
                  {w?.priority ?? 5}
                </span>
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">Customer</span><span className="font-medium">{w?.salesOrder?.customer?.name ?? 'Internal'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Sales Order</span><span className="font-mono">{w?.salesOrder?.orderNumber ?? '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Scheduled</span><span>{w?.scheduledDate ? format(new Date(w.scheduledDate), 'dd MMM yyyy') : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Actions</span><span className="font-mono">{lines.length}</span></div>
            </div>
          </div>

          <div className="card">
            <div className="card-header"><Wrench size={13} /><span className="text-sm font-semibold ml-1">Time Summary</span></div>
            <div className="card-body space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Estimated</span><span className="font-mono">{totalEstMins > 0 ? `${totalEstHours.toFixed(1)} hrs` : '—'}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Actual</span><span className="font-mono font-bold">{totalActHours.toFixed(1)} hrs</span></div>
              {totalEstMins > 0 && (
                <div className="mt-2">
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-muted-foreground">Progress</span>
                    <span>{Math.min(100, Math.round((totalActMins / totalEstMins) * 100))}%</span>
                  </div>
                  <div className="h-2 bg-steel-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-600 rounded-full transition-all"
                      style={{ width: `${Math.min(100, (totalActMins / totalEstMins) * 100)}%` }} />
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

      {/* Add Action Modal */}
      <Modal open={actionOpen} onClose={() => setActionOpen(false)} title="Add Action"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setActionOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" disabled={!actionForm.operation || addLineMutation.isPending} onClick={() => addLineMutation.mutate()}>
            {addLineMutation.isPending ? 'Adding…' : 'Add Action'}
          </button>
        </>}>
        <div className="space-y-4">
          <div className="form-group">
            <label className="label">Operation *</label>
            <input className="input" value={actionForm.operation}
              onChange={(e) => setActionForm({ ...actionForm, operation: e.target.value })}
              placeholder="e.g. Cut to size, Drill holes, Bend…" />
          </div>
          <div className="form-group">
            <label className="label">Description</label>
            <textarea className="input min-h-[60px] resize-none" value={actionForm.description}
              onChange={(e) => setActionForm({ ...actionForm, description: e.target.value })}
              placeholder="Additional details…" />
          </div>
          <div className="form-group">
            <label className="label">Work Centre</label>
            <select className="input" value={actionForm.workCenterId} onChange={(e) => setActionForm({ ...actionForm, workCenterId: e.target.value })}>
              <option value="">None</option>
              {workCenters.map((wc: any) => (
                <option key={wc.id} value={wc.id}>{wc.code} — {wc.name}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="form-group">
              <label className="label">Qty Required</label>
              <input type="number" className="input" min="1" value={actionForm.qtyRequired}
                onChange={(e) => setActionForm({ ...actionForm, qtyRequired: e.target.value })} />
            </div>
            <div className="form-group">
              <label className="label">Est. Minutes</label>
              <input type="number" className="input" min="0" step="15" value={actionForm.estimatedMinutes}
                onChange={(e) => setActionForm({ ...actionForm, estimatedMinutes: e.target.value })}
                placeholder="e.g. 60" />
            </div>
          </div>
        </div>
      </Modal>

      {/* Create Shipment Modal */}
      <Modal open={shipmentModalOpen} onClose={() => setShipmentModalOpen(false)} title="Create Shipment"
        footer={<>
          <button className="btn-secondary btn-sm" onClick={() => setShipmentModalOpen(false)}>Cancel</button>
          <button className="btn-primary btn-sm" onClick={() => shipmentMutation.mutate()} disabled={shipmentMutation.isPending}>
            {shipmentMutation.isPending ? 'Creating…' : 'Create Shipment'}
          </button>
        </>}>
        <div className="text-sm text-steel-700 space-y-2">
          <p>Create a shipping manifest for work order <strong>{w?.workOrderNumber}</strong>.</p>
          {w?.salesOrder?.orderNumber && (
            <p className="text-xs text-muted-foreground">Linked to sales order: <strong>{w.salesOrder.orderNumber}</strong></p>
          )}
          {w?.salesOrder?.customer?.name && (
            <p className="text-xs text-muted-foreground">Customer: <strong>{w.salesOrder.customer.name}</strong></p>
          )}
        </div>
      </Modal>

      {/* Shipment Success Modal */}
      <Modal open={!!shipmentSuccess} onClose={() => setShipmentSuccess(null)} title="Shipment Created">
        <div className="text-sm text-steel-700 space-y-3">
          <p>Shipment has been created successfully.</p>
          {w?.salesOrder?.id && (
            <button
              className="inline-flex items-center gap-1.5 text-blue-600 hover:underline font-medium text-sm"
              onClick={() => navigate(`/sales/orders/${w.salesOrder.id}`)}
            >
              <Truck size={13} /> View Sales Order
            </button>
          )}
        </div>
      </Modal>
    </div>
  );
}
