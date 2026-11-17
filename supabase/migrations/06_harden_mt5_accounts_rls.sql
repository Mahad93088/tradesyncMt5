-- ==============================================================================
-- TradeSync MT5: Migration 06 - Harden mt5_accounts RLS, Protected Columns,
--                               and Column-Level Terminal Token Protection
-- ==============================================================================
-- Addresses Priority 1 Audit Finding (FIX 4 — Harden MT5 Account RLS):
-- 1. Prevents non-admin authenticated users from modifying protected identity,
--    role, linkage, token, or server-managed telemetry columns on
--    public.mt5_accounts via direct PostgREST UPDATEs:
--      id, user_id, account_role, account_type, assigned_parent_id,
--      terminal_token_hash, terminal_token_prefix, terminal_token_created_at,
--      created_at, balance, equity, margin, free_margin, ping_ms, last_sync,
--      error_message
-- 2. Restricts non-admin connection_status transitions so authenticated users
--    can never establish connection_status = 'connected' (or fake
--    'connecting'/'error'), while preserving 'disconnected' and user settings
--    such as auto_trading_enabled.
-- 3. Enforces active-profile validation, trader->child / mentor->parent parity,
--    Demo-only safety, null linkage/token metadata, and safe DB defaults for
--    telemetry fields during direct client INSERTs.
-- 4. Hardens mt5_accounts INSERT, UPDATE, and DELETE RLS policies while
--    preserving legitimate tenant SELECT access and Super Admin / service_role
--    / postgres workflows.
-- 5. Revokes SELECT on sensitive column terminal_token_hash from PUBLIC, anon,
--    and authenticated roles (replacing blanket table-level SELECT with
--    explicit non-secret column SELECT for authenticated, while keeping full
--    SELECT + terminal_token_hash SELECT granted to service_role and postgres).
--
-- Idempotent & safe to re-run in the Supabase SQL Editor.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Safe Database Defaults for Server-Managed Telemetry Columns
-- ------------------------------------------------------------------------------
-- Ensures omitted columns on direct INSERT default safely without modifying
-- any pre-existing rows in public.mt5_accounts.
ALTER TABLE public.mt5_accounts
    ALTER COLUMN connection_status SET DEFAULT 'disconnected',
    ALTER COLUMN ping_ms SET DEFAULT 0,
    ALTER COLUMN last_sync SET DEFAULT now(),
    ALTER COLUMN created_at SET DEFAULT now();

-- ------------------------------------------------------------------------------
-- 2. Anti-Tamper Trigger Function on public.mt5_accounts
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

    v_is_privileged :=
        current_user IN ('postgres', 'service_role', 'supabase_admin')
        OR session_user IN ('postgres', 'service_role', 'supabase_admin')
        OR v_jwt_role = 'service_role'
        OR public.is_admin();

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

            IF NEW.assigned_parent_id IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: assigned_parent_id cannot be set on direct client inserts.';
            END IF;

            IF NEW.terminal_token_hash IS NOT NULL
               OR NEW.terminal_token_prefix IS NOT NULL
               OR NEW.terminal_token_created_at IS NOT NULL THEN
                RAISE EXCEPTION 'Security violation: Terminal token hash and metadata are server-managed.';
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
               OR NEW.assigned_parent_id IS DISTINCT FROM OLD.assigned_parent_id
               OR NEW.terminal_token_hash IS DISTINCT FROM OLD.terminal_token_hash
               OR NEW.terminal_token_prefix IS DISTINCT FROM OLD.terminal_token_prefix
               OR NEW.terminal_token_created_at IS DISTINCT FROM OLD.terminal_token_created_at
               OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
                RAISE EXCEPTION 'Security violation: Protected mt5_accounts columns (id, user_id, account_role, account_type, assigned_parent_id, terminal_token_*, created_at) cannot be modified by non-admin callers.';
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

-- ------------------------------------------------------------------------------
-- 3. Harden mt5_accounts RLS Policies (Preserve Tenant SELECT)
-- ------------------------------------------------------------------------------
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;

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
        public.is_admin()
        OR (
            user_id = auth.uid()
            AND account_type = 'demo'
            AND assigned_parent_id IS NULL
            AND terminal_token_hash IS NULL
            AND terminal_token_prefix IS NULL
            AND terminal_token_created_at IS NULL
            AND connection_status = 'disconnected'
            AND balance = 0
            AND equity = 0
            AND margin = 0
            AND free_margin = 0
            AND ping_ms = 0
            AND error_message IS NULL
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
                  AND (
                      (p.role = 'trader' AND account_role = 'child')
                      OR (p.role = 'mentor' AND account_role = 'parent')
                  )
            )
        )
    );

DROP POLICY IF EXISTS "mt5_accounts_update_policy" ON public.mt5_accounts;
CREATE POLICY "mt5_accounts_update_policy"
    ON public.mt5_accounts FOR UPDATE
    USING (
        public.is_admin()
        OR (
            user_id = auth.uid()
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
            )
        )
    )
    WITH CHECK (
        public.is_admin()
        OR (
            user_id = auth.uid()
            AND account_type = 'demo'
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
            )
        )
    );

DROP POLICY IF EXISTS "mt5_accounts_delete_policy" ON public.mt5_accounts;
CREATE POLICY "mt5_accounts_delete_policy"
    ON public.mt5_accounts FOR DELETE
    USING (
        public.is_admin()
        OR (
            user_id = auth.uid()
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
            )
        )
    );

-- ------------------------------------------------------------------------------
-- 4. Column-Level Privilege Restriction for terminal_token_hash
-- ------------------------------------------------------------------------------
-- In PostgreSQL, table-level SELECT overrides column-level REVOKE SELECT.
-- Revoke blanket SELECT from PUBLIC, anon, authenticated first, then grant
-- column-level SELECT on non-secret columns only to authenticated.
REVOKE SELECT ON public.mt5_accounts FROM PUBLIC, anon, authenticated;
REVOKE SELECT (terminal_token_hash) ON public.mt5_accounts FROM PUBLIC, anon, authenticated;

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
    assigned_parent_id
) ON public.mt5_accounts TO authenticated;

GRANT SELECT ON public.mt5_accounts TO service_role, postgres;
GRANT SELECT (terminal_token_hash) ON public.mt5_accounts TO service_role, postgres;

-- Notify PostgREST to reload schema and privilege metadata immediately
NOTIFY pgrst, 'reload schema';

COMMIT;
