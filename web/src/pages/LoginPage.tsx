import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { installMockFetch } from '../demo/mockFetch';

export function LoginPage() {
  const navigate = useNavigate();
  const { signIn, enterDemoMode } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      await signIn(username, password);
      navigate('/');
    } catch (err: any) {
      setError(err.message || 'Login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Logo / Brand */}
        <div className="text-center mb-8">
          <span className="text-2xl font-bold text-gray-900 tracking-tight">videonow</span>
          <p className="text-sm text-gray-400 mt-1">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Username
              </label>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': 'rgb(99 102 241 / 0.2)' } as React.CSSProperties}
                placeholder="Enter your username"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:border-transparent transition-all"
                style={{ '--tw-ring-color': 'rgb(99 102 241 / 0.2)' } as React.CSSProperties}
                placeholder="Enter your password"
              />
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-100 text-red-600 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-sm text-gray-400">
            Don't have an account?{' '}
            <Link to="/signup" className="text-gray-900 font-semibold hover:text-gray-600 transition-colors">
              Sign up
            </Link>
          </p>
        </div>

        <div className="mt-4 text-center">
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-200" />
            </div>
            <div className="relative flex justify-center text-xs text-gray-400">
              <span className="bg-gray-50 px-3">or</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { installMockFetch(); enterDemoMode(); navigate('/'); }}
            className="mt-4 w-full py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-100 transition-colors"
          >
            Continue in Demo Mode
          </button>
          <p className="mt-2 text-xs text-gray-400">Explore the UI with mock data — no account needed</p>
        </div>
      </div>
    </div>
  );
}
