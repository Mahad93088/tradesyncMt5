/**
 * TradeSync MT5 Central Policy Configuration
 *
 * Isolates optional/policy behavior switches cleanly from core safety invariants
 * so client policy adjustments never weaken demo-only, suspension, or capacity guards.
 */

export const REQUIRE_100_INITIAL_ACTIVATION = false;
export const ALLOW_MENTOR_EMERGENCY_CLOSE = false;
export const LEGACY_PLAN_CODE_COMPAT = true;

export const BALANCE_PAUSE_THRESHOLD_USD = 50;
export const BALANCE_RESUME_THRESHOLD_USD = 100;

export const CLIENT_PLAN_LIMITS = {
  trial: 2,
  silver: 50,
  gold: 100,
} as const;
