import { Bell, Search, LogOut, User, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { authApi } from '../../services/api';

export function TopBar() {
  const navigate = useNavigate();
  const { user, refreshToken, logout } = useAuthStore();
  const [showMenu, setShowMenu] = useState(false);

  const handleLogout = async () => {
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } finally {
      logout();
      navigate('/login');
    }
  };

  return (
    <header className="h-14 bg-white border-b border-steel-200 flex items-center px-6 gap-4 flex-shrink-0">
      {/* Search */}
      <div className="flex-1 max-w-md relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-steel-400" />
        <input
          type="search"
          placeholder="Search orders, products, customers..."
          className="input pl-9 py-1.5 text-sm h-8"
        />
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Notifications */}
        <button className="relative p-1.5 rounded-lg text-steel-500 hover:bg-steel-100 transition-colors">
          <Bell size={18} />
          <span className="absolute top-0.5 right-0.5 w-2 h-2 bg-red-500 rounded-full"></span>
        </button>

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-steel-100 transition-colors"
          >
            <div className="w-7 h-7 bg-primary-100 text-primary-700 rounded-full flex items-center justify-center text-xs font-semibold">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div className="hidden sm:block text-left">
              <div className="text-sm font-medium text-steel-800 leading-tight">
                {user?.firstName} {user?.lastName}
              </div>
              <div className="text-[10px] text-steel-500">{user?.role.name}</div>
            </div>
            <ChevronDown size={14} className="text-steel-400" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-10 z-20 w-44 bg-white rounded-xl border border-steel-200 shadow-lg py-1">
                <button className="w-full flex items-center gap-2 px-4 py-2 text-sm text-steel-700 hover:bg-steel-50">
                  <User size={14} /> Profile
                </button>
                <hr className="my-1 border-steel-100" />
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
