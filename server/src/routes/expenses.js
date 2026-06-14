const express = require('express');
const { requireAuth } = require('../middleware/auth');
const expenseController = require('../controllers/expenseController');

// mergeParams: true is required to access :groupId from the parent router
const router = express.Router({ mergeParams: true });

router.use(requireAuth);

router.post('/',             expenseController.createExpense);
router.get('/',              expenseController.listExpenses);
router.get('/:expenseId',    expenseController.getExpense);
router.delete('/:expenseId', expenseController.deleteExpense);

module.exports = router;
