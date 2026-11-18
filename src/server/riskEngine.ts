import { LotSettings } from '../types';

export interface LotCalculationInput {
  parentSymbol: string;
  parentLots: number;
  orderType?: string;
  parentEquity?: number;
  parentBalance?: number;
  childEquity?: number;
  childBalance?: number;
  lotSettings: LotSettings;
  brokerLimits?: {
    minLot?: number;
    maxLot?: number;
    lotStep?: number;
  };
}

export interface LotCalculationResult {
  valid: boolean;
  childLots: number;
  childSymbol: string;
  reason?: string;
}

export class RiskEngine {
  /**
   * Align a volume DOWN to a valid broker lot step without ever silently increasing volume.
   */
  public static floorToStep(value: number, step: number = 0.01): number {
    if (!Number.isFinite(value) || value <= 0) return 0;
    if (!Number.isFinite(step) || step <= 0) return Number(value.toFixed(2));
    const steps = Math.floor((value + 1e-9) / step);
    return Number((steps * step).toFixed(4));
  }

  /**
   * Round a number to a specific precision (kept for compatibility, delegates safely).
   */
  public static roundToStep(value: number, step: number = 0.01): number {
    return this.floorToStep(value, step);
  }

  /**
   * Adjust symbol for child broker (case-sensitive prefix/suffix handling)
   */
  public static adjustSymbol(symbol: string, prefix?: string, suffix?: string): string {
    let clean = String(symbol || '').trim();
    const p = prefix ? String(prefix).trim() : '';
    const s = suffix ? String(suffix).trim() : '';

    if (!clean) return '';

    if (p && !clean.startsWith(p)) {
      clean = `${p}${clean}`;
    }
    if (s && !clean.endsWith(s)) {
      clean = `${clean}${s}`;
    }
    return clean;
  }

  /**
   * Parse persisted mentor_assignments row into strict LotSettings with safe defaults
   */
  public static normalizeLotSettingsFromRow(row: Record<string, any> | null | undefined): LotSettings {
    const rawLotMode = String(row?.lot_mode || 'parent_lot').trim().toLowerCase();
    let mode: 'parent_lot' | 'custom_lot' = 'parent_lot';
    let customType: 'fixed' | 'multiplier' | 'equity_ratio' | 'risk_percent' = 'multiplier';

    if (rawLotMode === 'fixed' || rawLotMode === 'fixed_lot') {
      mode = 'custom_lot';
      customType = 'fixed';
    } else if (rawLotMode === 'multiplier') {
      mode = 'custom_lot';
      customType = 'multiplier';
    } else if (rawLotMode === 'equity_ratio') {
      mode = 'custom_lot';
      customType = 'equity_ratio';
    } else if (rawLotMode === 'risk_percent') {
      mode = 'custom_lot';
      customType = 'risk_percent';
    }

    const numOr = (val: unknown, fallback: number): number => {
      const n = Number(val);
      return Number.isFinite(n) ? n : fallback;
    };

    const boolOr = (val: unknown, fallback: boolean): boolean =>
      typeof val === 'boolean' ? val : fallback;

    return {
      mode,
      customType,
      fixedLot: numOr(row?.fixed_lot, 0.1),
      multiplier: numOr(row?.lot_multiplier, 1.0),
      riskPercent: numOr(row?.risk_percent, 1.0),
      maxLotCap: numOr(row?.max_lot_cap, 50.0),
      minLotClamp: numOr(row?.min_lot_clamp, 0.01),
      maxDrawdownProtectionPercent: numOr(row?.max_drawdown_percent, 20.0),
      copyPendingOrders: boolOr(row?.copy_pending_orders, true),
      syncSlTp: boolOr(row?.sync_sl_tp, true),
      slippageMaxPips: numOr(row?.slippage_max_pips, 3.0),
      symbolPrefix: typeof row?.symbol_prefix === 'string' ? row.symbol_prefix : '',
      symbolSuffix: typeof row?.symbol_suffix === 'string' ? row.symbol_suffix : '',
    };
  }

