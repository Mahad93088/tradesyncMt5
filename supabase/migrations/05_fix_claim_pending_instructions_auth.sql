-- ==============================================================================
-- TradeSync MT5: Migration 05 - Fix claim_pending_instructions & Helper Auth
-- ==============================================================================
-- Fixes the live database permission mismatch where service_role backend calls
-- failed with:
--   "Access denied: service_role or postgres backend session required to claim instructions"
--
-- Root Causes Addressed:
-- 1. Live DB runs an older claim_pending_instructions definition that rejects
--    PostgREST service_role sessions (where session_user = 'authenticator' and
--    modern Supabase sb_secret_* / PostgREST v12+ use role switching and
--    request.jwt.claims rather than legacy session_user / request.jwt.claim.role).
-- 2. In 03_mt5_bridge_persistence.sql, is_service_role_or_admin() was marked
--    SECURITY DEFINER while checking `current_user IN ('postgres', 'service_role')`.
--    Because SECURITY DEFINER switches current_user to the function owner
--    ('postgres') for ALL callers, current_user inside that helper could not
--    safely identify the real PostgREST role. Switching both functions to
--    SECURITY INVOKER makes `current_user` reflect the actual active session role
--    ('anon', 'authenticated', 'service_role', or 'postgres').
--
-- Safety Guarantees:
-- - Idempotent (safe to run multiple times).
-- - Preserves atomic FOR UPDATE SKIP LOCKED claiming, lease expiry, & max-5 retries.
-- - Preserves RLS, tenant isolation, and active-admin checks via public.is_admin().
-- - Revokes EXECUTE on claim_pending_instructions from PUBLIC, anon, authenticated.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Fix public.is_service_role_or_admin() using SECURITY INVOKER
-- ------------------------------------------------------------------------------
-- With SECURITY INVOKER, `current_user` accurately reflects the PostgREST role
-- ('anon', 'authenticated', 'service_role') or direct backend role ('postgres').
CREATE OR REPLACE FUNCTION public.is_service_role_or_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public, auth
AS $$
DECLARE
    v_jwt_role TEXT := '';
    v_claims_raw TEXT := '';
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

    -- 1. Verified backend service_role or direct postgres/supabase_admin session
    IF current_user IN ('postgres', 'service_role', 'supabase_admin')
       OR session_user IN ('postgres', 'service_role', 'supabase_admin')
       OR v_jwt_role = 'service_role' THEN
        RETURN TRUE;
    END IF;

    -- 2. Authenticated browser caller with verified active admin profile
    RETURN public.is_admin();
END;
$$;

-- RLS policies on bridge_instructions & trade_mappings evaluate this helper for
-- authenticated tenant reads; SECURITY INVOKER ensures non-admins get FALSE.
-- Revoke from PUBLIC/anon so anonymous visitors cannot probe it via PostgREST RPC.
REVOKE ALL ON FUNCTION public.is_service_role_or_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_service_role_or_admin()
TO authenticated, service_role, postgres;

-- Ensure backend service_role retains schema, table, and sequence grants under SECURITY INVOKER
GRANT USAGE ON SCHEMA public TO service_role, postgres;
GRANT ALL ON TABLE
    public.bridge_instructions,
    public.trade_mappings,
    public.bridge_sync_logs
TO service_role, postgres;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 2. Replace public.claim_pending_instructions with fixed backend auth check
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

    -- 1. Strict Backend Authorization:
    --    Allows PostgREST service_role (legacy JWT or sb_secret_* key) or direct
    --    postgres/supabase_admin backend sessions. Rejects anon & regular users.
    IF NOT (
        current_user IN ('postgres', 'service_role', 'supabase_admin')
        OR session_user IN ('postgres', 'service_role', 'supabase_admin')
        OR v_jwt_role = 'service_role'
    ) THEN
        RAISE EXCEPTION 'Access denied: service_role or postgres backend session required to claim instructions';
    END IF;

    -- Allow non-mutating health/RPC probes with p_limit = 0 or null account
    IF v_safe_limit = 0 OR p_child_account_id IS NULL THEN
        RETURN;
    END IF;

    -- 2. Permanently transition expired instructions at retry ceiling (>= 5) to FAILED
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

    -- 3. Atomically select, lock, and claim eligible instructions (FOR UPDATE SKIP LOCKED)
    RETURN QUERY
    WITH eligible AS (
        SELECT q.id
        FROM public.bridge_instructions q
        WHERE q.child_account_id = p_child_account_id
          AND (
              q.status = 'QUEUED'
              OR (q.status = 'IN_FLIGHT' AND q.lease_expires_at < v_now AND COALESCE(q.retry_count, 0) < 5)
          )
        ORDER BY q.created_at ASC
        LIMIT v_safe_limit
        FOR UPDATE SKIP LOCKED
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

-- Tighten function execution privileges strictly to service_role and postgres
REVOKE ALL ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) FROM anon;
REVOKE ALL ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_instructions(UUID, INT, INT)
TO service_role, postgres;

-- Notify PostgREST to reload schema/function metadata immediately
NOTIFY pgrst, 'reload schema';

COMMIT;
