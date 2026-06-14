/**
 * importService.js — CSV import engine
 *
 * Phase 1 (preview):  buildPreview()   — parse + detect anomalies, write nothing to expenses
 * Phase 2 (confirm):  commitImport()   — user-reviewed decisions committed to DB
 *
 * Pure helpers (A–D) are exported so unit tests can verify them in isolation.
 */

const { parse } = require('csv-parse/sync');
const { db } = require('../config/db');
const { calculateSplits } = require('./splitCalculator');
const { getMembersOnDate } = require('../controllers/groupController');

// ─────────────────────────────────────────────────────────────
// A. normalizeAmount
// ─────────────────────────────────────────────────────────────
function normalizeAmount(raw) {
  const anomalies = [];
  if (raw == null) return { value: null, anomalies: [{ type: 'invalid_amount', description: 'Amount is missing' }] };

  let s = String(raw);

  // Whitespace
  if (s !== s.trim()) {
    anomalies.push({ type: 'whitespace_in_amount', description: `Leading/trailing whitespace removed from amount "${s}"` });
    s = s.trim();
  }

  // Commas (thousands separator)
  if (s.includes(',')) {
    anomalies.push({ type: 'comma_in_amount', description: `Comma(s) removed from amount "${s}" — treated as thousands separator` });
    s = s.replace(/,/g, '');
  }

  const value = parseFloat(s);
  if (isNaN(value)) {
    return { value: null, anomalies: [{ type: 'invalid_amount', description: `Cannot parse "${raw}" as a number` }] };
  }

  if (value === 0) {
    anomalies.push({ type: 'zero_amount', description: 'Amount is zero — this row will be skipped' });
  }

  if (value < 0) {
    anomalies.push({ type: 'negative_amount', description: `Amount ${value} is negative` });
  }

  // Excessive decimal places (more than 2)
  const decimalPart = s.split('.')[1];
  if (decimalPart && decimalPart.length > 2) {
    const rounded = Math.round(value * 100) / 100;
    anomalies.push({ type: 'excessive_decimal', description: `${value} rounded to ${rounded} (more than 2 decimal places)` });
    return { value: rounded, anomalies };
  }

  return { value, anomalies };
}

// ─────────────────────────────────────────────────────────────
// B. normalizeDate
// ─────────────────────────────────────────────────────────────
const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
};

function pad2(n) { return String(n).padStart(2, '0'); }

function normalizeDate(raw) {
  const anomalies = [];
  if (!raw || !raw.trim()) {
    return { value: null, anomalies: [{ type: 'invalid_date', description: 'Date is missing' }] };
  }
  const s = raw.trim();

  // 1. YYYY-MM-DD — canonical, no anomaly
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + 'T00:00:00');
    if (!isNaN(d)) return { value: s, anomalies: [] };
  }

  // 2. DD/MM/YYYY or MM/DD/YYYY — ambiguous, treat as DD/MM/YYYY (India context)
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, dd, mm, yyyy] = slashMatch;
    const value = `${yyyy}-${pad2(mm)}-${pad2(dd)}`;
    anomalies.push({
      type: 'ambiguous_date',
      description: `"${s}" is ambiguous (DD/MM/YYYY or MM/DD/YYYY). Interpreted as DD/MM/YYYY → ${value}`
    });
    return { value, anomalies };
  }

  // 3. Month-name formats:  "Mar 14", "Mar 14 2026", "14 Mar 2026", "14 Mar"
  //    Also handles "March 14", "14 March 2026" etc.
  const monthNameRe = /^(\d{1,2})\s+([a-z]+)\s*(\d{4})?$/i;
  const monthNameRe2 = /^([a-z]+)\s+(\d{1,2})\s*,?\s*(\d{4})?$/i;

  let mDay = null, mMonth = null, mYear = null;

  const m1 = s.match(monthNameRe);   // "14 Mar 2026" or "14 Mar"
  const m2 = s.match(monthNameRe2);  // "Mar 14" or "Mar 14, 2026"

  if (m1) {
    mDay   = parseInt(m1[1], 10);
    mMonth = MONTH_NAMES[m1[2].toLowerCase()];
    mYear  = m1[3] ? parseInt(m1[3], 10) : 2026;
  } else if (m2) {
    mMonth = MONTH_NAMES[m2[1].toLowerCase()];
    mDay   = parseInt(m2[2], 10);
    mYear  = m2[3] ? parseInt(m2[3], 10) : 2026;
  }

  if (mDay != null && mMonth != null && mYear != null) {
    const value = `${mYear}-${pad2(mMonth)}-${pad2(mDay)}`;
    anomalies.push({
      type: 'ambiguous_date',
      description: `Month-name date "${s}" normalized to ${value} (assumed year ${mYear} if not specified)`
    });
    return { value, anomalies };
  }

  // 4. Unrecognized
  return {
    value: null,
    anomalies: [{ type: 'invalid_date', description: `Cannot parse date "${s}"` }]
  };
}