  /**
   * Validate risk & lot settings configuration before order sizing or persistence
   */
  public static validateLotSettings(lotSettings: LotSettings): { valid: boolean; reason?: string } {
    if (!lotSettings) {
      return { valid: false, reason: 'Missing lot settings configuration.' };
    }

    if (lotSettings.mode !== 'parent_lot' && lotSettings.mode !== 'custom_lot') {
      return { valid: false, reason: `Unsupported lot mode: ${String(lotSettings.mode)}` };
    }

    if (lotSettings.mode === 'custom_lot') {
      const allowedTypes = ['fixed', 'multiplier', 'equity_ratio', 'risk_percent'];
      if (!allowedTypes.includes(lotSettings.customType)) {
        return { valid: false, reason: `Unsupported custom lot type: ${String(lotSettings.customType)}` };
      }
      if (lotSettings.customType === 'fixed') {
        if (!Number.isFinite(lotSettings.fixedLot) || lotSettings.fixedLot < 0.01 || lotSettings.fixedLot > 100) {
          return { valid: false, reason: 'Fixed lot size must be between 0.01 and 100 lots.' };
        }
      }
      if (lotSettings.customType === 'multiplier') {
        if (!Number.isFinite(lotSettings.multiplier) || lotSettings.multiplier <= 0 || lotSettings.multiplier > 100) {
          return { valid: false, reason: 'Lot multiplier must be greater than 0 and at most 100.' };
        }
      }
      if (lotSettings.customType === 'risk_percent') {
        if (!Number.isFinite(lotSettings.riskPercent) || lotSettings.riskPercent <= 0 || lotSettings.riskPercent > 100) {
          return { valid: false, reason: 'Risk percentage must be between 0 and 100.' };
        }
      }
    }

    if (
      lotSettings.riskPercent !== undefined &&
      (!Number.isFinite(lotSettings.riskPercent) || lotSettings.riskPercent <= 0 || lotSettings.riskPercent > 100)
    ) {
      return { valid: false, reason: 'Risk percentage must be > 0 and <= 100.' };
    }

    const minClamp = lotSettings.minLotClamp ?? 0.01;
    const maxCap = lotSettings.maxLotCap ?? 100.0;
    if (!Number.isFinite(minClamp) || minClamp < 0.01 || minClamp > 100) {
      return { valid: false, reason: 'Minimum lot clamp must be between 0.01 and 100.' };
    }
    if (!Number.isFinite(maxCap) || maxCap < 0.01 || maxCap > 100 || maxCap < minClamp) {
      return { valid: false, reason: 'Maximum lot cap must be >= minimum lot clamp and <= 100.' };
    }

    const maxDd = lotSettings.maxDrawdownProtectionPercent ?? 0;
    if (!Number.isFinite(maxDd) || maxDd < 0 || maxDd >= 100) {
      return { valid: false, reason: 'Max drawdown protection percent must be between 0 and <100.' };
    }

    const slippage = lotSettings.slippageMaxPips ?? 3.0;
    if (!Number.isFinite(slippage) || slippage < 0 || slippage > 100) {
      return { valid: false, reason: 'Max slippage pips must be between 0 and 100.' };
    }

    for (const [label, aff] of [
      ['symbolPrefix', lotSettings.symbolPrefix],
      ['symbolSuffix', lotSettings.symbolSuffix],
    ] as const) {
      if (aff !== undefined && aff !== null) {
        const strVal = String(aff);
        if (strVal.length > 16 || /[\s\r\n\t]/.test(strVal)) {
          return { valid: false, reason: `Invalid ${label}: must be <= 16 non-whitespace characters.` };
        }
      }
    }

    return { valid: true };
  }

