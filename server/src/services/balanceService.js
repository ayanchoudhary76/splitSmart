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
 * Even if Meera is listed in a split for an April expense,
 * e.date < gm.left_at (2026-03-31) excludes it from her total_owed.
 */
async function queryTotalOwed(groupId) {
  const rows = await db.raw(`
    SELECT
      u.id   AS user_id,
      u.name AS user_name,
      COALESCE(SUM(es.share_amount), 0) AS total_owed
    FROM group_members gm
    JOIN users u ON u.id = gm.user_id
    LEFT JOIN expense_splits es ON es.user_id = gm.user_id
    LEFT JOIN expenses e
      ON  e.id            = es.expense_id
      AND e.group_id      = gm.group_id
      AND e.is_settlement = FALSE
      AND e.date         >= gm.joined_at
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
 * getRawBalances(groupId)
 * Runs all 4 queries concurrently, merges in JS.
 *
 * net_balance > 0 → they are OWED this amount
 * net_balance < 0 → they OWE this amount
 */
async function getRawBalances(groupId) {
  const [paid, owed, settPaid, settReceived] = await Promise.all([
    queryTotalPaid(groupId),
    queryTotalOwed(groupId),
    querySettlementsPaid(groupId),
    querySettlementsReceived(groupId),
  ]);

  // Build lookup maps keyed by user_id
  const paidMap         = Object.fromEntries(paid.map(r => [String(r.user_id), parseFloat(r.total_paid)]));
  const owedMap         = Object.fromEntries(owed.map(r => [String(r.user_id), parseFloat(r.total_owed)]));
  const settPaidMap     = Object.fromEntries(settPaid.map(r => [String(r.user_id), parseFloat(r.settlements_paid)]));
  const settRecvMap     = Object.fromEntries(settReceived.map(r => [String(r.user_id), parseFloat(r.settlements_received)]));

  // Use the paid query as the source of members (it has all group_members)
  const balances = paid.map(r => {
    const uid             = String(r.user_id);
    const total_paid      = paidMap[uid]     ?? 0;
    const total_owed      = owedMap[uid]     ?? 0;
    const sett_paid       = settPaidMap[uid]  ?? 0;
    const sett_recv       = settRecvMap[uid]  ?? 0;

    const net_balance = Math.round(
      ((total_paid + sett_paid) - (total_owed + sett_recv)) * 100
    ) / 100;

    return {
      user_id:              r.user_id,
      user_name:            r.user_name,
      total_paid,
      total_owed,
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
 */
async function getGroupBalanceSummary(groupId) {
  const balances     = await getRawBalances(groupId);
  const transactions = minimizeDebts(balances);

  const total_expenses = Math.round(
    balances.reduce((sum, m) => sum + m.total_paid, 0) * 100
  ) / 100;

  return {
    balances,
    transactions,
    total_expenses,
    settled: transactions.length === 0,
  };
}

module.exports = { getGroupBalanceSummary, getRawBalances, minimizeDebts };