// ─────────────────────────────────────────────────────────────
// C. normalizeName
// ─────────────────────────────────────────────────────────────
function normalizeName(raw, groupMembers) {
  if (!raw || !raw.trim()) {
    return { user_id: null, participant_name: '', anomaly: 'unknown_participant' };
  }
  const trimmed = raw.trim();
  const lc = trimmed.toLowerCase();

  // 1. Case-sensitive exact match → truly no anomaly
  const csSame = groupMembers.find(m => m.name === trimmed);
  if (csSame) {
    return { user_id: csSame.id, participant_name: csSame.name, anomaly: null };
  }

  // 2. Case-insensitive exact match (name matches but case differs) → name_mismatch
  const exactMatch = groupMembers.find(m => m.name.toLowerCase() === lc);
  if (exactMatch) {
    return {
      user_id:          exactMatch.id,
      participant_name: exactMatch.name,
      anomaly:          'name_mismatch',
      anomalyDesc:      `"${trimmed}" matched to group member "${exactMatch.name}" (case differs)`
    };
  }

  // 3. Prefix match — raw starts with member name, or member name starts with raw
  const prefixMatch = groupMembers.find(m => {
    const mLc = m.name.toLowerCase();
    return lc.startsWith(mLc) || mLc.startsWith(lc);
  });
  if (prefixMatch) {
    return {
      user_id:          prefixMatch.id,
      participant_name: prefixMatch.name,
      anomaly:          'name_mismatch',
      anomalyDesc:      `"${trimmed}" matched to group member "${prefixMatch.name}"`
    };
  }

  // 3. No match → external participant
  return {
    user_id:          null,
    participant_name: trimmed,
    anomaly:          'unknown_participant',
    anomalyDesc:      `"${trimmed}" is not a group member — will be recorded as external participant`
  };
}

// ─────────────────────────────────────────────────────────────
// D. detectSettlement
// ─────────────────────────────────────────────────────────────
const SETTLEMENT_RE = [
  /paid\s+back/i,
  /settled/i,
  /settlement/i,
  /deposit\s+share/i,
  /transfer/i,
  /\w+\s+paid\s+\w+/i   // "<name> paid <name>"
];

function detectSettlement(description) {
  if (!description) return false;
  return SETTLEMENT_RE.some(re => re.test(description));
}

