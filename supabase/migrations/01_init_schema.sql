-- Migration: 01_init_schema.sql
-- Description: Hardened TradeSync MT5 schema with mentor validation, anti-tamper triggers, and idempotent RLS

-- Enable UUID extension
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

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'trader';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

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

ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());
ALTER TABLE public.mentor_assignments ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';

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
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_number ON public.mt5_accounts(account_number);

-- 4. Trades
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

-- 5. Trade Feedback
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

-- 6. Helper Security Functions (SECURITY DEFINER, Non-Recursive)
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
    WHERE id = auth.uid() AND role = 'admin'
  );
END;
$$;

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
    SELECT 1 FROM public.mentor_assignments
    WHERE mentor_id = auth.uid()
      AND trader_id = target_trader_id
      AND status = 'active'
  );
END;
$$;

-- 7. Public Signup Trigger
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

-- 8. Existing User Backfill
INSERT INTO public.profiles (id, email, full_name, role, status)
SELECT 
    id, 
    COALESCE(email, ''), 
    COALESCE(raw_user_meta_data->>'full_name', split_part(COALESCE(email, ''), '@', 1), 'Trader'),
    'trader',
    'active'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- 9. Profile Privilege Escalation Guard
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  IF (OLD.role IS DISTINCT FROM NEW.role) THEN
    BEGIN
      jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
    EXCEPTION WHEN OTHERS THEN
      jwt_role := '';
    END IF;

    IF NOT (
      public.is_admin()
      OR current_user = 'postgres'
      OR current_user = 'service_role'
      OR session_user = 'service_role'
      OR jwt_role = 'service_role'
    ) THEN
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

-- 10. Mentor Assignment Validation & Ownership Guard Trigger
CREATE OR REPLACE FUNCTION public.validate_mentor_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  IF NEW.mentor_id = NEW.trader_id THEN
    RAISE EXCEPTION 'Security error: A user cannot assign themselves as their own mentor.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.mentor_id AND role = 'mentor' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Security error: Target mentor_id is not a verified active mentor.';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (OLD.mentor_id IS DISTINCT FROM NEW.mentor_id OR OLD.trader_id IS DISTINCT FROM NEW.trader_id) THEN
      BEGIN
        jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END IF;

      IF NOT (
        public.is_admin()
        OR current_user = 'postgres'
        OR current_user = 'service_role'
        OR jwt_role = 'service_role'
      ) THEN
        RAISE EXCEPTION 'Security error: Assignment ownership (mentor_id / trader_id) cannot be transferred.';
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

-- 11. Enable Row-Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_feedback ENABLE ROW LEVEL SECURITY;

-- 12. Row-Level Security Policies (Hardened & Idempotent)

-- ---- PROFILES POLICIES ----
DROP POLICY IF EXISTS "profiles_select_policy" ON public.profiles;
CREATE POLICY "profiles_select_policy"
  ON public.profiles FOR SELECT
  USING (
    auth.uid() = id
    OR (role = 'mentor' AND status = 'active')
    OR public.is_admin()
    OR public.is_mentor_of(id)
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
    (
      trader_id = auth.uid()
      AND mentor_id != auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = mentor_id AND role = 'mentor' AND status = 'active'
      )
    )
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mentor_assignments_update_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_update_policy"
  ON public.mentor_assignments FOR UPDATE
  USING (
    mentor_id = auth.uid()
    OR trader_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    mentor_id = auth.uid()
    OR trader_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS "mentor_assignments_delete_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_delete_policy"
  ON public.mentor_assignments FOR DELETE
  USING (
    mentor_id = auth.uid()
    OR trader_id = auth.uid()
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
    user_id = auth.uid()
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
    user_id = auth.uid()
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
  WITH CHECK (author_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "trade_feedback_delete_policy" ON public.trade_feedback;
CREATE POLICY "trade_feedback_delete_policy"
  ON public.trade_feedback FOR DELETE
  USING (author_id = auth.uid() OR public.is_admin());
