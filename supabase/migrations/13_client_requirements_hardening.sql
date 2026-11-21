-- ==============================================================================
-- TradeSync MT5: Migration 13 - Client Requirements Hardening & Enforcement
-- ==============================================================================
-- Production-compatible, transactional, idempotent PostgreSQL migration designed
-- to layer cleanly on top of Migrations 01-12 without altering any prior
-- migration file.
--
-- What this migration enforces:
-- 1. public.mt5_accounts Verified EA Telemetry & Broker Symbol Specs:
--    - Adds verified_balance, verified_equity, balance_verified_at, and
--      verified_symbol_specs (JSONB) updated strictly by trusted backend EA
--      heartbeats.
--    - Preserves Migration 12 unconditional account_type = 'demo' enforcement
--      for ALL callers (including service_role, postgres, supabase_admin).
--    - Protects verified_* telemetry columns inside protect_mt5_account_security()
--      from direct client forgery or mutation.
--    - Re-applies Migration 11 least-privilege table/column ACLs so authenticated
--      retains SELECT ONLY on non-secret columns (25 from Migration 11 + 4 new
--      verified telemetry columns = 29 columns) while keeping
--      terminal_token_hash strictly revoked from PUBLIC, anon, and authenticated.
-- 2. public.mentor_assignments Suspension, Hysteresis, Activation Epoch &
--    Atomic Capacity Enforcement:
--    - Expands status CHECK to allow ('active', 'paused', 'suspended', 'inactive').
--    - Adds suspended_by, suspended_at, suspension_reason, balance_pause_active,
--      pause_reason, paused_at, resumed_at, activated_at, activation_epoch.
--    - Updates validate_mentor_assignment() to:
--      a) Block students from unsuspending a 'suspended' assignment or clearing
--         balance_pause_active / hysteresis / suspension columns directly.
--      b) Advance activated_at & activation_epoch when transitioning to 'active'
--         or resuming from balance pause (single-row isolation; siblings untouched).
--      c) Acquire pg_advisory_xact_lock(hashtext('mentor_quota_' || mentor_id))
--         and atomically enforce distinct active trader count <= unexpired plan
--         max_followers whenever an assignment becomes 'active'.
-- 3. public.trade_mappings & public.bridge_instructions:
--    - Adds child_remaining_lots, partial_close_count, activation_epoch, and
--      parent_event_timestamp for proportional partial closes and boundary auditing.
-- 4. public.claim_pending_instructions(UUID, INT, INT):
--    - Cancels queued OPEN instructions on suspended/paused/balance-paused or
--      pre-activation assignments, and refuses to claim blocked OPENs, while
--      always allowing CLOSE and MODIFY instructions for existing open trades.
-- 5. public.subscription_plans:
--    - Upserts Trial (2), Silver (50), and Gold (100) plans and archives legacy
--      seeded plan codes cleanly without breaking existing subscription FKs.
-- 6. public.mentor_profiles RLS:
--    - Restricts direct authenticated table reads to owner and verified admins,
--      preventing student scraping of private strategy metrics via PostgREST.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. public.mt5_accounts Verified EA Telemetry + Preserved Demo-Only & ACLs
-- ------------------------------------------------------------------------------
ALTER TABLE public.mt5_accounts
    ADD COLUMN IF NOT EXISTS verified_balance NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS verified_equity NUMERIC(15, 2),
    ADD COLUMN IF NOT EXISTS balance_verified_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verified_symbol_specs JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Ensure Migration 12 unconditional demo-only CHECK constraint remains present
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint c
        JOIN pg_class tbl ON tbl.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          AND tbl.relname = 'mt5_accounts'
          AND c.conname = 'mt5_accounts_account_type_demo_only_check'
    ) THEN
        ALTER TABLE public.mt5_accounts
            ADD CONSTRAINT mt5_accounts_account_type_demo_only_check
            CHECK (account_type = 'demo');
    END IF;
END;
$$;