// ─────────────────────────────────────────────────────────────
// E. parseSplitParticipants
// ─────────────────────────────────────────────────────────────
function parseSplitParticipants(splitWith, splitDetails, splitType, groupMembers, amountInr, exchangeRate) {
  const anomalies = [];

  if (!splitWith || !splitWith.trim()) {
    return { participants: [], anomalies: [{ type: 'missing_split_with', description: 'split_with is empty' }], splits: [] };
  }

  const names   = splitWith.split(',').map(n => n.trim()).filter(Boolean);
  const details = splitDetails ? splitDetails.split(',').map(d => d.trim()).filter(Boolean) : [];

  const participants = names.map((name, i) => {
    const resolved = normalizeName(name, groupMembers);

    if (resolved.anomaly === 'name_mismatch') {
      anomalies.push({ type: 'name_mismatch', description: resolved.anomalyDesc });
    } else if (resolved.anomaly === 'unknown_participant') {
      anomalies.push({ type: 'unknown_participant', description: resolved.anomalyDesc });
    }

    const base = { user_id: resolved.user_id, participant_name: resolved.participant_name };

    switch (splitType) {
      case 'unequal':
        return { ...base, amount: parseFloat(details[i]) || 0 };
      case 'percentage':
        return { ...base, percentage: parseFloat((details[i] || '').replace('%', '')) || 0 };
      case 'share':
        return { ...base, shares: parseFloat(details[i]) || 1 };
      default: // equal
        return base;
    }
  });

  // Run calculateSplits to validate and collect its warnings
  let splits = [];
  try {
    const result = calculateSplits(splitType, amountInr, participants, { exchangeRate });
    splits = result.splits;
    for (const w of result.warnings) {
      anomalies.push({ type: 'split_warning', description: w });
    }
  } catch (err) {
    anomalies.push({ type: 'split_error', description: `calculateSplits error: ${err.message}` });
  }

  return { participants, anomalies, splits };
}

// ─────────────────────────────────────────────────────────────
// F. analyzeRow
// ─────────────────────────────────────────────────────────────
function analyzeRow(row, rowNumber, groupMembers, usdRate) {
  const anomalies = [];
  const normalized = {};

  // a. Amount
  const { value: amountValue, anomalies: amtAnomalies } = normalizeAmount(row.amount);
  normalized.amount = amountValue;
  anomalies.push(...amtAnomalies);

  // b. Date
  const { value: dateValue, anomalies: dateAnomalies } = normalizeDate(row.date);
  normalized.date = dateValue;
  anomalies.push(...dateAnomalies);

  // c. Currency (default INR)
  let currency = (row.currency || '').trim().toUpperCase();
  if (!currency) {
    currency = 'INR';
    anomalies.push({ type: 'missing_currency', description: 'No currency specified — defaulting to INR' });
  }
  normalized.currency = currency;

  // d. Exchange rate
  let exchangeRate = 1;
  if (currency === 'USD') {
    exchangeRate = usdRate;
    anomalies.push({ type: 'usd_amount', description: `USD amount converted at ₹${usdRate}/USD` });
  }
  normalized.exchange_rate = exchangeRate;
  const amountInr = amountValue != null ? Math.round(amountValue * exchangeRate * 100) / 100 : null;
  normalized.amount_inr = amountInr;

  // e. paid_by
  const paidByRaw = (row.paid_by || '').trim();
  const paidByResolved = normalizeName(paidByRaw, groupMembers);
  if (paidByResolved.anomaly === 'name_mismatch') {
    anomalies.push({ type: 'name_mismatch', description: `paid_by: ${paidByResolved.anomalyDesc}` });
  } else if (paidByResolved.anomaly === 'unknown_participant') {
    anomalies.push({ type: 'unknown_payer', description: `paid_by: ${paidByResolved.anomalyDesc}` });
  }
  normalized.paid_by_user_id   = paidByResolved.user_id;
  normalized.paid_by_name      = paidByResolved.participant_name;

  // f. Settlement detection
  const isSettlement = detectSettlement(row.description);
  normalized.is_settlement = isSettlement;

  // g. Split type + participants
  const rawSplitType = (row.split_type || 'equal').trim().toLowerCase();
  let splitType = rawSplitType;
  normalized.description = (row.description || '').trim();

  // h. Conflict: split_type='equal' but split_details has numeric values → treat as 'share'
  const splitDetailsRaw = (row.split_details || '').trim();
  if (splitType === 'equal' && splitDetailsRaw && /\d/.test(splitDetailsRaw.replace(/%/g, ''))) {
    anomalies.push({
      type: 'conflicting_split_type',
      description: `split_type is "equal" but split_details contains numeric values "${splitDetailsRaw}". Treating as "share" split.`
    });
    splitType = 'share';
  }
  normalized.split_type = splitType;

  let participants = [];
  let proposedSplits = [];

  if (!isSettlement && amountInr != null) {
    const splitResult = parseSplitParticipants(
      row.split_with, splitDetailsRaw, splitType, groupMembers, amountInr, exchangeRate
    );
    anomalies.push(...splitResult.anomalies);
    participants    = splitResult.participants;
    proposedSplits  = splitResult.splits;

    // i. Post-departure member check
    if (dateValue) {
      participants.forEach(p => {
        if (p.user_id == null) return;
        const member = groupMembers.find(m => m.id === p.user_id);
        if (member?.left_at && dateValue > member.left_at) {
          anomalies.push({
            type: 'post_departure_member',
            description: `${member.name} left on ${member.left_at} but is in split for ${dateValue}. Policy: exclude and redistribute to active members on that date.`,
            user_id: member.id
          });
        }
      });
    }
  }

  normalized.participants = participants;

  // j. Determine proposedAction
  const types = new Set(anomalies.map(a => a.type));
  let proposedAction;

  if (isSettlement) {
    proposedAction = 'imported_as_settlement';
  } else if (types.has('zero_amount')) {
    proposedAction = 'skipped';
  } else if (types.has('invalid_amount') || types.has('invalid_date')) {
    proposedAction = 'skipped';
  } else if (types.has('conflicting_entries')) {
    proposedAction = 'pending_user_review';
  } else if (anomalies.length === 0) {
    proposedAction = 'imported';
  } else {
    // Minor anomalies that don't block import
    const MINOR = new Set(['whitespace_in_amount', 'comma_in_amount', 'excessive_decimal',
      'missing_currency', 'name_mismatch', 'unknown_participant', 'usd_amount',
      'ambiguous_date', 'post_departure_member', 'split_warning', 'conflicting_split_type']);
    const hasBlocker = [...types].some(t => !MINOR.has(t));
    proposedAction = hasBlocker ? 'skipped' : 'imported_with_flag';
  }

  return {
    rowNumber,
    original:       row,
    normalized,
    anomalies,
    proposedAction,
    proposedData: proposedAction !== 'skipped' && proposedAction !== 'pending_user_review' ? {
      description:      normalized.description,
      amount:           normalized.amount,
      currency:         normalized.currency,
      exchange_rate:    normalized.exchange_rate,
      amount_inr:       normalized.amount_inr,
      paid_by_user_id:  normalized.paid_by_user_id,
      split_type:       normalized.split_type,
      date:             normalized.date,
      participants,
      splits:           proposedSplits,
      is_settlement:    isSettlement
    } : null
  };
}

