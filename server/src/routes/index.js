const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const authRouter = require('./auth');
const groupsRouter = require('./groups');
const expensesRouter = require('./expenses');
const balanceController = require('../controllers/balanceController');
const settlementsRouter = require('./settlements');
const importRouter = require('./import');

router.use('/auth', authRouter);
router.use('/groups', groupsRouter);
router.use('/groups/:groupId/expenses', requireAuth, expensesRouter);
router.get('/groups/:groupId/balances',     requireAuth, balanceController.getBalances);
router.use('/groups/:groupId/settlements',  requireAuth, settlementsRouter);
router.use('/import', importRouter);

module.exports = router;
