-- ==============================================================================
-- TradeSync MT5: Migration 11 - Harden public.mt5_accounts Table & Column ACLs
-- ==============================================================================
-- Corrects leftover Supabase default privileges (INSERT, UPDATE, DELETE,
-- REFERENCES, TRIGGER, TRUNCATE) on public.mt5_accounts for anon/authenticated
-- while preserving:
--   1. Column-level SELECT on exactly the 25 non-secret columns for authenticated
--      (22 columns from Migration 06 + 3 columns from Migration 10).
--   2. Complete secrecy of terminal_token_hash for PUBLIC, anon, authenticated.
--   3. Full operational privileges for postgres and service_role.
--   4. All existing RLS policies, triggers (protect_mt5_account_security), and
--      DEMO-only (account_type = 'demo') restrictions.
--   5. Zero sequence grants and zero Realtime publication changes.
--
-- Transactional and idempotent.
-- ==============================================================================

BEGIN;

-- 1. Re-assert RLS remains enabled (non-destructive; preserves existing policies)
ALTER TABLE public.mt5_accounts ENABLE ROW LEVEL SECURITY;

-- 2. Revoke all table-level privileges from PUBLIC, anon, and authenticated
--    (eliminates anon writes plus TRUNCATE, TRIGGER, REFERENCES, INSERT, UPDATE, DELETE)
REVOKE ALL PRIVILEGES ON TABLE public.mt5_accounts
    FROM PUBLIC, anon, authenticated;

-- 3. Sweep all existing column-level ACLs on every non-dropped column so no
--    legacy or unintended PUBLIC/anon/authenticated column grant can survive
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

-- Explicit belt-and-suspenders revocation of sensitive token hash column
REVOKE SELECT (terminal_token_hash) ON TABLE public.mt5_accounts
    FROM PUBLIC, anon, authenticated;

-- 4. Re-grant column-level SELECT to authenticated on ONLY the 25 intended
--    non-secret columns (22 from Migration 06 + 3 from Migration 10)
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
    symbol_verified
) ON TABLE public.mt5_accounts TO authenticated;

-- 5. Explicitly preserve full operational privileges for postgres and service_role
GRANT ALL PRIVILEGES ON TABLE public.mt5_accounts TO postgres, service_role;
GRANT SELECT (terminal_token_hash) ON TABLE public.mt5_accounts TO postgres, service_role;

-- 6. Refresh PostgREST schema & privilege cache
NOTIFY pgrst, 'reload schema';

COMMIT;
