const express = require('express');
const { requireAuth } = require('../middleware/auth');
const groupController = require('../controllers/groupController');

const router = express.Router();

// All group routes require authentication
router.use(requireAuth);

router.post('/', groupController.createGroup);
router.get('/', groupController.getMyGroups);
router.get('/:id', groupController.getGroup);
router.delete('/:id', groupController.deleteGroup);
router.patch('/:id/admin', groupController.transferAdmin);
router.post('/:id/members', groupController.addMember);
router.delete('/:id/members/:userId', groupController.removeMember);

module.exports = router;

