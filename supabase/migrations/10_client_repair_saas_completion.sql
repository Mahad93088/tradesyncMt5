-- ============================================================================
-- TradeSync MT5 - Migration 10: Client Repair & Complete SaaS Completion
-- Adds:
--   1. subscription_plans description, trial_days, is_archived, archived_at
--   2. brokers & broker_symbols tables with honest verification flags & Gold presets
--   3. mt5_accounts broker_id, trading_symbol, symbol_verified columns
--   4. mentor_profiles student_monthly_fee_usd, student_billing_period
--   5. mentor_assignments membership_status, membership_price_usd, billing_period
--   6. mentor_trader_invitations table for invitations + student join requests
-- All Demo-only protections and existing Migrations 01-09 security remain intact.
-- ============================================================================

-- 1. Extend subscription_plans with description, trial_days, and safe archival
ALTER TABLE IF EXISTS public.subscription_plans
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE IF EXISTS public.subscription_plans
  ADD COLUMN IF NOT EXISTS trial_days INTEGER NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE IF EXISTS public.subscription_plans
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'subscription_plans'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'subscription_plans_trial_days_nonneg'
    ) THEN
      ALTER TABLE public.subscription_plans
        ADD CONSTRAINT subscription_plans_trial_days_nonneg CHECK (trial_days >= 0);
    END IF;
  END IF;
END $$;

-- Idempotent seed refresh for Starter 10, Pro 50, Business 200
INSERT INTO public.subscription_plans (
  code, name, tier, description, trial_days,
  monthly_price_usd, yearly_price_usd,
  max_followers, max_child_accounts, is_active, is_archived, features
)
VALUES
  (
    'starter_10',
    'Starter 10',
    'mentor_pro',
    'Entry mentor tier supporting up to 10 verified follower Demo MT5 terminals.',
    7,
    29,
    290,
    10,
    10,
    TRUE,
    FALSE,
    '["Up to 10 active followers", "Real-time SL/TP sync", "Demo-only account guard", "MT5 bridge diagnostics"]'::jsonb
  ),
  (
    'pro_50',
    'Pro 50',
    'mentor_pro',
    'Growth mentor tier supporting up to 50 followers with group cohorts and priority queue.',
    14,
    79,
    790,
    50,
    50,
    TRUE,
    FALSE,
    '["Up to 50 active followers", "Follower risk cohorts & groups", "Priority instruction queue", "Full audit & telemetry logs"]'::jsonb
  ),
  (
    'business_200',
    'Business 200',
    'enterprise',
    'Institutional mentor tier for up to 200 follower Demo MT5 terminals.',
    14,
    199,
    1990,
    200,
    200,
    TRUE,
    FALSE,
    '["Up to 200 active followers", "Multi-group follower routing", "Dedicated audit export", "SLA health monitoring"]'::jsonb
  )
ON CONFLICT (code) DO UPDATE
SET
  description = CASE
    WHEN COALESCE(public.subscription_plans.description, '') = '' THEN EXCLUDED.description
    ELSE public.subscription_plans.description
  END,
  trial_days = COALESCE(public.subscription_plans.trial_days, EXCLUDED.trial_days),
  updated_at = NOW();

-- 2. Broker Directory & Broker-Specific Gold Symbols
CREATE TABLE IF NOT EXISTS public.brokers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  code TEXT NOT NULL UNIQUE,
  mt5_server_examples TEXT[] NOT NULL DEFAULT '{}',
  website_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.broker_symbols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  broker_id UUID NOT NULL REFERENCES public.brokers(id) ON DELETE CASCADE,
  symbol_name TEXT NOT NULL,
  asset_class TEXT NOT NULL DEFAULT 'commodities',
  is_gold BOOLEAN NOT NULL DEFAULT TRUE,
  prefix TEXT NOT NULL DEFAULT '',
  suffix TEXT NOT NULL DEFAULT '',
  digits INTEGER NOT NULL DEFAULT 2,
  min_lot NUMERIC(10, 4) NOT NULL DEFAULT 0.01,
  max_lot NUMERIC(10, 4) NOT NULL DEFAULT 100.0000,
  lot_step NUMERIC(10, 4) NOT NULL DEFAULT 0.01,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (broker_id, symbol_name)
);

