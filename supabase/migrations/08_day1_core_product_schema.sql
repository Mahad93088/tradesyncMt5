-- ==============================================================================
-- TradeSync MT5: Migration 08 - Day 1 Core Product Schema & Hardening
-- ==============================================================================
-- Idempotent PostgreSQL migration for manual Supabase SQL Editor application.
-- Does NOT modify Demo-Only safeguards or grant live-trading privileges.
--
-- What this migration accomplishes:
-- 1. Safely inspects pg_constraint / pg_depend and drops ONLY the obsolete
--    UNIQUE(mentor_id, trader_id) constraint on public.mentor_assignments so
--    traders can link multiple child MT5 accounts or switch mentors cleanly,
--    while preserving Migration 07's partial unique indexes:
--      - idx_mentor_assignments_active_child_unique
--      - idx_mentor_assignments_active_pair_unique
-- 2. Safely adds UNIQUE(account_number, broker_server) protection on
--    public.mt5_accounts ONLY after checking that zero duplicate rows exist.
-- 3. Adds the 9 persistent risk configuration columns on public.mentor_assignments
--    with CHECK constraints and updates validate_mentor_assignment() so mentors
--    cannot overwrite follower risk limits.
-- 4. Enhances public.trades and public.trade_mappings for idempotent deal/trade
--    persistence without fabricated realized P&L.
-- 5. Creates missing platform, strategy, audit, notification, and billing
--    tables with foreign keys, constraints, indexes, RLS policies, and grants:
--      - mentor_profiles
--      - mentor_groups
--      - platform_settings
--      - audit_logs
--      - notifications
--      - subscription_plans
--      - subscriptions
--      - payments
--      - invoices
--      - payment_webhooks
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Drop Obsolete UNIQUE(mentor_id, trader_id) on public.mentor_assignments
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_con_name TEXT;
    v_has_fk_depend BOOLEAN := FALSE;
BEGIN
    SELECT c.conname
    INTO v_con_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'mentor_assignments'
      AND c.contype = 'u'
      AND (
          SELECT ARRAY_AGG(a.attname::TEXT ORDER BY a.attname::TEXT)
          FROM unnest(c.conkey) AS k(attnum)
          JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      ) = ARRAY['mentor_id', 'trader_id'];

    IF v_con_name IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1
            FROM pg_constraint fk
            WHERE fk.confrelid = 'public.mentor_assignments'::regclass
              AND fk.contype = 'f'
        ) INTO v_has_fk_depend;

        IF v_has_fk_depend THEN
            RAISE NOTICE 'External foreign key depends on public.mentor_assignments; inspect before dropping constraint %.', v_con_name;
        ELSE
            EXECUTE format('ALTER TABLE public.mentor_assignments DROP CONSTRAINT %I', v_con_name);
            RAISE NOTICE 'Dropped obsolete UNIQUE(mentor_id, trader_id) constraint: %', v_con_name;
        END IF;
    ELSE
        RAISE NOTICE 'No obsolete UNIQUE(mentor_id, trader_id) constraint found on public.mentor_assignments.';
    END IF;
END
$$;

-- Re-assert Migration 07 active child & pair unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_mentor_assignments_active_child_unique
    ON public.mentor_assignments(child_account_id)
    WHERE child_account_id IS NOT NULL AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_mentor_assignments_active_pair_unique
    ON public.mentor_assignments(parent_account_id, child_account_id)
    WHERE parent_account_id IS NOT NULL AND child_account_id IS NOT NULL AND status = 'active';

-- ------------------------------------------------------------------------------
-- 2. Duplicate-Checked Unique Index on public.mt5_accounts(account_number, broker_server)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_existing_unique BOOLEAN := FALSE;
    v_dup_count INTEGER := 0;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM pg_index ix
        JOIN pg_class tbl ON tbl.oid = ix.indrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          AND tbl.relname = 'mt5_accounts'
          AND ix.indisunique
          AND (
              SELECT ARRAY_AGG(a.attname::TEXT ORDER BY a.attname::TEXT)
              FROM unnest(ix.indkey) WITH ORDINALITY AS u(attnum, ord)
              JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = u.attnum
              WHERE u.attnum > 0
          ) = ARRAY['account_number', 'broker_server']
    ) INTO v_existing_unique;

    IF v_existing_unique THEN
        RAISE NOTICE 'Unique index/constraint on public.mt5_accounts(account_number, broker_server) already exists.';
    ELSE
        SELECT COUNT(*)
        INTO v_dup_count
        FROM (
            SELECT account_number, broker_server
            FROM public.mt5_accounts
            GROUP BY account_number, broker_server
            HAVING COUNT(*) > 1
        ) dups;

        IF v_dup_count > 0 THEN
            RAISE NOTICE 'Skipped UNIQUE(account_number, broker_server) on public.mt5_accounts: % duplicate pair(s) detected. Resolve duplicates manually without auto-deleting accounts.', v_dup_count;
        ELSE
            CREATE UNIQUE INDEX IF NOT EXISTS idx_mt5_accounts_number_server_unique
                ON public.mt5_accounts(account_number, broker_server);
        END IF;
    END IF;
