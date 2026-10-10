-- ==============================================================================
-- TradeSync MT5 - Supabase PostgreSQL Schema & Security Policies (Phase 1)
--
-- Security Enforcement:
-- 1. Public signups are strictly constrained to the 'trader' role via trigger.
-- 2. Admin accounts can NEVER be created through public registration.
-- 3. Row-Level Security (RLS) policies strictly enforce Mentor and Trader access.
-- 4. Self-promotion and unauthorized role alteration are blocked at database level.
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. Profiles Table (extends auth.users)
-- ------------------------------------------------------------------------------
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

-- Index for fast lookups by role and status
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- ------------------------------------------------------------------------------
-- 2. Mentor Assignments & Parent-Child Relationships
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 3. MT5 Accounts Table
-- ------------------------------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_number ON public.mt5_accounts(account_number);

-- ------------------------------------------------------------------------------
-- 4. Trades Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id UUID NOT NULL REFERENCES public.mt5_accounts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    ticket TEXT NOT NULL,
    symbol TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('BUY', 'SELL', 'BUY_LIMIT', 'SELL_LIMIT', 'BUY_STOP', 'SELL_STOP')),
    volume NUMERIC(10, 2) NOT NULL,
    open_price NUMERIC(15, 5) NOT NULL,
    close_price NUMERIC(15, 5),
    sl NUMERIC(15, 5),
    tp NUMERIC(15, 5),
    profit NUMERIC(15, 2) DEFAULT 0.00,
    pips NUMERIC(10, 1) DEFAULT 0.0,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'PENDING', 'CANCELLED')),
    open_time TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    close_time TIMESTAMPTZ,
    commission NUMERIC(10, 2) DEFAULT 0.00,
    swap NUMERIC(10, 2) DEFAULT 0.00,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_account ON public.trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON public.trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_ticket ON public.trades(ticket);

-- ------------------------------------------------------------------------------
-- 5. Trade Feedback Table (Mentor Reviews for Traders)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    grade TEXT CHECK (grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_trade_feedback_trade ON public.trade_feedback(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_feedback_author ON public.trade_feedback(author_id);

-- ------------------------------------------------------------------------------
-- 6. Helper Security Functions (SECURITY DEFINER)
-- ------------------------------------------------------------------------------

-- Check if current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin'
  );
$$;

-- Check if current user is a mentor
CREATE OR REPLACE FUNCTION public.is_mentor()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'mentor'
  );
$$;

-- Check if current user is the assigned mentor of a specific trader
CREATE OR REPLACE FUNCTION public.is_mentor_of(target_trader_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mentor_assignments
    WHERE mentor_id = auth.uid()
      AND trader_id = target_trader_id
      AND status = 'active'
  );
$$;

-- ------------------------------------------------------------------------------
-- 7. Public Signup Security: Strict Forced 'trader' Default Trigger
-- ------------------------------------------------------------------------------
-- CRITICAL SECURITY REQUIREMENT:
-- Public registration must NEVER allow users to assign themselves 'admin' or 'mentor'.
-- Any role passed in client raw_user_meta_data is explicitly ignored.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    role,
    status
  )
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
    'trader', -- ENFORCED: Public registrations always default strictly to 'trader'
    'active'
  );
  RETURN NEW;
END;
$$;

-- Drop trigger if exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 8. Privilege Escalation Guard Trigger
-- ------------------------------------------------------------------------------
-- Users must NEVER be able to update their own 'role' column.
-- Only an active admin or the backend service_role can modify user roles.
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (OLD.role IS DISTINCT FROM NEW.role) THEN
    -- Check if caller is admin or service_role
    IF NOT (public.is_admin() OR current_user = 'service_role' OR session_user = 'service_role') THEN
      RAISE EXCEPTION 'Privilege escalation blocked: Users cannot modify their own role. Admin authorization required.';
    END IF;
  END IF;

  NEW.updated_at = timezone('utc'::text, now());
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_role();

-- ------------------------------------------------------------------------------
-- 9. Row-Level Security (RLS) Policies
-- ------------------------------------------------------------------------------

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_feedback ENABLE ROW LEVEL SECURITY;

