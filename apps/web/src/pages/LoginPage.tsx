import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Eye, EyeOff, AlertCircle, Factory, ArrowRight } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { AxiosError } from 'axios';

interface LoginForm {
  email: string;
  password: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>();

  const onSubmit = async (data: LoginForm) => {
    setError(null);
    try {
      const { data: tokens } = await authApi.login(data.email, data.password);
      setTokens(tokens.accessToken, tokens.refreshToken);
      const { data: me } = await authApi.me();
      setUser(me);
      navigate('/');
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setError(e.response?.data?.message ?? 'Login failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* ── Left panel — branding ───────────────────────────────────────────── */}
      <div
        className="hidden lg:flex w-[480px] flex-shrink-0 flex-col justify-between p-12"
        style={{ background: 'hsl(var(--sidebar-background))' }}
      >
        {/* Logo */}
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary-600 rounded-xl flex items-center justify-center shadow-lg">
            <Factory size={20} className="text-white" />
          </div>
          <div>
            <div className="text-white font-bold text-base leading-tight">DiCandilo</div>
            <div className="text-white/40 text-[11px] uppercase tracking-widest">Metal ERP</div>
          </div>
        </div>

        {/* Hero text */}
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold text-white leading-tight tracking-tight">
              Industrial-grade ERP for Metal Service Centres
            </h1>
            <p className="mt-4 text-base text-white/50 leading-relaxed">
              Inventory, nesting, heat-number traceability, sales, purchasing, and full accounting — all in one platform.
            </p>
          </div>

          {/* Feature list */}
          <ul className="space-y-3">
            {[
              'Real-time inventory & MTR traceability',
              'Linear & plate nesting optimisation',
              'Integrated sales, purchasing & accounting',
              'Multi-branch, multi-company ready',
            ].map((f) => (
              <li key={f} className="flex items-center gap-3 text-sm text-white/60">
                <span className="w-5 h-5 rounded-full bg-primary-600/30 flex items-center justify-center flex-shrink-0">
                  <span className="w-1.5 h-1.5 bg-primary-400 rounded-full" />
                </span>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Bottom */}
        <p className="text-white/20 text-xs">© 2025 DiCandilo ERP. All rights reserved.</p>
      </div>

      {/* ── Right panel — form ──────────────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-[380px] space-y-8">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 lg:hidden">
            <div className="w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center">
              <Factory size={18} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-foreground text-sm">DiCandilo ERP</div>
              <div className="text-muted-foreground text-xs">Metal Service Centre</div>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-foreground tracking-tight">Sign in</h2>
            <p className="text-muted-foreground text-sm mt-1">
              Enter your credentials to access your workspace
            </p>
          </div>

          {/* Error alert */}
          {error && (
            <div className="flex items-start gap-3 p-3.5 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
              <AlertCircle size={15} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {/* Email */}
            <div className="form-group">
              <label className="label">Email address</label>
              <input
                type="email"
                className="input h-10"
                placeholder="admin@company.com"
                {...register('email', { required: 'Email is required' })}
              />
              {errors.email && (
                <p className="error-text">
                  <AlertCircle size={11} />{errors.email.message}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="form-group">
              <div className="flex items-center justify-between mb-1.5">
                <label className="label mb-0">Password</label>
                <a href="#" className="text-xs text-primary-600 hover:text-primary-700 font-medium">
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  className="input h-10 pr-10"
                  placeholder="••••••••"
                  {...register('password', { required: 'Password is required' })}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPass((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-steel-400 hover:text-steel-600"
                >
                  {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              {errors.password && (
                <p className="error-text">
                  <AlertCircle size={11} />{errors.password.message}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full h-10 mt-2"
            >
              {isSubmitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Signing in…
                </>
              ) : (
                <>Sign in <ArrowRight size={15} /></>
              )}
            </button>
          </form>

          <p className="text-center text-sm text-muted-foreground">
            New company?{' '}
            <Link to="/register" className="text-primary-600 hover:text-primary-700 font-medium underline underline-offset-2">
              Create an account
            </Link>
          </p>

          {/* Dev hint */}
          <div className="border border-dashed border-steel-200 rounded-xl p-3.5 bg-steel-50/60">
            <p className="text-[11px] font-semibold text-steel-500 uppercase tracking-wider mb-1.5">
              Demo credentials
            </p>
            <p className="text-xs text-steel-600 font-mono">admin@dicandilo.com</p>
            <p className="text-xs text-steel-600 font-mono">Admin@12345</p>
          </div>
        </div>
      </div>
    </div>
  );
}