END
$$;

-- ------------------------------------------------------------------------------
-- 3. Persistent Risk Configuration Columns on public.mentor_assignments
-- ------------------------------------------------------------------------------
ALTER TABLE public.mentor_assignments
    ADD COLUMN IF NOT EXISTS risk_percent NUMERIC(5, 2) NOT NULL DEFAULT 1.00,
    ADD COLUMN IF NOT EXISTS max_lot_cap NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
    ADD COLUMN IF NOT EXISTS min_lot_clamp NUMERIC(10, 2) NOT NULL DEFAULT 0.01,
    ADD COLUMN IF NOT EXISTS slippage_max_pips NUMERIC(8, 2) NOT NULL DEFAULT 3.00,
    ADD COLUMN IF NOT EXISTS max_drawdown_percent NUMERIC(5, 2) NOT NULL DEFAULT 20.00,
    ADD COLUMN IF NOT EXISTS sync_sl_tp BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS copy_pending_orders BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS symbol_prefix TEXT NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS symbol_suffix TEXT NOT NULL DEFAULT '';

UPDATE public.mentor_assignments
SET risk_percent = COALESCE(risk_percent, 1.00),
    max_lot_cap = COALESCE(max_lot_cap, 50.00),
    min_lot_clamp = COALESCE(min_lot_clamp, 0.01),
    slippage_max_pips = COALESCE(slippage_max_pips, 3.00),
    max_drawdown_percent = COALESCE(max_drawdown_percent, 20.00),
    sync_sl_tp = COALESCE(sync_sl_tp, TRUE),
    copy_pending_orders = COALESCE(copy_pending_orders, TRUE),
    symbol_prefix = COALESCE(symbol_prefix, ''),
    symbol_suffix = COALESCE(symbol_suffix, '')
WHERE risk_percent IS NULL
   OR max_lot_cap IS NULL
   OR min_lot_clamp IS NULL
   OR slippage_max_pips IS NULL
   OR max_drawdown_percent IS NULL
   OR sync_sl_tp IS NULL
   OR copy_pending_orders IS NULL
   OR symbol_prefix IS NULL
   OR symbol_suffix IS NULL;

ALTER TABLE public.mentor_assignments
    ALTER COLUMN risk_percent SET DEFAULT 1.00,
    ALTER COLUMN risk_percent SET NOT NULL,
    ALTER COLUMN max_lot_cap SET DEFAULT 50.00,
    ALTER COLUMN max_lot_cap SET NOT NULL,
    ALTER COLUMN min_lot_clamp SET DEFAULT 0.01,
    ALTER COLUMN min_lot_clamp SET NOT NULL,
    ALTER COLUMN slippage_max_pips SET DEFAULT 3.00,
    ALTER COLUMN slippage_max_pips SET NOT NULL,
    ALTER COLUMN max_drawdown_percent SET DEFAULT 20.00,
    ALTER COLUMN max_drawdown_percent SET NOT NULL,
    ALTER COLUMN sync_sl_tp SET DEFAULT TRUE,
    ALTER COLUMN sync_sl_tp SET NOT NULL,
    ALTER COLUMN copy_pending_orders SET DEFAULT TRUE,
    ALTER COLUMN copy_pending_orders SET NOT NULL,
    ALTER COLUMN symbol_prefix SET DEFAULT '',
    ALTER COLUMN symbol_prefix SET NOT NULL,
    ALTER COLUMN symbol_suffix SET DEFAULT '',
    ALTER COLUMN symbol_suffix SET NOT NULL;

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_risk_percent_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_risk_percent_check
    CHECK (risk_percent > 0 AND risk_percent <= 100);

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_min_lot_clamp_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_min_lot_clamp_check
    CHECK (min_lot_clamp >= 0.01 AND min_lot_clamp <= 100);

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_max_lot_cap_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_max_lot_cap_check
    CHECK (max_lot_cap >= min_lot_clamp AND max_lot_cap <= 100);

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_slippage_max_pips_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_slippage_max_pips_check
    CHECK (slippage_max_pips >= 0 AND slippage_max_pips <= 100);

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_max_drawdown_percent_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_max_drawdown_percent_check
    CHECK (max_drawdown_percent >= 0 AND max_drawdown_percent < 100);

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_symbol_prefix_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_symbol_prefix_check
    CHECK (char_length(symbol_prefix) <= 16 AND symbol_prefix !~ '\s');

ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS mentor_assignments_symbol_suffix_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_symbol_suffix_check
    CHECK (char_length(symbol_suffix) <= 16 AND symbol_suffix !~ '\s');

