-- ==============================================================================
-- TradeSync MT5: Migration 09 - Day 2 Security, Billing & Archival Hardening
-- ==============================================================================
-- Idempotent PostgreSQL migration for manual Supabase SQL Editor application.
-- Preserves all Demo-Only safeguards and Migration 05/06/07/08 protections.
--
-- What this migration accomplishes:
-- 1. Hardens public.notifications UPDATE permissions so authenticated non-admin
--    users may ONLY toggle is_read on their own rows (column-level GRANT +
--    SECURITY DEFINER BEFORE UPDATE trigger protecting all other columns).
-- 2. Preserves financial history (subscriptions, payments, invoices) across
--    account deletion/archival by replacing NOT NULL + ON DELETE CASCADE on
--    user_id with nullable user_id + ON DELETE SET NULL plus archival metadata
--    columns and a BEFORE DELETE preservation trigger on public.profiles.
-- 3. Idempotently seeds required SaaS subscription plans (Starter 10, Pro 50,
--    Business 200) matching the client specification.
-- 4. Adds public.mentor_assignments.group_id referencing public.mentor_groups(id)
--    with ownership validation so mentors can organize students into groups.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Harden public.notifications Column-Level UPDATE & Trigger Enforcement
-- ------------------------------------------------------------------------------
REVOKE UPDATE ON TABLE public.notifications FROM authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_notifications_immutable_columns()
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

    IF v_is_privileged THEN
        RETURN NEW;
    END IF;

    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Security error: Authenticated session required to update notifications.';
    END IF;

    IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
        RAISE EXCEPTION 'Security error: Users may only mark their own notifications as read.';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.target_role IS DISTINCT FROM OLD.target_role
       OR NEW.type IS DISTINCT FROM OLD.type
       OR NEW.title IS DISTINCT FROM OLD.title
       OR NEW.message IS DISTINCT FROM OLD.message
       OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'Security error: Only notifications.is_read may be updated by non-admin users.';
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_notifications_immutable_columns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_notifications_immutable_columns() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_notifications_immutable_columns ON public.notifications;
CREATE TRIGGER trg_notifications_immutable_columns
    BEFORE UPDATE ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_notifications_immutable_columns();

-- ------------------------------------------------------------------------------
-- 2. Preserve Financial History (subscriptions, payments, invoices) on Delete
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS archived_email TEXT;

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS archived_user_id UUID,
    ADD COLUMN IF NOT EXISTS archived_user_email TEXT;

ALTER TABLE public.payments
    ADD COLUMN IF NOT EXISTS archived_user_id UUID,
    ADD COLUMN IF NOT EXISTS archived_user_email TEXT;

ALTER TABLE public.invoices
    ADD COLUMN IF NOT EXISTS archived_user_id UUID,
    ADD COLUMN IF NOT EXISTS archived_user_email TEXT;

ALTER TABLE public.subscriptions ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.payments ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE public.invoices ALTER COLUMN user_id DROP NOT NULL;

DO $$
DECLARE
    v_tbl TEXT;
    v_fk_name TEXT;
BEGIN
    FOREACH v_tbl IN ARRAY ARRAY['subscriptions', 'payments', 'invoices'] LOOP
        FOR v_fk_name IN
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class tbl ON tbl.oid = c.conrelid
            JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
            JOIN pg_attribute att ON att.attrelid = tbl.oid AND att.attnum = ANY(c.conkey)
            WHERE ns.nspname = 'public'
              AND tbl.relname = v_tbl
              AND c.contype = 'f'
              AND att.attname = 'user_id'
        LOOP
            EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', v_tbl, v_fk_name);
        END LOOP;

        EXECUTE format(
            'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL',
            v_tbl,
            v_tbl || '_user_id_fkey'
        );
    END LOOP;
END
$$;

