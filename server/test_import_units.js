/**
 * Unit tests for importService pure helpers (no DB needed).
 */
const path = require('path');

// ── Mock DB and groupController ───────────────────────────────
const dbPath = path.resolve('./src/config/db.js');
require.cache[require.resolve(dbPath)] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { db: () => ({}), query: async () => [] }
};
const gcPath = path.resolve('./src/controllers/groupController.js');
require.cache[require.resolve(gcPath)] = {
  id: gcPath, filename: gcPath, loaded: true,
  exports: { getMembersOnDate: async () => [] }
};

const {
  normalizeAmount, normalizeDate, normalizeName,
  detectSettlement, detectDuplicates, detectConflicts
} = require('./src/services/importService');
console.log('importService loads OK\n');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('  ✅ ' + label); pass++; }
  else { console.log('  ❌ ' + label + ' — ' + String(detail)); fail++; }
}

const members = [
  { id: 1, name: 'Aisha', left_at: null },
  { id: 2, name: 'Rohan', left_at: null },
  { id: 3, name: 'Meera', left_at: '2026-03-31' },
];

// ─── normalizeAmount ──────────────────────────────────────────
console.log('─── normalizeAmount ───────────────────────────────────');

const a1 = normalizeAmount('  1450  ');
ok('A1 whitespace trimmed → 1450', a1.value === 1450, 'got ' + a1.value);
ok('A1 whitespace_in_amount flag', a1.anomalies.some(a => a.type === 'whitespace_in_amount'), JSON.stringify(a1.anomalies));

const a2 = normalizeAmount('1,200');
ok('A2 comma removed → 1200', a2.value === 1200, 'got ' + a2.value);
ok('A2 comma_in_amount flag', a2.anomalies.some(a => a.type === 'comma_in_amount'), JSON.stringify(a2.anomalies));

const a3 = normalizeAmount('899.995');
ok('A3 excessive decimal rounds → 900', a3.value === 900, 'got ' + a3.value);
ok('A3 excessive_decimal flag', a3.anomalies.some(a => a.type === 'excessive_decimal'), JSON.stringify(a3.anomalies));

const a4 = normalizeAmount('-30');
ok('A4 negative value kept → -30', a4.value === -30, 'got ' + a4.value);
ok('A4 negative_amount flag', a4.anomalies.some(a => a.type === 'negative_amount'), JSON.stringify(a4.anomalies));

const a5 = normalizeAmount('0');
ok('A5 zero_amount flag', a5.anomalies.some(a => a.type === 'zero_amount'), JSON.stringify(a5.anomalies));
ok('A5 value = 0', a5.value === 0, 'got ' + a5.value);

const a6 = normalizeAmount('abc');
ok('A6 invalid_amount → null', a6.value === null, 'got ' + a6.value);
ok('A6 invalid_amount flag', a6.anomalies.some(a => a.type === 'invalid_amount'), JSON.stringify(a6.anomalies));

const a7 = normalizeAmount('1,250.50');
ok('A7 comma + 2 decimals → 1250.50', a7.value === 1250.50, 'got ' + a7.value);
ok('A7 comma_in_amount flag', a7.anomalies.some(a => a.type === 'comma_in_amount'), JSON.stringify(a7.anomalies));

// ─── normalizeDate ────────────────────────────────────────────
console.log('\n─── normalizeDate ─────────────────────────────────────');

const d1 = normalizeDate('04/05/2026');
ok('D1 DD/MM/YYYY → 2026-05-04', d1.value === '2026-05-04', 'got ' + d1.value);
ok('D1 ambiguous_date flag', d1.anomalies.some(a => a.type === 'ambiguous_date'), JSON.stringify(d1.anomalies));

const d2 = normalizeDate('Mar 14');
ok('D2 "Mar 14" → 2026-03-14', d2.value === '2026-03-14', 'got ' + d2.value);
ok('D2 ambiguous_date flag', d2.anomalies.some(a => a.type === 'ambiguous_date'), JSON.stringify(d2.anomalies));

const d3 = normalizeDate('2026-06-14');
ok('D3 ISO date → no anomaly', d3.value === '2026-06-14' && d3.anomalies.length === 0, 'anom=' + d3.anomalies.length);

const d4 = normalizeDate('14 Mar 2026');
ok('D4 "14 Mar 2026" → 2026-03-14', d4.value === '2026-03-14', 'got ' + d4.value);
ok('D4 ambiguous_date flag', d4.anomalies.some(a => a.type === 'ambiguous_date'), JSON.stringify(d4.anomalies));

const d5 = normalizeDate('not-a-date');
ok('D5 invalid → null', d5.value === null, 'got ' + d5.value);
ok('D5 invalid_date flag', d5.anomalies.some(a => a.type === 'invalid_date'), JSON.stringify(d5.anomalies));

const d6 = normalizeDate('Mar 14 2026');
ok('D6 "Mar 14 2026" → 2026-03-14', d6.value === '2026-03-14', 'got ' + d6.value);

const d7 = normalizeDate('14 March 2026');
ok('D7 "14 March 2026" → 2026-03-14', d7.value === '2026-03-14', 'got ' + d7.value);

// ─── normalizeName ────────────────────────────────────────────
console.log('\n─── normalizeName ─────────────────────────────────────');

