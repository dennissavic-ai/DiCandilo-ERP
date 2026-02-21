import { useQuery } from '@tanstack/react-query';
import { usersApi } from '../../services/api';
import { Plus, Search, Users, ShieldCheck } from 'lucide-react';
import { useState } from 'react';

export function UsersPage() {
  const [search, setSearch] = useState('');

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
      <div className="page-header">
        <div>
          <h1 className="page-title">User Management</h1>
          <p className="page-subtitle">Manage access and roles for your team</p>
        </div>
        <button className="btn-primary btn-sm"><Plus size={13} /> Invite User</button>
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
