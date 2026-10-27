-- ==============================================================================
-- TradeSync MT5 - Complete Production Supabase PostgreSQL Migration
-- ==============================================================================
-- Features & Security Audited:
-- 1. Anti-Self-Assignment: Users cannot assign themselves as mentors.
-- 2. Anti-Tamper Triggers: Assignment and feedback ownership cannot be transferred or hijacked.
-- 3. Mentor Verification: Only verified active users with role = 'mentor' can be mentors.
-- 4. Profile Privacy: RLS restricts profiles to owner, admin, and active mentor-trader links.
-- 5. Mentor Directory View: Exposes only public fields (id, name, avatar, role, status) to visitors.
-- 6. Anti-Privilege Escalation: Users cannot modify their own 'role' or 'status' column.
-- 7. Anti-Hijacking UPDATE: WITH CHECK prevents reassigning account, trade, or feedback ownership.
-- 8. Existing Table Resilient: Safe IF NOT EXISTS + ALTER TABLE ADD COLUMN IF NOT EXISTS.
-- 9. Existing User Backfill: Pre-existing auth.users automatically initialized as 'trader'.
-- 10. Restricted PostgREST Grants: PostgREST cannot access promote_user_to_admin or raw profiles for anon.
-- ==============================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

-- Backward-compatibility column assertions
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'trader';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- Indexes for profiles
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_status ON public.profiles(status);

-- ------------------------------------------------------------------------------
-- 1.1 Public Mentor Directory View
-- Provides safe, restricted discovery of active mentors without exposing
-- private fields (email, phone, created_at, updated_at).
-- Executes as view owner (security_invoker = false) with security_barrier.
-- ------------------------------------------------------------------------------
DROP VIEW IF EXISTS public.mentor_directory;
CREATE VIEW public.mentor_directory
WITH (security_barrier = true)
AS
SELECT 
    id, 
    full_name, 
    avatar_url, 
    role, 
    status
FROM public.profiles
WHERE role = 'mentor' AND status = 'active';

COMMENT ON VIEW public.mentor_directory IS 'Public catalog of verified active mentors exposing only public profile attributes.';

-- ------------------------------------------------------------------------------
-- 2. Mentor Assignments Table
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mentor_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    trader_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    UNIQUE (mentor_id, trader_id)
);

-- Backward-compatibility column assertions
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL;
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS lot_mode TEXT DEFAULT 'parent_lot';
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS lot_multiplier NUMERIC(10, 2) DEFAULT 1.00;
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS fixed_lot NUMERIC(10, 2) DEFAULT 0.10;