-- Update trigger function from Migration 07 to validate and protect the 9 new columns
CREATE OR REPLACE FUNCTION public.validate_mentor_assignment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_jwt_role TEXT := '';
    v_claims_raw TEXT := '';
    v_is_privileged BOOLEAN := FALSE;
    v_is_fk_cleanup BOOLEAN := FALSE;
    v_mentor_role TEXT;
    v_mentor_status TEXT;
    v_trader_role TEXT;
    v_trader_status TEXT;
    v_parent_user_id UUID;
    v_parent_role TEXT;
    v_parent_type TEXT;
    v_child_user_id UUID;
    v_child_role TEXT;
    v_child_type TEXT;
BEGIN
    BEGIN
        v_jwt_role := COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), '');
        IF v_jwt_role = '' THEN
            v_claims_raw := COALESCE(NULLIF(current_setting('request.jwt.claims', true), ''), '');
            IF v_claims_raw <> '' THEN
                v_jwt_role := COALESCE(v_claims_raw::jsonb ->> 'role', '');
            END IF;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        v_jwt_role := '';
    END;

    v_is_privileged :=
        session_user IN ('postgres', 'supabase_admin')
        OR v_jwt_role = 'service_role'
        OR public.is_admin();

    -- 1. Preserve FK ON DELETE SET NULL clean deactivation
    IF TG_OP = 'UPDATE' THEN
        IF (
            (OLD.parent_account_id IS NOT NULL AND NEW.parent_account_id IS NULL
             AND NOT EXISTS (SELECT 1 FROM public.mt5_accounts a WHERE a.id = OLD.parent_account_id))
            OR (OLD.child_account_id IS NOT NULL AND NEW.child_account_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM public.mt5_accounts a WHERE a.id = OLD.child_account_id))
        )
        AND NEW.mentor_id IS NOT DISTINCT FROM OLD.mentor_id
        AND NEW.trader_id IS NOT DISTINCT FROM OLD.trader_id
        AND NEW.assigned_at IS NOT DISTINCT FROM OLD.assigned_at
        AND NEW.lot_mode IS NOT DISTINCT FROM OLD.lot_mode
        AND NEW.lot_multiplier IS NOT DISTINCT FROM OLD.lot_multiplier
        AND NEW.fixed_lot IS NOT DISTINCT FROM OLD.fixed_lot
        AND NEW.risk_percent IS NOT DISTINCT FROM OLD.risk_percent
        AND NEW.max_lot_cap IS NOT DISTINCT FROM OLD.max_lot_cap
        AND NEW.min_lot_clamp IS NOT DISTINCT FROM OLD.min_lot_clamp
        AND NEW.slippage_max_pips IS NOT DISTINCT FROM OLD.slippage_max_pips
        AND NEW.max_drawdown_percent IS NOT DISTINCT FROM OLD.max_drawdown_percent
        AND NEW.sync_sl_tp IS NOT DISTINCT FROM OLD.sync_sl_tp
        AND NEW.copy_pending_orders IS NOT DISTINCT FROM OLD.copy_pending_orders
        AND NEW.symbol_prefix IS NOT DISTINCT FROM OLD.symbol_prefix
        AND NEW.symbol_suffix IS NOT DISTINCT FROM OLD.symbol_suffix THEN
            NEW.status := 'inactive';
            v_is_fk_cleanup := TRUE;
            RETURN NEW;
        END IF;
    END IF;

    -- 2. Require complete MT5 account pairing for active assignments & reactivations
    IF NOT v_is_fk_cleanup AND NEW.status = 'active' THEN
        IF NEW.parent_account_id IS NULL OR NEW.child_account_id IS NULL THEN
            RAISE EXCEPTION 'Security error: Active mentor assignments require both parent_account_id and child_account_id.';
        END IF;
    END IF;

    -- 3. Anti-Self-Assignment Checks
    IF NEW.mentor_id = NEW.trader_id THEN
        RAISE EXCEPTION 'Security error: A user cannot assign themselves as their own mentor.';
    END IF;

    IF NEW.parent_account_id IS NOT NULL
       AND NEW.child_account_id IS NOT NULL
       AND NEW.parent_account_id = NEW.child_account_id THEN
        RAISE EXCEPTION 'Security error: An MT5 account cannot be assigned as its own parent copy master.';
    END IF;

    -- 4. Mentor & Trader Profile Verification
    SELECT p.role, p.status
    INTO v_mentor_role, v_mentor_status
    FROM public.profiles p
    WHERE p.id = NEW.mentor_id;

    IF v_mentor_role IS DISTINCT FROM 'mentor' THEN
        RAISE EXCEPTION 'Security error: Target mentor_id is not a verified mentor profile.';
    END IF;

    IF (TG_OP = 'INSERT' OR NEW.status = 'active') AND v_mentor_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Security error: Target mentor_id is not a verified active mentor.';
    END IF;

    SELECT p.role, p.status
    INTO v_trader_role, v_trader_status
    FROM public.profiles p
    WHERE p.id = NEW.trader_id;

    IF v_trader_role IS DISTINCT FROM 'trader' THEN
        RAISE EXCEPTION 'Security error: Target trader_id is not a valid trader profile.';
    END IF;

    IF (TG_OP = 'INSERT' OR NEW.status = 'active') AND v_trader_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Security error: Trader account must be active to create or activate an assignment.';
    END IF;

    -- 5. Parent & Child MT5 Account Ownership, Role Parity, and Demo-Only Validation
    IF NEW.parent_account_id IS NOT NULL THEN
        SELECT a.user_id, a.account_role, a.account_type
        INTO v_parent_user_id, v_parent_role, v_parent_type
        FROM public.mt5_accounts a
        WHERE a.id = NEW.parent_account_id;

        IF v_parent_user_id IS NULL THEN
            RAISE EXCEPTION 'Security error: Parent MT5 account (%) does not exist.', NEW.parent_account_id;
        END IF;
        IF v_parent_role IS DISTINCT FROM 'parent' THEN
            RAISE EXCEPTION 'Security error: Parent MT5 account (%) must have account_role = parent.', NEW.parent_account_id;
        END IF;
        IF v_parent_type IS DISTINCT FROM 'demo' THEN
            RAISE EXCEPTION 'Security error: Only Demo MT5 parent accounts may be assigned.';
        END IF;
        IF v_parent_user_id IS DISTINCT FROM NEW.mentor_id THEN
            RAISE EXCEPTION 'Security error: Parent MT5 account (%) is not owned by mentor_id (%).', NEW.parent_account_id, NEW.mentor_id;
        END IF;
    END IF;

    IF NEW.child_account_id IS NOT NULL THEN
        SELECT a.user_id, a.account_role, a.account_type
        INTO v_child_user_id, v_child_role, v_child_type
        FROM public.mt5_accounts a
        WHERE a.id = NEW.child_account_id;

        IF v_child_user_id IS NULL THEN
            RAISE EXCEPTION 'Security error: Child MT5 account (%) does not exist.', NEW.child_account_id;
        END IF;
        IF v_child_role IS DISTINCT FROM 'child' THEN
            RAISE EXCEPTION 'Security error: Child MT5 account (%) must have account_role = child.', NEW.child_account_id;
        END IF;
        IF v_child_type IS DISTINCT FROM 'demo' THEN
            RAISE EXCEPTION 'Security error: Only Demo MT5 child accounts may be assigned.';
        END IF;
        IF v_child_user_id IS DISTINCT FROM NEW.trader_id THEN
            RAISE EXCEPTION 'Security error: Child MT5 account (%) is not owned by trader_id (%).', NEW.child_account_id, NEW.trader_id;
        END IF;
    END IF;

    -- 6. Lot & Risk Configuration Validation
    IF NEW.lot_mode IS NULL OR NEW.lot_mode NOT IN ('parent_lot', 'multiplier', 'fixed', 'fixed_lot', 'equity_ratio', 'risk_percent') THEN
        RAISE EXCEPTION 'Validation error: Invalid lot_mode (%).', COALESCE(NEW.lot_mode, 'NULL');
    END IF;
    IF NEW.lot_multiplier IS NULL OR NEW.lot_multiplier <= 0 OR NEW.lot_multiplier > 100 THEN
        RAISE EXCEPTION 'Validation error: lot_multiplier must be > 0 and <= 100.';
    END IF;
    IF NEW.fixed_lot IS NULL OR NEW.fixed_lot < 0.01 OR NEW.fixed_lot > 100 THEN
        RAISE EXCEPTION 'Validation error: fixed_lot must be between 0.01 and 100.';
    END IF;
    IF NEW.risk_percent IS NULL OR NEW.risk_percent <= 0 OR NEW.risk_percent > 100 THEN
        RAISE EXCEPTION 'Validation error: risk_percent must be > 0 and <= 100.';
    END IF;
    IF NEW.min_lot_clamp IS NULL OR NEW.min_lot_clamp < 0.01 OR NEW.min_lot_clamp > 100 THEN
        RAISE EXCEPTION 'Validation error: min_lot_clamp must be between 0.01 and 100.';
    END IF;
    IF NEW.max_lot_cap IS NULL OR NEW.max_lot_cap < NEW.min_lot_clamp OR NEW.max_lot_cap > 100 THEN
        RAISE EXCEPTION 'Validation error: max_lot_cap must be >= min_lot_clamp and <= 100.';
    END IF;
    IF NEW.slippage_max_pips IS NULL OR NEW.slippage_max_pips < 0 OR NEW.slippage_max_pips > 100 THEN
        RAISE EXCEPTION 'Validation error: slippage_max_pips must be between 0 and 100.';
    END IF;
    IF NEW.max_drawdown_percent IS NULL OR NEW.max_drawdown_percent < 0 OR NEW.max_drawdown_percent >= 100 THEN
        RAISE EXCEPTION 'Validation error: max_drawdown_percent must be between 0 and < 100.';
    END IF;

    -- 7. Anti-Hijacking & Caller Ownership Checks
    IF NOT v_is_privileged AND NOT v_is_fk_cleanup THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Security error: Authenticated session required to modify mentor assignments.';
        END IF;

        IF TG_OP = 'INSERT' THEN
            IF NEW.trader_id IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Security error: Users can only create assignments for their own trader profile.';
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            IF auth.uid() NOT IN (OLD.mentor_id, OLD.trader_id) THEN
                RAISE EXCEPTION 'Security error: Caller is not a party to this mentor assignment.';
            END IF;

            IF OLD.mentor_id IS DISTINCT FROM NEW.mentor_id
               OR OLD.trader_id IS DISTINCT FROM NEW.trader_id
               OR OLD.assigned_at IS DISTINCT FROM NEW.assigned_at THEN
                RAISE EXCEPTION 'Security error: Assignment ownership and creation timestamp cannot be transferred.';
            END IF;

            IF auth.uid() = OLD.mentor_id AND auth.uid() IS DISTINCT FROM OLD.trader_id THEN
                IF NEW.lot_mode IS DISTINCT FROM OLD.lot_mode
                   OR NEW.lot_multiplier IS DISTINCT FROM OLD.lot_multiplier
                   OR NEW.fixed_lot IS DISTINCT FROM OLD.fixed_lot
                   OR NEW.risk_percent IS DISTINCT FROM OLD.risk_percent
                   OR NEW.max_lot_cap IS DISTINCT FROM OLD.max_lot_cap
                   OR NEW.min_lot_clamp IS DISTINCT FROM OLD.min_lot_clamp
                   OR NEW.slippage_max_pips IS DISTINCT FROM OLD.slippage_max_pips
                   OR NEW.max_drawdown_percent IS DISTINCT FROM OLD.max_drawdown_percent
                   OR NEW.sync_sl_tp IS DISTINCT FROM OLD.sync_sl_tp
                   OR NEW.copy_pending_orders IS DISTINCT FROM OLD.copy_pending_orders
                   OR NEW.symbol_prefix IS DISTINCT FROM OLD.symbol_prefix
                   OR NEW.symbol_suffix IS DISTINCT FROM OLD.symbol_suffix
                   OR NEW.parent_account_id IS DISTINCT FROM OLD.parent_account_id
                   OR NEW.child_account_id IS DISTINCT FROM OLD.child_account_id THEN
                    RAISE EXCEPTION 'Security error: Only the assigned trader or an administrator may modify risk settings or account pairing.';
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_mentor_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mentor_assignment() TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 4. Enhance public.trades & public.trade_mappings for Durable Lifecycle & P&L
-- ------------------------------------------------------------------------------
ALTER TABLE public.trades
    ADD COLUMN IF NOT EXISTS mapping_id TEXT,
    ADD COLUMN IF NOT EXISTS parent_ticket TEXT,
    ADD COLUMN IF NOT EXISTS requested_volume NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS execution_status TEXT,
    ADD COLUMN IF NOT EXISTS rejection_reason TEXT,
    ADD COLUMN IF NOT EXISTS is_realized BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now());