-- Preserve all Migration 12 checks + protect verified EA telemetry columns
CREATE OR REPLACE FUNCTION public.protect_mt5_account_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
    v_jwt_role TEXT := '';
    v_claims_raw TEXT := '';
    v_is_backend_service BOOLEAN := FALSE;
    v_is_privileged BOOLEAN := FALSE;
    v_caller_role TEXT := NULL;
    v_caller_status TEXT := NULL;
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

    v_is_backend_service :=
        current_user IN ('postgres', 'service_role', 'supabase_admin')
        OR session_user IN ('postgres', 'service_role', 'supabase_admin')
        OR v_jwt_role = 'service_role';

    v_is_privileged := v_is_backend_service OR public.is_admin();

    -- Unconditional Demo-only safeguard: applies to EVERY caller including
    -- service_role, postgres, supabase_admin, admins, mentors, and traders.
    IF NEW.account_type IS DISTINCT FROM 'demo' THEN
        RAISE EXCEPTION 'Security violation: Only Demo MT5 accounts (account_type = demo) may be created or updated; live/real accounts are strictly prohibited for all roles including service_role and postgres.';
    END IF;

    IF NOT v_is_privileged THEN
        IF TG_OP = 'INSERT' THEN
            SELECT p.role, p.status
            INTO v_caller_role, v_caller_status
            FROM public.profiles p
            WHERE p.id = auth.uid();

            IF v_caller_role IS NULL OR v_caller_status IS DISTINCT FROM 'active' THEN
                RAISE EXCEPTION 'Security violation: Active user profile is required to create an MT5 account.';
            END IF;

            IF NOT (
                (v_caller_role = 'trader' AND NEW.account_role = 'child')
                OR (v_caller_role = 'mentor' AND NEW.account_role = 'parent')
            ) THEN
                RAISE EXCEPTION 'Security violation: Account role (%) is not permitted for caller profile role (%).',
                    COALESCE(NEW.account_role, 'NULL'), v_caller_role;
            END IF;

            IF NEW.terminal_token_hash IS NOT NULL
               OR NEW.terminal_token_prefix IS NOT NULL
               OR NEW.terminal_token_created_at IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: Terminal token hash and metadata are server-managed.';
            END IF;

            IF NEW.symbol_verified IS NOT FALSE THEN
                RAISE EXCEPTION 'Security violation: symbol_verified is server-managed and cannot be pre-verified on direct client inserts.';
            END IF;

            IF NEW.connection_status IS DISTINCT FROM 'disconnected' THEN
                RAISE EXCEPTION 'Security violation: Direct client inserts must use connection_status = disconnected; connected and telemetry states are server-managed.';
            END IF;

            IF NEW.verified_balance IS NOT NULL
               OR NEW.verified_equity IS NOT NULL
               OR NEW.balance_verified_at IS NOT NULL
               OR COALESCE(NEW.verified_symbol_specs, '{}'::jsonb) IS DISTINCT FROM '{}'::jsonb THEN
                RAISE EXCEPTION 'Security violation: Verified EA telemetry columns (verified_balance, verified_equity, balance_verified_at, verified_symbol_specs) are server-managed.';
            END IF;

            IF NEW.balance IS DISTINCT FROM 0.00
               OR NEW.equity IS DISTINCT FROM 0.00
               OR NEW.margin IS DISTINCT FROM 0.00
               OR NEW.free_margin IS DISTINCT FROM 0.00
               OR NEW.ping_ms IS DISTINCT FROM 0
               OR NEW.error_message IS NOT NULL
               OR NEW.last_sync IS DISTINCT FROM now()
               OR NEW.created_at IS DISTINCT FROM now() THEN
                RAISE EXCEPTION 'Security violation: Server-managed telemetry and timestamp columns (balance, equity, margin, free_margin, ping_ms, error_message, last_sync, created_at) cannot be supplied or forged on direct client inserts.';
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.id IS DISTINCT FROM OLD.id
               OR NEW.user_id IS DISTINCT FROM OLD.user_id
               OR NEW.account_role IS DISTINCT FROM OLD.account_role
               OR NEW.account_type IS DISTINCT FROM OLD.account_type
               OR NEW.terminal_token_hash IS DISTINCT FROM OLD.terminal_token_hash
               OR NEW.terminal_token_prefix IS DISTINCT FROM OLD.terminal_token_prefix
               OR NEW.terminal_token_created_at IS DISTINCT FROM OLD.terminal_token_created_at
               OR NEW.symbol_verified IS DISTINCT FROM OLD.symbol_verified
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'Security violation: Protected mt5_accounts columns (id, user_id, account_role, account_type, terminal_token_*, symbol_verified, created_at) cannot be modified by non-admin callers.';
            END IF;

            IF NEW.balance IS DISTINCT FROM OLD.balance
               OR NEW.equity IS DISTINCT FROM OLD.equity
               OR NEW.margin IS DISTINCT FROM OLD.margin
               OR NEW.free_margin IS DISTINCT FROM OLD.free_margin
               OR NEW.ping_ms IS DISTINCT FROM OLD.ping_ms
               OR NEW.last_sync IS DISTINCT FROM OLD.last_sync
               OR NEW.error_message IS DISTINCT FROM OLD.error_message
               OR NEW.verified_balance IS DISTINCT FROM OLD.verified_balance
               OR NEW.verified_equity IS DISTINCT FROM OLD.verified_equity
               OR NEW.balance_verified_at IS DISTINCT FROM OLD.balance_verified_at
               OR NEW.verified_symbol_specs IS DISTINCT FROM OLD.verified_symbol_specs THEN
                RAISE EXCEPTION 'Security violation: Server-managed telemetry columns cannot be modified by non-admin callers.';
            END IF;

            IF NEW.connection_status IS DISTINCT FROM OLD.connection_status
               AND NEW.connection_status IS DISTINCT FROM 'disconnected' THEN
                RAISE EXCEPTION 'Security violation: Non-admin callers cannot establish connection_status = % without trusted EA heartbeat; only disconnecting is permitted.',
                    COALESCE(NEW.connection_status, 'NULL');
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_mt5_account_security ON public.mt5_accounts;
CREATE TRIGGER trg_protect_mt5_account_security
    BEFORE INSERT OR UPDATE ON public.mt5_accounts
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_mt5_account_security();

