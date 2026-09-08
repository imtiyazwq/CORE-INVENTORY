import React, { useState } from 'react';
import {
  Lock,
  User,
  Users,
  KeyRound,
  LogIn,
  UserPlus,
  CheckCircle2,
  AlertCircle,
  Cpu,
  Eye,
  EyeOff,
} from 'lucide-react';
import { authService, PREDEFINED_TEAMS } from '../services/authService';
import { UserAccount } from '../types';

interface AuthPageProps {
  onAuthenticated?: (user: UserAccount) => void;
  onLoginSuccess?: (user: UserAccount) => void;
}

export const AuthPage: React.FC<AuthPageProps> = ({ onAuthenticated, onLoginSuccess }) => {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const notifyAuthenticated = (user: UserAccount) => {
    if (onLoginSuccess) onLoginSuccess(user);
    if (onAuthenticated) onAuthenticated(user);
  };

  // Form State
  const [userId, setUserId] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [teamName, setTeamName] = useState('Warehouse Team A');
  const [customTeam, setCustomTeam] = useState('');
  const [isCustomTeam, setIsCustomTeam] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!userId.trim()) {
      setError('Please enter your User ID.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authService.login(userId, password);
      if (res.success && res.user) {
        notifyAuthenticated(res.user);
      } else {
        setError(res.message || 'Login failed. Please check your credentials.');
      }
    } catch {
      setError('An unexpected error occurred during login.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!userId.trim()) {
      setError('Please enter a desired User ID.');
      return;
    }
    const finalTeam = isCustomTeam ? customTeam.trim() : teamName;
    if (!finalTeam) {
      setError('Please specify or select a Team Name.');
      return;
    }
    if (!password) {
      setError('Password is required.');
      return;
    }
    if (!confirmPassword) {
      setError('Please confirm your password.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await authService.signUp({
        userId: userId.trim(),
        teamName: finalTeam,
        password: password,
      });
      if (res.success && res.user) {
        notifyAuthenticated(res.user);
      } else {
        setError(res.message || 'Sign up failed.');
      }
    } catch {
      setError('An unexpected error occurred during registration.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0f172a] flex flex-col justify-center items-center px-4 py-12 relative overflow-hidden select-none">
      {/* Background Accent Graphics */}
      <div className="absolute -top-32 -left-32 w-96 h-96 bg-[#005f60]/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

      {/* Main Container */}
      <div className="w-full max-w-md relative z-10 space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#005f60] text-white shadow-lg border border-teal-400/30 mb-2">
            <svg
              className="w-7 h-7 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L3 7v10l9 5 9-5V7L12 2z" />
              <path d="M12 22V12" />
              <path d="M21 7l-9 5L3 7" />
              <path d="M7.5 9.5l4.5 2.5 4.5-2.5" stroke="#5eead4" strokeWidth="1.4" opacity="0.85" />
              <circle cx="12" cy="7" r="1.5" fill="#5eead4" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-white tracking-wider uppercase">
            CORE INVENTORY
          </h1>
          <p className="text-xs text-teal-300 font-mono flex items-center justify-center gap-1.5">
            <Cpu className="w-3.5 h-3.5" />
            AI-Powered YOLO Vision & Multi-Store Ledger
          </p>
        </div>

        {/* Authentication Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-xl overflow-hidden">
          {/* Tabs */}
          <div className="flex border-b border-slate-200 bg-slate-50/80">
            <button
              type="button"
              onClick={() => {
                setMode('login');
                setError(null);
              }}
              className={`flex-1 py-3 text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                mode === 'login'
                  ? 'bg-white text-[#005f60] border-b-2 border-[#005f60] shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode('signup');
                setError(null);
              }}
              className={`flex-1 py-3 text-xs font-bold transition-colors flex items-center justify-center gap-2 ${
                mode === 'signup'
                  ? 'bg-white text-[#005f60] border-b-2 border-[#005f60] shadow-2xs'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5" />
              Create Account
            </button>
          </div>

          <div className="p-6 space-y-5">
            {error && (
              <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-start gap-2 animate-in fade-in">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            {mode === 'login' ? (
              /* LOGIN FORM */
              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    User ID
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      placeholder="e.g. john_smith"
                      className="w-full text-xs pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900 font-medium"
                      autoFocus
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full text-xs pl-9 pr-10 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                      title={showPassword ? 'Hide password' : 'Show password'}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <LogIn className="w-4 h-4" />
                  {isLoading ? 'Verifying...' : 'Access Inventory System'}
                </button>

                <div className="text-center pt-1">
                  <span className="text-[11px] text-slate-500">
                    Don't have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('signup')}
                      className="text-[#005f60] font-bold hover:underline"
                    >
                      Sign Up
                    </button>
                  </span>
                </div>
              </form>
            ) : (
              /* SIGN UP FORM */
              <form onSubmit={handleSignUp} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    User ID <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={userId}
                      onChange={(e) => setUserId(e.target.value)}
                      placeholder="e.g. alex_rivera"
                      className="w-full text-xs pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900 font-medium"
                      autoFocus
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    Unique identifier used to sign actions & scan logs.
                  </p>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-slate-700">
                      Team Name <span className="text-rose-500">*</span>
                    </label>
                    <button
                      type="button"
                      onClick={() => setIsCustomTeam(!isCustomTeam)}
                      className="text-[10px] text-[#005f60] font-semibold hover:underline"
                    >
                      {isCustomTeam ? 'Select Existing Team' : '+ Custom Team'}
                    </button>
                  </div>

                  {isCustomTeam ? (
                    <div className="relative">
                      <Users className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={customTeam}
                        onChange={(e) => setCustomTeam(e.target.value)}
                        placeholder="e.g. Quality Assurance Team"
                        className="w-full text-xs pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900 font-medium"
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <Users className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <select
                        value={teamName}
                        onChange={(e) => setTeamName(e.target.value)}
                        className="w-full text-xs pl-9 pr-3 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900 font-medium"
                      >
                        {PREDEFINED_TEAMS.map((tm) => (
                          <option key={tm} value={tm}>
                            {tm}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">
                    All YOLO scans and audit confirmations will be attributed to this team.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Password <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full text-xs pl-9 pr-10 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                        title={showPassword ? 'Hide password' : 'Show password'}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Confirm Password <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <KeyRound className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="••••••••"
                        className="w-full text-xs pl-9 pr-10 py-2 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-[#005f60] bg-white text-slate-900"
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 focus:outline-none cursor-pointer"
                        title={showConfirmPassword ? 'Hide password' : 'Show password'}
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                      >
                        {showConfirmPassword ? (
                          <EyeOff className="w-4 h-4" />
                        ) : (
                          <Eye className="w-4 h-4" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#005f60] hover:bg-[#004d4e] text-white text-xs font-bold shadow-md transition-colors flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" />
                  {isLoading ? 'Creating Account...' : 'Register & Log In'}
                </button>

                <div className="text-center pt-1">
                  <span className="text-[11px] text-slate-500">
                    Already have an account?{' '}
                    <button
                      type="button"
                      onClick={() => setMode('login')}
                      className="text-[#005f60] font-bold hover:underline"
                    >
                      Sign In
                    </button>
                  </span>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
