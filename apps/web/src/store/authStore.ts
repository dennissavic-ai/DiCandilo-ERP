import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface Permission {
  module: string;
  action: string;
}

interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  companyId: string;
  branchId?: string;
  role: {
    id: string;
    name: string;
    permissions: Array<{ permission: Permission }>;
  };
}

interface AuthState {
  accessToken: string | null;
  refreshToken: string | null;
  user: AuthUser | null;
  isAuthenticated: boolean;
  setTokens: (accessToken: string, refreshToken: string) => void;
  setUser: (user: AuthUser) => void;
  logout: () => void;
  hasPermission: (module: string, action: string) => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      isAuthenticated: false,

      setTokens: (accessToken, refreshToken) => {
        set({ accessToken, refreshToken, isAuthenticated: true });
      },

      setUser: (user) => {
        set({ user });
      },

      logout: () => {
        set({ accessToken: null, refreshToken: null, user: null, isAuthenticated: false });
      },

      hasPermission: (module, action) => {
        const user = get().user;
        if (!user) return false;
        if (user.role.name === 'Admin') return true;
        return user.role.permissions.some(
          (p) => p.permission.module === module && p.permission.action === action
        );
      },
    }),
    {
      name: 'erp-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
