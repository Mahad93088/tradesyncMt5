-- ==============================================================================
-- TradeSync MT5: Migration 10 - Client Repair & Complete SaaS Schema Completion
-- ==============================================================================
-- Production-compatible, transaction-wrapped, idempotent PostgreSQL migration
-- designed to apply cleanly on top of Migrations 01-09.
--
-- What this migration adds & protects:
-- 1. public.subscription_plans: description, trial_days (>= 0), is_archived,
--    archived_at + non-destructive seed refresh aligned to Migration 09 prices
--    ($49 / $149 / $399 monthly; $490 / $1490 / $3990 yearly).
-- 2. public.brokers & public.broker_symbols: exact backend column names
--    (slug, server_prefixes, symbol_code, base_currency, quote_currency,
--    verification_notes), baseline unverified Gold presets (is_verified = FALSE),
--    strict RLS + least-privilege grants.
-- 3. public.mt5_accounts: broker_id, trading_symbol, symbol_verified columns +
--    column-level SELECT grants preserving terminal_token_hash secrecy +
--    hardened protect_mt5_account_security() preserving all Migration 06 guards.
-- 4. public.mentor_profiles & public.mentor_assignments: student pricing metadata,
--    aligned membership_status ('trial','active','past_due','paused','cancelled'),
--    and trigger guard preventing non-admin/non-backend mutation of billing fields.
-- 5. public.mentor_trader_invitations: exact backend column names (trader_id,
--    invited_email, message, group_id, monthly_price_usd, billing_period,
--    child_account_id, responded_at), status CHECK including 'cancelled',
--    indexes, NULL-safe scoped SELECT RLS, and least-privilege grants.
--
-- Preserves all Demo-only safeguards (account_type = 'demo') and Migrations 01-09.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Extend public.subscription_plans & Non-Destructive Plan Seed Refresh
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.subscription_plans
    ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

-- Add trial_days nullable first so pre-existing Migration 09 Starter/Pro/Business
-- rows receive baseline trial days (7/14/14) without overwriting admin edits.
ALTER TABLE IF EXISTS public.subscription_plans
    ADD COLUMN IF NOT EXISTS trial_days INTEGER;

ALTER TABLE IF EXISTS public.subscription_plans
    ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.subscription_plans
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

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
    features
)
VALUES
    (
        'starter_10',
        'Starter 10',
        'mentor_pro',
        'Entry mentor tier supporting up to 10 verified follower Demo MT5 terminals.',
        7,
        49.00,
        490.00,
        10,
        10,
        TRUE,
        FALSE,
        '["Up to 10 active follower accounts","Parent-to-Child Demo MT5 trade copier","12-control follower risk engine & SL/TP sync","Real-time telemetry & CSV trade reports"]'::jsonb
    ),
    (
        'pro_50',
        'Pro 50',
        'mentor_pro',
        'Growth mentor tier supporting up to 50 followers with group cohorts and priority queue.',
        14,
        149.00,
        1490.00,
        50,
        50,
        TRUE,
        FALSE,
        '["Up to 50 active follower accounts","Custom symbol prefix/suffix mapping","Equity-ratio & risk-% position sizing","Strategy group segmentation & CSV reports"]'::jsonb
    ),
    (
        'business_200',
        'Business 200',
        'enterprise',
        'Institutional mentor tier for up to 200 follower Demo MT5 terminals.',
        14,
        399.00,
        3990.00,
        200,
        200,
        TRUE,
        FALSE,
        '["Up to 200 active follower accounts","Institutional multi-group broadcast routing","Webhook billing & invoice ledger retention","Full compliance audit trail & printable reports"]'::jsonb
    )
ON CONFLICT (code) DO UPDATE
SET
    description = CASE
        WHEN COALESCE(NULLIF(TRIM(public.subscription_plans.description), ''), '') = ''
            THEN EXCLUDED.description
        ELSE public.subscription_plans.description
    END,
    trial_days = COALESCE(public.subscription_plans.trial_days, EXCLUDED.trial_days),
    updated_at = timezone('utc'::text, now());

UPDATE public.subscription_plans
SET trial_days = 0
WHERE trial_days IS NULL;