CREATE INDEX IF NOT EXISTS idx_broker_symbols_broker_id ON public.broker_symbols(broker_id);

-- Seed baseline brokers (marked is_verified = FALSE unless Admin/EA confirms on live terminal)
INSERT INTO public.brokers (name, code, mt5_server_examples, is_active, is_verified, notes)
VALUES
  (
    'XM Global',
    'xm_global',
    ARRAY['xmglobal_mt5 7', 'xmglobal_mt5 2', 'XMGlobal-MT5', 'XMGlobal-MT5 2', 'XMGlobal-MT5 3'],
    TRUE,
    FALSE,
    'Baseline XM MT5 server catalog; confirm exact Gold symbol inside MT5 Market Watch.'
  ),
  (
    'IC Markets',
    'ic_markets',
    ARRAY['ICMarketsSC-Demo', 'ICMarketsSC-MT5', 'ICMarketsEU-Demo'],
    TRUE,
    FALSE,
    'Baseline IC Markets Demo MT5 catalog; confirm exact Gold symbol inside MT5 Market Watch.'
  ),
  (
    'Pepperstone',
    'pepperstone',
    ARRAY['Pepperstone-Demo', 'PepperstoneUK-Demo'],
    TRUE,
    FALSE,
    'Baseline Pepperstone Demo MT5 catalog; confirm exact Gold symbol inside MT5 Market Watch.'
  ),
  (
    'Exness',
    'exness',
    ARRAY['Exness-MT5Trial', 'Exness-MT5Trial2', 'Exness-MT5Trial7'],
    TRUE,
    FALSE,
    'Baseline Exness Demo MT5 catalog; confirm exact Gold symbol inside MT5 Market Watch.'
  ),
  (
    'MetaQuotes-Demo',
    'metaquotes_demo',
    ARRAY['MetaQuotes-Demo'],
    TRUE,
    FALSE,
    'Standard MetaQuotes Demo MT5 server.'
  )
ON CONFLICT (code) DO NOTHING;

-- Seed baseline Gold symbol candidates per broker (is_verified = FALSE until verified against MT5 Market Watch)
INSERT INTO public.broker_symbols (broker_id, symbol_name, is_gold, prefix, suffix, digits, min_lot, max_lot, lot_step, is_active, is_verified)
SELECT b.id, s.symbol_name, TRUE, s.prefix, s.suffix, 2, 0.01, 100.0, 0.01, TRUE, FALSE
FROM public.brokers b
JOIN (
  VALUES
    ('xm_global', 'GOLD', '', ''),
    ('xm_global', 'XAUUSD', '', ''),
    ('xm_global', 'XAUUSDm', '', 'm'),
    ('ic_markets', 'XAUUSD', '', ''),
    ('ic_markets', 'XAUUSD.a', '', '.a'),
    ('pepperstone', 'XAUUSD', '', ''),
    ('pepperstone', 'XAUUSD.p', '', '.p'),
    ('exness', 'XAUUSDm', '', 'm'),
    ('exness', 'XAUUSD', '', ''),
    ('metaquotes_demo', 'XAUUSD', '', '')
) AS s(broker_code, symbol_name, prefix, suffix)
  ON b.code = s.broker_code
ON CONFLICT (broker_id, symbol_name) DO NOTHING;

ALTER TABLE public.brokers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.broker_symbols ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brokers_authenticated_read" ON public.brokers;
CREATE POLICY "brokers_authenticated_read" ON public.brokers
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "brokers_admin_write" ON public.brokers;
CREATE POLICY "brokers_admin_write" ON public.brokers
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "broker_symbols_authenticated_read" ON public.broker_symbols;
CREATE POLICY "broker_symbols_authenticated_read" ON public.broker_symbols
  FOR SELECT TO authenticated
  USING (TRUE);

