const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createSettlement, listSettlements } = require('../controllers/settlementController');

// mergeParams: true so :groupId from the parent router is accessible
const router = express.Router({ mergeParams: true });

router.use(requireAuth);

router.post('/', createSettlement);
router.get('/',  listSettlements);

module.exports = router;