REVOKE ALL ON FUNCTION public.protect_mt5_account_security() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_mt5_account_security() TO service_role, postgres;

-- Re-apply Migration 11 least-privilege ACLs cleanly (adding ONLY the 4 non-secret verified telemetry columns)
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE public.mt5_accounts
    FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
    v_col RECORD;
BEGIN
    FOR v_col IN
        SELECT att.attname AS column_name
        FROM pg_attribute att
        JOIN pg_class cls ON cls.oid = att.attrelid
        JOIN pg_namespace ns ON ns.oid = cls.relnamespace
        WHERE ns.nspname = 'public'
          AND cls.relname = 'mt5_accounts'
          AND att.attnum > 0
          AND NOT att.attisdropped
    LOOP
        EXECUTE format(
            'REVOKE ALL (%I) ON TABLE public.mt5_accounts FROM PUBLIC, anon, authenticated;',
            v_col.column_name
        );
    END LOOP;
END;
$$;

REVOKE SELECT (terminal_token_hash) ON TABLE public.mt5_accounts
    FROM PUBLIC, anon, authenticated;

GRANT SELECT (
    id,
    user_id,
    account_number,
    broker_server,
    broker_name,
    account_role,
    account_type,
    balance,
    equity,
    margin,
    free_margin,
    currency,
    leverage,
    connection_status,
    ping_ms,
    is_investor_password,
    auto_trading_enabled,
    last_sync,
    error_message,
    created_at,
    terminal_token_prefix,
    terminal_token_created_at,
    broker_id,
    trading_symbol,
    symbol_verified,
    verified_balance,
    verified_equity,
    balance_verified_at,
    verified_symbol_specs
) ON TABLE public.mt5_accounts TO authenticated;

GRANT ALL PRIVILEGES ON TABLE public.mt5_accounts TO postgres, service_role;
GRANT SELECT (terminal_token_hash) ON TABLE public.mt5_accounts TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 2. public.mentor_assignments Suspension, Hysteresis, Boundary & Atomic Quota
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT c.conname
        FROM pg_constraint c
        JOIN pg_class tbl ON tbl.oid = c.conrelid
        JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
        WHERE ns.nspname = 'public'
          AND tbl.relname = 'mentor_assignments'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ~* '\ystatus\y'
          AND pg_get_constraintdef(c.oid) !~* 'membership_status'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.mentor_assignments DROP CONSTRAINT IF EXISTS %I;',
            v_con.conname
        );
    END LOOP;
