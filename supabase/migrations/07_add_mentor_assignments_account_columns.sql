-- ==============================================================================
-- TradeSync MT5: Migration 07 - Add Missing mentor_assignments Account & Lot Columns
-- ==============================================================================
-- Compatibility & Integrity Migration for live Supabase databases where
-- public.mentor_assignments currently has only (id, mentor_id, trader_id,
-- assigned_at, status) from 01_init_schema.sql.
--
-- Fixes & Safeguards:
-- 1. Idempotently adds the 5 missing columns to public.mentor_assignments:
--      - parent_account_id (UUID -> public.mt5_accounts(id) ON DELETE SET NULL)
--      - child_account_id  (UUID -> public.mt5_accounts(id) ON DELETE SET NULL)
--      - lot_mode          (TEXT NOT NULL DEFAULT 'parent_lot')
--      - lot_multiplier    (NUMERIC(10, 2) NOT NULL DEFAULT 1.00)
--      - fixed_lot         (NUMERIC(10, 2) NOT NULL DEFAULT 0.10)
-- 2. Does NOT add mt5_accounts.assigned_parent_id (authoritative parent-child
--    linkage lives in public.mentor_assignments).
-- 3. Preserves nullable account IDs for pre-existing historical records while
--    requiring both parent_account_id and child_account_id for every new
--    active assignment and every reactivation to status = 'active'.
-- 4. Handles mt5_accounts ON DELETE SET NULL safely by transitioning affected
--    assignments to status = 'inactive' instead of leaving orphaned active rows
--    or blocking legitimate account deletions.
-- 5. Tightens grants, all four RLS policies, and SECURITY DEFINER trigger checks
--    for account existence, Demo-only type, role parity, ownership, and lot bounds.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Add Missing Account-Pairing & Lot Configuration Columns
-- ------------------------------------------------------------------------------
ALTER TABLE public.mentor_assignments
    ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS lot_mode TEXT NOT NULL DEFAULT 'parent_lot',
    ADD COLUMN IF NOT EXISTS lot_multiplier NUMERIC(10, 2) NOT NULL DEFAULT 1.00,
    ADD COLUMN IF NOT EXISTS fixed_lot NUMERIC(10, 2) NOT NULL DEFAULT 0.10;

-- Preserve all existing historical records; backfill only NULL/blank lot fields
UPDATE public.mentor_assignments
SET lot_mode = COALESCE(NULLIF(TRIM(lot_mode), ''), 'parent_lot'),
    lot_multiplier = COALESCE(lot_multiplier, 1.00),
    fixed_lot = COALESCE(fixed_lot, 0.10)
WHERE lot_mode IS NULL
   OR TRIM(lot_mode) = ''
   OR lot_multiplier IS NULL
   OR fixed_lot IS NULL;

ALTER TABLE public.mentor_assignments
    ALTER COLUMN lot_mode SET DEFAULT 'parent_lot',
    ALTER COLUMN lot_mode SET NOT NULL,
    ALTER COLUMN lot_multiplier SET DEFAULT 1.00,
    ALTER COLUMN lot_multiplier SET NOT NULL,
    ALTER COLUMN fixed_lot SET DEFAULT 0.10,
    ALTER COLUMN fixed_lot SET NOT NULL;

-- ------------------------------------------------------------------------------
-- 2. Check Constraints for Lot Sizing & Anti-Self-Account Integrity
-- ------------------------------------------------------------------------------
ALTER TABLE public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_lot_mode_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_lot_mode_check
    CHECK (lot_mode IN ('parent_lot', 'multiplier', 'fixed', 'fixed_lot', 'equity_ratio', 'risk_percent'));

ALTER TABLE public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_lot_multiplier_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_lot_multiplier_check
    CHECK (lot_multiplier > 0 AND lot_multiplier <= 100);

ALTER TABLE public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_fixed_lot_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_fixed_lot_check
    CHECK (fixed_lot >= 0.01 AND fixed_lot <= 100);

ALTER TABLE public.mentor_assignments
    DROP CONSTRAINT IF EXISTS mentor_assignments_no_self_account_check;
ALTER TABLE public.mentor_assignments
    ADD CONSTRAINT mentor_assignments_no_self_account_check
    CHECK (parent_account_id IS NULL OR child_account_id IS NULL OR parent_account_id <> child_account_id);