-- Allow NULL profit for open/unsettled Cloud trades so unreported P&L is never faked as $0.00
ALTER TABLE public.trades ALTER COLUMN profit DROP DEFAULT;

CREATE INDEX IF NOT EXISTS idx_trades_account_status ON public.trades(account_id, status);
CREATE INDEX IF NOT EXISTS idx_trades_mapping_id ON public.trades(mapping_id) WHERE mapping_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_trades_open_time ON public.trades(open_time DESC);

DO $$
DECLARE
    v_dup_trades INTEGER := 0;
BEGIN
    SELECT COUNT(*)
    INTO v_dup_trades
    FROM (
        SELECT account_id, ticket
        FROM public.trades
        GROUP BY account_id, ticket
        HAVING COUNT(*) > 1
    ) t;

    IF v_dup_trades > 0 THEN
        RAISE NOTICE 'Skipped UNIQUE(account_id, ticket) on public.trades: % duplicate pair(s) detected.', v_dup_trades;
    ELSE
        CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_account_ticket_unique
            ON public.trades(account_id, ticket);
    END IF;
END
$$;

ALTER TABLE public.trade_mappings
    ADD COLUMN IF NOT EXISTS parent_profit_usd NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS child_profit_usd NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS close_price NUMERIC(15, 5),
    ADD COLUMN IF NOT EXISTS close_time TIMESTAMPTZ;

