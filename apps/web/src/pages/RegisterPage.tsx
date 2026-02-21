import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Factory, AlertCircle } from 'lucide-react';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/authStore';
import type { AxiosError } from 'axios';

interface RegisterForm {
  companyName: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  confirmPassword: string;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { setTokens, setUser } = useAuthStore();
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<RegisterForm>();

  const onSubmit = async (data: RegisterForm) => {
    setError(null);
    try {
      const { data: tokens } = await authApi.register({
        companyName: data.companyName,
        firstName: data.firstName,
        lastName: data.lastName,
        email: data.email,
        password: data.password,
      });
      setTokens(tokens.accessToken, tokens.refreshToken);
      const { data: me } = await authApi.me();
      setUser(me);
      navigate('/');
    } catch (err) {
      const e = err as AxiosError<{ message: string }>;
      setError(e.response?.data?.message ?? 'Registration failed.');
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-steel-900 to-primary-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 bg-primary-500 rounded-2xl flex items-center justify-center shadow-lg mb-3">
            <Factory size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Create your ERP</h1>
          <p className="text-steel-400 text-sm mt-1">Set up your metal service center</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-lg font-semibold text-steel-900 mb-6">Register</h2>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg mb-4 text-sm text-red-700">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="form-group">
              <label className="label">Company Name</label>
              <input type="text" className="input" placeholder="ACME Steel & Metals" {...register('companyName', { required: true })} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="form-group">
                <label className="label">First Name</label>
                <input type="text" className="input" {...register('firstName', { required: true })} />
              </div>
              <div className="form-group">
                <label className="label">Last Name</label>
                <input type="text" className="input" {...register('lastName', { required: true })} />
              </div>
            </div>
            <div className="form-group">
              <label className="label">Work Email</label>
              <input type="email" className="input" {...register('email', { required: true })} />
            </div>
            <div className="form-group">
              <label className="label">Password</label>
              <input type="password" className="input" {...register('password', { required: true, minLength: 8 })} />
              {errors.password && <p className="error-text">Minimum 8 characters</p>}
            </div>
            <div className="form-group">
              <label className="label">Confirm Password</label>
              <input
                type="password" className="input"
                {...register('confirmPassword', {
                  required: true,
                  validate: (v) => v === watch('password') || 'Passwords do not match',
                })}
              />
              {errors.confirmPassword && <p className="error-text">{errors.confirmPassword.message}</p>}
            </div>
            <button type="submit" disabled={isSubmitting} className="btn-primary w-full py-2.5 mt-2">
              {isSubmitting ? 'Creating account…' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-xs text-steel-500 mt-6">
            Already have an account?{' '}
            <Link to="/login" className="text-primary-600 hover:underline font-medium">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
