import { useState } from 'react';
import { useNavigate, Link, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiClient } from '../api/client';

export default function RegisterPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [loading, setLoading] = useState(false);

  // If already logged in, redirect immediately
  if (user) {
    return <Navigate to="/" replace />;
  }

  const validate = () => {
    const errors = {};
    if (!name.trim()) errors.name = 'Name is required';
    if (!email.includes('@')) errors.email = 'Valid email is required';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters';
    
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError(null);

    try {
      const response = await apiClient.post('/auth/register', { name, email, password });
      const { token, user: userData } = response.data;
      
      login(token, userData);
      navigate('/');
      // Do not set loading false on success since we are navigating away
    } catch (err) {
      if (err.response && err.response.data) {
        if (err.response.data.errors && Array.isArray(err.response.data.errors)) {
          setError(err.response.data.errors.map(e => e.msg || e).join('\n'));
        } else if (err.response.data.error) {
          setError(err.response.data.error);
        } else {
          setError('Registration failed. Please try again.');
        }
      } else {
        setError('Registration failed. Please try again.');
      }
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex w-full">
      {/* Left panel */}
      <div className="hidden md:flex flex-col justify-center items-center w-[45%] bg-brand-dark p-12 text-center">
        <svg viewBox="0 0 120 120" className="w-32 h-32 mb-6 mx-auto">
          <rect x="20" y="10" width="80" height="100" rx="8" fill="none" stroke="#6C63FF" strokeWidth="3"/>
          <line x1="35" y1="35" x2="85" y2="35" stroke="#6C63FF" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="35" y1="50" x2="70" y2="50" stroke="#FF6584" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="35" y1="65" x2="80" y2="65" stroke="#6C63FF" strokeWidth="2.5" strokeLinecap="round"/>
          <line x1="35" y1="80" x2="65" y2="80" stroke="#FF6584" strokeWidth="2.5" strokeLinecap="round"/>
          <circle cx="85" cy="85" r="18" fill="#6C63FF"/>
          <path d="M78 85 l4 4 l8 -8" stroke="white" strokeWidth="2.5" fill="none" strokeLinecap="round"/>
        </svg>
        <h1 className="text-white text-3xl font-bold">Split expenses,</h1>
        <h1 className="text-brand-primary text-3xl font-bold">not friendships.</h1>
        <p className="text-gray-400 text-sm mt-3 max-w-xs">
          Track who paid, who owes, and settle up — without the spreadsheet chaos.
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-10">
          <span className="text-xs bg-white/10 text-gray-300 rounded-full px-3 py-1">⚡ Real-time balances</span>
          <span className="text-xs bg-white/10 text-gray-300 rounded-full px-3 py-1">🧾 Smart CSV import</span>
          <span className="text-xs bg-white/10 text-gray-300 rounded-full px-3 py-1">💸 Debt minimization</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="w-full md:w-[55%] bg-brand-surface flex flex-col justify-center px-6 min-h-screen">
        <div className="w-full max-w-sm mx-auto">
          {/* Mobile header (hidden on md) */}
          <div className="mb-8 text-center md:hidden">
            <h1 className="text-2xl font-bold" style={{color:'#6C63FF'}}>SplitSmart</h1>
            <p className="text-xs text-gray-400 mt-1">Shared expenses, zero confusion</p>
          </div>

          <div className="mb-6">
            <h2 className="text-2xl font-bold text-brand-dark">Join SplitSmart ✨</h2>
            <p className="text-sm text-gray-500 mt-1">Create your account below</p>
          </div>
          
          <div className="border-t border-brand-border mt-6 mb-6"></div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Full name
              </label>
              <input
                type="text"
                placeholder="Aisha Sharma"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setFieldErrors({...fieldErrors, name: null});
                }}
                className="bg-white border border-brand-border rounded-xl px-4 py-3 w-full text-sm text-brand-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all duration-200"
              />
              {fieldErrors.name && <p className="text-sm text-red-600 mt-1">{fieldErrors.name}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Email
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setFieldErrors({...fieldErrors, email: null});
                }}
                className="bg-white border border-brand-border rounded-xl px-4 py-3 w-full text-sm text-brand-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all duration-200"
              />
              {fieldErrors.email && <p className="text-sm text-red-600 mt-1">{fieldErrors.email}</p>}
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="min 8 characters"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setFieldErrors({...fieldErrors, password: null});
                  }}
                  className="bg-white border border-brand-border rounded-xl px-4 py-3 w-full text-sm text-brand-dark placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary transition-all duration-200 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-brand-primary transition-colors focus:outline-none"
                >
                  {showPassword ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7 a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7 a10.025 10.025 0 01-4.132 5.411m0 0L21 21"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
                    </svg>
                  )}
                </button>
              </div>
              {fieldErrors.password && <p className="text-sm text-red-600 mt-1">{fieldErrors.password}</p>}
            </div>

            {error && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-700 mt-2 whitespace-pre-line">
                <svg className="h-4 w-4 mt-0.5 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" clipRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"/>
                </svg>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ background: 'linear-gradient(135deg, #6C63FF 0%, #FF6584 100%)' }}
              className="w-full text-white rounded-xl py-3 text-sm font-semibold hover:opacity-90 active:scale-[0.99] transition-all disabled:opacity-70 mt-4 flex justify-center items-center"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-4 w-4 mr-2 inline" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                  Creating account...
                </>
              ) : (
                'Create account'
              )}
            </button>
          </form>

          <div className="mt-8 text-center">
            <Link to="/login" className="text-sm text-brand-primary hover:text-brand-dark transition-colors font-semibold">
              Already have an account? Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