-- ------------------------------------------------------------------------------
-- 3. Performance & Duplicate Active Account-Assignment Prevention Indexes
-- ------------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_parent_account
    ON public.mentor_assignments(parent_account_id);

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_child_account
    ON public.mentor_assignments(child_account_id);

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_parent_active
    ON public.mentor_assignments(parent_account_id, status)
    WHERE status = 'active';

-- Prevent duplicate active assignments targeting the same child MT5 account
CREATE UNIQUE INDEX IF NOT EXISTS idx_mentor_assignments_active_child_unique
    ON public.mentor_assignments(child_account_id)
    WHERE child_account_id IS NOT NULL AND status = 'active';

-- Prevent duplicate active (parent_account_id, child_account_id) pairs
CREATE UNIQUE INDEX IF NOT EXISTS idx_mentor_assignments_active_pair_unique
    ON public.mentor_assignments(parent_account_id, child_account_id)
    WHERE parent_account_id IS NOT NULL AND child_account_id IS NOT NULL AND status = 'active';

-- ------------------------------------------------------------------------------
-- 4. Hardened Mentor Assignment Validation & Ownership Trigger (SECURITY DEFINER)
-- ------------------------------------------------------------------------------
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

    -- Inside SECURITY DEFINER, inspect session_user and JWT claim role (never current_user,
    -- which always reflects the function owner) alongside verified active Super Admin check.
    v_is_privileged :=
        session_user IN ('postgres', 'supabase_admin')
        OR v_jwt_role = 'service_role'
        OR public.is_admin();

    -- 1. Handle FK ON DELETE SET NULL cleanly when a linked MT5 account is deleted:
    --    Deactivate the assignment instead of leaving an orphaned active link or failing deletion.
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
        AND NEW.fixed_lot IS NOT DISTINCT FROM OLD.fixed_lot THEN
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

    -- 3. Anti-Self-Assignment Checks (Profile & MT5 Account)
    IF NEW.mentor_id = NEW.trader_id THEN
        RAISE EXCEPTION 'Security error: A user cannot assign themselves as their own mentor.';
    END IF;

    IF NEW.parent_account_id IS NOT NULL
       AND NEW.child_account_id IS NOT NULL
       AND NEW.parent_account_id = NEW.child_account_id THEN
        RAISE EXCEPTION 'Security error: An MT5 account cannot be assigned as its own parent copy master.';
    END IF;

    -- 4. Mentor & Trader Profile Verification
    --    Allows deactivating existing assignments (status = 'inactive') when a user is suspended.
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

    -- 6. Lot Configuration Validation
    IF NEW.lot_mode IS NULL OR NEW.lot_mode NOT IN ('parent_lot', 'multiplier', 'fixed', 'fixed_lot', 'equity_ratio', 'risk_percent') THEN
        RAISE EXCEPTION 'Validation error: Invalid lot_mode (%).', COALESCE(NEW.lot_mode, 'NULL');
    END IF;

    IF NEW.lot_multiplier IS NULL OR NEW.lot_multiplier <= 0 OR NEW.lot_multiplier > 100 THEN
        RAISE EXCEPTION 'Validation error: lot_multiplier must be > 0 and <= 100.';
    END IF;

    IF NEW.fixed_lot IS NULL OR NEW.fixed_lot < 0.01 OR NEW.fixed_lot > 100 THEN
        RAISE EXCEPTION 'Validation error: fixed_lot must be between 0.01 and 100.';
    END IF;

    -- 7. Anti-Hijacking & Caller Ownership Checks for Non-Privileged Callers
    IF NOT v_is_privileged AND NOT v_is_fk_cleanup THEN
        IF auth.uid() IS NULL THEN
            RAISE EXCEPTION 'Security error: Authenticated session required to modify mentor assignments.';
        END IF;

        IF TG_OP = 'INSERT' THEN
            IF NEW.trader_id IS DISTINCT FROM auth.uid() THEN
                RAISE EXCEPTION 'Security error: Users can only create assignments for their own trader profile.';
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

            -- Mentors may pause/resume assignment status but cannot overwrite follower lot risk settings
            IF auth.uid() = OLD.mentor_id AND auth.uid() IS DISTINCT FROM OLD.trader_id THEN
                IF NEW.lot_mode IS DISTINCT FROM OLD.lot_mode
                   OR NEW.lot_multiplier IS DISTINCT FROM OLD.lot_multiplier
                   OR NEW.fixed_lot IS DISTINCT FROM OLD.fixed_lot
                   OR NEW.parent_account_id IS DISTINCT FROM OLD.parent_account_id
                   OR NEW.child_account_id IS DISTINCT FROM OLD.child_account_id THEN
                    RAISE EXCEPTION 'Security error: Only the assigned trader or an administrator may modify lot sizing or account pairing.';
                END IF;
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_mentor_assignment ON public.mentor_assignments;
CREATE TRIGGER trg_validate_mentor_assignment
    BEFORE INSERT OR UPDATE ON public.mentor_assignments
    FOR EACH ROW
    EXECUTE FUNCTION public.validate_mentor_assignment();