-- ------------------------------------------------------------------------------
-- 5. Missing Core Platform, Strategy, Audit, Notification & Billing Tables
-- ------------------------------------------------------------------------------

-- 5.1 public.mentor_profiles
CREATE TABLE IF NOT EXISTS public.mentor_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    strategy_name TEXT NOT NULL DEFAULT 'Master Strategy',
    description TEXT NOT NULL DEFAULT '',
    monthly_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (monthly_fee >= 0),
    max_followers INTEGER NOT NULL DEFAULT 100 CHECK (max_followers > 0),
    invite_code TEXT NOT NULL UNIQUE,
    is_public BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mentor_profiles_user ON public.mentor_profiles(user_id);

-- 5.2 public.mentor_groups
CREATE TABLE IF NOT EXISTS public.mentor_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (mentor_id, name)
);

CREATE INDEX IF NOT EXISTS idx_mentor_groups_mentor ON public.mentor_groups(mentor_id);

-- 5.3 public.platform_settings
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id TEXT PRIMARY KEY DEFAULT 'default',
    demo_only_enforced BOOLEAN NOT NULL DEFAULT TRUE CHECK (demo_only_enforced = TRUE),
    default_slippage_max_pips NUMERIC(8, 2) NOT NULL DEFAULT 3.00 CHECK (default_slippage_max_pips >= 0 AND default_slippage_max_pips <= 100),
    default_max_lot_cap NUMERIC(10, 2) NOT NULL DEFAULT 50.00 CHECK (default_max_lot_cap >= 0.01 AND default_max_lot_cap <= 100),
    heartbeat_stale_seconds INTEGER NOT NULL DEFAULT 60 CHECK (heartbeat_stale_seconds >= 10),
    maintenance_mode BOOLEAN NOT NULL DEFAULT FALSE,
    updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

