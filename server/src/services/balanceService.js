const { db } = require('../config/db');

/**
 * QUERY A — Total paid per member, date-range-filtered by membership window.
 * Sam joining mid-April means expenses before his join_at are excluded.
 * Meera's expenses before her left_at (2026-03-31) are included.
 */
async function queryTotalPaid(groupId) {
  const rows = await db.raw(`
    SELECT
      u.id   AS user_id,
      u.name AS user_name,
      COALESCE(SUM(e.amount_inr), 0) AS total_paid
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN expenses e
      ON  e.group_id          = gm.group_id
      AND e.paid_by_user_id   = gm.user_id
      AND e.is_settlement     = FALSE
      AND e.date             >= gm.joined_at
      AND (gm.left_at IS NULL OR e.date < gm.left_at)
    WHERE gm.group_id = :groupId
    GROUP BY u.id, u.name
  `, { groupId });
  return rows.rows;
}

/**
 * QUERY B — Total owed per member from expense_splits, date-range-filtered.
 *
 * Uses a pre-joined (expense_splits INNER JOIN expenses) inside a LEFT JOIN
 * to avoid the chained-LEFT-JOIN leak: when es is LEFT JOINed first and e is
 * LEFT JOINed second, a failed e match leaves es.share_amount non-null, which
 * inflates the SUM. Pre-joining ensures both es and e are null when the
 * expense doesn't qualify.
 *
 * Excludes:
 *  - settlement expenses (is_settlement = TRUE)
 *  - external-payer expenses (paid_by_user_id IS NULL) — those debts are owed
 *    to the external person directly, not within the group balance
 *  - expenses outside the member's membership window
 */
async function queryTotalOwed(groupId) {
  const rows = await db.raw(`
    SELECT
      u.id   AS user_id,
      u.name AS user_name,
      COALESCE(SUM(es.share_amount), 0) AS total_owed
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN (
      expense_splits es
      INNER JOIN expenses e
        ON  e.id              = es.expense_id
        AND e.is_settlement   = FALSE
        AND e.paid_by_user_id IS NOT NULL
    )
      ON  es.user_id  = gm.user_id
      AND e.group_id  = gm.group_id
      AND e.date     >= gm.joined_at
      AND (gm.left_at IS NULL OR e.date < gm.left_at)
    WHERE gm.group_id = :groupId
    GROUP BY u.id, u.name
  `, { groupId });
  return rows.rows;
}

/**
 * QUERY C — Settlements paid out (reduces what you owe).
 */
async function querySettlementsPaid(groupId) {
  const rows = await db.raw(`
    SELECT
      from_user_id           AS user_id,
      COALESCE(SUM(amount), 0) AS settlements_paid
    FROM settlements
    WHERE group_id = :groupId
    GROUP BY from_user_id
  `, { groupId });
  return rows.rows;
}

/**
 * QUERY D — Settlements received (reduces what you are owed).
 */
async function querySettlementsReceived(groupId) {
  const rows = await db.raw(`
    SELECT
      to_user_id             AS user_id,
      COALESCE(SUM(amount), 0) AS settlements_received
    FROM settlements
    WHERE group_id = :groupId
    GROUP BY to_user_id
  `, { groupId });
  return rows.rows;
}

/**
 * QUERY E — External participant shares in expenses paid by each member.
 *
 * When Aisha pays for a cab and Kabir (external, user_id IS NULL) takes half,
 * Aisha fronted Kabir's share but the group owes her nothing for it.
 * We subtract it from her credit so net_balances sum to zero.
 *
 * The JOIN on group_members (with date filter) ensures we only count expenses
 * that fall within the payer's own membership window.
 */
async function queryExternalShares(groupId) {
  const rows = await db.raw(`
    SELECT
      e.paid_by_user_id          AS user_id,
      COALESCE(SUM(es.share_amount), 0) AS external_shares
    FROM expenses e
    JOIN expense_splits es ON es.expense_id = e.id
    JOIN group_members gm
      ON  gm.group_id     = e.group_id
      AND gm.user_id      = e.paid_by_user_id
      AND e.date         >= gm.joined_at
      AND (gm.left_at IS NULL OR e.date < gm.left_at)
    WHERE e.group_id      = :groupId
      AND e.is_settlement = FALSE
      AND es.user_id      IS NULL
    GROUP BY e.paid_by_user_id
  `, { groupId });
  return rows.rows;
}

/**
 * getRawBalances(groupId)
 * Runs all 5 queries concurrently, merges in JS.
 *
 * net_balance > 0 → they are OWED this amount
 * net_balance < 0 → they OWE this amount
 *
 * External shares are subtracted from the payer's credit so that
 * the sum of all net_balances is always zero.
 */
