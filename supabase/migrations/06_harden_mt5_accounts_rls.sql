-- ==============================================================================
-- TradeSync MT5: Migration 06 - Harden mt5_accounts RLS, Protected Columns,
--                               and Column-Level Terminal Token Protection
-- ==============================================================================
-- Addresses Priority 1 Audit Finding (FIX 4 — Harden MT5 Account RLS):
-- 1. Prevents non-admin authenticated users from modifying protected columns on
--    public.mt5_accounts via direct PostgREST UPDATEs:
--      id, user_id, account_role, account_type, assigned_parent_id,
--      terminal_token_hash, terminal_token_prefix, terminal_token_created_at,
--      created_at
-- 2. Prevents non-admin authenticated users from bypassing Demo-only safety,
--    parent linkage, terminal token metadata, or connection_status = 'connected'
--    via direct PostgREST INSERTs.
-- 3. Hardens mt5_accounts INSERT and UPDATE RLS policies to require an active
--    profile in public.profiles and account_type = 'demo' for non-admin writes.
-- 4. Revokes SELECT on sensitive column terminal_token_hash from PUBLIC, anon,
--    and authenticated roles (replacing blanket table-level SELECT with
--    explicit non-secret column SELECT for authenticated, while keeping full
--    SELECT + terminal_token_hash SELECT granted to service_role and postgres).
-- 5. Preserves legitimate tenant SELECT access (owner, active admin, mentor
--    for assigned child accounts).
--
-- Idempotent & safe to re-run in the Supabase SQL Editor.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Anti-Tamper Trigger Function on public.mt5_accounts
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.protect_mt5_account_security()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_jwt_role TEXT := '';
    v_claims_raw TEXT := '';
    v_is_privileged BOOLEAN := FALSE;
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

            IF NEW.connection_status = 'connected' THEN
                RAISE EXCEPTION 'Security violation: Client inserts cannot set connection_status to connected without EA heartbeat.';
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
-- 2. Harden mt5_accounts RLS Policies (Preserve Tenant SELECT)
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
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
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
-- 3. Column-Level Privilege Restriction for terminal_token_hash
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
