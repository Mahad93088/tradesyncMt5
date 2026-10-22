-- ==============================================================================
-- TradeSync MT5: Migration 02 - Account-Level Parent-Child Assignment Columns
-- Description:
--   1. Adds parent_account_id, child_account_id, and copy-lot settings to public.mentor_assignments
--   2. Adds assigned_parent_id to public.mt5_accounts for direct parent linkage
--   3. Adds foreign key constraints and performance indexes
--   4. Preserves all existing data, triggers, and RLS policies
-- ==============================================================================

-- 1. Extend public.mentor_assignments table with MT5 terminal account tracking
ALTER TABLE public.mentor_assignments
    ADD COLUMN IF NOT EXISTS parent_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS child_account_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS lot_mode TEXT DEFAULT 'parent_lot',
    ADD COLUMN IF NOT EXISTS lot_multiplier NUMERIC(10, 2) DEFAULT 1.00,
    ADD COLUMN IF NOT EXISTS fixed_lot NUMERIC(10, 2) DEFAULT 0.10;

-- 2. Create indexes for high-throughput sync queries
CREATE INDEX IF NOT EXISTS idx_mentor_assignments_parent_account 
    ON public.mentor_assignments(parent_account_id);

CREATE INDEX IF NOT EXISTS idx_mentor_assignments_child_account 
    ON public.mentor_assignments(child_account_id);

-- 3. Extend public.mt5_accounts with direct parent account reference
ALTER TABLE public.mt5_accounts
    ADD COLUMN IF NOT EXISTS assigned_parent_id UUID REFERENCES public.mt5_accounts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mt5_accounts_assigned_parent 
    ON public.mt5_accounts(assigned_parent_id);

-- 4. Update mentor assignment validation trigger to guard account-level integrity
CREATE OR REPLACE FUNCTION public.validate_mentor_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  jwt_role TEXT;
BEGIN
  -- Anti-Self-Assignment Check on user profiles
  IF NEW.mentor_id = NEW.trader_id THEN
    RAISE EXCEPTION 'Security error: A user cannot assign themselves as their own mentor.';
  END IF;

  -- Anti-Self-Assignment Check on MT5 accounts
  IF NEW.parent_account_id IS NOT NULL 
     AND NEW.child_account_id IS NOT NULL 
     AND NEW.parent_account_id = NEW.child_account_id THEN
    RAISE EXCEPTION 'Security error: An MT5 account cannot be assigned as its own parent copy master.';
  END IF;

  -- Mentor Eligibility Check: Target mentor must be verified active mentor
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.mentor_id AND role = 'mentor' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Security error: Target mentor_id is not a verified active mentor.';
  END IF;

  -- Trader Eligibility Check: Trader must be an active account
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = NEW.trader_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Security error: Trader account must be active to create or update an assignment.';
  END IF;

  -- Anti-Hijacking Check: Assignment ownership cannot be transferred on UPDATE by non-admins
  IF TG_OP = 'UPDATE' THEN
    IF (OLD.mentor_id IS DISTINCT FROM NEW.mentor_id 
        OR OLD.trader_id IS DISTINCT FROM NEW.trader_id
        OR OLD.assigned_at IS DISTINCT FROM NEW.assigned_at) THEN
      BEGIN
        jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
      EXCEPTION WHEN OTHERS THEN
        jwt_role := '';
      END IF;

      IF NOT (
        public.is_admin()
        OR current_user IN ('postgres', 'service_role')
        OR session_user IN ('postgres', 'service_role')
        OR jwt_role = 'service_role'
      ) THEN
        RAISE EXCEPTION 'Security error: Assignment ownership and creation timestamp cannot be transferred.';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