INSERT INTO public.platform_settings (id, demo_only_enforced, default_slippage_max_pips, default_max_lot_cap, heartbeat_stale_seconds)
VALUES ('default', TRUE, 3.00, 50.00, 60)
ON CONFLICT (id) DO NOTHING;

-- 5.4 public.audit_logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    actor_role TEXT NOT NULL DEFAULT 'system' CHECK (actor_role IN ('admin', 'mentor', 'trader', 'system', 'service_role')),
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT 'system',
    target_id TEXT,
    result TEXT NOT NULL DEFAULT 'success' CHECK (result IN ('success', 'denied', 'failed')),
    details TEXT NOT NULL DEFAULT '',
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs(created_at DESC);

-- 5.5 public.notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
    target_role TEXT NOT NULL DEFAULT 'all' CHECK (target_role IN ('all', 'admin', 'mentor', 'trader')),
    type TEXT NOT NULL DEFAULT 'info' CHECK (type IN ('info', 'success', 'warning', 'error')),
    title TEXT NOT NULL,
    message TEXT NOT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON public.notifications(user_id, is_read, created_at DESC);

-- 5.6 public.subscription_plans
CREATE TABLE IF NOT EXISTS public.subscription_plans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('free_demo', 'trader_pro', 'mentor_pro', 'enterprise')),
    monthly_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (monthly_price_usd >= 0),
    yearly_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (yearly_price_usd >= 0),
    max_followers INTEGER NOT NULL DEFAULT 25 CHECK (max_followers > 0),
    max_child_accounts INTEGER NOT NULL DEFAULT 3 CHECK (max_child_accounts > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    features JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 5.7 public.subscriptions
CREATE TABLE IF NOT EXISTS public.subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    mentor_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'past_due', 'cancelled', 'expired')),
    billing_cycle TEXT NOT NULL DEFAULT 'monthly' CHECK (billing_cycle IN ('monthly', 'yearly')),
    amount_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (amount_usd >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    current_period_start TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    current_period_end TIMESTAMPTZ,
    cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_mentor ON public.subscriptions(mentor_id);

-- 5.8 public.payments
CREATE TABLE IF NOT EXISTS public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('stripe', 'paypal', 'manual')),
    provider_payment_id TEXT,
    amount_usd NUMERIC(10, 2) NOT NULL CHECK (amount_usd >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed', 'refunded')),
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON public.payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON public.payments(subscription_id);

-- 5.9 public.invoices
CREATE TABLE IF NOT EXISTS public.invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
    payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    invoice_number TEXT NOT NULL UNIQUE,
    amount_usd NUMERIC(10, 2) NOT NULL CHECK (amount_usd >= 0),
    currency TEXT NOT NULL DEFAULT 'USD',
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'paid', 'void', 'uncollectible')),
    issued_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    due_at TIMESTAMPTZ,
    paid_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_invoices_user ON public.invoices(user_id);

