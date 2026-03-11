import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../services/api';
import { Plus, ClipboardList, CheckCircle2, Circle, AlertCircle, X } from 'lucide-react';
import { useState } from 'react';

const PRIORITY_BADGE: Record<string, string> = {
  LOW:    'badge-gray',
  MEDIUM: 'badge-blue',
  HIGH:   'badge-orange',
  URGENT: 'badge-red',
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  OPEN:        <Circle size={14} className="text-steel-400" />,
  IN_PROGRESS: <Circle size={14} className="text-blue-500 fill-blue-100" />,
  BLOCKED:     <AlertCircle size={14} className="text-red-500" />,
  DONE:        <CheckCircle2 size={14} className="text-green-500" />,
  CANCELLED:   <CheckCircle2 size={14} className="text-steel-300" />,
};

function NewTaskModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState('MEDIUM');
  const [dueDate, setDueDate] = useState('');

  const { mutate, isPending } = useMutation({
    mutationFn: (data: object) => tasksApi.createTask(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      onClose();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    mutate({
      title: title.trim(),
      priority,
      ...(dueDate ? { dueDate: new Date(dueDate).toISOString() } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-foreground">New Task</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="form-label">Title <span className="text-red-500">*</span></label>
            <input
              className="input"
              placeholder="Task title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>
          <div>
            <label className="form-label">Priority</label>
            <select className="input" value={priority} onChange={(e) => setPriority(e.target.value)}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="URGENT">Urgent</option>
            </select>
          </div>
          <div>
            <label className="form-label">Due Date</label>
            <input
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={isPending || !title.trim()}>
              {isPending ? 'Creating…' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function TasksPage() {
  const [showModal, setShowModal] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.listTasks({ limit: 50 }).then((r) => r.data),
  });

  const tasks = data?.data ?? [];
  const open       = tasks.filter((t: any) => t.status === 'OPEN').length;
  const inProgress = tasks.filter((t: any) => t.status === 'IN_PROGRESS').length;
  const done       = tasks.filter((t: any) => t.status === 'DONE').length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      {showModal && <NewTaskModal onClose={() => setShowModal(false)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total tasks across all modules</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
          <Plus size={13} /> New Task
        </button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="stat-card">
          <div className="text-xl font-bold">{open}</div>
          <div className="text-xs text-muted-foreground">Open</div>
        </div>
        <div className="stat-card">
          <div className="text-xl font-bold text-blue-600">{inProgress}</div>
          <div className="text-xs text-muted-foreground">In Progress</div>
        </div>
        <div className="stat-card">
          <div className="text-xl font-bold text-green-600">{done}</div>
          <div className="text-xs text-muted-foreground">Completed</div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Title</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Due</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : tasks.map((t: any) => (
                    <tr key={t.id} className="cursor-pointer">
                      <td>{STATUS_ICON[t.status] ?? <Circle size={14} />}</td>
                      <td className="font-medium text-foreground max-w-[320px] truncate" title={t.title}>
                        {t.title}
                      </td>
                      <td>
                        <span className={PRIORITY_BADGE[t.priority] ?? 'badge-gray'}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="text-xs text-muted-foreground">
                        {t.assignee ? `${t.assignee.firstName} ${t.assignee.lastName}` : 'Unassigned'}
                      </td>
                      <td className="text-xs text-steel-500">{t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-AU') : '—'}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>

        {!isLoading && tasks.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><ClipboardList size={22} /></div>
            <p className="text-sm font-medium text-foreground">No tasks found</p>
            <p className="text-xs text-muted-foreground mt-1">Create a task to track work across orders, POs and work orders.</p>
          </div>
        )}
      </div>
    </div>
  );
}