DROP POLICY IF EXISTS "broker_symbols_admin_write" ON public.broker_symbols;
CREATE POLICY "broker_symbols_admin_write" ON public.broker_symbols
  FOR ALL TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3. Link mt5_accounts cleanly to broker_id and selected trading_symbol
ALTER TABLE IF EXISTS public.mt5_accounts
  ADD COLUMN IF NOT EXISTS broker_id UUID REFERENCES public.brokers(id) ON DELETE SET NULL;

ALTER TABLE IF EXISTS public.mt5_accounts
  ADD COLUMN IF NOT EXISTS trading_symbol TEXT;

ALTER TABLE IF EXISTS public.mt5_accounts
  ADD COLUMN IF NOT EXISTS symbol_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 4. Mentor & Student Membership Billing Metadata
ALTER TABLE IF EXISTS public.mentor_profiles
  ADD COLUMN IF NOT EXISTS student_monthly_fee_usd NUMERIC(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.mentor_profiles
  ADD COLUMN IF NOT EXISTS student_billing_period TEXT NOT NULL DEFAULT 'monthly';

ALTER TABLE IF EXISTS public.mentor_assignments
  ADD COLUMN IF NOT EXISTS membership_status TEXT NOT NULL DEFAULT 'active';

ALTER TABLE IF EXISTS public.mentor_assignments
  ADD COLUMN IF NOT EXISTS membership_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0;

ALTER TABLE IF EXISTS public.mentor_assignments
  ADD COLUMN IF NOT EXISTS billing_period TEXT NOT NULL DEFAULT 'monthly';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'mentor_assignments'
  ) THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'mentor_assignments_membership_status_check'
    ) THEN
      ALTER TABLE public.mentor_assignments
        ADD CONSTRAINT mentor_assignments_membership_status_check
        CHECK (membership_status IN ('paid', 'unpaid', 'expired', 'cancelled', 'active', 'trial'));
    END IF;
  END IF;
END $$;

-- 5. Mentor Trader Invitations & Join Requests Table
CREATE TABLE IF NOT EXISTS public.mentor_trader_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trader_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL DEFAULT '',
  invite_code TEXT,
  direction TEXT NOT NULL DEFAULT 'mentor_invite' CHECK (direction IN ('mentor_invite', 'student_request')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'revoked', 'expired')),
  group_id UUID REFERENCES public.mentor_groups(id) ON DELETE SET NULL,
  monthly_price_usd NUMERIC(10, 2) NOT NULL DEFAULT 0,
  billing_period TEXT NOT NULL DEFAULT 'monthly',
  child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mentor_invitations_mentor ON public.mentor_trader_invitations(mentor_id, status);
CREATE INDEX IF NOT EXISTS idx_mentor_invitations_trader ON public.mentor_trader_invitations(trader_user_id, status);
CREATE INDEX IF NOT EXISTS idx_mentor_invitations_email ON public.mentor_trader_invitations(lower(email), status);

ALTER TABLE public.mentor_trader_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_invitations_select_scoped" ON public.mentor_trader_invitations;
CREATE POLICY "mentor_invitations_select_scoped" ON public.mentor_trader_invitations
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR mentor_id = auth.uid()
    OR trader_user_id = auth.uid()
    OR lower(email) = lower(COALESCE((SELECT email FROM public.profiles WHERE id = auth.uid()), ''))
  );

DROP POLICY IF EXISTS "mentor_invitations_mentor_manage" ON public.mentor_trader_invitations;
CREATE POLICY "mentor_invitations_mentor_manage" ON public.mentor_trader_invitations
  FOR ALL TO authenticated
  USING (public.is_admin() OR mentor_id = auth.uid())
  WITH CHECK (public.is_admin() OR mentor_id = auth.uid());

-- Grants for authenticated role (service_role bypasses RLS by design)
GRANT SELECT ON public.brokers TO authenticated;
GRANT SELECT ON public.broker_symbols TO authenticated;
GRANT SELECT ON public.mentor_trader_invitations TO authenticated;
GRANT ALL ON public.brokers TO service_role;
GRANT ALL ON public.broker_symbols TO service_role;
GRANT ALL ON public.mentor_trader_invitations TO service_role;
