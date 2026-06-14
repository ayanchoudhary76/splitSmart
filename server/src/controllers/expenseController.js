const { db } = require('../config/db');
const { calculateSplits } = require('../services/splitCalculator');

/**
 * POST /api/groups/:groupId/expenses
 * Create an expense with splits.
 */
async function createExpense(req, res, next) {
  try {
    const groupId = req.params.groupId;
    const {
      description,
      amount,
      currency = 'INR',
      exchange_rate,
      paid_by_user_id = null,
      split_type,
      date,
      notes = null,
      participants
    } = req.body;

    // ── Validate required fields ──────────────────────────────
    const missing = [];
    if (!description?.trim())       missing.push('description');
    if (amount == null)             missing.push('amount');
    if (!currency)                  missing.push('currency');
    if (!split_type)                missing.push('split_type');
    if (!date)                      missing.push('date');
    if (!participants?.length)      missing.push('participants (min 1)');
    if (missing.length) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    if (!['equal', 'unequal', 'percentage', 'share'].includes(split_type)) {
      return res.status(400).json({ error: `split_type must be one of: equal, unequal, percentage, share` });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    // ── Verify caller is active member of group ───────────────
    const membership = await db('group_members')
      .where({ group_id: groupId, user_id: req.user.id })
      .whereNull('left_at')
      .first();
    if (!membership) {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // ── Compute amount_inr ────────────────────────────────────
    const effectiveRate = (currency === 'INR' || !exchange_rate) ? 1 : exchange_rate;
    const amount_inr = Math.round(amount * effectiveRate * 100) / 100;

    // ── Calculate splits ──────────────────────────────────────
    const { splits, warnings } = calculateSplits(
      split_type,
      amount_inr,
      participants,
      { exchangeRate: effectiveRate }
    );

    // ── Persist in a transaction ──────────────────────────────
    const result = await db.transaction(async (trx) => {
      const [expense] = await trx('expenses')
        .insert({
          group_id:         groupId,
          description:      description.trim(),
          amount,
          currency:         currency.toUpperCase(),
          exchange_rate:    effectiveRate,
          amount_inr,
          paid_by_user_id:  paid_by_user_id || null,
          split_type,
          date,
          is_settlement:    false,
          notes:            notes || null,
          created_by:       req.user.id
        })
        .returning(['id', 'group_id', 'description', 'amount', 'currency',
                    'exchange_rate', 'amount_inr', 'paid_by_user_id',
                    'split_type', 'date', 'is_settlement', 'notes', 'created_at']);

      // Bulk-insert splits
      const splitRows = splits.map((s) => ({
        expense_id:       expense.id,
        user_id:          s.user_id,
        participant_name: s.participant_name,
        share_amount:     s.share_amount,
        split_detail:     s.split_detail
      }));
      const insertedSplits = await trx('expense_splits')
        .insert(splitRows)
        .returning(['id', 'user_id', 'participant_name', 'share_amount', 'split_detail']);

      return { expense, splits: insertedSplits };
    });

    return res.status(201).json({
      expense: result.expense,
      splits:  result.splits,
      warnings
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/groups/:groupId/expenses
 * Paginated list of non-settlement expenses for a group.
 */
async function listExpenses(req, res, next) {
  try {
    const groupId = req.params.groupId;
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    // Verify caller is a member (active or past)
    const membership = await db('group_members')
      .where({ group_id: groupId, user_id: req.user.id })
      .first();
    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    // Count total
    const { count: totalStr } = await db('expenses')
      .where({ group_id: groupId, is_settlement: false })
      .count('id as count')
      .first();
    const total = parseInt(totalStr, 10);

    // Fetch page
    const expenses = await db('expenses as e')
      .leftJoin('users as u', 'u.id', 'e.paid_by_user_id')
      .where({ 'e.group_id': groupId, 'e.is_settlement': false })
      .select(
        'e.id', 'e.group_id', 'e.description', 'e.amount', 'e.currency',
        'e.exchange_rate', 'e.amount_inr', 'e.paid_by_user_id',
        'e.split_type', 'e.date', 'e.notes', 'e.created_at',
        'u.name as paid_by_name'
      )
      .orderBy('e.date', 'desc')
      .orderBy('e.created_at', 'desc')
      .limit(limit)
      .offset(offset);

    return res.status(200).json({ expenses, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/groups/:groupId/expenses/:expenseId
 * Return one expense with all its splits.
 */
async function getExpense(req, res, next) {
  try {
    const { groupId, expenseId } = req.params;

    // Verify membership
    const membership = await db('group_members')
      .where({ group_id: groupId, user_id: req.user.id })
      .first();
    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const expense = await db('expenses').where({ id: expenseId, group_id: groupId }).first();
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    const splits = await db('expense_splits as es')
      .leftJoin('users as u', 'u.id', 'es.user_id')
      .where('es.expense_id', expenseId)
      .select(
        'es.id', 'es.user_id', 'es.participant_name',
        'es.share_amount', 'es.split_detail',
        'u.name as user_name'
      );

    return res.status(200).json({ expense, splits });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/groups/:groupId/expenses/:expenseId
 * Hard delete. Only admin or the expense creator can delete.
 */
async function deleteExpense(req, res, next) {
  try {
    const { groupId, expenseId } = req.params;

    const expense = await db('expenses').where({ id: expenseId, group_id: groupId }).first();
    if (!expense) {
      return res.status(404).json({ error: 'Expense not found' });
    }

    const group = await db('groups').where({ id: groupId }).first();
    const isAdmin   = group?.admin_user_id === req.user.id;
    const isCreator = expense.created_by   === req.user.id;

    if (!isAdmin && !isCreator) {
      return res.status(403).json({ error: 'Only the group admin or expense creator can delete this expense' });
    }

    await db('expenses').where({ id: expenseId }).del();

    return res.status(200).json({ message: 'Expense deleted' });
  } catch (err) {
    next(err);
  }
}

module.exports = { createExpense, listExpenses, getExpense, deleteExpense };
