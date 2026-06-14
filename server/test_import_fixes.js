/**
 * Targeted spot-check tests for all five fixes in importService.js.
 * Runs without a DB connection.
 */
const path = require('path');

// ── Mock DB + groupController ─────────────────────────────────
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
  normalizeAmount, analyzeRow, detectConflicts, detectDuplicates,
} = require('./src/services/importService');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { console.log('  ✅ ' + label); pass++; }
  else { console.log('  ❌ ' + label + (detail ? ' — ' + String(detail) : '')); fail++; }
}

const members = [
  { id: 1, name: 'Aisha',  joined_at: '2026-01-01', left_at: null },
  { id: 2, name: 'Rohan',  joined_at: '2026-01-01', left_at: null },
  { id: 3, name: 'Meera',  joined_at: '2026-01-01', left_at: '2026-03-31' },
  { id: 4, name: 'Priya',  joined_at: '2026-02-01', left_at: null },
  { id: 5, name: 'Sam',    joined_at: '2026-04-08', left_at: null },
];

// ─── FIX 1: percentage_sum_not_100 → imported_with_flag ───────
console.log('\n─── FIX 1: percentage_sum_not_100 must be imported_with_flag ─');
const row_pct = {
  date: '2026-02-14', description: 'Pizza Friday', amount: '1500',
  currency: 'INR', paid_by: 'Aisha', split_type: 'percentage',
  split_with: '', split_details: 'Aisha 60%;Rohan 50%'   // sums to 110%
};
const r1 = analyzeRow(row_pct, 14, members, 83.5);
ok('FIX1 percentage_sum_not_100 present', r1.anomalies.some(a => a.type === 'percentage_sum_not_100'), JSON.stringify(r1.anomalies.map(a=>a.type)));
ok('FIX1 proposedAction = imported_with_flag (not skipped)', r1.proposedAction === 'imported_with_flag', 'got ' + r1.proposedAction);

// ─── FIX 1: negative_amount → imported_with_flag ──────────────
console.log('\n─── FIX 1b: negative_amount → imported_with_flag ─────────────');
const row_neg = {
  date: '2026-03-01', description: 'Refund from Amazon', amount: '-300',
  currency: 'INR', paid_by: 'Aisha', split_type: 'equal',
  split_with: 'Aisha;Rohan', split_details: ''
};
const r1b = analyzeRow(row_neg, 99, members, 83.5);
ok('FIX1b negative_amount flag present', r1b.anomalies.some(a => a.type === 'negative_amount'), JSON.stringify(r1b.anomalies.map(a=>a.type)));
ok('FIX1b proposedAction = imported_with_flag', r1b.proposedAction === 'imported_with_flag', 'got ' + r1b.proposedAction);

// ─── FIX 2: blank paid_by → missing_paid_by → skipped ─────────
console.log('\n─── FIX 2: blank paid_by → missing_paid_by (skip) ───────────');
const row_blank_payer = {
  date: '2026-03-01', description: 'Anonymous expense', amount: '500',
  currency: 'INR', paid_by: '', split_type: 'equal',
  split_with: 'Aisha;Rohan', split_details: ''
};
const r2a = analyzeRow(row_blank_payer, 99, members, 83.5);
ok('FIX2a missing_paid_by anomaly', r2a.anomalies.some(a => a.type === 'missing_paid_by'), JSON.stringify(r2a.anomalies.map(a=>a.type)));
ok('FIX2a proposedAction = skipped', r2a.proposedAction === 'skipped', 'got ' + r2a.proposedAction);

// ─── FIX 2: named external payer → unknown_payer → imported_with_flag ─
console.log('\n─── FIX 2b: named external payer → imported_with_flag ────────');
const row_ext_payer = {
  date: '2026-04-10', description: 'Goa villa', amount: '200',
  currency: 'USD', paid_by: 'Dev', split_type: 'equal',
  split_with: 'Aisha;Rohan;Dev', split_details: ''
};
const r2b = analyzeRow(row_ext_payer, 19, members, 83.5);
ok('FIX2b unknown_payer anomaly present', r2b.anomalies.some(a => a.type === 'unknown_payer'), JSON.stringify(r2b.anomalies.map(a=>a.type)));
ok('FIX2b paid_by_user_id = null', r2b.normalized.paid_by_user_id === null, 'got ' + r2b.normalized.paid_by_user_id);
ok('FIX2b proposedAction = imported_with_flag', r2b.proposedAction === 'imported_with_flag', 'got ' + r2b.proposedAction);

