import { Bell, Search, LogOut, User, ChevronDown, Settings, ScanLine } from 'lucide-react';
import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../services/api';

function Initials({ first, last }: { first?: string; last?: string }) {
  return (
    <span className="text-xs font-semibold" style={{ color: 'hsl(var(--brand-red))' }}>
      {(first?.[0] ?? '').toUpperCase()}{(last?.[0] ?? '').toUpperCase()}
    </span>
  );
}

export function TopBar() {
  const navigate = useNavigate();
  const { user, refreshToken, logout } = useAuthStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  /* Close menu on outside click */
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleLogout = async () => {
    try { if (refreshToken) await authApi.logout(refreshToken); } catch { /* ignore */ }
    logout();
    navigate('/login');
  };

  return (
    <header className="h-13 bg-white border-b border-border flex items-center px-5 gap-4 flex-shrink-0 z-10 shadow-sm">
      {/* Global search */}
      <div className="flex-1 max-w-sm relative">
        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400 pointer-events-none" />
        <input
          type="search"
          placeholder="Search orders, products, customers…"
          className="input pl-8 py-1.5 text-sm h-8 bg-steel-50/80 border-steel-200 focus-visible:bg-white"
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-mono text-steel-400 bg-steel-100 border border-steel-200">
          ⌘K
        </kbd>
      </div>

      <div className="flex items-center gap-1.5 ml-auto">
        {/* Barcode scanner — prominent on mobile */}
        <button
          className="btn-icon btn-ghost rounded-lg text-primary-600 hover:bg-primary-50"
          onClick={() => navigate('/inventory/barcodes')}
          title="Scan barcode"
          aria-label="Open barcode scanner"
        >
          <ScanLine size={16} />
        </button>

        {/* Notifications */}
        <button className="relative btn-icon btn-ghost rounded-lg">
          <Bell size={16} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white" />
        </button>

        {/* Settings */}
        <button
          className="btn-icon btn-ghost rounded-lg"
          onClick={() => navigate('/admin/users')}
          title="Settings"
        >
          <Settings size={16} />
        </button>

        {/* Divider */}
        <div className="w-px h-6 bg-steel-200 mx-1" />

        {/* User menu */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="flex items-center gap-2.5 pl-1 pr-2 py-1 rounded-lg hover:bg-steel-100 transition-colors"
          >
            <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'hsl(var(--brand-red) / 0.15)' }}>
              <Initials first={user?.firstName} last={user?.lastName} />
            </div>
            <div className="hidden sm:flex flex-col text-left leading-tight">
              <span className="text-[13px] font-medium text-steel-800">
                {user?.firstName} {user?.lastName}
              </span>
              <span className="text-[11px] text-steel-400">{user?.role?.name}</span>
            </div>
            <ChevronDown size={13} className="text-steel-400 ml-0.5" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-[calc(100%+6px)] z-50 w-52 bg-white rounded-xl border border-border shadow-lg shadow-steel-900/10 py-1.5 animate-fade-in">
              {/* User info header */}
              <div className="px-4 py-2.5 border-b border-border mb-1">
                <div className="text-[13px] font-semibold text-steel-900">
                  {user?.firstName} {user?.lastName}
                </div>
                <div className="text-[11px] text-steel-400 truncate">{user?.email}</div>
              </div>

              <button className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-steel-700 hover:bg-steel-50 transition-colors">
                <User size={13} className="text-steel-400" />
                My Profile
              </button>
              <button className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-steel-700 hover:bg-steel-50 transition-colors">
                <Settings size={13} className="text-steel-400" />
                Preferences
              </button>

              <div className="border-t border-border mt-1 pt-1">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut size={13} />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