END;
$$;

ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_status_check
    CHECK (status IN ('active', 'paused', 'suspended', 'inactive'));

ALTER TABLE public.mentor_assignments
    ADD COLUMN IF NOT EXISTS suspended_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
    ADD COLUMN IF NOT EXISTS balance_pause_active BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS pause_reason TEXT,
    ADD COLUMN IF NOT EXISTS paused_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS resumed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS activation_epoch INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_activation_epoch_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_activation_epoch_check
    CHECK (activation_epoch >= 1);

UPDATE public.mentor_assignments
SET activated_at = COALESCE(activated_at, assigned_at, timezone('utc'::text, now()))
WHERE status = 'active'
  AND activated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_mentor_status_trader
    ON public.mentor_assignments(mentor_id, status, trader_id);

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_balance_pause
    ON public.mentor_assignments(child_account_id, balance_pause_active)
    WHERE status = 'active';

-- Update validate_mentor_assignment() with atomic advisory lock quota check,
-- activation boundary tracking, and student anti-tamper suspension/pause guards.
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
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
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
    v_max_followers INTEGER := NULL;
    v_distinct_active_traders INTEGER := 0;
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

    -- 7. Anti-Hijacking, Caller Ownership & Student Suspension/Hysteresis Guards
    IF NOT v_is_privileged AND NOT v_is_fk_cleanup THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Security error: Authenticated session required to modify mentor assignments.';
        END IF;

        IF TG_OP = 'INSERT' THEN
            IF NEW.trader_id IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Security error: Users can only create assignments for their own trader profile.';
            END IF;

            IF NEW.suspended_by IS NOT NULL
               OR NEW.suspended_at IS NOT NULL
               OR NEW.suspension_reason IS NOT NULL
               OR NEW.balance_pause_active IS DISTINCT FROM FALSE
               OR NEW.pause_reason IS NOT NULL
               OR NEW.paused_at IS NOT NULL
               OR NEW.resumed_at IS NOT NULL THEN
                RAISE EXCEPTION 'Security error: Server-managed suspension and balance-pause fields cannot be forged on direct client inserts.';
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

            IF auth.uid() = OLD.trader_id AND auth.uid() IS DISTINCT FROM OLD.mentor_id THEN
                IF OLD.status = 'suspended' AND NEW.status IS DISTINCT FROM OLD.status THEN
                    RAISE EXCEPTION 'Security error: Suspended assignments can only be unsuspended by the owning mentor or an administrator.';
                END IF;

                IF NEW.status = 'suspended'
                   OR NEW.suspended_by IS DISTINCT FROM OLD.suspended_by
                   OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
                   OR NEW.suspension_reason IS DISTINCT FROM OLD.suspension_reason
                   OR NEW.balance_pause_active IS DISTINCT FROM OLD.balance_pause_active
                   OR NEW.pause_reason IS DISTINCT FROM OLD.pause_reason
                   OR NEW.paused_at IS DISTINCT FROM OLD.paused_at
                   OR NEW.resumed_at IS DISTINCT FROM OLD.resumed_at
                   OR NEW.activated_at IS DISTINCT FROM OLD.activated_at
                   OR NEW.activation_epoch IS DISTINCT FROM OLD.activation_epoch THEN
                    RAISE EXCEPTION 'Security error: Students cannot modify server-managed suspension, balance-pause, or activation-boundary fields.';
                END IF;
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
                   OR NEW.child_account_id IS DISTINCT FROM OLD.child_account_id
                   OR NEW.balance_pause_active IS DISTINCT FROM OLD.balance_pause_active
                   OR NEW.pause_reason IS DISTINCT FROM OLD.pause_reason
                   OR NEW.paused_at IS DISTINCT FROM OLD.paused_at
                   OR NEW.resumed_at IS DISTINCT FROM OLD.resumed_at THEN
                    RAISE EXCEPTION 'Security error: Only the assigned trader or an administrator may modify risk settings or account pairing; balance pause is telemetry-managed.';
                END IF;
            END IF;
        END IF;
    END IF;

    -- 8. Future-Only Activation Boundary & Epoch Advancement (Single Row Only)
    IF TG_OP = 'INSERT' THEN
        IF NEW.status = 'active' THEN
            NEW.activated_at := COALESCE(NEW.activated_at, v_now);
            NEW.activation_epoch := GREATEST(COALESCE(NEW.activation_epoch, 1), 1);
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF OLD.status IS DISTINCT FROM 'active' AND NEW.status = 'active' THEN
            NEW.activated_at := v_now;
            NEW.activation_epoch := COALESCE(OLD.activation_epoch, 1) + 1;
            NEW.resumed_at := COALESCE(NEW.resumed_at, v_now);
        ELSIF NEW.status = 'active'
          AND OLD.balance_pause_active IS TRUE
          AND NEW.balance_pause_active IS FALSE THEN
            NEW.activated_at := v_now;
            NEW.activation_epoch := COALESCE(OLD.activation_epoch, 1) + 1;
            NEW.resumed_at := COALESCE(NEW.resumed_at, v_now);
        END IF;

        IF NEW.status = 'suspended' AND OLD.status IS DISTINCT FROM 'suspended' THEN
            NEW.suspended_at := COALESCE(NEW.suspended_at, v_now);
        END IF;
    END IF;

    -- 9. Atomic Plan Follower Capacity Enforcement (Transaction-Scoped Advisory Lock)
    IF NOT v_is_fk_cleanup
       AND NEW.status = 'active'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
        PERFORM pg_advisory_xact_lock(hashtext('mentor_quota_' || NEW.mentor_id::text));

        SELECT COALESCE(sp.max_followers, sp.max_child_accounts)
        INTO v_max_followers
        FROM public.subscriptions s
        JOIN public.subscription_plans sp ON sp.id = s.plan_id
        WHERE (s.mentor_id = NEW.mentor_id OR s.user_id = NEW.mentor_id)
          AND s.status IN ('active', 'trial')
          AND (s.current_period_end IS NULL OR s.current_period_end > v_now)
        ORDER BY s.created_at DESC
        LIMIT 1;

        IF v_max_followers IS NULL OR v_max_followers <= 0 THEN
            RAISE EXCEPTION 'Capacity error: Mentor does not have an active, unexpired subscription plan.';
        END IF;

        SELECT COUNT(DISTINCT ma.trader_id)
        INTO v_distinct_active_traders
        FROM public.mentor_assignments ma
        WHERE ma.mentor_id = NEW.mentor_id
          AND ma.status = 'active'
          AND ma.trader_id IS DISTINCT FROM NEW.trader_id;

        IF v_distinct_active_traders >= v_max_followers THEN
            RAISE EXCEPTION 'Capacity limit reached: Plan allows up to % active student trader(s). Upgrade plan to activate additional students.', v_max_followers;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_mentor_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mentor_assignment() TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 3. Partial Close & Activation Epoch Columns on Mappings & Instructions