async function getRawBalances(groupId) {
  const [paid, owed, settPaid, settReceived, extShares] = await Promise.all([
    queryTotalPaid(groupId),
    queryTotalOwed(groupId),
    querySettlementsPaid(groupId),
    querySettlementsReceived(groupId),
    queryExternalShares(groupId),
  ]);

  // Build lookup maps keyed by user_id
  const paidMap      = Object.fromEntries(paid.map(r => [String(r.user_id), parseFloat(r.total_paid)]));
  const owedMap      = Object.fromEntries(owed.map(r => [String(r.user_id), parseFloat(r.total_owed)]));
  const settPaidMap  = Object.fromEntries(settPaid.map(r => [String(r.user_id), parseFloat(r.settlements_paid)]));
  const settRecvMap  = Object.fromEntries(settReceived.map(r => [String(r.user_id), parseFloat(r.settlements_received)]));
  const extSharesMap = Object.fromEntries(extShares.map(r => [String(r.user_id), parseFloat(r.external_shares)]));

  // Use the paid query as the source of members (it has all group_members)
  const balances = paid.map(r => {
    const uid              = String(r.user_id);
    const total_paid       = paidMap[uid]      ?? 0;
    const total_owed       = owedMap[uid]      ?? 0;
    const sett_paid        = settPaidMap[uid]  ?? 0;
    const sett_recv        = settRecvMap[uid]  ?? 0;
    const external_shares  = extSharesMap[uid] ?? 0;

    // net_balance = (what you paid to the group, excl. external shares)
    //             + settlements you sent
    //             - what you owe for your own shares
    //             - settlements you received
    const net_balance = Math.round(
      ((total_paid - external_shares) + sett_paid - total_owed - sett_recv) * 100
    ) / 100;

    return {
      user_id:              r.user_id,
      user_name:            r.user_name,
      total_paid,
      total_owed,
      external_shares,
      settlements_paid:     sett_paid,
      settlements_received: sett_recv,
      net_balance,
    };
  });

  return balances;
}

/**
 * minimizeDebts(rawBalances)
 * Pure function — no DB. Minimum cash flow algorithm.
 * Collapses N-way debts into the fewest possible transactions.
 *
 * @param {Array} rawBalances — output of getRawBalances (or any array with { user_id, user_name, net_balance })
 * @returns {Array} transactions — [{ from_user_id, from_name, to_user_id, to_name, amount }]
 */
function minimizeDebts(rawBalances) {
  const THRESHOLD = 0.01;
  const transactions = [];

  // Work on mutable copies so we don't mutate input
  const creditors = rawBalances
    .filter(m => m.net_balance > THRESHOLD)
    .map(m => ({ ...m }));

  const debtors = rawBalances
    .filter(m => m.net_balance < -THRESHOLD)
    .map(m => ({ ...m }));

  // Sort: creditors descending (largest credit first), debtors ascending (most negative first)
  const sortCreditors = () => creditors.sort((a, b) => b.net_balance - a.net_balance);
  const sortDebtors   = () => debtors.sort((a, b) => a.net_balance - b.net_balance);

  sortCreditors();
  sortDebtors();

  while (creditors.length > 0 && debtors.length > 0) {
    const debtor   = debtors[0];
    const creditor = creditors[0];

    const amount = Math.round(
      Math.min(Math.abs(debtor.net_balance), creditor.net_balance) * 100
    ) / 100;

    transactions.push({
      from_user_id: debtor.user_id,
      from_name:    debtor.user_name,
      to_user_id:   creditor.user_id,
      to_name:      creditor.user_name,
      amount,
    });

    debtor.net_balance   += amount;
    creditor.net_balance -= amount;

    if (Math.abs(debtor.net_balance)   < THRESHOLD) debtors.shift();
    if (Math.abs(creditor.net_balance) < THRESHOLD) creditors.shift();

    sortCreditors();
    sortDebtors();
  }

  return transactions;
}

/**
 * getGroupBalanceSummary(groupId)
 * Main export. Combines raw balances + minimized debt transactions.
 * Also surfaces external_receivables — amounts the payer must collect
 * directly from external participants (outside the app).
 */
async function getGroupBalanceSummary(groupId) {
  const balances     = await getRawBalances(groupId);
  const transactions = minimizeDebts(balances);

  const total_expenses = Math.round(
    balances.reduce((sum, m) => sum + m.total_paid, 0) * 100
  ) / 100;

  // External receivables: amounts a member fronted for non-members.
  // These are NOT part of the group balance — the payer must collect directly.
  const external_receivables = balances
    .filter(m => m.external_shares > 0)
    .map(m => ({
      payer_name: m.user_name,
      amount:     m.external_shares,
      note:       'Collect directly — not tracked in group balance'
    }));

  return {
    balances,
    transactions,
    total_expenses,
    settled: transactions.length === 0,
    external_receivables,
  };
}

module.exports = { getGroupBalanceSummary, getRawBalances, minimizeDebts };
