-- Balance calculation queries
-- Returns: user_id, user_name, total_paid, total_owed, net_balance
-- net_balance > 0 means they are owed money
-- net_balance < 0 means they owe money

-- QUERY A: Total paid per member (membership-date-filtered)
-- Key: e.date >= gm.joined_at AND (gm.left_at IS NULL OR e.date < gm.left_at)
-- This means Sam joining mid-April won't be charged for March expenses.
-- Meera leaving March 31 won't be charged for April expenses.
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
GROUP BY u.id, u.name;

-- QUERY B: Total owed per member from expense_splits (membership-date-filtered)
-- Even if Meera is listed in a split for an April expense,
-- e.date < gm.left_at (2026-03-31) excludes it from her owed total.
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
GROUP BY u.id, u.name;

-- QUERY C: Settlements paid (reduces what you owe)
SELECT
  from_user_id             AS user_id,
  COALESCE(SUM(amount), 0) AS settlements_paid
FROM settlements
WHERE group_id = :groupId
GROUP BY from_user_id;

-- QUERY D: Settlements received (reduces what you are owed)
SELECT
  to_user_id               AS user_id,
  COALESCE(SUM(amount), 0) AS settlements_received
FROM settlements
WHERE group_id = :groupId
GROUP BY to_user_id;

-- FINAL NET BALANCE (computed in JS):
-- net_balance = (total_paid + settlements_paid) - (total_owed + settlements_received)