REVOKE ALL ON FUNCTION public.validate_mentor_assignment() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_mentor_assignment() TO postgres, service_role;

-- ------------------------------------------------------------------------------
-- 5. Hardened RLS Policies & Tightened Grants on public.mentor_assignments
-- ------------------------------------------------------------------------------
ALTER TABLE public.mentor_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mentor_assignments_select_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_select_policy"
    ON public.mentor_assignments FOR SELECT
    USING (
        mentor_id = auth.uid()
        OR trader_id = auth.uid()
        OR public.is_admin()
    );

DROP POLICY IF EXISTS "mentor_assignments_insert_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_insert_policy"
    ON public.mentor_assignments FOR INSERT
    WITH CHECK (
        (
            status <> 'active'
            OR (parent_account_id IS NOT NULL AND child_account_id IS NOT NULL)
        )
        AND (
            parent_account_id IS NULL
            OR child_account_id IS NULL
            OR parent_account_id <> child_account_id
        )
        AND mentor_id <> trader_id
        AND (
            public.is_admin()
            OR (
                trader_id = auth.uid()
                AND EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND p.role = 'trader'
                      AND p.status = 'active'
                )
                AND EXISTS (
                    SELECT 1
                    FROM public.mentor_directory md
                    WHERE md.id = mentor_id
                      AND md.role = 'mentor'
                      AND md.status = 'active'
                )
                AND (
                    child_account_id IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM public.mt5_accounts a
                        WHERE a.id = child_account_id
                          AND a.user_id = auth.uid()
                          AND a.account_role = 'child'
                          AND a.account_type = 'demo'
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS "mentor_assignments_update_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_update_policy"
    ON public.mentor_assignments FOR UPDATE
    USING (
        public.is_admin()
        OR (
            (mentor_id = auth.uid() OR trader_id = auth.uid())
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
            )
        )
    )
    WITH CHECK (
        (
            status <> 'active'
            OR (parent_account_id IS NOT NULL AND child_account_id IS NOT NULL)
        )
        AND (
            parent_account_id IS NULL
            OR child_account_id IS NULL
            OR parent_account_id <> child_account_id
        )
        AND mentor_id <> trader_id
        AND (
            public.is_admin()
            OR (
                (mentor_id = auth.uid() OR trader_id = auth.uid())
                AND EXISTS (
                    SELECT 1
                    FROM public.profiles p
                    WHERE p.id = auth.uid()
                      AND p.status = 'active'
                )
                AND (
                    trader_id IS DISTINCT FROM auth.uid()
                    OR child_account_id IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM public.mt5_accounts a
                        WHERE a.id = child_account_id
                          AND a.user_id = auth.uid()
                          AND a.account_role = 'child'
                          AND a.account_type = 'demo'
                    )
                )
                AND (
                    mentor_id IS DISTINCT FROM auth.uid()
                    OR parent_account_id IS NULL
                    OR EXISTS (
                        SELECT 1
                        FROM public.mt5_accounts a
                        WHERE a.id = parent_account_id
                          AND a.user_id = auth.uid()
                          AND a.account_role = 'parent'
                          AND a.account_type = 'demo'
                    )
                )
            )
        )
    );

DROP POLICY IF EXISTS "mentor_assignments_delete_policy" ON public.mentor_assignments;
CREATE POLICY "mentor_assignments_delete_policy"
    ON public.mentor_assignments FOR DELETE
    USING (
        public.is_admin()
        OR (
            (mentor_id = auth.uid() OR trader_id = auth.uid())
            AND EXISTS (
                SELECT 1
                FROM public.profiles p
                WHERE p.id = auth.uid()
                  AND p.status = 'active'
            )
        )
    );

REVOKE ALL ON TABLE public.mentor_assignments FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.mentor_assignments TO authenticated;
GRANT ALL ON TABLE public.mentor_assignments TO postgres, service_role;

-- Notify PostgREST to reload schema cache immediately
NOTIFY pgrst, 'reload schema';

COMMIT;
