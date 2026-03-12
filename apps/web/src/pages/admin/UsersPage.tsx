import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { Plus, Search, Users, ShieldCheck, X, Eye, EyeOff } from 'lucide-react';
import { useState } from 'react';

function InviteUserModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '', password: '', roleId: '', phone: '',
  });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => usersApi.listRoles().then((r) => r.data),
  });
  const roles: any[] = rolesData ?? [];

  const { mutate, isPending } = useMutation({
    mutationFn: (data: object) => usersApi.createUser(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? err?.message ?? 'Failed to create user');
    },
  });

  function set(field: string, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.password || !form.roleId) {
      setError('Please fill in all required fields.');
      return;
    }
    mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      email: form.email,
      password: form.password,
      roleId: form.roleId,
      ...(form.phone ? { phone: form.phone } : {}),
      requirePasswordChange: true,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-sm font-semibold text-foreground">Invite User</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="form-label">First Name <span className="text-red-500">*</span></label>
              <input className="input" value={form.firstName} onChange={(e) => set('firstName', e.target.value)} autoFocus />
            </div>
            <div>
              <label className="form-label">Last Name <span className="text-red-500">*</span></label>
              <input className="input" value={form.lastName} onChange={(e) => set('lastName', e.target.value)} />
            </div>
          </div>

          <div>
            <label className="form-label">Email <span className="text-red-500">*</span></label>
            <input className="input" type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>

          <div>
            <label className="form-label">Phone</label>
            <input className="input" type="tel" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
          </div>

          <div>
            <label className="form-label">Role <span className="text-red-500">*</span></label>
            <select className="input" value={form.roleId} onChange={(e) => set('roleId', e.target.value)}>
              <option value="">Select a role…</option>
              {roles.map((r: any) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="form-label">Temporary Password <span className="text-red-500">*</span></label>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder="Min 8 chars, upper, lower, number, symbol"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((s) => !s)}
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">User will be required to change this on first login.</p>
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
              {isPending ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.listUsers({ limit: 100 }).then((r) => r.data),
  });

  const users = (data?.data ?? []).filter((u: any) =>
    !search ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      {showModal && <InviteUserModal onClose={() => setShowModal(false)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage access and roles for your team</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
          <Plus size={13} /> Invite User
        </button>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search users…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="table-container rounded-xl">
          <table className="table">
            <thead>
              <tr>
                <th>User</th>
                <th>Email</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
              </tr>
            </thead>
            <tbody>
              {isLoading
                ? Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 5 }).map((__, j) => (
                        <td key={j}><div className="skeleton h-4 w-24" /></td>
                      ))}
                    </tr>
                  ))
                : users.map((u: any) => (
                    <tr key={u.id} className="cursor-pointer">
                      <td>
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-xs font-bold">
                            {(u.firstName?.[0] ?? '').toUpperCase()}{(u.lastName?.[0] ?? '').toUpperCase()}
                          </div>
                          <span className="font-medium text-foreground">{u.firstName} {u.lastName}</span>
                        </div>
                      </td>
                      <td className="text-sm text-steel-600">{u.email}</td>
                      <td>
                        <div className="flex items-center gap-1.5">
                          <ShieldCheck size={12} className="text-primary-500" />
                          <span className="text-xs font-medium">{u.role?.name ?? '—'}</span>
                        </div>
                      </td>
                      <td>
                        {u.isActive
                          ? <span className="badge-green">Active</span>
                          : <span className="badge-red">Inactive</span>}
                      </td>
                      <td className="text-xs text-steel-400">
                        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-AU') : 'Never'}
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!isLoading && users.length === 0 && (
          <div className="empty-state">
            <div className="empty-state-icon"><Users size={22} /></div>
            <p className="text-sm font-medium text-foreground">No users found</p>
          </div>
        )}
      </div>
    </div>
  );
}