ALTER TABLE IF EXISTS public.subscription_plans
    ALTER COLUMN trial_days SET DEFAULT 0,
    ALTER COLUMN trial_days SET NOT NULL;

ALTER TABLE IF EXISTS public.subscription_plans
    DROP CONSTRAINT IF EXISTS subscription_plans_trial_days_nonneg;
ALTER TABLE IF EXISTS public.subscription_plans
    ADD CONSTRAINT subscription_plans_trial_days_nonneg CHECK (trial_days >= 0);

-- ------------------------------------------------------------------------------
-- 2. Broker Directory & Broker-Specific Gold Symbols
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.brokers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    slug TEXT NOT NULL UNIQUE,
    server_prefixes TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE TABLE IF NOT EXISTS public.broker_symbols (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
    symbol_code TEXT NOT NULL,
    asset_class TEXT NOT NULL DEFAULT 'Metals',
    base_currency TEXT NOT NULL DEFAULT 'XAU',
    quote_currency TEXT NOT NULL DEFAULT 'USD',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    is_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verification_notes TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    UNIQUE (broker_id, symbol_code)
);

CREATE INDEX IF NOT EXISTS idx_broker_symbols_broker_id
    ON public.broker_symbols(broker_id);

CREATE INDEX IF NOT EXISTS idx_brokers_active
    ON public.brokers(is_active);

-- Seed baseline brokers with honest unverified notes
INSERT INTO public.brokers (name, slug, server_prefixes, is_active, notes)
VALUES
    (
        'XM Global',
        'xm_global',
        ARRAY['XMGlobal-MT5', 'xmglobal_mt5', 'xmglobal_mt5 7', 'XMGlobal-MT5 2', 'XMGlobal-MT5 3'],
        TRUE,
        'Baseline XM MT5 server catalog; confirm exact Gold symbol inside MetaTrader Market Watch.'
    ),
    (
        'IC Markets',
        'ic_markets',
        ARRAY['ICMarketsSC-Demo', 'ICMarkets-Demo', 'ICMarketsEU-Demo'],
        TRUE,
        'Baseline IC Markets Demo MT5 catalog; confirm exact Gold symbol inside MetaTrader Market Watch.'
    ),
    (
        'Pepperstone',
        'pepperstone',
        ARRAY['Pepperstone-Demo', 'PepperstoneUK-Demo'],
        TRUE,
        'Baseline Pepperstone Demo MT5 catalog; confirm exact Gold symbol inside MetaTrader Market Watch.'
    ),
    (
        'Exness',
        'exness',
        ARRAY['Exness-MT5Trial', 'Exness-MT5Trial2', 'Exness-MT5Trial7'],
        TRUE,
        'Baseline Exness Demo MT5 catalog; confirm exact Gold symbol inside MetaTrader Market Watch.'
    ),
    (
        'MetaQuotes-Demo',
        'metaquotes_demo',
        ARRAY['MetaQuotes-Demo'],
        TRUE,
        'Standard MetaQuotes Demo MT5 server catalog; confirm symbol in Market Watch.'
    )
ON CONFLICT (slug) DO NOTHING;

-- Seed baseline Gold symbol candidates per broker (strictly is_verified = FALSE until verified on MT5 terminal)
INSERT INTO public.broker_symbols (
    broker_id,
    symbol_code,
    asset_class,
    base_currency,
    quote_currency,
    is_active,
    is_verified,
    verification_notes
)
SELECT
    b.id,
    s.symbol_code,
    'Metals',
    'XAU',
    'USD',
    TRUE,
    FALSE,
    'Baseline unverified — confirm exact Gold symbol spelling inside MetaTrader 5 Market Watch.'
FROM public.brokers b
JOIN (
    VALUES
        ('xm_global', 'GOLD'),
        ('xm_global', 'XAUUSD'),
        ('xm_global', 'XAUUSDm'),
        ('ic_markets', 'XAUUSD'),
        ('ic_markets', 'XAUUSD.a'),
        ('pepperstone', 'XAUUSD'),
        ('pepperstone', 'XAUUSD.p'),
        ('exness', 'XAUUSD'),
        ('exness', 'XAUUSDm'),
        ('metaquotes_demo', 'XAUUSD')
) AS s(broker_slug, symbol_code)
    ON b.slug = s.broker_slug