-- ---- PROFILES POLICIES ----
-- SELECT: Users see their own profile, Mentors see assigned traders, Admins see all
CREATE POLICY "profiles_select_policy"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin()
    OR public.is_mentor_of(id)
  );

-- UPDATE: Users can update their own non-role fields; Admins can update any
CREATE POLICY "profiles_update_policy"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR public.is_admin()
  );

-- INSERT: Insert is handled by handle_new_user() trigger or Admin
CREATE POLICY "profiles_insert_policy"
  ON public.profiles FOR INSERT
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin()
  );

-- DELETE: Admins only
CREATE POLICY "profiles_delete_policy"
  ON public.profiles FOR DELETE
  USING (public.is_admin());

-- ---- MENTOR_ASSIGNMENTS POLICIES ----
-- SELECT: Mentors see their assigned traders, Traders see their mentor, Admins see all
CREATE POLICY "mentor_assignments_select_policy"
  ON public.mentor_assignments FOR SELECT
  USING (
    mentor_id = auth.uid()
    OR trader_id = auth.uid()
    OR public.is_admin()
  );

-- INSERT / UPDATE / DELETE: Restricted strictly to Admins (or service role)
CREATE POLICY "mentor_assignments_admin_all"
  ON public.mentor_assignments FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ---- MT5_ACCOUNTS POLICIES ----
-- SELECT: Traders see own accounts, Mentors see assigned traders' accounts, Admins see all
CREATE POLICY "mt5_accounts_select_policy"
  ON public.mt5_accounts FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.is_mentor_of(user_id)
  );

-- INSERT: Traders manage own accounts, Admins can provision
CREATE POLICY "mt5_accounts_insert_policy"
  ON public.mt5_accounts FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- UPDATE: Traders update own accounts; Mentors have NO update rights; Admins can update
CREATE POLICY "mt5_accounts_update_policy"
  ON public.mt5_accounts FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- DELETE: Traders delete own accounts, Admins can delete
CREATE POLICY "mt5_accounts_delete_policy"
  ON public.mt5_accounts FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- ---- TRADES POLICIES ----
-- SELECT: Traders see own trades, Mentors see assigned traders' trades, Admins see all
CREATE POLICY "trades_select_policy"
  ON public.trades FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.is_mentor_of(user_id)
  );

-- INSERT: Owning trader can insert trades; Admins can insert; Mentors cannot insert
CREATE POLICY "trades_insert_policy"
  ON public.trades FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- UPDATE: Owning trader can update; Mentors have READ-ONLY access (cannot execute/modify); Admins can update
CREATE POLICY "trades_update_policy"
  ON public.trades FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- DELETE: Owning trader or Admin
CREATE POLICY "trades_delete_policy"
  ON public.trades FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- ---- TRADE_FEEDBACK POLICIES ----
-- SELECT: Visible to trade owner, feedback author, and Admins
CREATE POLICY "trade_feedback_select_policy"
  ON public.trade_feedback FOR SELECT
  USING (
    author_id = auth.uid()
    OR public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.trades t
      WHERE t.id = trade_feedback.trade_id AND t.user_id = auth.uid()
    )
  );

-- INSERT: Mentors can post feedback on trades belonging to their assigned traders; Admins can post
CREATE POLICY "trade_feedback_insert_policy"
  ON public.trade_feedback FOR INSERT
  WITH CHECK (
    public.is_admin()
    OR (
      author_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.trades t
        WHERE t.id = trade_feedback.trade_id AND public.is_mentor_of(t.user_id)
      )
    )
  );

-- UPDATE / DELETE: Feedback author or Admin
CREATE POLICY "trade_feedback_modify_policy"
  ON public.trade_feedback FOR UPDATE
  USING (author_id = auth.uid() OR public.is_admin());

CREATE POLICY "trade_feedback_delete_policy"
  ON public.trade_feedback FOR DELETE
  USING (author_id = auth.uid() OR public.is_admin());

-- ==============================================================================
-- 10. Bootstrap First Super Admin (Manual Execution in Supabase SQL Editor)
--
-- After creating your primary user via Supabase Auth UI or app sign up:
-- UPDATE public.profiles
-- SET role = 'admin'
-- WHERE email = 'admin@yourcompany.com';
-- ==============================================================================
