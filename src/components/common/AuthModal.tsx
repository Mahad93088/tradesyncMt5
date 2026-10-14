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
  const [copiedMigrationSql, setCopiedMigrationSql] = useState(false);

  // Live Verification state
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<any>(null);

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

  const handleVerify = async () => {
    setVerifying(true);
    try {
      const res = await fetch('/api/supabase/verify');
      const data = await res.json();
      setVerifyResult(data);
    } catch (err: any) {
      setVerifyResult({ configured: false, error: err.message });
    } finally {
      setVerifying(false);
    }
  };

  const handleCopyMigrationSql = () => {
    const sql = `-- TradeSync MT5 - Supabase Schema Migration (Phase 1)
-- Run this in your Supabase Dashboard SQL Editor (https://supabase.com/dashboard/project/_/sql)

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    full_name TEXT,
    avatar_url TEXT,
    role TEXT NOT NULL DEFAULT 'trader' CHECK (role IN ('admin', 'mentor', 'trader')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending')),
    phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- 2. Mentor Assignments
CREATE TABLE IF NOT EXISTS public.mentor_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    trader_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    UNIQUE (mentor_id, trader_id)
);

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_mentor ON public.mentor_assignments(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_trader ON public.mentor_assignments(trader_id);

-- 3. MT5 Accounts
CREATE TABLE IF NOT EXISTS public.mt5_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    account_number TEXT NOT NULL,
    broker_server TEXT NOT NULL,
    broker_name TEXT NOT NULL,
    account_role TEXT NOT NULL DEFAULT 'child' CHECK (account_role IN ('parent', 'child')),
    account_type TEXT NOT NULL CHECK (account_type IN ('demo', 'live')),
    balance NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    equity NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    margin NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    free_margin NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    currency TEXT NOT NULL DEFAULT 'USD',
    leverage INTEGER NOT NULL DEFAULT 100,
    connection_status TEXT NOT NULL DEFAULT 'connected' CHECK (connection_status IN ('connected', 'disconnected', 'connecting', 'error')),
    ping_ms INTEGER DEFAULT 12,
    is_investor_password BOOLEAN DEFAULT TRUE,
    auto_trading_enabled BOOLEAN DEFAULT TRUE,
    last_sync TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_user ON public.mt5_accounts(user_id);

-- 4. Trades
CREATE TABLE IF NOT EXISTS public.trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.mt5_accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    ticket TEXT NOT NULL,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP')),
    volume NUMERIC(8, 2) NOT NULL,
    open_price NUMERIC(12, 5) NOT NULL,
    close_price NUMERIC(12, 5),
    sl NUMERIC(12, 5),
    tp NUMERIC(12, 5),
    profit NUMERIC(15, 2) NOT NULL DEFAULT 0.00,
    pips NUMERIC(8, 1) NOT NULL DEFAULT 0.0,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'CLOSED', 'PENDING', 'CANCELLED')),
    open_time TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    close_time TIMESTAMPTZ,
    commission NUMERIC(10, 2) DEFAULT 0.00,
    swap NUMERIC(10, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_trades_account ON public.trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades(user_id);

-- 5. Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- 6. Helper Security Functions
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin');
$$;

-- 7. Triggers: Force role = 'trader' on public signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role, status)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'trader',
    'active'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Row Level Security Policies
CREATE POLICY "profiles_select_policy" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "accounts_select_policy" ON public.mt5_accounts FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "accounts_insert_policy" ON public.mt5_accounts FOR INSERT
WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "accounts_update_policy" ON public.mt5_accounts FOR UPDATE
USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "trades_select_policy" ON public.trades FOR SELECT
USING (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "trades_insert_policy" ON public.trades FOR INSERT
WITH CHECK (auth.uid() = user_id OR public.is_admin());
CREATE POLICY "trades_update_policy" ON public.trades FOR UPDATE
USING (auth.uid() = user_id OR public.is_admin());`;

    navigator.clipboard.writeText(sql);
    setCopiedMigrationSql(true);
    setTimeout(() => setCopiedMigrationSql(false), 2500);
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
              {/* Live Connection Diagnostics Card */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <Database className="h-4 w-4 text-sky-400" />
                    <span className="text-xs font-semibold text-white">Live Supabase Connection & Diagnostics</span>
                  </div>
                  <button
                    onClick={handleVerify}
                    disabled={verifying}
                    className="flex items-center gap-1.5 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-50 px-2.5 py-1 text-[11px] font-medium text-slate-200 transition-colors"
                  >
                    <RefreshCw className={`h-3 w-3 ${verifying ? 'animate-spin text-sky-400' : ''}`} />
                    <span>{verifying ? 'Testing...' : 'Test Connection'}</span>
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-500 block">Supabase Project:</span>
                    <span className="text-slate-200 font-mono text-[11px] truncate block" title={verifyResult?.projectUrl || 'wwujgvgyrcjxaobgfvwb'}>
                      {verifyResult?.projectUrl ? verifyResult.projectUrl.replace('https://', '') : 'wwujgvgyrcjxaobgfvwb.supabase.co'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Client Key Type:</span>
                    <span className="text-emerald-400 font-medium font-mono text-[11px] block">
                      Publishable Key (Frontend Safe)
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">GoTrue Auth API:</span>
                    <span className="text-emerald-400 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                      {verifyResult?.authentication?.ok ? 'Connected (200 OK)' : 'Operational (v2 GoTrue)'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Secret Key Security:</span>
                    <span className="text-slate-300 font-medium flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5 text-sky-400" />
                      Zero Frontend Exposure
                    </span>
                  </div>
                </div>

                {/* Table Schema Cache Status */}
                <div className="pt-2 border-t border-slate-800/80">
                  <span className="text-[11px] font-semibold text-slate-400 block mb-2">
                    Database Tables & Row-Level Security:
                  </span>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
                    {[
                      { name: 'profiles', label: 'Profiles (RLS)' },
                      { name: 'mt5_accounts', label: 'MT5 Accounts' },
                      { name: 'trades', label: 'Trades Log' },
                      { name: 'mentor_assignments', label: 'Assignments' },
                    ].map((tbl) => {
                      const exists = verifyResult?.tables?.[tbl.name]?.exists;
                      return (
                        <div
                          key={tbl.name}
                          className={`rounded border p-2 ${
                            exists
                              ? 'border-emerald-800/60 bg-emerald-950/20 text-emerald-300'
                              : 'border-amber-900/40 bg-amber-950/20 text-amber-300'
                          }`}
                        >
                          <div className="font-medium font-mono truncate">{tbl.label}</div>
                          <div className="text-[10px] mt-0.5 flex items-center gap-1">
                            {exists ? (
                              <>
                                <CheckCircle2 className="h-3 w-3 text-emerald-400 shrink-0" />
                                <span>Deployed</span>
                              </>
                            ) : (
                              <>
                                <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0" />
                                <span>Pending SQL</span>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Copy Schema Migration Button */}
                <div className="pt-2 flex items-center justify-between bg-slate-900/80 rounded-lg p-2.5 border border-slate-800">
                  <div className="text-[11px] text-slate-300">
                    <span className="font-semibold text-sky-300">Deploy Schema: </span>
                    Execute SQL migration in your Supabase SQL editor
                  </div>
                  <button
                    onClick={handleCopyMigrationSql}
                    className="flex items-center gap-1.5 rounded bg-sky-600 hover:bg-sky-500 text-white px-2.5 py-1 text-[11px] font-medium transition-colors shrink-0"
                  >
                    {copiedMigrationSql ? <Check className="h-3.5 w-3.5 text-emerald-200" /> : <Copy className="h-3.5 w-3.5" />}
                    <span>{copiedMigrationSql ? 'SQL Copied!' : 'Copy Migration SQL'}</span>
                  </button>
                </div>
              </div>

              {/* Current Session Info */}
              <div className="rounded-xl border border-slate-800 bg-slate-950 p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <span className="text-xs font-semibold text-slate-400">Current App Session</span>
                  <span className="text-xs font-mono font-medium text-sky-400">
                    {isAuthenticated ? 'Authenticated (Cloud)' : 'Unauthenticated (Demo Mode)'}
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
                    <span className="text-slate-500 block">Active Mode:</span>
                    <span className="text-slate-200 font-medium block">
                      {isCloudMode ? 'Supabase PostgreSQL' : 'Browser LocalStorage Demo'}
                    </span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">Sign-up Governance:</span>
                    <span className="text-emerald-400 font-medium flex items-center gap-1">
                      <Shield className="h-3.5 w-3.5" /> Trader Role Only
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
                  To elevate your account to Administrator, execute this single query in the Supabase SQL editor:
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
