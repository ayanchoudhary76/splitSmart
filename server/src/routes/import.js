const express = require('express');
const { requireAuth } = require('../middleware/auth');
const {
  previewImport,
  confirmImport,
  getImportSession,
  getImportReport,
  uploadSingle,
} = require('../controllers/importController');

const router = express.Router();

router.use(requireAuth);

// Phase 1 — multipart CSV upload → anomaly report (no DB writes to expenses)
router.post('/:groupId/preview', uploadSingle, previewImport);

// Phase 2 — commit decisions to DB
router.post('/:groupId/confirm', confirmImport);

// Inspect a past session + its anomalies
router.get('/:groupId/sessions/:sessionId', getImportSession);

// Human-readable audit report for the assignment evaluator
router.get('/:groupId/sessions/:sessionId/report', getImportReport);

module.exports = router;
