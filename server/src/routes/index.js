const express = require('express');
const router = express.Router();

const { requireAuth } = require('../middleware/auth');
const authRouter = require('./auth');
const groupsRouter = require('./groups');
const expensesRouter = require('./expenses');

router.use('/auth', authRouter);
router.use('/groups', groupsRouter);
router.use('/groups/:groupId/expenses', requireAuth, expensesRouter);

module.exports = router;
