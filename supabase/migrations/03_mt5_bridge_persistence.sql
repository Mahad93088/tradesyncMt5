-- ==============================================================================
-- TradeSync MT5: Migration 03 - Serverless MT5 Bridge Persistence & Security
-- Description:
--   1. Adds terminal_token_hash and terminal_token_prefix to public.mt5_accounts
--   2. Creates public.bridge_instructions table for durable cross-instance queueing
--   3. Creates public.trade_mappings table for durable parent-child trade tracking
--   4. Creates public.bridge_sync_logs table for execution audit and broker telemetry
--   5. Applies Row-Level Security (RLS) policies and performance indexes
-- ==============================================================================

-- 1. Add terminal token columns to mt5_accounts
ALTER TABLE public.mt5_accounts
    ADD COLUMN IF NOT EXISTS terminal_token_hash TEXT,
    ADD COLUMN IF NOT EXISTS terminal_token_prefix TEXT,
    ADD COLUMN IF NOT EXISTS terminal_token_created_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_token_hash 
    ON public.mt5_accounts(terminal_token_hash);

-- 2. Durable Bridge Instructions Queue (Cross-Instance / Serverless Safe)
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

CREATE INDEX IF NOT EXISTS idx_bridge_instructions_child_status 
    ON public.bridge_instructions(child_account_id, status);

CREATE INDEX IF NOT EXISTS idx_bridge_instructions_idempotency 
    ON public.bridge_instructions(idempotency_key);

-- 3. Durable Trade Mappings Table
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
    status TEXT NOT NULL DEFAULT 'PENDING',
    latency_ms INT DEFAULT 0,
    error_message TEXT,
    retry_count INT NOT NULL DEFAULT 0,
    open_time TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE(parent_trade_ticket, child_account_id)
);

CREATE INDEX IF NOT EXISTS idx_trade_mappings_parent_ticket 
    ON public.trade_mappings(parent_trade_ticket);

CREATE INDEX IF NOT EXISTS idx_trade_mappings_child_account 
    ON public.trade_mappings(child_account_id);

-- 4. Durable Bridge Sync Logs Table
CREATE TABLE IF NOT EXISTS public.bridge_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL,
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error', 'success')),
    details TEXT NOT NULL,
    ticket BIGINT,
    latency_ms INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_bridge_sync_logs_created 
    ON public.bridge_sync_logs(created_at DESC);

-- 5. RLS Policies for Bridge Tables
ALTER TABLE public.bridge_instructions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trade_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bridge_sync_logs ENABLE ROW LEVEL SECURITY;

-- Allow server-side service role full access
DROP POLICY IF EXISTS "Service role has full access to bridge_instructions" ON public.bridge_instructions;
CREATE POLICY "Service role has full access to bridge_instructions" 
    ON public.bridge_instructions FOR ALL 
    USING (current_user = 'service_role' OR public.is_admin())
    WITH CHECK (current_user = 'service_role' OR public.is_admin());

DROP POLICY IF EXISTS "Service role has full access to trade_mappings" ON public.trade_mappings;
CREATE POLICY "Service role has full access to trade_mappings" 
    ON public.trade_mappings FOR ALL 
    USING (current_user = 'service_role' OR public.is_admin())
    WITH CHECK (current_user = 'service_role' OR public.is_admin());

DROP POLICY IF EXISTS "Service role has full access to bridge_sync_logs" ON public.bridge_sync_logs;
CREATE POLICY "Service role has full access to bridge_sync_logs" 
    ON public.bridge_sync_logs FOR ALL 
    USING (current_user = 'service_role' OR public.is_admin())
    WITH CHECK (current_user = 'service_role' OR public.is_admin());

-- Read-only visibility for account owners
DROP POLICY IF EXISTS "Users can view their trade mappings" ON public.trade_mappings;
CREATE POLICY "Users can view their trade mappings" 
    ON public.trade_mappings FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.mt5_accounts a 
            WHERE (a.id = child_account_id OR a.id = parent_account_id) 
              AND a.user_id = auth.uid()
        )
        OR public.is_admin()
    );
