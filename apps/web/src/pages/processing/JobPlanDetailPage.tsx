import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { planningApi } from '../../services/api';
import {
  ArrowLeft, Users, Wrench, ListChecks, Sparkles,
  Plus, Trash2, CheckSquare, Square, Loader2, Calendar,
  Clock, ChevronRight, AlertCircle,
} from 'lucide-react';
import { useAuthStore } from '../../store/authStore';

const STATUS_OPTIONS = [
  { value: 'DRAFT',     label: 'Draft',     desc: 'Plan is being built' },
  { value: 'READY',     label: 'Ready',     desc: 'Plan is complete and ready to schedule' },
  { value: 'SCHEDULED', label: 'Scheduled', desc: 'Time blocks assigned on the schedule' },
];

export function JobPlanDetailPage() {
  const { workOrderId } = useParams<{ workOrderId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['job-plan', workOrderId],
    queryFn: () => planningApi.getPlan(workOrderId!).then((r) => r.data),
    enabled: !!workOrderId,
  });

  const workOrder = data?.workOrder;
  const plan = data?.plan;

  const refetch = () => qc.invalidateQueries({ queryKey: ['job-plan', workOrderId] });

  // ── Status update ──────────────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: (status: string) => planningApi.updateStatus(plan!.id, status),
    onSuccess: refetch,
  });

  // ── Roles ──────────────────────────────────────────────────────────────────
  const [roleForm, setRoleForm] = useState({ roleName: '', estimatedHours: 1, notes: '' });
  const [showRoleForm, setShowRoleForm] = useState(false);

  const addRole = useMutation({
    mutationFn: () => planningApi.addRole(plan!.id, roleForm),
    onSuccess: () => { refetch(); setRoleForm({ roleName: '', estimatedHours: 1, notes: '' }); setShowRoleForm(false); },
  });

  const deleteRole = useMutation({
    mutationFn: (roleId: string) => planningApi.deleteRole(plan!.id, roleId),
    onSuccess: refetch,
  });

  // ── Equipment ──────────────────────────────────────────────────────────────
  const { data: workCentersData } = useQuery({
    queryKey: ['planning-work-centers'],
    queryFn: () => planningApi.listWorkCenters().then((r) => r.data),
  });
  const workCenters: any[] = workCentersData ?? [];

  const [equipForm, setEquipForm] = useState({ workCenterId: '', estimatedMinutes: 60, sequenceOrder: 1, notes: '' });
  const [showEquipForm, setShowEquipForm] = useState(false);

  const addEquipment = useMutation({
    mutationFn: () => planningApi.addEquipment(plan!.id, equipForm),
    onSuccess: () => { refetch(); setEquipForm({ workCenterId: '', estimatedMinutes: 60, sequenceOrder: 1, notes: '' }); setShowEquipForm(false); },
  });

  const deleteEquipment = useMutation({
    mutationFn: (equipId: string) => planningApi.deleteEquipment(plan!.id, equipId),
    onSuccess: refetch,
  });

  // ── Tasks ──────────────────────────────────────────────────────────────────
  const [taskTitle, setTaskTitle] = useState('');
  const [showTaskForm, setShowTaskForm] = useState(false);

  const addTask = useMutation({
    mutationFn: () => planningApi.addTask(plan!.id, { title: taskTitle, sortOrder: plan?.tasks?.length ?? 0 }),
    onSuccess: () => { refetch(); setTaskTitle(''); setShowTaskForm(false); },
  });

  const toggleTask = useMutation({
    mutationFn: ({ taskId, isComplete }: { taskId: string; isComplete: boolean }) =>
      planningApi.toggleTask(plan!.id, taskId, isComplete),
    onSuccess: refetch,
  });

  const deleteTask = useMutation({
    mutationFn: (taskId: string) => planningApi.deleteTask(plan!.id, taskId),
    onSuccess: refetch,
  });

  // ── AI Schedule ────────────────────────────────────────────────────────────
  const [scheduling, setScheduling] = useState(false);
  const [scheduleResult, setScheduleResult] = useState<string | null>(null);

  async function runAiSchedule() {
    if (!workOrderId) return;
    setScheduling(true);
    setScheduleResult(null);
    try {
      const token = useAuthStore.getState().accessToken ?? '';
      const res = await fetch('/api/v1/ai/schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ workOrderIds: [workOrderId] }),
      });
      if (!res.ok || !res.body) throw new Error(await res.text() || 'Schedule request failed');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let finalMsg = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.type === 'done') finalMsg = evt.message ?? 'Schedule updated.';
            if (evt.type === 'error') throw new Error(evt.message);
          } catch { /* skip */ }
        }
      }
      setScheduleResult(finalMsg || 'AI scheduling complete. Schedule blocks created.');
      refetch();
    } catch (err) {
      setScheduleResult(err instanceof Error ? err.message : 'Scheduling failed.');
    } finally {
      setScheduling(false);
    }
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading plan…
      </div>
    );
  }

  if (!workOrder || !plan) {
    return <div className="p-6 text-red-600">Work order not found.</div>;
  }

  const completedTasks = plan.tasks?.filter((t: any) => t.isComplete).length ?? 0;
  const totalTasks = plan.tasks?.length ?? 0;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <button
          onClick={() => navigate('/processing/planning')}
          className="mt-0.5 p-1.5 rounded-lg hover:bg-muted/60 text-muted-foreground transition-colors"
        >
          <ArrowLeft size={16} />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-foreground">{workOrder.workOrderNumber}</h1>
            <span className="badge badge-secondary text-xs">{workOrder.status?.replace('_', ' ')}</span>
          </div>
          {workOrder.salesOrder && (
            <p className="text-sm text-muted-foreground mt-0.5">
              {workOrder.salesOrder.orderNumber} · {workOrder.salesOrder.customer?.name}
            </p>
          )}
          {workOrder.scheduledDate && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Calendar size={11} /> Scheduled {new Date(workOrder.scheduledDate).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Plan status selector */}
        <div className="flex items-center gap-2">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => updateStatus.mutate(opt.value)}
              disabled={plan.status === opt.value || updateStatus.isPending}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors
                ${plan.status === opt.value
                  ? 'bg-primary-700 text-white border-primary-700'
                  : 'bg-background text-muted-foreground border-border hover:border-primary-300 hover:text-primary-700'}`}
              title={opt.desc}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Work order context: lines */}
      {workOrder.lines?.length > 0 && (
        <div className="rounded-xl border border-border bg-muted/20 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">Work Order Lines</p>
          <div className="space-y-1">
            {workOrder.lines.map((line: any) => (
              <div key={line.id} className="flex items-center gap-3 text-sm">
                <ChevronRight size={12} className="text-muted-foreground shrink-0" />
                <span className="font-medium text-foreground">{line.operation}</span>
                {line.description && <span className="text-muted-foreground">{line.description}</span>}
                {line.estimatedMinutes && (
                  <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock size={10} /> {line.estimatedMinutes}min est.
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Roles */}
        <section className="rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Users size={14} className="text-primary-600" />
              <span className="text-sm font-semibold">Roles Required</span>
              <span className="text-xs text-muted-foreground">({plan.roles?.length ?? 0})</span>
            </div>
            <button
              onClick={() => setShowRoleForm((v) => !v)}
              className="text-xs text-primary-700 hover:text-primary-900 flex items-center gap-1"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {showRoleForm && (
            <div className="p-3 border-b border-border bg-muted/20 space-y-2">
              <input
                className="input input-sm w-full"
                placeholder="Role name (e.g. CNC Operator)"
                value={roleForm.roleName}
                onChange={(e) => setRoleForm((f) => ({ ...f, roleName: e.target.value }))}
              />
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">Est. Hours</label>
                  <input
                    type="number"
                    min={0}
                    step={0.5}
                    className="input input-sm w-full"
                    value={roleForm.estimatedHours}
                    onChange={(e) => setRoleForm((f) => ({ ...f, estimatedHours: parseFloat(e.target.value) || 0 }))}
                  />
                </div>
              </div>
              <input
                className="input input-sm w-full"
                placeholder="Notes (optional)"
                value={roleForm.notes}
                onChange={(e) => setRoleForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowRoleForm(false)} className="btn-ghost btn-xs">Cancel</button>
                <button
                  onClick={() => addRole.mutate()}
                  disabled={!roleForm.roleName || addRole.isPending}
                  className="btn-primary btn-xs"
                >
                  {addRole.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Add Role'}
                </button>
              </div>
            </div>
          )}

          <div className="divide-y divide-border">
            {(plan.roles ?? []).length === 0 && !showRoleForm && (
              <p className="px-4 py-4 text-xs text-muted-foreground">No roles added yet.</p>
            )}
            {(plan.roles ?? []).map((role: any) => (
              <div key={role.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{role.roleName}</p>
                  {role.estimatedHours > 0 && (
                    <p className="text-[11px] text-muted-foreground">{role.estimatedHours}h estimated</p>
                  )}
                  {role.notes && <p className="text-[11px] text-muted-foreground italic">{role.notes}</p>}
                </div>
                <button
                  onClick={() => deleteRole.mutate(role.id)}
                  className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>

        {/* Equipment */}
        <section className="rounded-xl border border-border bg-background">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Wrench size={14} className="text-primary-600" />
              <span className="text-sm font-semibold">Equipment / Work Centers</span>
              <span className="text-xs text-muted-foreground">({plan.equipment?.length ?? 0})</span>
            </div>
            <button
              onClick={() => setShowEquipForm((v) => !v)}
              className="text-xs text-primary-700 hover:text-primary-900 flex items-center gap-1"
            >
              <Plus size={12} /> Add
            </button>
          </div>

          {showEquipForm && (
            <div className="p-3 border-b border-border bg-muted/20 space-y-2">
              <select
                className="input input-sm w-full"
                value={equipForm.workCenterId}
                onChange={(e) => setEquipForm((f) => ({ ...f, workCenterId: e.target.value }))}
              >
                <option value="">Select work center…</option>
                {workCenters.map((wc: any) => (
                  <option key={wc.id} value={wc.id}>{wc.code} — {wc.name}</option>
                ))}
              </select>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">Est. Minutes</label>
                  <input
                    type="number"
                    min={0}
                    step={5}
                    className="input input-sm w-full"
                    value={equipForm.estimatedMinutes}
                    onChange={(e) => setEquipForm((f) => ({ ...f, estimatedMinutes: parseInt(e.target.value) || 0 }))}
                  />
                </div>
                <div className="flex-1">
                  <label className="text-[11px] text-muted-foreground">Sequence #</label>
                  <input
                    type="number"
                    min={1}
                    className="input input-sm w-full"
                    value={equipForm.sequenceOrder}
                    onChange={(e) => setEquipForm((f) => ({ ...f, sequenceOrder: parseInt(e.target.value) || 1 }))}
                  />
                </div>
              </div>
              <input
                className="input input-sm w-full"
                placeholder="Notes (optional)"
                value={equipForm.notes}
                onChange={(e) => setEquipForm((f) => ({ ...f, notes: e.target.value }))}
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowEquipForm(false)} className="btn-ghost btn-xs">Cancel</button>
                <button
                  onClick={() => addEquipment.mutate()}
                  disabled={!equipForm.workCenterId || addEquipment.isPending}
                  className="btn-primary btn-xs"
                >
                  {addEquipment.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Add'}
                </button>
              </div>
            </div>
          )}

          <div className="divide-y divide-border">
            {(plan.equipment ?? []).length === 0 && !showEquipForm && (
              <p className="px-4 py-4 text-xs text-muted-foreground">No equipment assigned yet.</p>
            )}
            {(plan.equipment ?? []).map((eq: any) => (
              <div key={eq.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="w-6 h-6 rounded bg-primary-50 flex items-center justify-center text-[10px] font-bold text-primary-600 shrink-0">
                  {eq.sequenceOrder}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{eq.workCenter?.name ?? eq.workCenterId}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {eq.estimatedMinutes}min est.
                    {eq.workCenter?.type && ` · ${eq.workCenter.type}`}
                  </p>
                  {eq.notes && <p className="text-[11px] text-muted-foreground italic">{eq.notes}</p>}
                </div>
                <button
                  onClick={() => deleteEquipment.mutate(eq.id)}
                  className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Prep Tasks */}
      <section className="rounded-xl border border-border bg-background">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <ListChecks size={14} className="text-primary-600" />
            <span className="text-sm font-semibold">Preparation Tasks</span>
            {totalTasks > 0 && (
              <span className="text-xs text-muted-foreground">
                ({completedTasks}/{totalTasks} done)
              </span>
            )}
          </div>
          <button
            onClick={() => setShowTaskForm((v) => !v)}
            className="text-xs text-primary-700 hover:text-primary-900 flex items-center gap-1"
          >
            <Plus size={12} /> Add Task
          </button>
        </div>

        {showTaskForm && (
          <div className="px-4 py-3 border-b border-border bg-muted/20 flex gap-2">
            <input
              className="input input-sm flex-1"
              placeholder="Task title…"
              value={taskTitle}
              autoFocus
              onChange={(e) => setTaskTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addTask.mutate(); }}
            />
            <button onClick={() => setShowTaskForm(false)} className="btn-ghost btn-xs">Cancel</button>
            <button
              onClick={() => addTask.mutate()}
              disabled={!taskTitle.trim() || addTask.isPending}
              className="btn-primary btn-xs"
            >
              {addTask.isPending ? <Loader2 size={11} className="animate-spin" /> : 'Add'}
            </button>
          </div>
        )}

        <div className="divide-y divide-border">
          {(plan.tasks ?? []).length === 0 && !showTaskForm && (
            <p className="px-4 py-4 text-xs text-muted-foreground">No tasks added yet.</p>
          )}
          {(plan.tasks ?? []).map((task: any) => (
            <div key={task.id} className="flex items-center gap-3 px-4 py-2.5">
              <button
                onClick={() => toggleTask.mutate({ taskId: task.id, isComplete: !task.isComplete })}
                className={`shrink-0 transition-colors ${task.isComplete ? 'text-green-600' : 'text-muted-foreground hover:text-primary-600'}`}
              >
                {task.isComplete ? <CheckSquare size={15} /> : <Square size={15} />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${task.isComplete ? 'line-through text-muted-foreground' : 'text-foreground'}`}>
                  {task.title}
                </p>
                {task.description && <p className="text-[11px] text-muted-foreground">{task.description}</p>}
              </div>
              <button
                onClick={() => deleteTask.mutate(task.id)}
                className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>

        {totalTasks > 0 && (
          <div className="px-4 py-2 bg-muted/20 rounded-b-xl">
            <div className="w-full bg-muted rounded-full h-1.5">
              <div
                className="bg-green-500 h-1.5 rounded-full transition-all"
                style={{ width: `${totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Schedule Blocks */}
      {plan.scheduleBlocks?.length > 0 && (
        <section className="rounded-xl border border-border bg-background">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Calendar size={14} className="text-primary-600" />
            <span className="text-sm font-semibold">Scheduled Blocks</span>
            <span className="text-xs text-muted-foreground">({plan.scheduleBlocks.length})</span>
          </div>
          <div className="divide-y divide-border">
            {plan.scheduleBlocks.map((block: any) => (
              <div key={block.id} className="flex items-center gap-3 px-4 py-2.5">
                <Calendar size={13} className="text-muted-foreground shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{block.workCenter?.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {new Date(block.startAt).toLocaleString()} → {new Date(block.endAt).toLocaleString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {block.aiGenerated && (
                    <span className="text-[10px] bg-primary-50 text-primary-700 px-1.5 py-0.5 rounded flex items-center gap-1">
                      <Sparkles size={9} /> AI
                    </span>
                  )}
                  {block.isConfirmed && (
                    <span className="text-[10px] bg-green-50 text-green-700 px-1.5 py-0.5 rounded">Confirmed</span>
                  )}
                  <button
                    onClick={() => planningApi.deleteScheduleBlock(plan.id, block.id).then(refetch)}
                    className="p-1 text-muted-foreground hover:text-red-600 transition-colors"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* AI Auto-Schedule */}
      <section className="rounded-xl border border-primary-200 bg-primary-50/30 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Sparkles size={14} className="text-primary-600" />
              <span className="text-sm font-semibold text-foreground">AI Auto-Schedule</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Let AI analyse the equipment requirements and work center availability, then automatically
              create optimised schedule blocks to maximise utilisation.
            </p>
            {scheduleResult && (
              <div className="mt-2 flex items-start gap-1.5 text-xs text-primary-700 bg-primary-50 rounded px-2 py-1.5">
                <AlertCircle size={11} className="shrink-0 mt-0.5" />
                <span>{scheduleResult}</span>
              </div>
            )}
          </div>
          <button
            onClick={runAiSchedule}
            disabled={scheduling || (plan.equipment ?? []).length === 0}
            className="btn-primary btn-sm gap-2 shrink-0"
          >
            {scheduling
              ? <><Loader2 size={13} className="animate-spin" /> Scheduling…</>
              : <><Sparkles size={13} /> Auto Schedule</>}
          </button>
        </div>
        {(plan.equipment ?? []).length === 0 && (
          <p className="mt-2 text-xs text-yellow-700 bg-yellow-50 rounded px-2 py-1.5">
            Add at least one equipment/work center before auto-scheduling.
          </p>
        )}
      </section>
    </div>
  );
}
