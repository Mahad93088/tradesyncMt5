import React, { useState } from 'react';
import {
  X,
  Lock,
  Mail,
  User as UserIcon,
  Shield,
  KeyRound,
  CheckCircle2,
  AlertTriangle,
  Database,
  Cloud,
  ArrowRight,
  Server,
  Copy,
  Check,
  RefreshCw,
  LogOut
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { supabaseDataService, MigrationResult } from '../../services/supabaseDataService';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const {
    session,
    user,
    isAuthenticated,
    isCloudMode,
    isConfigured,
    isLoading,
    signIn,
    signUp,
    signOut,
    resetPassword,
    switchToDemoMode,
    switchToCloudMode,
  } = useAuth();

  const [activeTab, setActiveTab] = useState<'signin' | 'signup' | 'reset' | 'status' | 'migration'>('signin');

  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Migration states
  const [migrationRunning, setMigrationRunning] = useState(false);
  const [migrationResult, setMigrationResult] = useState<MigrationResult | null>(null);

  // Clipboard state
  const [copiedSql, setCopiedSql] = useState(false);

  if (!isOpen) return null;

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubmitting(true);

    const res = await signIn(email, password);
    setSubmitting(false);

    if (res.success) {
      setSuccessMsg('Successfully signed in to Supabase Cloud!');
      setTimeout(() => {
        onClose();
      }, 1200);
    } else {
      setErrorMsg(res.error || 'Failed to sign in. Verify credentials or connection.');
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);

    if (password !== confirmPassword) {
      setErrorMsg('Passwords do not match.');
      return;
    }

    if (password.length < 6) {
      setErrorMsg('Password must be at least 6 characters.');
      return;
    }

    setSubmitting(true);
    const res = await signUp(email, password, fullName);
    setSubmitting(false);

    if (res.success) {
      setSuccessMsg(
        'Account created with Trader role! If email verification is enabled on your Supabase project, check your inbox to confirm your email.'
      );
      setTimeout(() => {
        setActiveTab('signin');
      }, 3000);
    } else {
      setErrorMsg(res.error || 'Registration failed.');
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
      setSuccessMsg('Password recovery email dispatched. Check your inbox.');
    } else {
      setErrorMsg(res.error || 'Failed to send recovery email.');
    }
  };

  const handleRunMigration = async () => {
    if (!user?.id) return;
    setMigrationRunning(true);
    setErrorMsg(null);

    const result = await supabaseDataService.migrateLocalDataToCloud(user.id);
    setMigrationRunning(false);
    setMigrationResult(result);

    if (result.errors.length === 0) {
      setSuccessMsg(`Migrated ${result.accountsMigrated} accounts and ${result.tradesMigrated} trades to Supabase Cloud!`);
    }
  };

  const handleCopySqlHint = () => {
    navigator.clipboard.writeText(
      `-- Bootstrap Admin Query (Run in Supabase SQL Editor):\nUPDATE public.profiles\nSET role = 'admin'\nWHERE email = '${email || 'your-admin@email.com'}';`
    );
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="relative w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden my-8">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-sky-950 p-2 text-sky-400 border border-sky-800/60">
              <Cloud className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-white">TradeSync Cloud Authentication</h3>
                <span
                  className={`rounded border text-[10px] px-2 py-0.5 font-mono uppercase font-semibold ${
                    isCloudMode
                      ? 'border-emerald-800 bg-emerald-950 text-emerald-400'
                      : isConfigured
                      ? 'border-amber-800 bg-amber-950 text-amber-400'
                      : 'border-slate-700 bg-slate-800 text-slate-400'
                  }`}
                >
                  {isCloudMode ? 'Cloud Connected' : isConfigured ? 'Ready to Connect' : 'Demo Fallback'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Supabase PostgreSQL persistence, Row-Level Security & Role Governance
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-800 bg-slate-950/60 px-6">
          {!isAuthenticated ? (
            <>
              <button
                onClick={() => {
                  setActiveTab('signin');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  activeTab === 'signin'
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Sign In
              </button>
              <button
                onClick={() => {
                  setActiveTab('signup');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  activeTab === 'signup'
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Create Account
              </button>
              <button
                onClick={() => {
                  setActiveTab('reset');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                }}
                className={`border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  activeTab === 'reset'
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Password Reset
              </button>
            </>
          ) : (
            <>
              <button
                onClick={() => setActiveTab('status')}
                className={`border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  activeTab === 'status'
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Active Session
              </button>
              <button
                onClick={() => setActiveTab('migration')}
                className={`border-b-2 px-4 py-3 text-xs font-semibold transition-colors ${
                  activeTab === 'migration'
                    ? 'border-sky-400 text-sky-300'
                    : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                Cloud Data Sync
              </button>
            </>
          )}
          <button
            onClick={() => setActiveTab('status')}
            className={`border-b-2 px-4 py-3 text-xs font-semibold transition-colors ml-auto ${
              activeTab === 'status'
                ? 'border-sky-400 text-sky-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            System Status
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* Notification Messages */}
          {errorMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-rose-900/60 bg-rose-950/40 p-3 text-xs text-rose-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-rose-400 mt-0.5" />
              <div>{errorMsg}</div>
            </div>
          )}

          {successMsg && (
            <div className="flex items-start gap-2.5 rounded-lg border border-emerald-900/60 bg-emerald-950/40 p-3 text-xs text-emerald-300">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400 mt-0.5" />
              <div>{successMsg}</div>
            </div>
          )}

          {/* SIGN IN TAB */}
          {activeTab === 'signin' && (
            <form onSubmit={handleSignIn} className="space-y-4">
              {!isConfigured && (
                <div className="rounded-lg border border-amber-900/40 bg-amber-950/30 p-3 text-xs text-amber-300">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
                    <div>
                      <p className="font-semibold">Supabase Environment Unconfigured</p>
                      <p className="text-slate-300 mt-0.5">
                        <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> are not yet set in environment. You can explore the platform in <strong>Demo Simulator Mode</strong>, or configure keys in <code>.env</code> / AI Studio secrets.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@tradesync.io"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setActiveTab('reset')}
                  className="text-[11px] text-sky-400 hover:text-sky-300 underline"
                >
                  Forgot password?
                </button>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-2.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Sign In to Cloud</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    switchToDemoMode('admin');
                    onClose();
                  }}
                  className="rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-750 px-4 py-2.5 text-xs font-medium text-slate-300 hover:text-white transition-colors"
                >
                  Use Demo Mode
                </button>
              </div>
            </form>
          )}

          {/* SIGN UP TAB (STRICT ZERO SELF-ASSIGNED ADMIN) */}
          {activeTab === 'signup' && (
            <form onSubmit={handleSignUp} className="space-y-4">
              {/* Security Banner */}
              <div className="rounded-lg border border-sky-900/60 bg-sky-950/40 p-3 text-xs text-sky-200">
                <div className="flex items-start gap-2.5">
                  <Shield className="h-4 w-4 shrink-0 text-sky-400 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-semibold text-sky-100">Public Registration Security Policy</p>
                    <p className="text-[11px] text-sky-300/90 leading-relaxed">
                      Public registration automatically and strictly assigns the <strong>Trader (Child)</strong> role via database trigger.
                      Super Admin privileges can <strong>never</strong> be self-assigned and must be promoted via verified server-side process or database administrator execution.
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Full Name</label>
                <div className="relative">
                  <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Jordan Miller"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@tradesync.io"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Confirm Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                    <input
                      type="password"
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                    />
                  </div>
                </div>
              </div>

              <div className="pt-2">
                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 py-2.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                  <span>Register as Trader</span>
                </button>
              </div>
            </form>
          )}

          {/* RESET PASSWORD TAB */}
          {activeTab === 'reset' && (
            <form onSubmit={handleReset} className="space-y-4">
              <p className="text-xs text-slate-300">
                Enter your registered email address. Supabase Auth will transmit a secure recovery link.
              </p>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="trader@tradesync.io"
                    className="w-full rounded-lg border border-slate-700 bg-slate-800/80 pl-9 pr-3 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={submitting}
                className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-2.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
              >
                {submitting && <RefreshCw className="h-3.5 w-3.5 animate-spin" />}
                <span>Send Reset Link</span>
              </button>
            </form>
          )}

          {/* ACTIVE SESSION / STATUS TAB */}
          {activeTab === 'status' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <div className="flex items-center justify-between pb-3 border-b border-slate-800">
                  <span className="text-xs font-semibold text-slate-400">Current Auth State</span>
                  <span className="text-xs font-mono font-medium text-sky-400">
                    {isAuthenticated ? 'Authenticated' : 'Unauthenticated (Demo)'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">User Email:</span>
                    <span className="text-slate-200 font-medium font-mono truncate block">
                      {user.email || 'None'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Active Role:</span>
                    <span className="text-sky-300 font-semibold font-mono uppercase block">
                      {user.role}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Persistence Mode:</span>
                    <span className="text-slate-200 font-medium block">
                      {isCloudMode ? 'Supabase PostgreSQL' : 'Browser LocalStorage'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">RLS Enforced:</span>
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Active in PostgreSQL
                    </span>
                  </div>
                </div>
              </div>

              {/* Bootstrap Admin helper query */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-300">
                    Admin Bootstrap SQL (Safe Elevation)
                  </span>
                  <button
                    onClick={handleCopySqlHint}
                    className="flex items-center gap-1 text-[11px] text-sky-400 hover:text-sky-300 font-medium"
                  >
                    {copiedSql ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedSql ? 'Copied' : 'Copy SQL'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  To grant Super Admin to your initial account, execute this query once in your Supabase SQL editor:
                </p>
                <pre className="rounded bg-slate-900 border border-slate-800 p-2.5 font-mono text-[11px] text-slate-300 overflow-x-auto">
{`UPDATE public.profiles
SET role = 'admin'
WHERE email = '${user.email || 'your-admin@email.com'}';`}
                </pre>
              </div>

              {isAuthenticated && (
                <div className="flex justify-end pt-2">
                  <button
                    onClick={async () => {
                      await signOut();
                      onClose();
                    }}
                    className="flex items-center gap-2 rounded-lg border border-rose-900/60 bg-rose-950/30 hover:bg-rose-900/40 text-rose-300 px-4 py-2 text-xs font-medium transition-colors"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* MIGRATION TAB */}
          {activeTab === 'migration' && (
            <div className="space-y-4">
              <div className="rounded-xl border border-sky-900/40 bg-sky-950/30 p-4 space-y-2">
                <h4 className="text-xs font-bold text-sky-200 flex items-center gap-2">
                  <Cloud className="h-4 w-4" />
                  Migrate Local Demo Portfolio to Supabase
                </h4>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Transfer existing MT5 demo accounts, trades, and configurations stored in your browser's local storage directly into persistent PostgreSQL tables under your authenticated user ID (<code>{user.id}</code>).
                </p>
              </div>

              {migrationResult && (
                <div className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs space-y-1.5 font-mono">
                  <div className="text-emerald-400 font-semibold">
                    ✓ Accounts Migrated: {migrationResult.accountsMigrated}
                  </div>
                  <div className="text-emerald-400 font-semibold">
                    ✓ Trades Migrated: {migrationResult.tradesMigrated}
                  </div>
                  {migrationResult.errors.length > 0 && (
                    <div className="text-rose-400 pt-1">
                      {migrationResult.errors.map((err, i) => (
                        <div key={i}>⚠ {err}</div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <button
                onClick={handleRunMigration}
                disabled={migrationRunning}
                className="w-full rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-50 py-2.5 text-xs font-semibold text-white transition-colors flex items-center justify-center gap-2"
              >
                {migrationRunning ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    <span>Migrating data to Supabase...</span>
                  </>
                ) : (
                  <>
                    <ArrowRight className="h-4 w-4" />
                    <span>Start Migration</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
