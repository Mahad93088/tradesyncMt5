-- ==============================================================================
-- TradeSync MT5: Migration 04 - Atomic Serverless Instruction Claiming via RPC
-- ==============================================================================
-- Eliminates concurrency race conditions across independent Vercel Serverless instances.
-- Uses FOR UPDATE SKIP LOCKED inside an atomic transaction.
-- Atomically locks QUEUED and expired IN_FLIGHT instructions, updates status to IN_FLIGHT,
-- assigns 15-second lease window, increments retry count, and enforces max 5 retries.
-- ==============================================================================

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
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
    v_now TIMESTAMPTZ := now();
    v_lease_expiry TIMESTAMPTZ := v_now + (p_lease_seconds || ' seconds')::INTERVAL;
BEGIN
    -- 1. Security Check: Only service_role or active admin may claim instructions
    IF NOT public.is_service_role_or_admin() THEN
        RAISE EXCEPTION 'Access denied: service_role or admin required to claim instructions';
    END IF;

    -- 2. Permanently transition expired instructions that have reached max retries (>= 5) to FAILED
    UPDATE public.bridge_instructions bi
    SET status = 'FAILED'
    WHERE bi.child_account_id = p_child_account_id
      AND bi.status = 'IN_FLIGHT'
      AND bi.lease_expires_at < v_now
      AND bi.retry_count >= 5;

    -- Also update corresponding trade_mappings if any
    UPDATE public.trade_mappings tm
    SET status = 'FAILED',
        error_message = 'Max retries (5) exceeded without broker ACK',
        updated_at = v_now
    WHERE tm.child_account_id = p_child_account_id
      AND tm.status = 'PENDING'
      AND EXISTS (
          SELECT 1 FROM public.bridge_instructions bi
          WHERE bi.child_account_id = p_child_account_id
            AND bi.parent_ticket = tm.parent_trade_ticket
            AND bi.status = 'FAILED'
            AND bi.retry_count >= 5
      );

    -- 3. Atomically select, lock, and update eligible instructions using FOR UPDATE SKIP LOCKED
    RETURN QUERY
    WITH eligible AS (
        SELECT q.id
        FROM public.bridge_instructions q
        WHERE q.child_account_id = p_child_account_id
          AND (
              q.status = 'QUEUED'
              OR (q.status = 'IN_FLIGHT' AND q.lease_expires_at < v_now AND q.retry_count < 5)
          )
        ORDER BY q.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    ),
    claimed AS (
        UPDATE public.bridge_instructions b
        SET status = 'IN_FLIGHT',
            lease_expires_at = v_lease_expiry,
            retry_count = CASE 
                WHEN b.status = 'IN_FLIGHT' THEN b.retry_count + 1 
                ELSE b.retry_count 
            END
        FROM eligible e
        WHERE b.id = e.id
        RETURNING 
            b.id,
            b.idempotency_key,
            b.action,
            b.child_account_id,
            b.parent_account_id,
            b.parent_ticket,
            b.child_ticket,
            b.symbol,
            b.order_type,
            b.lots,
            b.open_price,
            b.sl,
            b.tp,
            b.magic_number,
            b.comment,
            b.status,
            b.lease_expires_at,
            b.retry_count,
            b.created_at
    )
    SELECT * FROM claimed ORDER BY created_at ASC;
END;
$$;

-- Revoke default public execution privileges for defense-in-depth
REVOKE ALL ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) FROM anon;

-- Grant execution strictly to service_role and postgres backend engines
GRANT EXECUTE ON FUNCTION public.claim_pending_instructions(UUID, INT, INT) 
TO service_role, postgres;