-- ------------------------------------------------------------------------------
ALTER TABLE public.trade_mappings
    ADD COLUMN IF NOT EXISTS child_remaining_lots NUMERIC(10, 2),
    ADD COLUMN IF NOT EXISTS partial_close_count INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS activation_epoch INTEGER,
    ADD COLUMN IF NOT EXISTS parent_event_timestamp TIMESTAMPTZ;

ALTER TABLE public.bridge_instructions
    ADD COLUMN IF NOT EXISTS activation_epoch INTEGER,
    ADD COLUMN IF NOT EXISTS parent_event_timestamp TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_bridge_instructions_child_action_status
    ON public.bridge_instructions(child_account_id, action, status);

-- ------------------------------------------------------------------------------
-- 4. Harden public.claim_pending_instructions() Against Pre-Activation & Paused OPENs
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_pending_instructions(
    p_child_account_id UUID,
    p_limit INT DEFAULT 20,
    p_lease_seconds INT DEFAULT 15
)
RETURNS TABLE (
    id TEXT,
    idempotency_key TEXT,
    action TEXT,
    child_account_id UUID,
    parent_account_id UUID,
    parent_ticket BIGINT,
    child_ticket BIGINT,
    symbol TEXT,
    order_type TEXT,
    lots NUMERIC,
    open_price NUMERIC,
    sl NUMERIC,
    tp NUMERIC,
    magic_number BIGINT,
    comment TEXT,
    status TEXT,
    lease_expires_at TIMESTAMPTZ,
    retry_count INT,
    created_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_safe_limit INT := GREATEST(COALESCE(p_limit, 20), 0);
    v_safe_lease_secs INT := GREATEST(COALESCE(p_lease_seconds, 15), 1);
    v_lease_expiry TIMESTAMPTZ := v_now + make_interval(secs => v_safe_lease_secs);
    v_jwt_role TEXT := '';
    v_claims_raw TEXT := '';
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

    IF NOT (
        current_user IN ('postgres', 'service_role', 'supabase_admin')
        OR session_user IN ('postgres', 'service_role', 'supabase_admin')
        OR v_jwt_role = 'service_role'
    ) THEN
        RAISE EXCEPTION 'Access denied: service_role or postgres backend session required to claim instructions';
    END IF;

    IF v_safe_limit = 0 OR p_child_account_id IS NULL THEN
        RETURN;
    END IF;

    -- Cancel queued OPEN instructions that belong to suspended/paused/inactive,
    -- balance-paused, or prior-epoch assignments so they cannot execute later.
    -- CLOSE and MODIFY instructions remain untouched and claimable.
    UPDATE public.bridge_instructions bi
    SET status = 'FAILED'
    WHERE bi.child_account_id = p_child_account_id
      AND bi.action = 'OPEN'
      AND bi.status = 'QUEUED'
      AND NOT EXISTS (
          SELECT 1
          FROM public.mentor_assignments ma
          WHERE ma.parent_account_id = bi.parent_account_id
            AND ma.child_account_id = bi.child_account_id
            AND ma.status = 'active'
            AND COALESCE(ma.balance_pause_active, FALSE) = FALSE
            AND (ma.activated_at IS NULL OR bi.created_at >= ma.activated_at)
            AND (
                bi.activation_epoch IS NULL
                OR ma.activation_epoch IS NULL
                OR bi.activation_epoch >= ma.activation_epoch
            )
      );

    -- Permanently transition expired instructions at retry ceiling (>= 5) to FAILED
    UPDATE public.bridge_instructions bi
    SET status = 'FAILED'
    WHERE bi.child_account_id = p_child_account_id
      AND bi.status = 'IN_FLIGHT'
      AND bi.lease_expires_at < v_now
      AND COALESCE(bi.retry_count, 0) >= 5;

    -- Update corresponding trade_mappings rows when max retries exceeded
    UPDATE public.trade_mappings tm
    SET status = 'FAILED',
        error_message = 'Max retries (5) exceeded without broker ACK',
        updated_at = v_now
    WHERE tm.child_account_id = p_child_account_id
      AND tm.status = 'PENDING'
      AND EXISTS (
          SELECT 1
          FROM public.bridge_instructions bi
          WHERE bi.child_account_id = p_child_account_id
            AND bi.parent_ticket = tm.parent_trade_ticket
            AND bi.status = 'FAILED'
            AND COALESCE(bi.retry_count, 0) >= 5
      );

    -- Atomically select, lock, and claim eligible instructions
    RETURN QUERY
    WITH eligible AS (
        SELECT q.id
        FROM public.bridge_instructions q
        WHERE q.child_account_id = p_child_account_id
          AND (
              q.status = 'QUEUED'
              OR (q.status = 'IN_FLIGHT' AND q.lease_expires_at < v_now AND COALESCE(q.retry_count, 0) < 5)
          )
          AND (
              q.action <> 'OPEN'
              OR EXISTS (
                  SELECT 1
                  FROM public.mentor_assignments ma
                  WHERE ma.parent_account_id = q.parent_account_id
                    AND ma.child_account_id = q.child_account_id
                    AND ma.status = 'active'
                    AND COALESCE(ma.balance_pause_active, FALSE) = FALSE
                    AND (ma.activated_at IS NULL OR q.created_at >= ma.activated_at)
                    AND (
                        q.activation_epoch IS NULL
                        OR ma.activation_epoch IS NULL
                        OR q.activation_epoch >= ma.activation_epoch
                    )
              )
          )
        ORDER BY q.created_at ASC
        LIMIT v_safe_limit
        FOR UPDATE OF q SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.bridge_instructions b
        SET status = 'IN_FLIGHT',
            lease_expires_at = v_lease_expiry,
            retry_count = CASE
                WHEN b.status = 'IN_FLIGHT' THEN COALESCE(b.retry_count, 0) + 1
                ELSE COALESCE(b.retry_count, 0)
            END
        FROM eligible e
        WHERE b.id = e.id
        RETURNING
            b.id::TEXT,
            b.idempotency_key::TEXT,
            b.action::TEXT,
            b.child_account_id::UUID,
            b.parent_account_id::UUID,
            b.parent_ticket::BIGINT,
            b.child_ticket::BIGINT,
            b.symbol::TEXT,
            b.order_type::TEXT,
            b.lots::NUMERIC,
            b.open_price::NUMERIC,
            b.sl::NUMERIC,
            b.tp::NUMERIC,
            b.magic_number::BIGINT,
            b.comment::TEXT,
            b.status::TEXT,
            b.lease_expires_at::TIMESTAMPTZ,
            b.retry_count::INT,
            b.created_at::TIMESTAMPTZ
    )
    SELECT c.* FROM claimed c ORDER BY c.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 5. Upsert Client Plans (Trial: 2, Silver: 50, Gold: 100) + Legacy Archival
-- ------------------------------------------------------------------------------
INSERT INTO public.subscription_plans (
    code,
    name,
    tier,
    description,
    trial_days,
    monthly_price_usd,
    yearly_price_usd,
    max_followers,
    max_child_accounts,
    is_active,
    is_archived,
    archived_at,
    features
)
VALUES
    (
        'trial',
        'Trial',
        'free_demo',
        'Evaluation mentor tier supporting up to 2 active Demo MT5 student traders.',
        14,
        0.00,
        0.00,
        2,
        2,
        TRUE,
        FALSE,
        NULL,
        '["Up to 2 active student traders","Demo MT5 Broadcaster & Receiver copier","SL/TP & proportional partial-close sync","Real-time $50/$100 balance protection"]'::jsonb
    ),
    (
        'silver',
        'Silver',
        'mentor_pro',
        'Growth mentor tier supporting up to 50 active Demo MT5 student traders.',
        0,
        49.00,
        490.00,
        50,
        50,
        TRUE,
        FALSE,
        NULL,
        '["Up to 50 active student traders","Demo MT5 Broadcaster & Receiver copier","SL/TP & proportional partial-close sync","Cohort strategy groups & CSV reports"]'::jsonb
    ),
    (
        'gold',
        'Gold',
        'enterprise',
        'Scale mentor tier supporting up to 100 active Demo MT5 student traders.',
        0,
        149.00,
        1490.00,
        100,
        100,
        TRUE,
        FALSE,
        NULL,
        '["Up to 100 active student traders","Priority sub-50ms bridge routing","Full compliance audit & CSV reporting","Dedicated cohort management & SLA"]'::jsonb
    )
ON CONFLICT (code) DO UPDATE
SET
    name = EXCLUDED.name,
    tier = EXCLUDED.tier,
    description = EXCLUDED.description,
    trial_days = EXCLUDED.trial_days,
    monthly_price_usd = EXCLUDED.monthly_price_usd,
    yearly_price_usd = EXCLUDED.yearly_price_usd,
    max_followers = EXCLUDED.max_followers,
    max_child_accounts = EXCLUDED.max_child_accounts,
    is_active = TRUE,
    is_archived = FALSE,
    archived_at = NULL,
    features = EXCLUDED.features,
    updated_at = timezone('utc'::text, now());

-- Archive legacy seeded plan codes without deleting any rows referenced by existing subscriptions
UPDATE public.subscription_plans
SET is_active = FALSE,
    is_archived = TRUE,
    archived_at = COALESCE(archived_at, timezone('utc'::text, now())),
    updated_at = timezone('utc'::text, now())
WHERE code IN ('starter_10', 'pro_50', 'business_200');

-- ------------------------------------------------------------------------------
-- 6. Tighten public.mentor_profiles SELECT RLS (Prevent Direct Student Scraping)
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "mentor_profiles_select_policy" ON public.mentor_profiles;
CREATE POLICY "mentor_profiles_select_policy"
    ON public.mentor_profiles FOR SELECT
    USING (user_id = auth.uid() OR public.is_admin());

NOTIFY pgrst, 'reload schema';

COMMIT;