const n1 = normalizeName('Aisha', members);
ok('N1 exact match Aisha → id=1', n1.user_id === 1, 'got ' + n1.user_id);
ok('N1 no anomaly', n1.anomaly === null, 'got ' + n1.anomaly);

const n2 = normalizeName('rohan', members);
ok('N2 case-insensitive "rohan" → id=2', n2.user_id === 2, 'got ' + n2.user_id);
ok('N2 name_mismatch anomaly (case diff)', n2.anomaly === 'name_mismatch', 'got ' + n2.anomaly);

// Priya is NOT in members array → should be unknown_participant
const n3 = normalizeName('Priya S', members);
ok('N3 "Priya S" no match (Priya not in members) → null', n3.user_id === null, 'got ' + n3.user_id);
ok('N3 unknown_participant anomaly', n3.anomaly === 'unknown_participant', 'got ' + n3.anomaly);

const n4 = normalizeName("Dev's friend Kabir", members);
ok('N4 external participant → user_id null', n4.user_id === null, 'got ' + n4.user_id);
ok('N4 unknown_participant anomaly', n4.anomaly === 'unknown_participant', 'got ' + n4.anomaly);

// Prefix match: "Meera S" → member "Meera" is a prefix of "Meera S"
const n5 = normalizeName('Meera S', members);
ok('N5 "Meera S" prefix-matches Meera → id=3', n5.user_id === 3, 'got ' + n5.user_id);
ok('N5 name_mismatch anomaly', n5.anomaly === 'name_mismatch', 'got ' + n5.anomaly);

// The spec's n2 test with different shape — anomalies as object with .type
ok('N2-spec: n2.anomalies.type = name_mismatch', n2.anomaly === 'name_mismatch', 'got ' + n2.anomaly);

// ─── detectSettlement ─────────────────────────────────────────
console.log('\n─── detectSettlement ──────────────────────────────────');

ok('S1 "settled" → true', detectSettlement('Rohan settled with Aisha'), true);
ok('S2 "paid back" → true', detectSettlement('Rohan paid back Aisha'), true);
ok('S3 "transfer" → true', detectSettlement('Bank transfer to Aisha'), true);
ok('S4 normal expense → false', !detectSettlement('February rent'), true);
ok('S5 "settlement" → true', detectSettlement('Final settlement'), true);
ok('S6 "deposit share" → true', detectSettlement('deposit share for Feb'), true);
ok('S7 "Rohan paid Aisha" → true', detectSettlement('Rohan paid Aisha'), true);

// ─── detectDuplicates ─────────────────────────────────────────
console.log('\n─── detectDuplicates ──────────────────────────────────');

const dupRows = [
  { rowNumber: 1, normalized: { description: 'Rent', amount: 12000, date: '2026-02-01', paid_by_user_id: 1 }, anomalies: [], proposedAction: 'imported' },
  { rowNumber: 2, normalized: { description: 'Rent', amount: 12000, date: '2026-02-01', paid_by_user_id: 1 }, anomalies: [], proposedAction: 'imported' },
  { rowNumber: 3, normalized: { description: 'Pizza', amount: 800,  date: '2026-02-10', paid_by_user_id: 2 }, anomalies: [], proposedAction: 'imported' },
];
detectDuplicates(dupRows);
ok('Dup1 first row unchanged → imported', dupRows[0].proposedAction === 'imported', 'got ' + dupRows[0].proposedAction);
ok('Dup2 second row → skipped', dupRows[1].proposedAction === 'skipped', 'got ' + dupRows[1].proposedAction);
ok('Dup2 has duplicate_entry anomaly', dupRows[1].anomalies.some(a => a.type === 'duplicate_entry'), JSON.stringify(dupRows[1].anomalies));
ok('Row3 not affected', dupRows[2].proposedAction === 'imported', 'got ' + dupRows[2].proposedAction);

// ─── detectConflicts ──────────────────────────────────────────
console.log('\n─── detectConflicts ───────────────────────────────────');

const conflictRows = [
  { rowNumber: 1, normalized: { description: 'Monthly rent', amount: 12000, date: '2026-03-01', paid_by_user_id: 1 }, anomalies: [], proposedAction: 'imported', proposedData: {} },
  { rowNumber: 2, normalized: { description: 'Rent',         amount: 15000, date: '2026-03-01', paid_by_user_id: 2 }, anomalies: [], proposedAction: 'imported', proposedData: {} },
  { rowNumber: 3, normalized: { description: 'Groceries',    amount: 500,   date: '2026-03-05', paid_by_user_id: 1 }, anomalies: [], proposedAction: 'imported', proposedData: {} },
];
detectConflicts(conflictRows);
ok('Conflict1 row1 → pending_user_review', conflictRows[0].proposedAction === 'pending_user_review', 'got ' + conflictRows[0].proposedAction);
ok('Conflict2 row2 → pending_user_review', conflictRows[1].proposedAction === 'pending_user_review', 'got ' + conflictRows[1].proposedAction);
ok('Conflict: conflicting_entries anomaly on row1', conflictRows[0].anomalies.some(a => a.type === 'conflicting_entries'), JSON.stringify(conflictRows[0].anomalies));
ok('Row3 unaffected', conflictRows[2].proposedAction === 'imported', 'got ' + conflictRows[2].proposedAction);

// ─── Summary ──────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(50));
console.log('  ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('═'.repeat(50));
if (fail > 0) process.exit(1);
