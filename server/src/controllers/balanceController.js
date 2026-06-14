const { getGroupBalanceSummary } = require('../services/balanceService');
const { db } = require('../config/db');

/**
 * GET /api/groups/:groupId/balances
 * Returns raw per-member balances + minimized debt transactions.
 */
async function getBalances(req, res, next) {
  try {
    const { groupId } = req.params;

    // Verify caller is a member (active OR past — departed members can still view)
    const membership = await db('group_members')
      .where({ group_id: groupId, user_id: req.user.id })
      .first();

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this group' });
    }

    const summary = await getGroupBalanceSummary(groupId);
    return res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
}

module.exports = { getBalances };