-- Indexes for mentor_assignments
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_mentor ON public.mentor_assignments(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_trader ON public.mentor_assignments(trader_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_parent_account ON public.mentor_assignments(parent_account_id);
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_child_account ON public.mentor_assignments(child_account_id);

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

-- Backward-compatibility column assertions
ALTER TABLE public.mt5_accounts ADD COLUMN IF NOT EXISTS ping_ms INTEGER DEFAULT 12;
ALTER TABLE public.mt5_accounts ADD COLUMN IF NOT EXISTS is_investor_password BOOLEAN DEFAULT TRUE;
ALTER TABLE public.mt5_accounts ADD COLUMN IF NOT EXISTS auto_trading_enabled BOOLEAN DEFAULT TRUE;
ALTER TABLE public.mt5_accounts ADD COLUMN IF NOT EXISTS last_sync TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.mt5_accounts ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.mt5_accounts ADD COLUMN IF NOT EXISTS assigned_parent_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL;

-- Indexes for mt5_accounts
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_user ON public.mt5_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_number ON public.mt5_accounts(account_number);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_role ON public.mt5_accounts(account_role);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_assigned_parent ON public.mt5_accounts(assigned_parent_id);

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

-- Backward-compatibility column assertions
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS close_price NUMERIC(15, 5);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS sl NUMERIC(15, 5);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS tp NUMERIC(15, 5);
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS profit NUMERIC(15, 2) DEFAULT 0.00;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS pips NUMERIC(10, 1) DEFAULT 0.0;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS close_time TIMESTAMPTZ;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS commission NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS swap NUMERIC(10, 2) DEFAULT 0.00;
ALTER TABLE public.trades ADD COLUMN IF NOT EXISTS notes TEXT;

-- Indexes for trades
CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades(user_id);
CREATE INDEX IF NOT EXISTS idx_trades_account ON public.trades(account_id);
CREATE INDEX IF NOT EXISTS idx_trades_status ON public.trades(status);
CREATE INDEX IF NOT EXISTS idx_trades_ticket ON public.trades(ticket);

-- ------------------------------------------------------------------------------
-- 5. Trade Feedback Table (Mentor reviews & grading)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.trade_feedback (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.trades(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    grade TEXT CHECK (grade IN ('A+', 'A', 'B', 'C', 'D', 'F')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Backward-compatibility column assertions
ALTER TABLE public.trade_feedback ADD COLUMN IF NOT EXISTS grade TEXT CHECK (grade IN ('A+', 'A', 'B', 'C', 'D', 'F'));

-- Indexes for trade_feedback
CREATE INDEX IF NOT EXISTS idx_trade_feedback_trade ON public.trade_feedback(trade_id);
CREATE INDEX IF NOT EXISTS idx_trade_feedback_author ON public.trade_feedback(author_id);

-- ------------------------------------------------------------------------------
-- 6. Helper Security Functions (SECURITY DEFINER, Non-Recursive)
-- ------------------------------------------------------------------------------

-- Check if current authenticated user has 'admin' role
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'admin' AND status = 'active'
  );
END;
$$;

-- Check if current authenticated user has active 'mentor' role
CREATE OR REPLACE FUNCTION public.is_mentor()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'mentor' AND status = 'active'
  );
END;
$$;

-- Check if current authenticated user is the assigned active mentor for a given trader
CREATE OR REPLACE FUNCTION public.is_mentor_of(target_trader_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
  IF auth.uid() IS NULL OR target_trader_id IS NULL THEN
    RETURN FALSE;
  END IF;
  RETURN EXISTS (
    SELECT 1 
    FROM public.mentor_assignments ma
    JOIN public.profiles mp ON mp.id = ma.mentor_id
    WHERE ma.mentor_id = auth.uid()
      AND ma.trader_id = target_trader_id
      AND ma.status = 'active'
      AND mp.role = 'mentor'
      AND mp.status = 'active'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Public Signup Trigger (Strict Default 'trader' Role)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
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
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(COALESCE(NEW.email, ''), '@', 1), 'Trader'),
    COALESCE(NEW.raw_user_meta_data->>'avatar_url', ''),
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
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ------------------------------------------------------------------------------
-- 8. Existing User Backfill (Synchronizes existing auth.users to public.profiles)
-- ------------------------------------------------------------------------------
INSERT INTO public.profiles (id, email, full_name, role, status)
SELECT 
    id, 
    COALESCE(email, ''), 
    COALESCE(raw_user_meta_data->>'full_name', split_part(COALESCE(email, ''), '@', 1), 'Trader'),
    'trader',
    'active'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------------------------
-- 9. Anti-Privilege & Status Escalation Trigger on Profiles
-- Protects role, status, id, email, and created_at from non-admin modification
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_security()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
  caller_is_admin BOOLEAN := FALSE;
BEGIN
  BEGIN
    jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  EXCEPTION WHEN OTHERS THEN
    jwt_role := '';
  END;

  caller_is_admin := (
    public.is_admin()
    OR current_user IN ('postgres', 'service_role')
    OR session_user IN ('postgres', 'service_role')
    OR jwt_role = 'service_role'
  );

  IF TG_OP = 'INSERT' THEN
    -- If a non-admin client attempts direct insertion, force default trader role and active status
    IF NOT caller_is_admin THEN
      NEW.role := 'trader';
      NEW.status := 'active';
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Protect critical identity and authorization fields from non-admin modification
    IF NOT caller_is_admin THEN
      IF (OLD.role IS DISTINCT FROM NEW.role) THEN
        RAISE EXCEPTION 'Security error: Users cannot modify their account role. Admin authorization required.';
      END IF;

      IF (OLD.status IS DISTINCT FROM NEW.status) THEN
        RAISE EXCEPTION 'Security error: Users cannot alter their account status (active/suspended). Admin authorization required.';
      END IF;

      IF (OLD.id IS DISTINCT FROM NEW.id) THEN
        RAISE EXCEPTION 'Security error: User ID cannot be changed.';
      END IF;

      IF (OLD.email IS DISTINCT FROM NEW.email) THEN
        RAISE EXCEPTION 'Security error: Primary email cannot be changed directly in public.profiles.';
      END IF;

      IF (OLD.created_at IS DISTINCT FROM NEW.created_at) THEN
        RAISE EXCEPTION 'Security error: Account creation timestamp cannot be modified.';
      END IF;
    END IF;
    NEW.updated_at = timezone('utc'::text, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
DROP TRIGGER IF EXISTS trg_protect_profile_security ON public.profiles;
CREATE TRIGGER trg_protect_profile_security
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_security();

-- ------------------------------------------------------------------------------
-- 10. Mentor Assignment Validation & Ownership Guard Trigger
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validate_mentor_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  -- Anti-Self-Assignment Check
  IF NEW.mentor_id = NEW.trader_id THEN
    RAISE EXCEPTION 'Security error: A user cannot assign themselves as their own mentor.';
  END IF;

  -- Mentor Eligibility Check: Target mentor must be verified active mentor
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.mentor_id AND role = 'mentor' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Security error: Target mentor_id is not a verified active mentor.';
  END IF;

  -- Trader Eligibility Check: Trader must be an active account
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.trader_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Security error: Trader account must be active to create or update an assignment.';
  END IF;

  -- Anti-Hijacking Check: Assignment ownership (mentor_id, trader_id, assigned_at) cannot be transferred on UPDATE
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.mentor_id IS DISTINCT FROM NEW.mentor_id 
        OR OLD.trader_id IS DISTINCT FROM NEW.trader_id
        OR OLD.assigned_at IS DISTINCT FROM NEW.assigned_at) THEN
      BEGIN
        jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END IF;

      IF NOT (
        public.is_admin()
        OR current_user IN ('postgres', 'service_role')
        OR session_user IN ('postgres', 'service_role')
        OR jwt_role = 'service_role'
      ) THEN
        RAISE EXCEPTION 'Security error: Assignment ownership and creation timestamp cannot be transferred.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mentor_assignment ON public.mentor_assignments;
CREATE TRIGGER trg_validate_mentor_assignment
  BEFORE INSERT OR UPDATE ON public.mentor_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_mentor_assignment();

-- ------------------------------------------------------------------------------
-- 10.1 Trade Feedback Immutability & Ownership Guard Trigger
-- Ensures feedback cannot be reassigned to another trade, author, or timestamp on UPDATE
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_trade_feedback()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.trade_id IS DISTINCT FROM NEW.trade_id 
        OR OLD.author_id IS DISTINCT FROM NEW.author_id
        OR OLD.created_at IS DISTINCT FROM NEW.created_at) THEN
      BEGIN
        jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END IF;

      IF NOT (
        public.is_admin()
        OR current_user IN ('postgres', 'service_role')
        OR session_user IN ('postgres', 'service_role')
        OR jwt_role = 'service_role'
      ) THEN
        RAISE EXCEPTION 'Security error: Feedback author_id, trade_id, and created_at cannot be modified.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_trade_feedback ON public.trade_feedback;
CREATE TRIGGER trg_protect_trade_feedback
  BEFORE UPDATE ON public.trade_feedback
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_trade_feedback();

-- ------------------------------------------------------------------------------
-- 11. Enable Row-Level Security on All Application Tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_feedback ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 12. Idempotent Row-Level Security Policies
-- ------------------------------------------------------------------------------

-- ---- PROFILES POLICIES ----
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR public.is_admin()
    OR public.is_mentor_of(id)
    OR EXISTS (
      SELECT 1 FROM public.mentor_assignments ma
      WHERE ma.trader_id = auth.uid()
        AND ma.mentor_id = public.profiles.id
        AND ma.status = 'active'
    )
  );

DROP POLICY IF EXISTS "profiles_update_policy" ON public.profiles;
CREATE POLICY "profiles_update_policy"
  ON public.profiles FOR UPDATE
  USING (
    auth.uid() = id
    OR public.is_admin()
  )
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "profiles_insert_policy" ON public.profiles;
CREATE POLICY "profiles_insert_policy"
  ON public.profiles FOR INSERT
  WITH CHECK (
    auth.uid() = id
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "profiles_delete_policy" ON public.profiles;
CREATE POLICY "profiles_delete_policy"
  ON public.profiles FOR DELETE
  USING (public.is_admin());

-- ---- MENTOR_ASSIGNMENTS POLICIES ----
DROP POLICY IF EXISTS "mentor_assignments_select_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_select_policy"
  ON public.mentor_assignments FOR SELECT
  USING (
    mentor_id = auth.uid()
    OR trader_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mentor_assignments_insert_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_insert_policy"
  ON public.mentor_assignments FOR INSERT
  WITH CHECK (
    trader_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mentor_assignments_update_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_update_policy"
  ON public.mentor_assignments FOR UPDATE
  USING (
    (
      (mentor_id = auth.uid() OR trader_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active')
    )
    OR public.is_admin()
  )
  WITH CHECK (
    (
      (mentor_id = auth.uid() OR trader_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active')
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mentor_assignments_delete_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_delete_policy"
  ON public.mentor_assignments FOR DELETE
  USING (
    (
      (mentor_id = auth.uid() OR trader_id = auth.uid())
      AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND status = 'active')
    )
    OR public.is_admin()
  );

-- ---- MT5_ACCOUNTS POLICIES ----
DROP POLICY IF EXISTS "mt5_accounts_select_policy" ON public.mt5_accounts;
CREATE POLICY "mt5_accounts_select_policy"
  ON public.mt5_accounts FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.is_mentor_of(user_id)
  );

DROP POLICY IF EXISTS "mt5_accounts_insert_policy" ON public.mt5_accounts;
CREATE POLICY "mt5_accounts_insert_policy"
  ON public.mt5_accounts FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mt5_accounts_update_policy" ON public.mt5_accounts;
CREATE POLICY "mt5_accounts_update_policy"
  ON public.mt5_accounts FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mt5_accounts_delete_policy" ON public.mt5_accounts;
CREATE POLICY "mt5_accounts_delete_policy"
  ON public.mt5_accounts FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- ---- TRADES POLICIES ----
DROP POLICY IF EXISTS "trades_select_policy" ON public.trades;
CREATE POLICY "trades_select_policy"
  ON public.trades FOR SELECT
  USING (
    user_id = auth.uid()
    OR public.is_admin()
    OR public.is_mentor_of(user_id)
  );

DROP POLICY IF EXISTS "trades_insert_policy" ON public.trades;
CREATE POLICY "trades_insert_policy"
  ON public.trades FOR INSERT
  WITH CHECK (
    (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.mt5_accounts
        WHERE id = account_id AND user_id = auth.uid()
      )
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "trades_update_policy" ON public.trades;
CREATE POLICY "trades_update_policy"
  ON public.trades FOR UPDATE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    (
      user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.mt5_accounts
        WHERE id = account_id AND user_id = auth.uid()
      )
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "trades_delete_policy" ON public.trades;
CREATE POLICY "trades_delete_policy"
  ON public.trades FOR DELETE
  USING (
    user_id = auth.uid()
    OR public.is_admin()
  );

-- ---- TRADE_FEEDBACK POLICIES ----
DROP POLICY IF EXISTS "trade_feedback_select_policy" ON public.trade_feedback;
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

DROP POLICY IF EXISTS "trade_feedback_insert_policy" ON public.trade_feedback;
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

DROP POLICY IF EXISTS "trade_feedback_modify_policy" ON public.trade_feedback;
CREATE POLICY "trade_feedback_modify_policy"
  ON public.trade_feedback FOR UPDATE
  USING (author_id = auth.uid() OR public.is_admin())
  WITH CHECK (
    (
      author_id = auth.uid()
      AND trade_id = trade_feedback.trade_id
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "trade_feedback_delete_policy" ON public.trade_feedback;
CREATE POLICY "trade_feedback_delete_policy"
  ON public.trade_feedback FOR DELETE
  USING (author_id = auth.uid() OR public.is_admin());

-- ------------------------------------------------------------------------------
-- 13. Tightened Schema Permissions & PostgREST Grants
-- Eliminates blanket ALL privileges; grants explicit DML and sequence usage
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Authenticated users receive only standard DML on application tables (no DDL/TRUNCATE/TRIGGER rights)
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE 
  public.profiles,
  public.mentor_assignments,
  public.mt5_accounts,
  public.trades,
  public.trade_feedback 
TO authenticated;

-- Service role retains full administrative privileges
GRANT ALL ON TABLE 
  public.profiles,
  public.mentor_assignments,
  public.mt5_accounts,
  public.trades,
  public.trade_feedback 
TO service_role;

-- Sequences: Grant only USAGE & SELECT to authenticated
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- Routines: Revoke default execution on internal trigger functions from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_profile_security() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_mentor_assignment() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_trade_feedback() FROM PUBLIC, anon, authenticated;

-- Explicitly allow authenticated and anon to execute safe read-only security helpers
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_mentor() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_mentor_of(UUID) TO authenticated, anon;

-- Ensure anonymous visitors have NO direct SELECT access to raw public.profiles
REVOKE SELECT ON public.profiles FROM anon;

-- Grant public read access to the sanitized mentor directory view
GRANT SELECT ON public.mentor_directory TO anon, authenticated, service_role;

-- ==============================================================================
-- 14. Dedicated Super Admin Promotion Utility & Manual Setup
-- Executed strictly from the Supabase Dashboard SQL Editor (runs as postgres role)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.promote_user_to_admin(target_email TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  matched_count INT;
BEGIN
  -- Strict security guard: Can only be executed in SQL editor or by service_role
  IF current_user NOT IN ('postgres', 'service_role') AND session_user NOT IN ('postgres', 'service_role') THEN
    RAISE EXCEPTION 'Access denied: promote_user_to_admin can only be invoked from the Supabase SQL Editor.';
  END IF;

  UPDATE public.profiles
  SET role = 'admin', status = 'active', updated_at = timezone('utc'::text, now())
  WHERE LOWER(TRIM(email)) = LOWER(TRIM(target_email));

  GET DIAGNOSTICS matched_count = ROW_COUNT;
  IF matched_count = 0 THEN
    RAISE EXCEPTION 'User profile with email "%" was not found. Please ensure the user has completed signup first.', target_email;
  END IF;

  RETURN 'Success: Account ' || target_email || ' has been elevated to Administrator.';
END;
$$;

-- Ensure promote_user_to_admin cannot be invoked via the PostgREST REST API
REVOKE EXECUTE ON FUNCTION public.promote_user_to_admin(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_user_to_admin(TEXT) TO postgres, service_role;

-- Manual Promotion Instruction (Run in Supabase SQL Editor after initial signup):
-- SELECT public.promote_user_to_admin('your-admin@email.com');
-- or directly:
-- UPDATE public.profiles SET role = 'admin', status = 'active' WHERE email = 'your-admin@email.com';

-- ------------------------------------------------------------------------------
-- 10. Serverless MT5 Bridge Persistence Tables (Migration 03)
-- ------------------------------------------------------------------------------
ALTER TABLE public.mt5_accounts
    ADD COLUMN IF NOT EXISTS terminal_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS terminal_token_prefix TEXT,
    ADD COLUMN IF NOT EXISTS terminal_token_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_token_hash 
    ON public.mt5_accounts(terminal_token_hash);

CREATE TABLE IF NOT EXISTS public.bridge_instructions (
    id TEXT PRIMARY KEY,
    idempotency_key TEXT UNIQUE NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('OPEN', 'CLOSE', 'MODIFY')),
    child_account_id UUID NOT NULL REFERENCES public.mt5_accounts(id) ON DELETE CASCADE,
    parent_account_id UUID NOT NULL REFERENCES public.mt5_accounts(id) ON DELETE CASCADE,
    parent_ticket BIGINT NOT NULL,
    child_ticket BIGINT,
    symbol TEXT NOT NULL,
    order_type TEXT NOT NULL,
    lots NUMERIC(10, 2) NOT NULL,
    open_price NUMERIC(15, 5),
    sl NUMERIC(15, 5),
    tp NUMERIC(15, 5),
    magic_number BIGINT DEFAULT 888999,
    comment TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'IN_FLIGHT', 'COMPLETED', 'FAILED')),
    lease_expires_at TIMESTAMPTZ,
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Comprehensive backward-compatibility assertions if table pre-existed
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS idempotency_key TEXT;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS action TEXT DEFAULT 'OPEN';
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS parent_ticket BIGINT;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS child_ticket BIGINT;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS symbol TEXT;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS order_type TEXT;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS lots NUMERIC(10, 2);
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS open_price NUMERIC(15, 5);
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS sl NUMERIC(15, 5);
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS tp NUMERIC(15, 5);
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS magic_number BIGINT DEFAULT 888999;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS comment TEXT;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'QUEUED';
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.bridge_instructions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_bridge_instructions_child_status 
    ON public.bridge_instructions(child_account_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_bridge_instructions_idempotency_unique 
    ON public.bridge_instructions(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_bridge_instructions_parent_ticket 
    ON public.bridge_instructions(parent_ticket);

CREATE INDEX IF NOT EXISTS idx_bridge_instructions_lease 
    ON public.bridge_instructions(status, lease_expires_at);

CREATE TABLE IF NOT EXISTS public.trade_mappings (
    id TEXT PRIMARY KEY,
    parent_trade_ticket BIGINT NOT NULL,
    child_trade_ticket BIGINT,
    parent_account_id UUID NOT NULL REFERENCES public.mt5_accounts(id) ON DELETE CASCADE,
    child_account_id UUID NOT NULL REFERENCES public.mt5_accounts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    order_type TEXT NOT NULL,
    parent_lots NUMERIC(10, 2) NOT NULL,
    child_lots NUMERIC(10, 2) NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED', 'REJECTED', 'REJECTED_MARGIN', 'REJECTED_OFF_QUOTES', 'SLIPPAGE_EXCEEDED', 'RETRIED', 'SKIPPED_LOT_LIMIT', 'CLOSED')),
    latency_ms INT DEFAULT 0,
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    open_time TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(parent_trade_ticket, child_account_id)
);

-- Comprehensive backward-compatibility assertions if table pre-existed
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS parent_trade_ticket BIGINT;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS child_trade_ticket BIGINT;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE CASCADE;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS symbol TEXT;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS order_type TEXT;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS parent_lots NUMERIC(10, 2);
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS child_lots NUMERIC(10, 2);
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'PENDING';
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS latency_ms INT DEFAULT 0;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS error_message TEXT;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS open_time TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.trade_mappings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- Update status constraint to ensure compatibility with all broker execution codes
ALTER TABLE public.trade_mappings DROP CONSTRAINT IF EXISTS trade_mappings_status_check;
ALTER TABLE public.trade_mappings 
    ADD CONSTRAINT trade_mappings_status_check 
    CHECK (status IN ('PENDING', 'EXECUTED', 'FAILED', 'REJECTED', 'REJECTED_MARGIN', 'REJECTED_OFF_QUOTES', 'SLIPPAGE_EXCEEDED', 'RETRIED', 'SKIPPED_LOT_LIMIT', 'CLOSED'));

CREATE UNIQUE INDEX IF NOT EXISTS idx_trade_mappings_parent_child_unique 
    ON public.trade_mappings(parent_trade_ticket, child_account_id);

CREATE INDEX IF NOT EXISTS idx_trade_mappings_parent_ticket 
    ON public.trade_mappings(parent_trade_ticket);

CREATE INDEX IF NOT EXISTS idx_trade_mappings_child_account 
    ON public.trade_mappings(child_account_id);

CREATE INDEX IF NOT EXISTS idx_trade_mappings_parent_account 
    ON public.trade_mappings(parent_account_id);

CREATE TABLE IF NOT EXISTS public.bridge_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success')),
    details TEXT NOT NULL,
    ticket BIGINT,
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- Comprehensive backward-compatibility assertions if table pre-existed
ALTER TABLE public.bridge_sync_logs ADD COLUMN IF NOT EXISTS event_type TEXT;
ALTER TABLE public.bridge_sync_logs ADD COLUMN IF NOT EXISTS level TEXT DEFAULT 'info';
ALTER TABLE public.bridge_sync_logs ADD COLUMN IF NOT EXISTS details TEXT;
ALTER TABLE public.bridge_sync_logs ADD COLUMN IF NOT EXISTS ticket BIGINT;
ALTER TABLE public.bridge_sync_logs ADD COLUMN IF NOT EXISTS latency_ms INT;
ALTER TABLE public.bridge_sync_logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

CREATE INDEX IF NOT EXISTS idx_bridge_sync_logs_created 
    ON public.bridge_sync_logs(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bridge_sync_logs_level 
    ON public.bridge_sync_logs(level);

-- Helper function to validate service_role or admin without depending on flawed current_user checks
CREATE OR REPLACE FUNCTION public.is_service_role_or_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  BEGIN
    jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  EXCEPTION WHEN OTHERS THEN
    jwt_role := '';
  END;

  IF current_user IN ('postgres', 'service_role') 
     OR session_user IN ('postgres', 'service_role') 
     OR jwt_role = 'service_role' THEN
    RETURN TRUE;
  END IF;

  RETURN public.is_admin();
END;
$$;

ALTER TABLE public.bridge_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_sync_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role and admin full access to bridge_instructions" ON public.bridge_instructions;
CREATE POLICY "Service role and admin full access to bridge_instructions" 
    ON public.bridge_instructions FOR ALL 
    USING (public.is_service_role_or_admin())
    WITH CHECK (public.is_service_role_or_admin());

DROP POLICY IF EXISTS "Account owners can view their bridge_instructions" ON public.bridge_instructions;
CREATE POLICY "Account owners can view their bridge_instructions" 
    ON public.bridge_instructions FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.mt5_accounts a 
            WHERE (a.id = child_account_id OR a.id = parent_account_id) 
              AND a.user_id = auth.uid()
        )
        OR public.is_service_role_or_admin()
    );

DROP POLICY IF EXISTS "Service role and admin full access to trade_mappings" ON public.trade_mappings;
CREATE POLICY "Service role and admin full access to trade_mappings" 
    ON public.trade_mappings FOR ALL 
    USING (public.is_service_role_or_admin())
    WITH CHECK (public.is_service_role_or_admin());

DROP POLICY IF EXISTS "Users can view their trade mappings" ON public.trade_mappings;
CREATE POLICY "Users can view their trade mappings" 
    ON public.trade_mappings FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.mt5_accounts a 
            WHERE (a.id = child_account_id OR a.id = parent_account_id) 
              AND a.user_id = auth.uid()
        )
        OR public.is_service_role_or_admin()
    );

DROP POLICY IF EXISTS "Service role and admin full access to bridge_sync_logs" ON public.bridge_sync_logs;
CREATE POLICY "Service role and admin full access to bridge_sync_logs" 
    ON public.bridge_sync_logs FOR ALL 
    USING (public.is_service_role_or_admin())
    WITH CHECK (public.is_service_role_or_admin());

GRANT ALL ON TABLE 
    public.bridge_instructions,
    public.trade_mappings,
    public.bridge_sync_logs
TO service_role, postgres;

GRANT SELECT ON TABLE 
    public.bridge_instructions,
    public.trade_mappings
TO authenticated;

REVOKE ALL ON TABLE public.bridge_sync_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bridge_instructions, public.trade_mappings FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_instructions, public.trade_mappings FROM anon;
GRANT EXECUTE ON FUNCTION public.is_service_role_or_admin() TO anon, authenticated, service_role, postgres;

