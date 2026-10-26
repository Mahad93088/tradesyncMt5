import { LotSettings } from '../types';

export interface LotCalculationInput {
  parentSymbol: string;
  parentLots: number;
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
   * Round a number to a specific precision (e.g., broker lot step)
   */
  public static roundToStep(value: number, step: number = 0.01): number {
    if (step <= 0) return Number(value.toFixed(2));
    const inv = 1.0 / step;
    return Number((Math.round(value * inv) / inv).toFixed(2));
  }

  /**
   * Adjust symbol for child broker (prefix/suffix handling)
   */
  public static adjustSymbol(symbol: string, prefix?: string, suffix?: string): string {
    let clean = symbol.trim().toUpperCase();
    const p = prefix ? prefix.trim().toUpperCase() : '';
    const s = suffix ? suffix.trim().toUpperCase() : '';

    // Remove any known prefixes/suffixes if present to avoid duplication
    if (p && !clean.startsWith(p)) {
      clean = `${p}${clean}`;
    }
    if (s && !clean.endsWith(s)) {
      clean = `${clean}${s}`;
    }
    return clean;
  }

  /**
   * Calculate child execution lots and validate against drawdown/broker limits
   */
  public static calculateChildLots(input: LotCalculationInput): LotCalculationResult {
    const {
      parentSymbol,
      parentLots,
      parentEquity = 10000,
      parentBalance = 10000,
      childEquity = 10000,
      childBalance = 10000,
      lotSettings,
      brokerLimits = { minLot: 0.01, maxLot: 100.0, lotStep: 0.01 },
    } = input;

    const childSymbol = this.adjustSymbol(parentSymbol, lotSettings.symbolPrefix, lotSettings.symbolSuffix);

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
          rawLots = lotSettings.fixedLot > 0 ? lotSettings.fixedLot : 0.01;
          break;

        case 'multiplier':
          rawLots = parentLots * (lotSettings.multiplier > 0 ? lotSettings.multiplier : 1.0);
          break;

        case 'equity_ratio':
          if (parentEquity > 0 && childEquity > 0) {
            const ratio = childEquity / parentEquity;
            rawLots = parentLots * ratio;
          } else {
            rawLots = parentLots * (lotSettings.multiplier || 1.0);
          }
          break;

        case 'risk_percent':
          // Standard estimation: 1% risk on $10k account = ~0.10 lots on EURUSD
          // normalized: (childBalance * (riskPercent / 100)) / 1000
          const riskFraction = (lotSettings.riskPercent || 1.0) / 100;
          rawLots = (childBalance * riskFraction) / 1000;
          break;

        default:
          rawLots = parentLots;
      }
    }

    // 3. Broker constraint clamping
    const step = brokerLimits.lotStep && brokerLimits.lotStep > 0 ? brokerLimits.lotStep : 0.01;
    const minClamp = Math.max(
      lotSettings.minLotClamp > 0 ? lotSettings.minLotClamp : 0.01,
      brokerLimits.minLot || 0.01
    );
    const maxClamp = Math.min(
      lotSettings.maxLotCap > 0 ? lotSettings.maxLotCap : 100.0,
      brokerLimits.maxLot || 100.0
    );

    let stepped = this.roundToStep(rawLots, step);

    if (stepped < minClamp) {
      stepped = minClamp;
    }
    if (stepped > maxClamp) {
      stepped = maxClamp;
    }

    // Final verification that stepped lots are positive
    if (stepped <= 0) {
      return {
        valid: false,
        childLots: 0,
        childSymbol,
        reason: `Calculated volume (${stepped}) is below minimum execution threshold.`,
      };
    }

    return {
      valid: true,
      childLots: stepped,
      childSymbol,
    };
  }
}