-- 5.10 public.payment_webhooks
CREATE TABLE IF NOT EXISTS public.payment_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    provider TEXT NOT NULL CHECK (provider IN ('stripe', 'paypal', 'manual')),
    event_id TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    processed BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at TIMESTAMPTZ,
    error_message TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_payment_webhooks_received ON public.payment_webhooks(received_at DESC);

-- ------------------------------------------------------------------------------
-- 6. RLS Policies & Tightened Grants for New Tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.mentor_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_webhooks ENABLE ROW LEVEL SECURITY;

-- mentor_profiles
DROP POLICY IF EXISTS "mentor_profiles_select_policy" ON public.mentor_profiles;
CREATE POLICY "mentor_profiles_select_policy"
    ON public.mentor_profiles FOR SELECT
    USING (is_public = TRUE OR user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "mentor_profiles_modify_policy" ON public.mentor_profiles;
CREATE POLICY "mentor_profiles_modify_policy"
    ON public.mentor_profiles FOR ALL
    USING (
        public.is_admin()
        OR (user_id = auth.uid() AND public.is_mentor())
    )
    WITH CHECK (
        public.is_admin()
        OR (user_id = auth.uid() AND public.is_mentor())
    );

-- mentor_groups
DROP POLICY IF EXISTS "mentor_groups_select_policy" ON public.mentor_groups;
CREATE POLICY "mentor_groups_select_policy"
    ON public.mentor_groups FOR SELECT
    USING (mentor_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "mentor_groups_modify_policy" ON public.mentor_groups;
CREATE POLICY "mentor_groups_modify_policy"
    ON public.mentor_groups FOR ALL
    USING (public.is_admin() OR (mentor_id = auth.uid() AND public.is_mentor()))
    WITH CHECK (public.is_admin() OR (mentor_id = auth.uid() AND public.is_mentor()));

-- platform_settings (readable by authenticated, mutable only by Super Admin / service_role)
DROP POLICY IF EXISTS "platform_settings_select_policy" ON public.platform_settings;
CREATE POLICY "platform_settings_select_policy"
    ON public.platform_settings FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "platform_settings_admin_policy" ON public.platform_settings;
CREATE POLICY "platform_settings_admin_policy"
    ON public.platform_settings FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- audit_logs (admin only)
DROP POLICY IF EXISTS "audit_logs_admin_select_policy" ON public.audit_logs;
CREATE POLICY "audit_logs_admin_select_policy"
    ON public.audit_logs FOR SELECT
    USING (public.is_admin());

-- notifications (own user or targeted broadcast; mark read only on own row)
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
CREATE POLICY "notifications_select_policy"
    ON public.notifications FOR SELECT
    USING (
        public.is_admin()
        OR user_id = auth.uid()
        OR (
            user_id IS NULL
            AND (
                target_role = 'all'
                OR EXISTS (
                    SELECT 1 FROM public.profiles p
                    WHERE p.id = auth.uid() AND p.status = 'active' AND p.role = target_role
                )
            )
        )
    );

DROP POLICY IF EXISTS "notifications_update_own_policy" ON public.notifications;
CREATE POLICY "notifications_update_own_policy"
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid() OR public.is_admin())
    WITH CHECK (user_id = auth.uid() OR public.is_admin());

-- subscription_plans
DROP POLICY IF EXISTS "subscription_plans_select_policy" ON public.subscription_plans;
CREATE POLICY "subscription_plans_select_policy"
    ON public.subscription_plans FOR SELECT
    USING (is_active = TRUE OR public.is_admin());

DROP POLICY IF EXISTS "subscription_plans_admin_policy" ON public.subscription_plans;
CREATE POLICY "subscription_plans_admin_policy"
    ON public.subscription_plans FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- subscriptions, payments, invoices (owner or admin)
DROP POLICY IF EXISTS "subscriptions_select_policy" ON public.subscriptions;
CREATE POLICY "subscriptions_select_policy"
    ON public.subscriptions FOR SELECT
    USING (user_id = auth.uid() OR mentor_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "payments_select_policy" ON public.payments;
CREATE POLICY "payments_select_policy"
    ON public.payments FOR SELECT
    USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "invoices_select_policy" ON public.invoices;
CREATE POLICY "invoices_select_policy"
    ON public.invoices FOR SELECT
    USING (user_id = auth.uid() OR public.is_admin());

-- payment_webhooks (admin read only; writes strictly via service_role backend)
DROP POLICY IF EXISTS "payment_webhooks_admin_select_policy" ON public.payment_webhooks;
CREATE POLICY "payment_webhooks_admin_select_policy"
    ON public.payment_webhooks FOR SELECT
    USING (public.is_admin());

-- Least-privilege grants across all 10 new tables
REVOKE ALL ON TABLE
    public.mentor_profiles,
    public.mentor_groups,
    public.platform_settings,
    public.audit_logs,
    public.notifications,
    public.subscription_plans,
    public.subscriptions,
    public.payments,
    public.invoices,
    public.payment_webhooks
FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
    public.mentor_profiles,
    public.mentor_groups
TO authenticated;

GRANT SELECT, UPDATE ON TABLE public.notifications TO authenticated;

GRANT SELECT ON TABLE
    public.platform_settings,
    public.audit_logs,
    public.subscription_plans,
    public.subscriptions,
    public.payments,
    public.invoices,
    public.payment_webhooks
TO authenticated;

GRANT ALL ON TABLE
    public.mentor_profiles,
    public.mentor_groups,
    public.platform_settings,
    public.audit_logs,
    public.notifications,
    public.subscription_plans,
    public.subscriptions,
    public.payments,
    public.invoices,
    public.payment_webhooks
TO postgres, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