// ─────────────────────────────────────────────────────────────
// G. detectDuplicates
// ─────────────────────────────────────────────────────────────
function detectDuplicates(analyzedRows) {
  const seen = new Map(); // key → first rowNumber

  for (const row of analyzedRows) {
    const { normalized, proposedAction } = row;
    if (proposedAction === 'skipped') continue;

    const key = [
      (normalized.description || '').toLowerCase().trim(),
      normalized.amount,
      normalized.date,
      normalized.paid_by_user_id
    ].join('|');

    if (seen.has(key)) {
      const firstRow = seen.get(key);
      row.anomalies.push({
        type: 'duplicate_entry',
        description: `Exact duplicate of row ${firstRow} — skipping`
      });
      row.proposedAction = 'skipped';
    } else {
      seen.set(key, row.rowNumber);
    }
  }
}

// ─────────────────────────────────────────────────────────────
// H. detectConflicts
// ─────────────────────────────────────────────────────────────
function detectConflicts(analyzedRows) {
  for (let i = 0; i < analyzedRows.length; i++) {
    const ri = analyzedRows[i];
    if (ri.proposedAction === 'skipped') continue;
    const di = (ri.normalized.description || '').toLowerCase().trim();
    const dateI = ri.normalized.date;

    for (let j = i + 1; j < analyzedRows.length; j++) {
      const rj = analyzedRows[j];
      if (rj.proposedAction === 'skipped') continue;
      const dj = (rj.normalized.description || '').toLowerCase().trim();
      const dateJ = rj.normalized.date;

      // Same date, overlapping description, different amount or payer
      const sameDate = dateI && dateJ && dateI === dateJ;
      const descOverlap = di && dj && (di.includes(dj) || dj.includes(di));
      const different = ri.normalized.amount !== rj.normalized.amount ||
                        ri.normalized.paid_by_user_id !== rj.normalized.paid_by_user_id;

      if (sameDate && descOverlap && different) {
        const conflictNote = {
          type: 'conflicting_entries',
          description: `Same event logged with different amounts/payers. Row ${ri.rowNumber} and Row ${rj.rowNumber}. Manual review required.`
        };
        ri.anomalies.push(conflictNote);
        rj.anomalies.push(conflictNote);
        ri.proposedAction = 'pending_user_review';
        rj.proposedAction = 'pending_user_review';
        ri.proposedData = null;
        rj.proposedData = null;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────
// I. buildPreview
// ─────────────────────────────────────────────────────────────
async function buildPreview(csvBuffer, groupId, usdRate, userId, filename = 'upload.csv') {
  // 1. Parse CSV
  let rawRows;
  try {
    rawRows = parse(csvBuffer, {
      columns:           true,
      skip_empty_lines:  true,
      trim:              true,
      bom:               true,
    });
  } catch (err) {
    throw new Error(`CSV parse error: ${err.message}`);
  }

  // 2. Fetch all group members (past + present)
  const memberRows = await db('group_members as gm')
    .join('users as u', 'u.id', 'gm.user_id')
    .where('gm.group_id', groupId)
    .select('u.id', 'u.name', 'u.email', 'gm.joined_at', 'gm.left_at');

  // 3. analyzeRow for every CSV row
  const analyzedRows = rawRows.map((row, idx) =>
    analyzeRow(row, idx + 1, memberRows, usdRate)
  );

  // 4. detectDuplicates (mutates analyzedRows)
  detectDuplicates(analyzedRows);

  // 5. detectConflicts (mutates analyzedRows)
  detectConflicts(analyzedRows);

  // 6. Create import_session
  const [session] = await db('import_sessions')
    .insert({
      group_id:      groupId,
      imported_by:   userId,
      filename,
      status:        'reviewing',
      total_rows:    rawRows.length,
      usd_rate_used: usdRate,
      preview_data:  JSON.stringify(analyzedRows),
    })
    .returning(['id', 'group_id', 'filename', 'status', 'total_rows', 'usd_rate_used', 'created_at']);

  // 7. Bulk-insert anomalies
  const anomalyRows = [];
  for (const ar of analyzedRows) {
    for (const a of ar.anomalies) {
      anomalyRows.push({
        import_session_id: session.id,
        row_number:        ar.rowNumber,
        anomaly_type:      a.type,
        description:       a.description,
        proposed_action:   ar.proposedAction,
      });
    }
  }
  if (anomalyRows.length > 0) {
    await db('import_anomalies').insert(anomalyRows);
  }

  // 8. Build summary counts
  const counts = { imported: 0, imported_with_flag: 0, imported_as_settlement: 0, skipped: 0, pending_user_review: 0 };
  for (const ar of analyzedRows) {
    const k = ar.proposedAction;
    if (k in counts) counts[k]++;
  }

  return {
    session_id:    session.id,
    usd_rate_used: usdRate,
    summary: {
      total_rows:               rawRows.length,
      to_import:                counts.imported,
      to_import_with_flag:      counts.imported_with_flag,
      to_import_as_settlement:  counts.imported_as_settlement,
      to_skip:                  counts.skipped,
      pending_review:           counts.pending_user_review,
    },
    rows: analyzedRows,
  };
}

// ─────────────────────────────────────────────────────────────
// J. commitImport
// ─────────────────────────────────────────────────────────────
async function commitImport(sessionId, userDecisions, groupId, userId) {
  // 1. Fetch session — verify it belongs to this group and is 'reviewing'
  const session = await db('import_sessions')
    .where({ id: sessionId, group_id: groupId })
    .first();

  if (!session) {
    throw Object.assign(new Error('Import session not found'), { status: 404 });
  }
  if (session.status !== 'reviewing') {
    throw Object.assign(new Error(`Session is already "${session.status}"`), { status: 409 });
  }

  // 2. Re-use stored preview_data
  if (!session.preview_data) {
    throw Object.assign(new Error('No preview data found for this session'), { status: 400 });
  }
  const analyzedRows = JSON.parse(session.preview_data);

  // Build a decision map by rowNumber for O(1) lookup
  const decisionMap = {};
  for (const d of (userDecisions || [])) {
    decisionMap[d.row_number] = d;
  }

  // 3. Process each row
  let imported = 0, skipped = 0, flagged = 0, settlements = 0;
  const importReport = [];

  for (const ar of analyzedRows) {
    const decision = decisionMap[ar.rowNumber];
    const finalAction = decision?.action ?? ar.proposedAction;

    if (finalAction === 'skipped' || finalAction === 'pending_user_review') {
      skipped++;
      importReport.push({ rowNumber: ar.rowNumber, action: 'skipped', reason: finalAction });
      continue;
    }

    const pd = decision?.data ?? ar.proposedData;
    if (!pd) {
      skipped++;
      importReport.push({ rowNumber: ar.rowNumber, action: 'skipped', reason: 'no_proposed_data' });
      continue;
    }

    try {
      if (finalAction === 'imported_as_settlement') {
        // INSERT into settlements
        const [settlement] = await db('settlements')
          .insert({
            group_id:     groupId,
            from_user_id: pd.paid_by_user_id,
            to_user_id:   null, // settlements imported from CSV often don't have to_user_id
            amount:       pd.amount_inr ?? pd.amount,
            date:         pd.date,
            notes:        `Imported from CSV row ${ar.rowNumber}: ${pd.description}`,
            created_by:   userId,
          })
          .returning('id');
        settlements++;
        importReport.push({ rowNumber: ar.rowNumber, action: 'imported_as_settlement', settlement_id: settlement.id });
      } else {
        // INSERT expense + splits
        const result = await db.transaction(async (trx) => {
          const [expense] = await trx('expenses')
            .insert({
              group_id:            groupId,
              description:         pd.description,
              amount:              pd.amount,
              currency:            pd.currency,
              exchange_rate:       pd.exchange_rate,
              amount_inr:          pd.amount_inr,
              paid_by_user_id:     pd.paid_by_user_id,
              split_type:          pd.split_type,
              date:                pd.date,
              is_settlement:       false,
              notes:               `Imported from CSV row ${ar.rowNumber}`,
              created_by:          userId,
              import_session_id:   sessionId,
              csv_row_number:      ar.rowNumber,
            })
            .returning(['id', 'description', 'amount_inr', 'date']);

          const splitRows = pd.splits.map(s => ({
            expense_id:       expense.id,
            user_id:          s.user_id,
            participant_name: s.participant_name,
            share_amount:     s.share_amount,
            split_detail:     s.split_detail,
          }));
          if (splitRows.length > 0) {
            await trx('expense_splits').insert(splitRows);
          }
          return expense;
        });

        if (finalAction === 'imported_with_flag') flagged++;
        else imported++;
        importReport.push({ rowNumber: ar.rowNumber, action: finalAction, expense_id: result.id });
      }
    } catch (err) {
      skipped++;
      importReport.push({ rowNumber: ar.rowNumber, action: 'skipped', reason: `db_error: ${err.message}` });
    }
  }

  // 4. Update session status
  await db('import_sessions')
    .where({ id: sessionId })
    .update({
      status:         'completed',
      imported_rows:  imported + flagged,
      skipped_rows:   skipped,
      flagged_rows:   flagged,
      completed_at:   new Date().toISOString(),
    });

  // 5. Return summary
  return {
    session_id: sessionId,
    summary:    { imported, flagged, skipped, settlements, total: analyzedRows.length },
    import_report: importReport,
  };
}

module.exports = {
  // Pure helpers (exported for unit tests)
  normalizeAmount,
  normalizeDate,
  normalizeName,
  detectSettlement,
  parseSplitParticipants,
  analyzeRow,
  detectDuplicates,
  detectConflicts,
  // Async DB functions
  buildPreview,
  commitImport,
};