ON CONFLICT (broker_id, symbol_code) DO NOTHING;

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_symbols ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brokers_authenticated_read" ON public.brokers;
CREATE POLICY "brokers_authenticated_read"
    ON public.brokers FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "brokers_admin_write" ON public.brokers;
CREATE POLICY "brokers_admin_write"
    ON public.brokers FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "broker_symbols_authenticated_read" ON public.broker_symbols;
CREATE POLICY "broker_symbols_authenticated_read"
    ON public.broker_symbols FOR SELECT
    TO authenticated
    USING (TRUE);

DROP POLICY IF EXISTS "broker_symbols_admin_write" ON public.broker_symbols;
CREATE POLICY "broker_symbols_admin_write"
    ON public.broker_symbols FOR ALL
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

REVOKE ALL ON TABLE public.brokers, public.broker_symbols FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.brokers, public.broker_symbols TO authenticated;
GRANT ALL ON TABLE public.brokers, public.broker_symbols TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 3. Link public.mt5_accounts to broker_id, trading_symbol, symbol_verified
--    Preserves Migration 06 terminal_token_hash column-level protection
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.mt5_accounts
    ADD COLUMN IF NOT EXISTS broker_id UUID REFERENCES public.brokers(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.mt5_accounts
    ADD COLUMN IF NOT EXISTS trading_symbol TEXT;

ALTER TABLE IF EXISTS public.mt5_accounts
    ADD COLUMN IF NOT EXISTS symbol_verified BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_broker
    ON public.mt5_accounts(broker_id)
    WHERE broker_id IS NOT NULL;

-- Grant authenticated column-level SELECT only on the 3 non-secret new columns
-- (terminal_token_hash remains completely revoked from PUBLIC, anon, authenticated).
GRANT SELECT (broker_id, trading_symbol, symbol_verified)
    ON public.mt5_accounts TO authenticated;

-- Extend Migration 06 trigger to also protect symbol_verified while preserving
-- every Migration 06 check verbatim.
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

    -- Demo-only safeguard cannot be bypassed by authenticated admins or clients.
    IF NOT v_is_backend_service AND NEW.account_type IS DISTINCT FROM 'demo' THEN
        RAISE EXCEPTION 'Security violation: Only Demo MT5 accounts (account_type = demo) may be created or updated; authenticated administrators cannot create or convert live MT5 accounts.';
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

-- ------------------------------------------------------------------------------
-- 4. Mentor & Student Membership Billing Columns + Anti-Tamper Billing Guard
-- ------------------------------------------------------------------------------
ALTER TABLE IF EXISTS public.mentor_profiles
    ADD COLUMN IF NOT EXISTS student_monthly_fee_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE IF EXISTS public.mentor_profiles
    ADD COLUMN IF NOT EXISTS student_billing_period TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE IF EXISTS public.mentor_profiles
    DROP CONSTRAINT IF EXISTS mentor_profiles_student_monthly_fee_check;
ALTER TABLE IF EXISTS public.mentor_profiles
    ADD CONSTRAINT mentor_profiles_student_monthly_fee_check
    CHECK (student_monthly_fee_usd >= 0);

ALTER TABLE IF EXISTS public.mentor_profiles
    DROP CONSTRAINT IF EXISTS mentor_profiles_student_billing_period_check;
ALTER TABLE IF EXISTS public.mentor_profiles
    ADD CONSTRAINT mentor_profiles_student_billing_period_check
    CHECK (student_billing_period IN ('monthly', 'quarterly', 'yearly', 'free'));

ALTER TABLE IF EXISTS public.mentor_assignments
    ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE IF EXISTS public.mentor_assignments
    ADD COLUMN IF NOT EXISTS membership_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00;

ALTER TABLE IF EXISTS public.mentor_assignments
    ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE IF EXISTS public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_membership_status_check;
ALTER TABLE IF EXISTS public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_membership_status_check
    CHECK (membership_status IN ('trial', 'active', 'past_due', 'paused', 'cancelled'));

ALTER TABLE IF EXISTS public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_membership_price_check;
ALTER TABLE IF EXISTS public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_membership_price_check
    CHECK (membership_price_usd >= 0);

ALTER TABLE IF EXISTS public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_billing_period_check;
ALTER TABLE IF EXISTS public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_billing_period_check
    CHECK (billing_period IN ('monthly', 'quarterly', 'yearly', 'free'));

-- Protect membership_status, membership_price_usd, billing_period from direct
-- client tampering (especially traders altering their own billing state) while
-- preserving authorized backend service_role and admin operations.
CREATE OR REPLACE FUNCTION public.protect_mentor_assignment_membership_billing()
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

    IF NOT v_is_privileged THEN
        IF TG_OP = 'INSERT' THEN
            IF NEW.membership_status IS DISTINCT FROM 'active'
               OR NEW.membership_price_usd IS DISTINCT FROM 0.00
               OR NEW.billing_period IS DISTINCT FROM 'monthly' THEN
                RAISE EXCEPTION 'Security error: Protected membership billing fields (membership_status, membership_price_usd, billing_period) are server-managed on direct client inserts.';
            END IF;
        ELSIF TG_OP = 'UPDATE' THEN
            IF NEW.membership_status IS DISTINCT FROM OLD.membership_status
               OR NEW.membership_price_usd IS DISTINCT FROM OLD.membership_price_usd
               OR NEW.billing_period IS DISTINCT FROM OLD.billing_period THEN
                RAISE EXCEPTION 'Security error: Protected membership billing fields (membership_status, membership_price_usd, billing_period) cannot be modified directly by traders or non-privileged clients.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_mentor_assignment_membership_billing ON public.mentor_assignments;
CREATE TRIGGER trg_protect_mentor_assignment_membership_billing
    BEFORE INSERT OR UPDATE ON public.mentor_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_mentor_assignment_membership_billing();

REVOKE ALL ON FUNCTION public.protect_mentor_assignment_membership_billing() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_mentor_assignment_membership_billing() TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 5. Mentor Trader Invitations & Join Requests Table (Exact Backend Alignment)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.mentor_trader_invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    trader_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    invited_email TEXT NOT NULL,
    direction TEXT NOT NULL DEFAULT 'mentor_invite'
        CHECK (direction IN ('mentor_invite', 'student_request')),
    status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked', 'expired', 'cancelled')),
    message TEXT NOT NULL DEFAULT '',
    group_id UUID REFERENCES public.mentor_groups(id) ON DELETE SET NULL,
    monthly_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0.00 CHECK (monthly_price_usd >= 0),
    billing_period TEXT NOT NULL DEFAULT 'monthly'
        CHECK (billing_period IN ('monthly', 'quarterly', 'yearly', 'free')),
    child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_mentor_invitations_mentor
    ON public.mentor_trader_invitations(mentor_id, status);

CREATE INDEX IF NOT EXISTS idx_mentor_invitations_trader
    ON public.mentor_trader_invitations(trader_id, status);

CREATE INDEX IF NOT EXISTS idx_mentor_invitations_email
    ON public.mentor_trader_invitations(lower(invited_email), status);

ALTER TABLE public.mentor_trader_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_invitations_select_scoped" ON public.mentor_trader_invitations;
CREATE POLICY "mentor_invitations_select_scoped"
    ON public.mentor_trader_invitations FOR SELECT
    TO authenticated
    USING (
        public.is_admin()
        OR mentor_id = auth.uid()
        OR trader_id = auth.uid()
        OR (
            NULLIF(TRIM(lower(invited_email)), '') IS NOT NULL
            AND NULLIF(TRIM(lower(invited_email)), '') = NULLIF(
                TRIM(lower((SELECT p.email FROM public.profiles p WHERE p.id = auth.uid()))),
                ''
            )
        )
    );

DROP POLICY IF EXISTS "mentor_invitations_mentor_manage" ON public.mentor_trader_invitations;
CREATE POLICY "mentor_invitations_mentor_manage"
    ON public.mentor_trader_invitations FOR ALL
    TO authenticated
    USING (public.is_admin() OR (mentor_id = auth.uid() AND public.is_mentor()))
    WITH CHECK (public.is_admin() OR (mentor_id = auth.uid() AND public.is_mentor()));

REVOKE ALL ON TABLE public.mentor_trader_invitations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.mentor_trader_invitations TO authenticated;
GRANT ALL ON TABLE public.mentor_trader_invitations TO postgres, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