CREATE INDEX IF NOT EXISTS idx_subscriptions_archived_user
    ON public.subscriptions(archived_user_id)
    WHERE archived_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_archived_user
    ON public.payments(archived_user_id)
    WHERE archived_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_invoices_archived_user
    ON public.invoices(archived_user_id)
    WHERE archived_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.preserve_billing_history_before_profile_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    UPDATE public.subscriptions
    SET archived_user_id = COALESCE(archived_user_id, OLD.id),
        archived_user_email = COALESCE(archived_user_email, OLD.email)
    WHERE user_id = OLD.id;

    UPDATE public.payments
    SET archived_user_id = COALESCE(archived_user_id, OLD.id),
        archived_user_email = COALESCE(archived_user_email, OLD.email)
    WHERE user_id = OLD.id;

    UPDATE public.invoices
    SET archived_user_id = COALESCE(archived_user_id, OLD.id),
        archived_user_email = COALESCE(archived_user_email, OLD.email)
    WHERE user_id = OLD.id;

    RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.preserve_billing_history_before_profile_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preserve_billing_history_before_profile_delete() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_preserve_billing_history_before_profile_delete ON public.profiles;
CREATE TRIGGER trg_preserve_billing_history_before_profile_delete
    BEFORE DELETE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.preserve_billing_history_before_profile_delete();

-- ------------------------------------------------------------------------------
-- 3. Seed Required Client SaaS Subscription Tiers (Starter 10, Pro 50, Business 200)
-- ------------------------------------------------------------------------------
INSERT INTO public.subscription_plans (
    code,
    name,
    tier,
    monthly_price_usd,
    yearly_price_usd,
    max_followers,
    max_child_accounts,
    is_active,
    features
)
VALUES
    (
        'starter_10',
        'Starter 10',
        'mentor_pro',
        49.00,
        490.00,
        10,
        10,
        TRUE,
        '["Up to 10 active follower accounts","Parent-to-Child Demo MT5 trade copier","12-control follower risk engine & SL/TP sync","Real-time telemetry & CSV trade reports"]'::jsonb
    ),
    (
        'pro_50',
        'Pro 50',
        'mentor_pro',
        149.00,
        1490.00,
        50,
        50,
        TRUE,
        '["Up to 50 active follower accounts","Custom symbol prefix/suffix mapping","Equity-ratio & risk-% position sizing","Strategy group segmentation & CSV reports"]'::jsonb
    ),
    (
        'business_200',
        'Business 200',
        'enterprise',
        399.00,
        3990.00,
        200,
        200,
        TRUE,
        '["Up to 200 active follower accounts","Institutional multi-group broadcast routing","Webhook billing & invoice ledger retention","Full compliance audit trail & printable reports"]'::jsonb
    )
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    tier = EXCLUDED.tier,
    monthly_price_usd = EXCLUDED.monthly_price_usd,
    yearly_price_usd = EXCLUDED.yearly_price_usd,
    max_followers = EXCLUDED.max_followers,
    max_child_accounts = EXCLUDED.max_child_accounts,
    features = EXCLUDED.features,
    updated_at = timezone('utc'::text, now());

-- ------------------------------------------------------------------------------
-- 4. Mentor Strategy Group Link on public.mentor_assignments
-- ------------------------------------------------------------------------------
ALTER TABLE public.mentor_assignments
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES public.mentor_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_group
    ON public.mentor_assignments(group_id)
    WHERE group_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_mentor_assignment_group()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_group_mentor_id UUID;
    v_group_status TEXT;
BEGIN
    IF NEW.group_id IS NOT NULL THEN
        SELECT mg.mentor_id, mg.status
        INTO v_group_mentor_id, v_group_status
        FROM public.mentor_groups mg
        WHERE mg.id = NEW.group_id;

        IF v_group_mentor_id IS NULL THEN
            RAISE EXCEPTION 'Validation error: Target mentor_groups record (%) does not exist.', NEW.group_id;
        END IF;

        IF v_group_mentor_id IS DISTINCT FROM NEW.mentor_id THEN
            RAISE EXCEPTION 'Security error: Assignment group_id (%) does not belong to mentor_id (%).', NEW.group_id, NEW.mentor_id;
        END IF;

        IF v_group_status IS DISTINCT FROM 'active' THEN
            RAISE EXCEPTION 'Validation error: Cannot assign follower to an archived mentor group.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_mentor_assignment_group() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mentor_assignment_group() TO postgres, service_role;

DROP TRIGGER IF EXISTS trg_validate_mentor_assignment_group ON public.mentor_assignments;
CREATE TRIGGER trg_validate_mentor_assignment_group
    BEFORE INSERT OR UPDATE ON public.mentor_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_mentor_assignment_group();

NOTIFY pgrst, 'reload schema';

COMMIT;
