# Implementation Plan - Phase 1: Supabase Backend Integration & Role-Based Security

Integrate Supabase for persistent cloud data storage and authentication while securing the platform with strict database-enforced Row-Level Security (RLS), preventing unauthorized privilege escalation, and preserving all existing local demo simulator capabilities.

---

## 1. Architecture & Security Foundation

### A. Environment Configuration & Connection
- **Environment Variables**:
  - `VITE_SUPABASE_URL`: Public Supabase Project URL
  - `VITE_SUPABASE_ANON_KEY`: Public Client Anonymous Key
  - `SUPABASE_SERVICE_ROLE_KEY`: Server-side only (Express API proxy), never exposed to client bundles
- **Dual-Mode Fallback Architecture**:
  - If `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are configured, the app runs in **Cloud Mode** (real Supabase Auth & PostgreSQL).
  - If keys are missing or invalid, the app gracefully falls back to **Local Demo Mode** (existing `localStorage` and simulated accounts/trades), displaying an informative connection banner so functionality is never broken.

### B. Strict Role-Based Security & Privilege Separation
1. **Public Signup Security (Zero Self-Assigned Admin)**:
   - Public registration (`auth.signUp`) is strictly restricted to assigning the `'trader'` role (or an unprivileged default).
   - A PostgreSQL trigger on `auth.users` handles profile creation (`handle_new_user()`). Any role specified in client metadata during signup is discarded or overridden to `'trader'`.
   - The `role` column in the `public.profiles` table is strictly protected: users cannot update their own `role` under any circumstances.
2. **Server-Side Admin Provisioning & Promotion**:
   - Admin accounts can **never** be created through public registration.
   - Admin promotion is only possible through:
     - An authenticated server-side endpoint (`/api/admin/promote-user`) that verifies the caller is already an authorized Admin and uses the server-side `SUPABASE_SERVICE_ROLE_KEY`.
     - Direct administrator execution via the Supabase SQL Editor / CLI.
3. **Database-Level Row-Level Security (RLS) Enforcement**:
   - Permissions are enforced directly inside PostgreSQL via RLS policies on all tables, never relying solely on frontend UI guards.
   - **`public.profiles`**:
     - *SELECT*: Users can view their own profile; Mentors can view profiles of traders assigned to them; Admins can view all profiles.
     - *UPDATE*: Users can only update non-privilege fields (e.g., `full_name`, `avatar_url`, preferences). Users cannot modify their `role`.
   - **`public.mentor_assignments`**:
     - *SELECT*: Admins view all; Mentors view their assigned traders; Traders view their assigned mentor.
     - *INSERT / UPDATE / DELETE*: Restricted strictly to Admins (or authorized server-side service role). Mentors and traders cannot alter mentorship pairings.
   - **`public.mt5_accounts`**:
     - *SELECT*: Traders can view their own accounts (`user_id = auth.uid()`); Mentors can view accounts belonging to their assigned traders (read-only); Admins can view all.
     - *INSERT / UPDATE / DELETE*: Traders can manage their own accounts; Mentors have read-only access (cannot modify trader accounts).
   - **`public.trades`**:
     - *SELECT*: Traders view their own trades (`user_id = auth.uid()`); Mentors view trades of their assigned traders; Admins view all.
     - *INSERT / UPDATE*: Only the owning Trader can insert or update trades for their account. Mentors have strictly read-only access to review trade logs and cannot execute or delete trades.
   - **`public.trade_feedback` & `public.mentor_reviews`**:
     - *INSERT*: Assigned Mentors and Admins can post feedback on trades belonging to assigned traders.
     - *SELECT*: Visible to the trade owner, the author mentor, and admins.
   - **`public.risk_rules` & `public.trading_plans`**:
     - *SELECT*: Traders view their own; assigned Mentors view assigned traders' rules; Admins view all.
     - *INSERT / UPDATE*: Traders manage their personal rules; Mentors can leave recommendations; Admins can enforce firm-wide risk guardrails.

### C. MT5 Credential & Secret Protection
- Real MT5 passwords are never stored in plaintext.
- Read-only investor passwords or hashed/masked tokens are used where applicable.
- The Supabase client service-role key is never exposed to the frontend bundle; all privileged operations run through the backend server.

---

## 2. Database Schema (PostgreSQL via Supabase)

1. **`profiles`**
   - `id`: UUID (Primary Key, references `auth.users(id)` on delete cascade)
   - `email`: TEXT NOT NULL
   - `full_name`: TEXT
   - `avatar_url`: TEXT
   - `role`: TEXT NOT NULL DEFAULT 'trader' CHECK (role IN ('admin', 'mentor', 'trader'))
   - `status`: TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'pending'))
   - `created_at`: TIMESTAMPTZ DEFAULT now()
   - `updated_at`: TIMESTAMPTZ DEFAULT now()

2. **`mentor_assignments`**
   - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `mentor_id`: UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
   - `trader_id`: UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
   - `assigned_at`: TIMESTAMPTZ DEFAULT now()
   - `status`: TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive'))
   - UNIQUE (mentor_id, trader_id)

3. **`mt5_accounts`**
   - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `user_id`: UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
   - `account_number`: TEXT NOT NULL
   - `broker_server`: TEXT NOT NULL
   - `broker_name`: TEXT NOT NULL
   - `account_type`: TEXT NOT NULL CHECK (account_type IN ('demo', 'live'))
   - `balance`: NUMERIC(15, 2) NOT NULL DEFAULT 0.00
   - `equity`: NUMERIC(15, 2) NOT NULL DEFAULT 0.00
   - `margin`: NUMERIC(15, 2) NOT NULL DEFAULT 0.00
   - `free_margin`: NUMERIC(15, 2) NOT NULL DEFAULT 0.00
   - `currency`: TEXT NOT NULL DEFAULT 'USD'
   - `leverage`: INTEGER NOT NULL DEFAULT 100
   - `status`: TEXT NOT NULL DEFAULT 'connected'
   - `last_sync`: TIMESTAMPTZ DEFAULT now()

4. **`trades`**
   - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `account_id`: UUID NOT NULL REFERENCES mt5_accounts(id) ON DELETE CASCADE
   - `user_id`: UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
   - `ticket`: TEXT NOT NULL
   - `symbol`: TEXT NOT NULL
   - `type`: TEXT NOT NULL CHECK (type IN ('BUY', 'SELL'))
   - `volume`: NUMERIC(10, 2) NOT NULL
   - `open_price`: NUMERIC(15, 5) NOT NULL
   - `close_price`: NUMERIC(15, 5)
   - `sl`: NUMERIC(15, 5)
   - `tp`: NUMERIC(15, 5)
   - `profit`: NUMERIC(15, 2) DEFAULT 0.00
   - `pips`: NUMERIC(10, 1) DEFAULT 0.0
   - `status`: TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'PENDING'))
   - `open_time`: TIMESTAMPTZ NOT NULL DEFAULT now()
   - `close_time`: TIMESTAMPTZ
   - `commission`: NUMERIC(10, 2) DEFAULT 0.00
   - `swap`: NUMERIC(10, 2) DEFAULT 0.00
   - `notes`: TEXT

5. **`trade_feedback`**
   - `id`: UUID PRIMARY KEY DEFAULT gen_random_uuid()
   - `trade_id`: UUID NOT NULL REFERENCES trades(id) ON DELETE CASCADE
   - `author_id`: UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE
   - `content`: TEXT NOT NULL
   - `grade`: TEXT CHECK (grade IN ('A+', 'A', 'B', 'C', 'D', 'F'))
   - `created_at`: TIMESTAMPTZ DEFAULT now()

---

## 3. Implementation Steps

### Step 1: Install Dependencies
- Install `@supabase/supabase-js`.
- Verify TypeScript types build cleanly.

### Step 2: Supabase Client & Context Implementation
- Create `src/lib/supabase.ts` with singleton client and configuration helpers.
- Create `src/contexts/AuthContext.tsx`:
  - Manage session state, profile data, active role, and authentication status.
  - Implement `signUp`, `signIn`, `signOut`, and password reset.
  - In `signUp`, strictly constrain registration to the Trader role.
  - Expose fallback demo auth when Supabase is not configured, maintaining seamless demo access.

### Step 3: Database Migration Script & Setup Documentation
- Provide a SQL migration file (`supabase/migrations/01_init_schema.sql` and `supabase/schema.sql`) containing:
  - Table definitions and indices.
  - Function `handle_new_user()` executing on `AFTER INSERT ON auth.users` (strictly setting role = 'trader').
  - Trigger preventing users from self-updating their `role` column in `profiles`.
  - Comprehensive RLS policies for `profiles`, `mentor_assignments`, `mt5_accounts`, `trades`, and `trade_feedback`.
  - Helper functions `is_admin()`, `is_mentor_of(trader_id)`.

### Step 4: Server-Side Secure Admin Promotion Endpoint
- In `server.ts`, create a protected endpoint:
  - `POST /api/admin/promote-user`:
    - Validates caller's Bearer JWT using Supabase.
    - Confirms caller has `role = 'admin'`.
    - Updates target user's role to `'admin'` or `'mentor'` using the server-side `SUPABASE_SERVICE_ROLE_KEY`.

### Step 5: Data Layer Transition & Dual-Mode Services
- Create modular data services (`src/services/accountService.ts`, `src/services/tradeService.ts`, `src/services/mentorService.ts`):
  - Check whether active session is Cloud Mode (Supabase) or Demo Mode.
  - In Cloud Mode: execute Supabase queries respecting RLS.
  - In Demo Mode: read/write to current reactive in-memory / `localStorage` stores.
- Provide a one-click "Migrate Local Data to Cloud" utility so users with existing local demo data can sync their portfolio to their new Supabase account after signing up.

### Step 6: UI Enhancements & Connection Status
- Add an intuitive Auth Modal (Sign In / Sign Up / Forgot Password / Demo Switcher).
- Display a clean status pill in the header showing connection mode (e.g., `Supabase Connected` vs `Local Demo Mode`).
- Update Role Switcher so it dynamically respects real logged-in permissions (hiding Admin/Mentor switches when in Cloud Mode unless the user possesses those real roles).

---

## 4. Scope Exclusions (Deferred to Future Phases)
- **MetaApi Cloud Trade Copier / Webhook Execution**: Deferred to Phase 2. Phase 1 focuses exclusively on data persistence, real authentication, and RLS security.
- **Automated Live MT5 Terminal Heartbeat**: Deferred to Phase 2.

---

## 5. Verification & Testing Checklist
- [ ] **Build Validation**: Execute `npm run build` / `compile_applet` to confirm 0 compilation errors.
- [ ] **Public Signup Security**: Test public registration with manipulated metadata; verify database trigger assigns `'trader'` role and blocks self-assignment of `'admin'`.
- [ ] **Role-Level Security Verification**:
  - Trader cannot read another trader's trades or MT5 accounts.
  - Trader cannot modify their own `role` or assign themselves a mentor.
  - Mentor can view assigned traders' trades and accounts, but cannot alter trades.
  - Mentor cannot view unassigned traders.
  - Admin has full visibility across all traders and mentor assignments.
- [ ] **Demo Mode Resilience**: Unset Supabase keys and verify existing mock trading, charts, and trade execution operate normally without console errors.
