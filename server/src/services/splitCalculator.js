/**
 * splitCalculator.js — Pure calculation service.
 * No DB calls. No Express. Reused by the import engine (P8).
 *
 * calculateSplits(splitType, amountInr, participants, options)
 *   → { splits: [...], warnings: [] }
 */

/**
 * Round a number to exactly 2 decimal places.
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Calculate expense splits.
 *
 * @param {'equal'|'unequal'|'percentage'|'share'} splitType
 * @param {number} amountInr  — total expense in INR (already converted)
 * @param {Array}  participants — shape varies by splitType
 * @param {Object} options
 * @param {number} options.exchangeRate — default 1 (used for 'unequal' to convert amounts → INR)
 * @returns {{ splits: Array, warnings: string[] }}
 */
function calculateSplits(splitType, amountInr, participants, options = {}) {
  const exchangeRate = options.exchangeRate ?? 1;
  const warnings = [];
  let splits = [];

  switch (splitType) {
    case 'equal': {
      const n = participants.length;
      const share = round2(amountInr / n);

      splits = participants.map((p, i) => {
        // Last participant absorbs rounding remainder
        const isLast = i === n - 1;
        const share_amount = isLast
          ? round2(amountInr - share * (n - 1))
          : share;

        return {
          user_id: p.user_id ?? null,
          participant_name: p.participant_name,
          share_amount,
          split_detail: 'equal'
        };
      });
      break;
    }

    case 'unequal': {
      splits = participants.map((p) => {
        const share_amount = round2(p.amount * exchangeRate);
        return {
          user_id: p.user_id ?? null,
          participant_name: p.participant_name,
          share_amount,
          split_detail: String(p.amount)
        };
      });

      const sum = splits.reduce((acc, s) => acc + s.share_amount, 0);
      const diff = Math.abs(round2(sum) - round2(amountInr));
      if (diff > 1.00) {
        warnings.push(
          `Unequal amounts sum to ₹${round2(sum).toFixed(2)}, expense is ₹${amountInr.toFixed(2)}. Difference: ₹${diff.toFixed(2)}`
        );
      }
      break;
    }

    case 'percentage': {
      const totalPct = participants.reduce((acc, p) => acc + p.percentage, 0);
      if (Math.abs(totalPct - 100) > 0.01) {
        warnings.push(`Percentages sum to ${totalPct}%, not 100%`);
      }

      const n = participants.length;
      let sumSoFar = 0;

      splits = participants.map((p, i) => {
        const isLast = i === n - 1;
        let share_amount;
        if (isLast) {
          // Absorb rounding remainder
          share_amount = round2(amountInr - sumSoFar);
        } else {
          share_amount = round2((p.percentage / 100) * amountInr);
          sumSoFar += share_amount;
        }

        return {
          user_id: p.user_id ?? null,
          participant_name: p.participant_name,
          share_amount,
          split_detail: `${p.percentage}%`
        };
      });
      break;
    }

    case 'share': {
      const totalShares = participants.reduce((acc, p) => acc + p.shares, 0);
      const n = participants.length;
      let sumSoFar = 0;

      splits = participants.map((p, i) => {
        const isLast = i === n - 1;
        let share_amount;
        if (isLast) {
          share_amount = round2(amountInr - sumSoFar);
        } else {
          share_amount = round2((p.shares / totalShares) * amountInr);
          sumSoFar += share_amount;
        }

        return {
          user_id: p.user_id ?? null,
          participant_name: p.participant_name,
          share_amount,
          split_detail: `${p.shares} shares`
        };
      });
      break;
    }

    default:
      throw new Error(`Unknown split_type: ${splitType}`);
  }

  return { splits, warnings };
}

module.exports = { calculateSplits };
