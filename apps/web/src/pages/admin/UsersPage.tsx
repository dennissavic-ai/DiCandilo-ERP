import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { Plus, Search, Users, ShieldCheck, X, Eye, EyeOff, ChevronDown, Check, Pencil } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';

// ── Role color mapping ──────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  Admin:              { bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500' },
  Leadership:         { bg: 'bg-purple-50',  text: 'text-purple-700',  dot: 'bg-purple-500' },
  Finance:            { bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  'Marketing/Sales':  { bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  Operator:           { bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  'Parts Manager':    { bg: 'bg-cyan-50',    text: 'text-cyan-700',    dot: 'bg-cyan-500' },
  Planner:            { bg: 'bg-violet-50',  text: 'text-violet-700',  dot: 'bg-violet-500' },
  Dispatch:           { bg: 'bg-orange-50',  text: 'text-orange-700',  dot: 'bg-orange-500' },
  Developer:          { bg: 'bg-steel-100',  text: 'text-steel-700',   dot: 'bg-steel-500' },
};

const DEFAULT_ROLE_COLOR = { bg: 'bg-steel-50', text: 'text-steel-600', dot: 'bg-steel-400' };

function getRoleColor(roleName: string) {
  return ROLE_COLORS[roleName] ?? DEFAULT_ROLE_COLOR;
}

// ── Role Badge ──────────────────────────────────────────────────────────────

function RoleBadge({ name }: { name: string }) {
  const color = getRoleColor(name);
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${color.bg} ${color.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${color.dot}`} />
      {name}
    </span>
  );
}

// ── Role Dropdown (inline change) ───────────────────────────────────────────

function RoleDropdown({
  currentRoleId,
  currentRoleName,
  roles,
  onChangeRole,
  isChanging,
}: {
  currentRoleId: string;
  currentRoleName: string;
  roles: any[];
  onChangeRole: (roleId: string) => void;
  isChanging: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="flex items-center gap-1.5 group"
        disabled={isChanging}
      >
        <RoleBadge name={currentRoleName} />
        <ChevronDown size={11} className="text-steel-400 group-hover:text-steel-600 transition-colors" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-56 bg-white border border-steel-200 rounded-lg shadow-lg py-1 max-h-64 overflow-y-auto">
          <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-steel-400">
            Assign Role
          </div>
          {roles.map((r: any) => {
            const isActive = r.id === currentRoleId;
            const color = getRoleColor(r.name);
            return (
              <button
                key={r.id}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isActive) onChangeRole(r.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-steel-50 transition-colors ${
                  isActive ? 'bg-steel-50' : ''
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${color.dot}`} />
                <span className="flex-1 font-medium text-steel-800">{r.name}</span>
                {r.description && (
                  <span className="text-[10px] text-steel-400 truncate max-w-[100px]">{r.description.split('—')[0]}</span>
                )}
                {isActive && <Check size={13} className="text-primary-600 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Invite User Modal ───────────────────────────────────────────────────────

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

// ── Edit User Modal ─────────────────────────────────────────────────────────

function EditUserModal({ user, onClose }: { user: any; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    email: user.email ?? '',
    phone: user.phone ?? '',
    roleId: user.role?.id ?? '',
    isActive: user.isActive ?? true,
  });
  const [error, setError] = useState('');
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => usersApi.listRoles().then((r) => r.data),
  });
  const roles: any[] = rolesData ?? [];

  const { mutate, isPending } = useMutation({
    mutationFn: (data: object) => usersApi.updateUser(user.id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? err?.message ?? 'Failed to update user');
    },
  });

  function set(field: string, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
    setError('');
    setConfirmDeactivate(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.roleId) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!form.isActive && user.isActive && !confirmDeactivate) {
      setConfirmDeactivate(true);
      return;
    }
    mutate({
      firstName: form.firstName,
      lastName: form.lastName,
      roleId: form.roleId,
      isActive: form.isActive,
      ...(form.phone ? { phone: form.phone } : {}),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-primary-700 text-sm font-bold">
              {(user.firstName?.[0] ?? '').toUpperCase()}{(user.lastName?.[0] ?? '').toUpperCase()}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">Edit User</h2>
              <p className="text-[11px] text-muted-foreground">{user.email}</p>
            </div>
          </div>
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
            <label className="form-label">Email</label>
            <input className="input bg-steel-50 text-steel-500 cursor-not-allowed" type="email" value={form.email} disabled />
            <p className="text-[11px] text-muted-foreground mt-1">Email cannot be changed. Contact a developer if needed.</p>
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

          {/* Active / Deactivate toggle */}
          <div className="flex items-center justify-between py-2 px-3 rounded-lg border border-steel-200 bg-steel-50/50">
            <div>
              <p className="text-sm font-medium text-foreground">Account Status</p>
              <p className="text-[11px] text-muted-foreground">
                {form.isActive ? 'User can log in and access the system' : 'User is blocked from logging in'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => set('isActive', !form.isActive)}
              className={`relative w-10 h-5 rounded-full transition-colors ${form.isActive ? 'bg-green-500' : 'bg-steel-300'}`}
            >
              <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${form.isActive ? 'left-[22px]' : 'left-0.5'}`} />
            </button>
          </div>

          {confirmDeactivate && (
            <div className="p-3 rounded-lg bg-red-50 border border-red-200">
              <p className="text-xs text-red-700 font-medium">Are you sure you want to deactivate this user?</p>
              <p className="text-[11px] text-red-600 mt-0.5">They will be immediately logged out and unable to access the system. Click "Save Changes" again to confirm.</p>
            </div>
          )}

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary btn-sm" disabled={isPending}>
              {isPending ? 'Saving…' : confirmDeactivate ? 'Confirm Deactivation' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Users Page ──────────────────────────────────────────────────────────────

export function UsersPage() {
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState<any>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => usersApi.listUsers({ limit: 100 }).then((r) => r.data),
  });

  const { data: rolesData } = useQuery({
    queryKey: ['roles'],
    queryFn: () => usersApi.listRoles().then((r) => r.data),
  });
  const roles: any[] = rolesData ?? [];

  const { mutate: changeRole, isPending: isChangingRole, variables: changingVars } = useMutation({
    mutationFn: ({ userId, roleId }: { userId: string; roleId: string }) =>
      usersApi.updateUser(userId, { roleId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });

  const users = (data?.data ?? []).filter((u: any) =>
    !search ||
    u.email?.toLowerCase().includes(search.toLowerCase()) ||
    `${u.firstName} ${u.lastName}`.toLowerCase().includes(search.toLowerCase()) ||
    u.role?.name?.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="max-w-[1400px] mx-auto animate-fade-in">
      {showModal && <InviteUserModal onClose={() => setShowModal(false)} />}
      {editUser && <EditUserModal user={editUser} onClose={() => setEditUser(null)} />}

      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage access and roles for your team</p>
        </div>
        <button className="btn-primary btn-sm" onClick={() => setShowModal(true)}>
          <Plus size={13} /> Invite User
        </button>
      </div>

      {/* Role legend */}
      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-steel-400 mr-1">Roles:</span>
            {Object.keys(ROLE_COLORS).map((name) => (
              <RoleBadge key={name} name={name} />
            ))}
          </div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="card-body py-3">
          <div className="relative max-w-sm">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
            <input
              className="input pl-8 h-9 text-sm"
              placeholder="Search users by name, email, or role…"
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
                    <tr key={u.id} onClick={() => setEditUser(u)} className="cursor-pointer hover:bg-steel-50/60 transition-colors">
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
                        <RoleDropdown
                          currentRoleId={u.role?.id ?? ''}
                          currentRoleName={u.role?.name ?? '—'}
                          roles={roles}
                          onChangeRole={(roleId) => changeRole({ userId: u.id, roleId })}
                          isChanging={isChangingRole && changingVars?.userId === u.id}
                        />
                      </td>
                      <td>
                        {u.isActive
                          ? <span className="badge-green">Active</span>
                          : <span className="badge-red">Inactive</span>}
                      </td>
                      <td>
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-steel-400">
                            {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString('en-AU') : 'Never'}
                          </span>
                          <Pencil size={12} className="text-steel-300 group-hover:text-steel-500" />
                        </div>
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
