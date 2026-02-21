import { useQuery } from '@tanstack/react-query';
import { tasksApi } from '../services/api';
import { Plus, ClipboardList, CheckCircle2, Circle, AlertCircle } from 'lucide-react';

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

export function TasksPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['tasks'],
    queryFn: () => tasksApi.listTasks({ limit: 50 }).then((r) => r.data),
  });

  const tasks = data?.data ?? [];
  const open      = tasks.filter((t: any) => t.status === 'OPEN').length;
  const inProgress = tasks.filter((t: any) => t.status === 'IN_PROGRESS').length;
  const done      = tasks.filter((t: any) => t.status === 'DONE').length;

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Tasks</h1>
          <p className="page-subtitle">{data?.meta?.total ?? '—'} total tasks across all modules</p>
        </div>
        <button className="btn-primary btn-sm"><Plus size={13} /> New Task</button>
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
