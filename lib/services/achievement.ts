/**
 * Achievement calculation engine.
 * Pure functions with zero DB dependency — easy to unit test.
 *
 * Ported from: C:\Yan\suno-books\backend\app\services\achievement.py
 * Business rules from Grupo Suno HR/People Ops system.
 */

export type Polarity = 'up' | 'down';
export type CalculationType = 'soma' | 'media' | 'media_ponderada' | 'valor_mais_recente';

export interface MonthValue {
  month: number;
  target_value: number | null;
  actual_value: number | null;
  weight?: number;
}

export interface IcpRange {
  min_pct: number;
  max_pct: number | null; // null = unbounded upper
  label: string;
  score?: number | null;
}

// ---------------------------------------------------------------------------
// Achievement Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate achievement percentage based on meta, real, and polarity.
 *
 * Polarity "up" (cima): higher actual is better.
 *   - Handles 4 quadrants: (+meta,+real), (+meta,-real), (-meta,-real), (-meta,+real)
 *
 * Polarity "down" (baixo): lower actual is better.
 *   - Formula: (1 - (real - meta) / meta) * 100
 *
 * Returns null if meta is 0 or null, or real is null.
 */
export function calculateAchievement(
  meta: number | null,
  real: number | null,
  polarity: Polarity
): number | null {
  if (meta === null || meta === undefined || real === null || real === undefined || meta === 0) {
    return null;
  }

  let result: number;

  if (polarity === 'up') {
    if (meta > 0 && real > 0) {
      result = (real / meta) * 100;
    } else if (meta > 0 && real < 0) {
      result = 0;
    } else if (meta < 0 && real < 0) {
      result = (meta / real) * 100;
    } else if (meta < 0 && real > 0) {
      result = ((-meta + real) / real) * 100;
    } else {
      // real === 0
      result = 0;
    }
  } else if (polarity === 'down') {
    result = (1 - (real - meta) / meta) * 100;
  } else {
    return null;
  }

  // Round to 2 decimal places (banker's rounding equivalent)
  return Math.round(result * 100) / 100;
}

// ---------------------------------------------------------------------------
// Accumulated Calculation
// ---------------------------------------------------------------------------

/**
 * Calculate accumulated target and actual up to a given month.
 *
 * Strategies:
 * - soma: Sum all values from month 1 to upToMonth
 * - media: Average of non-null values
 * - media_ponderada: Weighted average using optional month weights (default weight=1)
 * - valor_mais_recente: Just the current month value (no accumulation)
 *
 * Returns { target, actual } — either can be null if no data.
 */
export function calculateAccumulated(
  values: MonthValue[],
  calculationType: CalculationType,
  upToMonth: number
): { target: number | null; actual: number | null } {
  const relevant = values.filter((v) => v.month <= upToMonth);

  if (relevant.length === 0) {
    return { target: null, actual: null };
  }

  switch (calculationType) {
    case 'soma': {
      const targets = relevant.filter((v) => v.target_value !== null);
      const actuals = relevant.filter((v) => v.actual_value !== null);
      return {
        target: targets.length > 0 ? targets.reduce((sum, v) => sum + v.target_value!, 0) : null,
        actual: actuals.length > 0 ? actuals.reduce((sum, v) => sum + v.actual_value!, 0) : null,
      };
    }

    case 'media': {
      const targets = relevant.filter((v) => v.target_value !== null);
      const actuals = relevant.filter((v) => v.actual_value !== null);
      return {
        target:
          targets.length > 0
            ? targets.reduce((sum, v) => sum + v.target_value!, 0) / targets.length
            : null,
        actual:
          actuals.length > 0
            ? actuals.reduce((sum, v) => sum + v.actual_value!, 0) / actuals.length
            : null,
      };
    }

    case 'media_ponderada': {
      let weightedTarget = 0;
      let weightedActual = 0;
      let totalWeightT = 0;
      let totalWeightA = 0;

      for (const v of relevant) {
        const w = v.weight ?? 1;
        if (v.target_value !== null) {
          weightedTarget += v.target_value * w;
          totalWeightT += w;
        }
        if (v.actual_value !== null) {
          weightedActual += v.actual_value * w;
          totalWeightA += w;
        }
      }

      return {
        target: totalWeightT > 0 ? weightedTarget / totalWeightT : null,
        actual: totalWeightA > 0 ? weightedActual / totalWeightA : null,
      };
    }

    case 'valor_mais_recente': {
      const current = relevant.find((v) => v.month === upToMonth);
      return {
        target: current?.target_value ?? null,
        actual: current?.actual_value ?? null,
      };
    }

    default:
      return { target: null, actual: null };
  }
}

// ---------------------------------------------------------------------------
// ICP Label Resolution
// ---------------------------------------------------------------------------

/**
 * Resolve which ICP range an achievement percentage falls into.
 *
 * Ranges are sorted by min_pct ascending.
 * If max_pct is null, it matches any value >= min_pct (unbounded upper).
 *
 * Example ranges:
 *   { min_pct: 0,   max_pct: 80,   label: "Abaixo" }
 *   { min_pct: 80,  max_pct: 100,  label: "Na meta" }
 *   { min_pct: 100, max_pct: null,  label: "Acima"  }
 */
export function resolveIcpLabel(
  achievementPct: number | null,
  ranges: IcpRange[]
): string | null {
  if (achievementPct === null || ranges.length === 0) {
    return null;
  }

  const sorted = [...ranges].sort((a, b) => a.min_pct - b.min_pct);

  for (const r of sorted) {
    if (r.max_pct === null || r.max_pct === undefined) {
      if (achievementPct >= r.min_pct) {
        return r.label;
      }
    } else {
      if (achievementPct >= r.min_pct && achievementPct < r.max_pct) {
        return r.label;
      }
    }
  }

  return null;
}
