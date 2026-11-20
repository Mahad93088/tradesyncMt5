import React, { useState, useEffect } from 'react';
import {
  Terminal,
  Lock,
  Mail,
  User as UserIcon,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Shield,
  RefreshCw,
  ArrowRight,
  Layers,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export const LoginPage: React.FC = () => {
  const {
    isConfigured,
    isRecoveryMode,
    signIn,
    signUp,
    resetPassword,
    updatePassword,
    clearRecoveryMode,
    switchToDemoMode,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    setErrorMsg(null);
    setSuccessMsg(null);
  }, [activeTab, isRecoveryMode]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    const res = await signIn(email, password);
    setSubmitting(false);
    if (!res.success) {
      setErrorMsg(res.error || 'Invalid credentials or unable to reach authentication service.');
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (fullName.trim().length < 2) {
      setErrorMsg('Please enter your full name (at least 2 characters).');
      return;
    }
    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const res = await signUp(email, password, fullName);
    setSubmitting(false);

    if (res.success) {
      setSuccessMsg(
        'Trader account created. If email confirmation is enabled, check your inbox before signing in.'
      );
      setPassword('');
      setConfirmPassword('');
    } else {
      setErrorMsg(res.error || 'Unable to register account.');
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);
    const res = await resetPassword(email);
    setSubmitting(false);

    if (res.success) {
      setSuccessMsg('Password recovery instructions sent. Check your inbox to set a new password.');
    } else {
      setErrorMsg(res.error || 'Failed to dispatch password reset email.');
    }
  };

  const handleCompleteRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (newPassword.length < 6) {
      setErrorMsg('New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    setSubmitting(true);
    const res = await updatePassword(newPassword);
    setSubmitting(false);

    if (res.success) {
      setSuccessMsg('Password updated successfully. Signing you into your workspace...');
      setNewPassword('');
      setConfirmNewPassword('');
    } else {
      setErrorMsg(res.error || 'Failed to update password.');
    }
  };

  return (
    <div className="min-h-screen bg-[#0B1220] text-slate-100 flex flex-col justify-between p-4 sm:p-8 font-sans">
      {/* Top Wordmark */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between gap-8 py-2">
        <div className="flex items-center gap-2.5 whitespace-nowrap shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 border border-slate-700 text-sky-400">
            <Terminal className="h-4 w-4" />
          </div>
          <span className="text-base font-bold tracking-tight text-white">TradeSync MT5</span>
        </div>
        <div className="text-xs text-slate-400 font-mono whitespace-nowrap shrink-0">
          Demo-Only Trade Copier Bridge
        </div>
      </header>

      {/* Main Split Workspace */}
      <main className="max-w-5xl w-full mx-auto my-auto py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
        {/* Left: Platform Architecture Overview */}
        <section className="lg:col-span-6 flex flex-col justify-between rounded-xl border border-slate-800 bg-slate-900/70 p-6 sm:p-8 space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-xs text-sky-400 font-mono">
              <span>Role-Isolated Access</span>
              <span aria-hidden="true">·</span>
              <span>MT5 Demo Bridge</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white text-balance leading-tight">
              Automated MetaTrader 5 Copy Trading Portal
            </h1>
            <p className="text-sm text-slate-300 leading-relaxed">
              Sign in with your verified credentials to access your assigned workspace. Permissions, subscriptions, and terminal telemetry are strictly partitioned by role.
            </p>
          </div>

          <div className="space-y-4 border-t border-slate-800 pt-5 text-xs">
            <div className="flex items-start gap-3">
              <Shield className="h-4 w-4 text-sky-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-100">Three Independent Role Portals</p>
                <p className="text-slate-400 mt-0.5 leading-relaxed">
                  Super Admin governance, Mentor strategy broadcasting &amp; student hubs, and Follower Trader execution workspaces.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Layers className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-slate-100">Strict Demo Account Safeguards</p>
                <p className="text-slate-400 mt-0.5 leading-relaxed">
                  Both MQL5 Expert Advisors and cloud bridge APIs enforce <code className="font-mono text-slate-200">ACCOUNT_TRADE_MODE_DEMO</code> and broker-specific symbol verification.
                </p>
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
            <span>Prefer offline evaluation?</span>
            <button
              type="button"
              onClick={() => switchToDemoMode('admin')}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition-colors whitespace-nowrap shrink-0"
            >
              <span>Enter Demo Sandbox</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>

        {/* Right: Auth Card */}
        <section className="lg:col-span-6 rounded-xl border border-slate-800 bg-slate-900 p-6 sm:p-8 flex flex-col justify-center">
          {isRecoveryMode ? (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-bold text-white flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-sky-400" />
                  <span>Set New Account Password</span>
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Enter and confirm your new password to complete account recovery.
                </p>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 p-3 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              <form onSubmit={handleCompleteRecovery} className="space-y-4 text-xs">
                <div>
                  <label className="block font-medium text-slate-300 mb-1.5">New Password</label>
                  <input
                    type="password"
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block font-medium text-slate-300 mb-1.5">Confirm New Password</label>
                  <input
                    type="password"
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter new password"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-2.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>Update Password</span>
                  </button>
                  <button
                    type="button"
                    onClick={clearRecoveryMode}
                    className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-4 py-2.5 text-xs font-medium text-slate-300"
                  >
                    Back
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Tabs */}
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-950 border border-slate-800">
                <button
                  type="button"
                  onClick={() => setActiveTab('signin')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeTab === 'signin'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Sign In
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('signup')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeTab === 'signup'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Create Trader Account
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab('reset')}
                  className={`flex-1 py-2 px-3 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    activeTab === 'reset'
                      ? 'bg-slate-800 text-white'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Reset Password
                </button>
              </div>

              {!isConfigured && (
                <div className="rounded-lg border border-amber-900/50 bg-amber-950/30 p-3 text-xs text-amber-300 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                  <span>
                    Supabase environment variables are not configured. Use <strong>Enter Demo Sandbox</strong> to explore locally.
                  </span>
                </div>
              )}

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-300">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {successMsg && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-900/60 bg-emerald-950/40 p-3 text-xs text-emerald-300">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
                  <span>{successMsg}</span>
                </div>
              )}

              {activeTab === 'signin' && (
                <form onSubmit={handleSignIn} className="space-y-4 text-xs">
                  <div className="space-y-1.5">
                    <label className="block font-medium text-slate-300">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="email"
                        required
                        autoComplete="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@domain.com"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="block font-medium text-slate-300">Password</label>
                      <button
                        type="button"
                        onClick={() => setActiveTab('reset')}
                        className="text-[11px] text-sky-400 hover:text-sky-300"
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="password"
                        required
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="••••••••••••"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !isConfigured}
                    className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-2.5 px-4 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>Sign In to Workspace</span>
                  </button>
                </form>
              )}

              {activeTab === 'signup' && (
                <form onSubmit={handleSignUp} className="space-y-3.5 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950/70 p-3 text-[11px] text-slate-300">
                    Self-registration creates a <strong>Follower Trader</strong> account. Mentor accounts are provisioned by your platform administrator.
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-300">Full Name</label>
                    <div className="relative">
                      <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="text"
                        required
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        placeholder="Jordan Miller"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="block font-medium text-slate-300">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="trader@domain.com"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="block font-medium text-slate-300">Password</label>
                      <input
                        type="password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Min 6 characters"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="block font-medium text-slate-300">Confirm Password</label>
                      <input
                        type="password"
                        required
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        placeholder="Repeat password"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !isConfigured}
                    className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2.5 px-4 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>Create Trader Account</span>
                  </button>
                </form>
              )}

              {activeTab === 'reset' && (
                <form onSubmit={handleReset} className="space-y-4 text-xs">
                  <p className="text-slate-300 leading-relaxed">
                    Enter your registered email address to receive a password reset link.
                  </p>
                  <div className="space-y-1.5">
                    <label className="block font-medium text-slate-300">Email Address</label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="you@domain.com"
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 pl-9 pr-3 py-2.5 text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                      />
                    </div>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting || !isConfigured}
                    className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-2.5 px-4 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
                  >
                    {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                    <span>Send Recovery Link</span>
                  </button>
                </form>
              )}
            </div>
          )}
        </section>
      </main>

      <footer className="max-w-5xl w-full mx-auto py-2 flex items-center justify-between text-[11px] text-slate-500">
        <span>TradeSync MT5</span>
        <span>Demo-only automated trade copying · No live real-money execution</span>
      </footer>
    </div>
  );
};
