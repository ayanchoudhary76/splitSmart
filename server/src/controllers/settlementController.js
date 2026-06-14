const { db } = require('../config/db');
const { getGroupBalanceSummary } = require('../services/balanceService');

/**
 * POST /api/groups/:groupId/settlements
 * Record a payment from one member to another and return updated balances.
 */
async function createSettlement(req, res, next) {
  try {
    const { groupId } = req.params;
    const { from_user_id, to_user_id, amount, date, notes = null } = req.body;

    // ── Validate required fields ──────────────────────────────
    if (from_user_id == null) return res.status(400).json({ error: 'from_user_id is required' });
    if (to_user_id   == null) return res.status(400).json({ error: 'to_user_id is required' });

    if (parseInt(from_user_id, 10) === parseInt(to_user_id, 10)) {
      return res.status(400).json({ error: 'Cannot settle with yourself' });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date must be YYYY-MM-DD' });
    }

    // ── Verify both users are members (active OR past) ────────
    const memberships = await db('group_members')
      .where('group_id', groupId)
      .whereIn('user_id', [from_user_id, to_user_id])
      .select('user_id');

    const memberIds = new Set(memberships.map(m => String(m.user_id)));

    if (!memberIds.has(String(from_user_id))) {
      return res.status(404).json({ error: `User ${from_user_id} is not a member of this group` });
    }
    if (!memberIds.has(String(to_user_id))) {
      return res.status(404).json({ error: `User ${to_user_id} is not a member of this group` });
    }

    // ── Insert settlement ─────────────────────────────────────
    const [settlement] = await db('settlements')
      .insert({
        group_id:     groupId,
        from_user_id: parseInt(from_user_id, 10),
        to_user_id:   parseInt(to_user_id,   10),
        amount:       parseFloat(amount),
        date,
        notes:        notes || null,
        created_by:   req.user.id,
      })
      .returning(['id', 'group_id', 'from_user_id', 'to_user_id', 'amount', 'date', 'notes', 'created_at']);

    // ── Fetch updated balances immediately ────────────────────
    // Returns updated state so the UI doesn't need a second request.
    const summary = await getGroupBalanceSummary(groupId);

    return res.status(201).json({
      settlement,
      updated_balances:     summary.balances,
      updated_transactions: summary.transactions,
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/groups/:groupId/settlements
 * List all settlements for a group with participant names.
 */
async function listSettlements(req, res, next) {
  try {
    const { groupId } = req.params;

    // Verify caller is a member (active or past)
    const membership = await db('group_members')
      .where({ group_id: groupId, user_id: req.user.id })
      .first();
    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const settlements = await db('settlements as s')
      .join('users as fu', 'fu.id', 's.from_user_id')
      .join('users as tu', 'tu.id', 's.to_user_id')
      .where('s.group_id', groupId)
      .select(
        's.id', 's.group_id', 's.from_user_id', 's.to_user_id',
        's.amount', 's.date', 's.notes', 's.created_at',
        'fu.name as from_name',
        'tu.name as to_name'
      )
      .orderBy('s.date', 'desc')
      .orderBy('s.created_at', 'desc');

    return res.status(200).json({ settlements });
  } catch (err) {
    next(err);
  }
}

module.exports = { createSettlement, listSettlements };