// ─── FIX 3: keyword-overlap conflict detection ─────────────────
console.log('\n─── FIX 3: keyword overlap catches "Dinner at Thalassa" vs "Thalassa dinner" ─');
const conflictRows = [
  { rowNumber: 23, normalized: { description: 'Dinner at Thalassa', amount: 4200, date: '2026-04-15', paid_by_user_id: 1 }, anomalies: [], proposedAction: 'imported', proposedData: {} },
  { rowNumber: 24, normalized: { description: 'Thalassa dinner',    amount: 3800, date: '2026-04-15', paid_by_user_id: 2 }, anomalies: [], proposedAction: 'imported', proposedData: {} },
  { rowNumber: 25, normalized: { description: 'Groceries',          amount:  500, date: '2026-04-16', paid_by_user_id: 1 }, anomalies: [], proposedAction: 'imported', proposedData: {} },
];
detectConflicts(conflictRows);
ok('FIX3 row23 → pending_user_review', conflictRows[0].proposedAction === 'pending_user_review', 'got ' + conflictRows[0].proposedAction);
ok('FIX3 row24 → pending_user_review', conflictRows[1].proposedAction === 'pending_user_review', 'got ' + conflictRows[1].proposedAction);
ok('FIX3 row25 (Groceries) unaffected', conflictRows[2].proposedAction === 'imported', 'got ' + conflictRows[2].proposedAction);
ok('FIX3 conflicting_entries anomaly on row23', conflictRows[0].anomalies.some(a => a.type === 'conflicting_entries'), JSON.stringify(conflictRows[0].anomalies));

// ─── FIX 4: post-departure redistribution ─────────────────────
console.log('\n─── FIX 4: post-departure removes Meera, redistributes to 3 ─');
// April 2 Groceries: Meera left 2026-03-31, expense on 2026-04-02
const row_post_dep = {
  date: '2026-04-02', description: 'April Groceries', amount: '2640',
  currency: 'INR', paid_by: 'Aisha', split_type: 'equal',
  split_with: 'Aisha;Rohan;Meera;Priya', split_details: ''
};
const r4 = analyzeRow(row_post_dep, 35, members, 83.5);
ok('FIX4 post_departure_member anomaly for Meera', r4.anomalies.some(a => a.type === 'post_departure_member'), JSON.stringify(r4.anomalies.map(a=>a.type)));
ok('FIX4 proposedAction = imported_with_flag', r4.proposedAction === 'imported_with_flag', 'got ' + r4.proposedAction);
ok('FIX4 proposedData.splits has 3 participants (Meera excluded)', r4.proposedData?.splits?.length === 3, 'got ' + r4.proposedData?.splits?.length);
const splitAmounts = r4.proposedData?.splits?.map(s => s.share_amount);
ok('FIX4 each share = 880 (2640/3)', splitAmounts?.every(a => a === 880), 'got ' + JSON.stringify(splitAmounts));
ok('FIX4 Meera not in splits', !r4.proposedData?.splits?.some(s => s.participant_name === 'Meera'), 'Meera still present');

// ─── FIX 5: whitespace in amount detected (trim:false) ─────────
console.log('\n─── FIX 5: whitespace_in_amount detected when amount has spaces ─');
// Simulate csv-parse with trim:false — amount field has leading/trailing space
const row_ws = {
  date: '2026-03-01', description: 'Electricity Mar', amount: ' 1450 ',
  currency: 'INR', paid_by: 'Aisha', split_type: 'equal',
  split_with: 'Aisha;Rohan', split_details: ''
};
const r5 = analyzeRow(row_ws, 28, members, 83.5);
ok('FIX5 whitespace_in_amount anomaly detected', r5.anomalies.some(a => a.type === 'whitespace_in_amount'), JSON.stringify(r5.anomalies.map(a=>a.type)));
ok('FIX5 normalized amount = 1450', r5.normalized.amount === 1450, 'got ' + r5.normalized.amount);
ok('FIX5 proposedAction = imported_with_flag', r5.proposedAction === 'imported_with_flag', 'got ' + r5.proposedAction);

// ─── Summary ──────────────────────────────────────────────────
console.log('');
console.log('═'.repeat(54));
console.log('  ' + pass + ' passed, ' + fail + ' failed, ' + (pass + fail) + ' total');
console.log('═'.repeat(54));
if (fail > 0) process.exit(1);
