const { db } = require('../config/db');

/**
 * POST /api/groups
 * Create a new group and add the creator as the first member.
 */
async function createGroup(req, res, next) {
  try {
    const { name, description } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Group name is required' });
    }

    const result = await db.transaction(async (trx) => {
      const [group] = await trx('groups')
        .insert({
          name: name.trim(),
          description: description || null,
          created_by: req.user.id
        })
        .returning(['id', 'name', 'description', 'created_at']);

      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

      const [membership] = await trx('group_members')
        .insert({
          group_id: group.id,
          user_id: req.user.id,
          joined_at: today,
          left_at: null
        })
        .returning(['joined_at']);

      return { group, membership };
    });

    return res.status(201).json({
      group: result.group,
      membership: { joined_at: result.membership.joined_at }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/groups
 * Return all groups where the current user is an active member.
 */
async function getMyGroups(req, res, next) {
  try {
    const userId = req.user.id;

    const groups = await db.raw(`
      SELECT
        g.id, g.name, g.description, g.created_at,
        gm_me.joined_at AS my_joined_at,
        (SELECT COUNT(*)::int FROM group_members gm2
         WHERE gm2.group_id = g.id AND gm2.left_at IS NULL) AS member_count
      FROM groups g
      JOIN group_members gm_me
        ON gm_me.group_id = g.id
        AND gm_me.user_id = ?
        AND gm_me.left_at IS NULL
      ORDER BY g.created_at DESC
    `, [userId]);

    return res.status(200).json({ groups: groups.rows });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/groups/:id
 * Return group details with all members (past and present).
 */
async function getGroup(req, res, next) {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;

    // Check group exists
    const group = await db('groups').where('id', groupId).first();
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    // Check caller is an active member
    const myMembership = await db('group_members')
      .where({ group_id: groupId, user_id: userId })
      .whereNull('left_at')
      .first();

    if (!myMembership) {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // Get ALL members (past and present)
    const members = await db('group_members as gm')
      .join('users as u', 'u.id', 'gm.user_id')
      .where('gm.group_id', groupId)
      .select(
        'u.id as user_id',
        'u.name',
        'u.email',
        'gm.joined_at',
        'gm.left_at'
      )
      .orderBy('gm.joined_at', 'asc');

    const membersWithStatus = members.map((m) => ({
      ...m,
      is_active: m.left_at === null
    }));

    return res.status(200).json({
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        created_at: group.created_at
      },
      members: membersWithStatus
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/groups/:id/members
 * Add a member to a group by email, with a specified join date.
 */
async function addMember(req, res, next) {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;
    const { email, joined_at } = req.body;

    // Validate joined_at
    if (!joined_at || !/^\d{4}-\d{2}-\d{2}$/.test(joined_at)) {
      return res.status(400).json({ error: 'joined_at must be a valid YYYY-MM-DD date' });
    }
    const joinDate = new Date(joined_at + 'T00:00:00Z');
    if (isNaN(joinDate.getTime())) {
      return res.status(400).json({ error: 'joined_at is not a valid date' });
    }
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    if (joinDate > today) {
      return res.status(400).json({ error: 'joined_at cannot be in the future' });
    }

    // Verify caller is active member
    const callerMembership = await db('group_members')
      .where({ group_id: groupId, user_id: userId })
      .whereNull('left_at')
      .first();

    if (!callerMembership) {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // Find user by email
    const targetUser = await db('users')
      .whereRaw('LOWER(email) = LOWER(?)', [email])
      .first();

    if (!targetUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if already an active member
    const activeMembership = await db('group_members')
      .where({ group_id: groupId, user_id: targetUser.id })
      .whereNull('left_at')
      .first();

    if (activeMembership) {
      return res.status(409).json({ error: 'User is already an active member' });
    }

    // Check for previous membership (left_at NOT NULL) — rejoin scenario
    const previousMembership = await db('group_members')
      .where({ group_id: groupId, user_id: targetUser.id })
      .whereNotNull('left_at')
      .first();

    if (previousMembership) {
      // Update existing row: clear left_at, set new joined_at
      await db('group_members')
        .where({ id: previousMembership.id })
        .update({ left_at: null, joined_at: joined_at });
    } else {
      // Insert new row
      await db('group_members')
        .insert({
          group_id: groupId,
          user_id: targetUser.id,
          joined_at: joined_at,
          left_at: null
        });
    }

    return res.status(201).json({
      membership: {
        user_id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        joined_at: joined_at,
        left_at: null
      }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/groups/:id/members/:userId
 * Mark a member as departed with a supplied left_at date.
 */
async function removeMember(req, res, next) {
  try {
    const groupId = req.params.id;
    const targetUserId = parseInt(req.params.userId, 10);
    const callerId = req.user.id;
    const { left_at } = req.body;

    // Validate left_at
    if (!left_at || !/^\d{4}-\d{2}-\d{2}$/.test(left_at)) {
      return res.status(400).json({ error: 'left_at must be a valid YYYY-MM-DD date' });
    }
    const leftDate = new Date(left_at + 'T00:00:00Z');
    if (isNaN(leftDate.getTime())) {
      return res.status(400).json({ error: 'left_at is not a valid date' });
    }

    // Verify caller is active member
    const callerMembership = await db('group_members')
      .where({ group_id: groupId, user_id: callerId })
      .whereNull('left_at')
      .first();

    if (!callerMembership) {
      return res.status(403).json({ error: 'You are not an active member of this group' });
    }

    // Find active membership for target user
    const targetMembership = await db('group_members')
      .where({ group_id: groupId, user_id: targetUserId })
      .whereNull('left_at')
      .first();

    if (!targetMembership) {
      return res.status(404).json({ error: 'Active membership not found for this user' });
    }

    // Cannot remove yourself if you're the only active member
    if (targetUserId === callerId) {
      const activeCount = await db('group_members')
        .where({ group_id: groupId })
        .whereNull('left_at')
        .count('id as count')
        .first();

      if (parseInt(activeCount.count, 10) <= 1) {
        return res.status(400).json({ error: 'Cannot remove yourself — you are the only active member' });
      }
    }

    // Set left_at
    await db('group_members')
      .where({ id: targetMembership.id })
      .update({ left_at: left_at });

    return res.status(200).json({ message: 'Member removed', left_at });
  } catch (err) {
    next(err);
  }
}

/**
 * Helper (NOT a route): get all members who were active on a specific date.
 * Used by the import engine to determine who should share an expense.
 *
 * A member is "active on date" if:
 *   joined_at <= date AND (left_at IS NULL OR left_at > date)
 */
async function getMembersOnDate(groupId, date) {
  const members = await db('group_members as gm')
    .join('users as u', 'u.id', 'gm.user_id')
    .where('gm.group_id', groupId)
    .where('gm.joined_at', '<=', date)
    .andWhere(function () {
      this.whereNull('gm.left_at').orWhere('gm.left_at', '>', date);
    })
    .select('u.id', 'u.name', 'u.email', 'gm.joined_at', 'gm.left_at');

  return members;
}

module.exports = {
  createGroup,
  getMyGroups,
  getGroup,
  addMember,
  removeMember,
  getMembersOnDate
};
