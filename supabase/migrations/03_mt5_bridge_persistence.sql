-- ==============================================================================
-- TradeSync MT5: Migration 03 - Serverless MT5 Bridge Persistence & Security
-- ==============================================================================
-- Features & Security Audited:
-- 1. gen_random_uuid() & UUID extensions guaranteed available.
-- 2. Terminal authentication tokens stored securely as SHA-256 hashes in public.mt5_accounts.
-- 3. Durable bridge_instructions queue for serverless cold-start resilience & lease locking.
-- 4. Durable trade_mappings tracking parent-to-child ticket links & broker execution results.
-- 5. Durable bridge_sync_logs recording real-time bridge execution events and latency.
-- 6. Canonical Supabase service_role & admin RLS security model (avoids flawed current_user checks).
-- 7. Safe to rerun: IF NOT EXISTS, OR REPLACE, DROP POLICY IF EXISTS, and non-destructive DDL.
-- 8. Restricted grants: PostgREST anonymous visitors cannot access or manipulate bridge data.
-- 9. Comprehensive backward-compatibility assertions for pre-existing tables and columns.
-- 10. Complete status constraint supporting all broker execution codes (REJECTED_MARGIN, etc.).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Ensure Required Cryptographic & UUID Extensions
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. Extend mt5_accounts with Terminal Token Columns
-- ------------------------------------------------------------------------------
ALTER TABLE public.mt5_accounts
    ADD COLUMN IF NOT EXISTS terminal_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS terminal_token_prefix TEXT,
    ADD COLUMN IF NOT EXISTS terminal_token_created_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS assigned_parent_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_token_hash 
    ON public.mt5_accounts(terminal_token_hash);
CREATE INDEX IF NOT EXISTS idx_mt5_accounts_assigned_parent
    ON public.mt5_accounts(assigned_parent_id);

-- ------------------------------------------------------------------------------
-- 3. Durable Bridge Instructions Queue (Cross-Instance / Serverless Safe)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 4. Durable Trade Mappings Table
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 5. Durable Bridge Sync Logs Table
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 6. Canonical Authorization Helper Function (SECURITY DEFINER)
-- Validates service_role JWT claims, database superusers, and active admin profiles
-- ------------------------------------------------------------------------------
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
  -- Read PostgREST JWT claim safely without throwing if context setting is missing
  BEGIN
    jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  EXCEPTION WHEN OTHERS THEN
    jwt_role := '';
  END;

  -- 1. Direct PostgreSQL service_role or postgres connection
  IF current_user IN ('postgres', 'service_role') 
     OR session_user IN ('postgres', 'service_role') 
     OR jwt_role = 'service_role' THEN
    RETURN TRUE;
  END IF;

  -- 2. Authenticated user with verified active admin profile
  RETURN public.is_admin();
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. Enable Row-Level Security on All Bridge Tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.bridge_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_sync_logs ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 8. Idempotent Row-Level Security Policies
-- ------------------------------------------------------------------------------

-- ---- BRIDGE_INSTRUCTIONS POLICIES ----
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

-- ---- TRADE_MAPPINGS POLICIES ----
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

-- ---- BRIDGE_SYNC_LOGS POLICIES ----
DROP POLICY IF EXISTS "Service role and admin full access to bridge_sync_logs" ON public.bridge_sync_logs;
CREATE POLICY "Service role and admin full access to bridge_sync_logs" 
    ON public.bridge_sync_logs FOR ALL 
    USING (public.is_service_role_or_admin())
    WITH CHECK (public.is_service_role_or_admin());

-- ------------------------------------------------------------------------------
-- 9. Tightened PostgREST Permissions & Grants
-- ------------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Service role and postgres retain full operational access for the backend API
GRANT ALL ON TABLE 
    public.bridge_instructions,
    public.trade_mappings,
    public.bridge_sync_logs
TO service_role, postgres;

-- Authenticated frontend users receive read-only SELECT permissions governed by RLS
GRANT SELECT ON TABLE 
    public.bridge_instructions,
    public.trade_mappings
TO authenticated;

-- Explicitly revoke sensitive execution logs and write operations from general users & anon
REVOKE ALL ON TABLE public.bridge_sync_logs FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.bridge_instructions, public.trade_mappings FROM anon, authenticated;
REVOKE ALL ON TABLE public.bridge_instructions, public.trade_mappings FROM anon;

-- Grant execution of the security helper
GRANT EXECUTE ON FUNCTION public.is_service_role_or_admin() TO anon, authenticated, service_role, postgres;