  /**
   * Calculate child execution lots and validate against drawdown, order type, and broker limits.
   * Safety invariant: NEVER silently increase requested/calculated volume above rawLots.
   */
  public static calculateChildLots(input: LotCalculationInput): LotCalculationResult {
    const {
      parentSymbol,
      parentLots,
      orderType,
      parentEquity = 10000,
      parentBalance = 10000,
      childEquity = 10000,
      childBalance = 10000,
      lotSettings,
      brokerLimits = { minLot: 0.01, maxLot: 100.0, lotStep: 0.01 },
    } = input;

    const childSymbol = this.adjustSymbol(parentSymbol, lotSettings?.symbolPrefix, lotSettings?.symbolSuffix);
    if (!childSymbol) {
      return {
        valid: false,
        childLots: 0,
        childSymbol: '',
        reason: 'Parent symbol is required and cannot be empty.',
      };
    }

    if (!Number.isFinite(parentLots) || parentLots <= 0) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: 'Parent trade lots must be a positive finite number.',
      };
    }

    const settingsValidation = this.validateLotSettings(lotSettings);
    if (!settingsValidation.valid) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: settingsValidation.reason,
      };
    }

    // 0. Pending Order Filter Guard
    if (orderType) {
      const cleanType = String(orderType).trim().toUpperCase();
      const isPending =
        cleanType === 'BUY_LIMIT' ||
        cleanType === 'SELL_LIMIT' ||
        cleanType === 'BUY_STOP' ||
        cleanType === 'SELL_STOP';
      if (isPending && lotSettings.copyPendingOrders === false) {
        return {
          valid: false,
          childLots: 0,
          childSymbol,
          reason: `Pending order ${cleanType} skipped: copyPendingOrders is disabled.`,
        };
      }
    }

    // 1. Drawdown Guard
    if (lotSettings.maxDrawdownProtectionPercent > 0 && childBalance > 0) {
      const currentDrawdownPercent = ((childBalance - childEquity) / childBalance) * 100;
      if (currentDrawdownPercent >= lotSettings.maxDrawdownProtectionPercent) {
        return {
          valid: false,
          childLots: 0,
          childSymbol,
          reason: `Drawdown guard triggered: Current drawdown ${currentDrawdownPercent.toFixed(1)}% exceeds limit of ${lotSettings.maxDrawdownProtectionPercent}%`,
        };
      }
    }

    // 2. Base lot calculation based on configured mode
    let rawLots = parentLots;

    if (lotSettings.mode === 'custom_lot') {
      switch (lotSettings.customType) {
        case 'fixed':
          rawLots = lotSettings.fixedLot;
          break;

        case 'multiplier':
          rawLots = parentLots * lotSettings.multiplier;
          break;

        case 'equity_ratio':
          if (parentEquity > 0 && childEquity > 0) {
            const ratio = childEquity / parentEquity;
            rawLots = parentLots * ratio;
          } else {
            return {
              valid: false,
              childLots: 0,
              childSymbol,
              reason: 'Equity ratio mode requires positive parent and child account equity.',
            };
          }
          break;

        case 'risk_percent': {
          const riskFraction = lotSettings.riskPercent / 100;
          rawLots = (childBalance * riskFraction) / 1000;
          break;
        }

        default:
          rawLots = parentLots;
      }
    }

    // 3. Broker constraint & step validation (strictly never increase volume)
    const rawStep = brokerLimits.lotStep ?? 0.01;
    const rawBrokerMin = brokerLimits.minLot ?? 0.01;
    const rawBrokerMax = brokerLimits.maxLot ?? 100.0;

    if (!Number.isFinite(rawStep) || rawStep <= 0) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Invalid broker lotStep: ${String(rawStep)}`,
      };
    }
    if (!Number.isFinite(rawBrokerMin) || rawBrokerMin <= 0 || !Number.isFinite(rawBrokerMax) || rawBrokerMax < rawBrokerMin) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Invalid broker min/max lot bounds (${rawBrokerMin}..${rawBrokerMax}).`,
      };
    }

    const minClamp = Math.max(lotSettings.minLotClamp > 0 ? lotSettings.minLotClamp : 0.01, rawBrokerMin);
    const maxClamp = Math.min(lotSettings.maxLotCap > 0 ? lotSettings.maxLotCap : 100.0, rawBrokerMax);

    if (maxClamp < minClamp) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Broker minimum lot (${minClamp}) exceeds configured maximum lot cap (${maxClamp}).`,
      };
    }

    // Align downward to broker step so we never silently inflate risk/volume
    let stepped = this.floorToStep(rawLots, rawStep);

    // For fixed or direct parent_lot mode, reject off-step invalid volumes if floor changed more than rounding dust
    if (
      (lotSettings.mode === 'parent_lot' || (lotSettings.mode === 'custom_lot' && lotSettings.customType === 'fixed')) &&
      Math.abs(rawLots - stepped) > 1e-6
    ) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Requested volume (${rawLots}) does not align with broker lot step (${rawStep}).`,
      };
    }

    // CRITICAL SAFETY RULE: Never silently increase volume below minClamp; reject cleanly instead.
    if (stepped + 1e-9 < minClamp) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Calculated volume (${stepped}) is below minimum allowed lot (${minClamp}) and will not be silently increased.`,
      };
    }

    // Safe downward clamp if calculated volume exceeds maxLotCap / broker maxLot
    if (stepped > maxClamp) {
      stepped = this.floorToStep(maxClamp, rawStep);
      if (stepped + 1e-9 < minClamp || stepped <= 0) {
        return {
          valid: false,
          childLots: 0,
          childSymbol,
          reason: `Maximum lot cap (${maxClamp}) is incompatible with broker step (${rawStep}) and minimum (${minClamp}).`,
        };
      }
    }

    if (!Number.isFinite(stepped) || stepped <= 0) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Calculated volume (${stepped}) is below minimum execution threshold.`,
      };
    }

    return {
      valid: true,
      childLots: Number(stepped.toFixed(2)),
      childSymbol,
    };
  }
}
