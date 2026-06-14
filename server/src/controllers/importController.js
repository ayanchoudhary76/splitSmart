const multer  = require('multer');
const { buildPreview, commitImport } = require('../services/importService');
const { db } = require('../config/db');

// ── Multer — keep file in RAM, pass buffer to service ────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 5 * 1024 * 1024 },   // 5 MB max
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === 'text/csv'
            || file.mimetype === 'text/plain'
            || file.originalname.toLowerCase().endsWith('.csv');
    if (ok) return cb(null, true);
    cb(Object.assign(new Error('Only .csv files are accepted'), { status: 400 }));
  },
});

const uploadSingle = upload.single('csv');   // exposed so the router can use it

/**
 * POST /api/import/:groupId/preview
 * Phase 1 — parse + anomaly detection only, no DB writes to expenses.
 */
async function previewImport(req, res, next) {
  try {
    const { groupId } = req.params;

    if (!req.file) {
      return res.status(400).json({ error: 'No CSV file uploaded — use multipart field "csv"' });
    }

    const usdRate = parseFloat(req.body.usd_rate || '83.50');
    if (isNaN(usdRate) || usdRate <= 0) {
      return res.status(400).json({ error: 'usd_rate must be a positive number' });
    }

    const preview = await buildPreview(
      req.file.buffer,
      groupId,
      usdRate,
      req.user.id,
      req.file.originalname
    );

    return res.status(200).json(preview);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/import/:groupId/confirm
 * Phase 2 — commit the import; user decisions override pending_user_review rows.
 * Body: { session_id, user_decisions: [{ row_number, action }] }
 */
async function confirmImport(req, res, next) {
  try {
    const { groupId } = req.params;
    const { session_id, user_decisions = [] } = req.body;

    if (!session_id) {
      return res.status(400).json({ error: 'session_id is required' });
    }

    const result = await commitImport(session_id, user_decisions, groupId, req.user.id);
    return res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    next(err);
  }
}

/**
 * GET /api/import/:groupId/sessions/:sessionId
 * Fetch a session + all its anomalies.
 */
async function getImportSession(req, res, next) {
  try {
    const { groupId, sessionId } = req.params;

    const session = await db('import_sessions')
      .where({ id: sessionId, group_id: groupId })
      .first();

    if (!session) {
      return res.status(404).json({ error: 'Import session not found' });
    }

    const anomalies = await db('import_anomalies')
      .where({ import_session_id: sessionId })
      .orderBy('row_number')
      .select('id', 'row_number', 'anomaly_type', 'description', 'proposed_action');

    // Don't send the heavy preview_data blob back — frontend already has it from Phase 1
    const { preview_data: _omit, ...sessionPublic } = session;
    return res.status(200).json({ session: sessionPublic, anomalies });
  } catch (err) {
    next(err);
  }
}

module.exports = { previewImport, confirmImport, getImportSession, uploadSingle };
