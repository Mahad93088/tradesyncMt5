-- ==============================================================================
-- TradeSync MT5: Migration 12 - Unconditional Database-Level Demo-Only Enforcement
-- ==============================================================================
-- Remediates the critical audit finding where protect_mt5_account_security()
-- exempted service_role/postgres/supabase_admin from the account_type = 'demo'
-- check and public.mt5_accounts retained CHECK (account_type IN ('demo', 'live')).
--
-- What this migration enforces:
-- 1. Pre-check: Verifies ZERO existing rows in public.mt5_accounts have
--    account_type IS DISTINCT FROM 'demo'. Never deletes or silently mutates
--    existing records; if any non-demo rows exist, aborts with full diagnostics.
-- 2. Tightens the account_type CHECK constraint on public.mt5_accounts to
--    CHECK (account_type = 'demo') strictly.
-- 3. Updates public.protect_mt5_account_security() so account_type = 'demo' is
--    enforced unconditionally for EVERY caller (including service_role,
--    postgres, supabase_admin, admins, mentors, and traders), while preserving
--    legitimate service_role operations for demo account registration, terminal
--    token management, EA heartbeats, and telemetry.
-- 4. Preserves all Migration 06, 10, and 11 RLS policies, column-level ACLs,
--    symbol_verified / terminal_token_* guards, and role parity protections.
--
-- Transactional and idempotent.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Pre-Check: Stop & Report If Any Non-Demo Rows Exist (Never Delete/Mutate)
-- ------------------------------------------------------------------------------
DO $$
DECLARE
    v_non_demo_count BIGINT := 0;
    v_sample_rows TEXT := '';
BEGIN
    SELECT COUNT(*)
    INTO v_non_demo_count
    FROM public.mt5_accounts
    WHERE account_type IS DISTINCT FROM 'demo';

    IF v_non_demo_count > 0 THEN
        SELECT COALESCE(
            string_agg(
                format(
                    'id=%s account_number=%s broker_server=%s account_type=%s',
                    id,
                    COALESCE(account_number, '<null>'),
                    COALESCE(broker_server, '<null>'),
                    COALESCE(account_type, '<null>')
                ),
                '; '
            ),
            ''
        )
        INTO v_sample_rows
        FROM (
            SELECT id, account_number, broker_server, account_type
            FROM public.mt5_accounts
            WHERE account_type IS DISTINCT FROM 'demo'
            ORDER BY created_at ASC
            LIMIT 20
        ) sub;

        RAISE EXCEPTION
            'Migration 12 aborted safely: found % existing public.mt5_accounts row(s) where account_type IS DISTINCT FROM ''demo''. No records were deleted or modified. Review and remediate these rows manually before tightening the constraint. Sample (up to 20): %',
            v_non_demo_count,
            v_sample_rows;
    END IF;
END;
$$;

-- ------------------------------------------------------------------------------
-- 2. Tighten public.mt5_accounts.account_type CHECK Constraint to 'demo' Only
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
          AND tbl.relname = 'mt5_accounts'
          AND c.contype = 'c'
          AND pg_get_constraintdef(c.oid) ~* '\yaccount_type\y'
    LOOP
        EXECUTE format(
            'ALTER TABLE public.mt5_accounts DROP CONSTRAINT IF EXISTS %I;',
            v_con.conname
        );
    END LOOP;
END;
$$;

ALTER TABLE public.mt5_accounts
    ADD CONSTRAINT mt5_accounts_account_type_demo_only_check
    CHECK (account_type = 'demo');

-- ------------------------------------------------------------------------------
-- 3. Update protect_mt5_account_security() to Enforce Demo-Only Unconditionally
-- ------------------------------------------------------------------------------
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
    -- Support both PostgREST v11 (request.jwt.claim.role) and v12+ (request.jwt.claims JSON)
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

            IF NEW.account_type IS DISTINCT FROM 'demo' THEN
                RAISE EXCEPTION 'Security violation: Only Demo MT5 accounts (account_type = demo) may be created.';
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
               OR NEW.error_message IS DISTINCT FROM OLD.error_message THEN
                RAISE EXCEPTION 'Security violation: Server-managed telemetry columns (balance, equity, margin, free_margin, ping_ms, last_sync, error_message) cannot be modified by non-admin callers.';
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

-- Preserve RLS enabled without altering policies or Migration 11 ACLs
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

COMMIT;
