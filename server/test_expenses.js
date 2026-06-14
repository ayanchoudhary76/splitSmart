/**
 * EXPENSES INTEGRATION TEST — MOCK DB
 *
 * Real code exercised: routing, JWT auth, validation, calculateSplits,
 *   transaction-based insert, listExpenses pagination, deleteExpense auth.
 * MOCKED: Knex DB calls.
 */

const http = require('http');
const path = require('path');

// ── In-memory stores ──────────────────────────────────────────
const tables = {
  users: [], groups: [], group_members: [],
  expenses: [], expense_splits: []
};
const counters = { users: 0, groups: 0, group_members: 0, expenses: 0, expense_splits: 0 };

function stripAlias(c) { return c.includes('.') ? c.split('.').pop() : c; }

function createQueryBuilder(tableName) {
  const baseTable = tableName.includes(' as ') ? tableName.split(' as ')[0] : tableName;
  const state = {
    filters: [], joinDefs: [], leftJoins: [],
    selectCols: null, orderBys: [],
    countExpr: null, limitVal: null, offsetVal: null,
    _insertData: null, _pendingInsert: false
  };

  function getRows() { return tables[baseTable] || []; }
  function applyFilters(rows) { return rows.filter(row => state.filters.every(f => f.apply(row))); }

  const builder = {
    where(...args) {
      if (args.length === 1 && typeof args[0] === 'object') {
        const obj = args[0];
        // Support aliased keys like {'e.group_id': 1}
        state.filters.push({
          apply: r => Object.entries(obj).every(([k, v]) => {
            const key = stripAlias(k);
            return String(r[key]) === String(v);
          })
        });
      } else if (args.length === 2) {
        const col = stripAlias(args[0]); const val = args[1];
        state.filters.push({ apply: r => String(r[col]) === String(val) });
      } else if (args.length === 3) {
        const col = stripAlias(args[0]); const op = args[1]; const val = args[2];
        state.filters.push({ apply: r => { const rv = r[col]; if (rv == null) return false; if (op === '<=') return rv <= val; if (op === '>=') return rv >= val; if (op === '<') return rv < val; if (op === '>') return rv > val; return String(rv) === String(val); } });
      }
      return builder;
    },
    whereRaw(sql, params) {
      if (sql.includes('LOWER')) { const e = params[0].toLowerCase(); state.filters.push({ apply: r => (r.email || '').toLowerCase() === e }); }
      return builder;
    },
    whereNull(col) { const c = stripAlias(col); state.filters.push({ apply: r => r[c] === null || r[c] === undefined }); return builder; },
    whereNotNull(col) { const c = stripAlias(col); state.filters.push({ apply: r => r[c] !== null && r[c] !== undefined }); return builder; },
    whereNot(obj) { state.filters.push({ apply: r => Object.entries(obj).some(([k, v]) => String(r[k]) !== String(v)) }); return builder; },
    andWhere(fn) {
      const clauses = [];
      const sub = {
        whereNull(col) { const c = stripAlias(col); clauses.push({ apply: r => r[c] == null }); return sub; },
        orWhere(...args) {
          if (args.length === 2) { const c = stripAlias(args[0]); clauses.push({ apply: r => r[c] > args[1] }); }
          else if (args.length === 3) { const c = stripAlias(args[0]); const op = args[1]; const val = args[2]; clauses.push({ apply: r => { const rv = r[c]; if (rv == null) return false; if (op === '>') return rv > val; if (op === '<') return rv < val; return false; } }); }
          return sub;
        }
      };
      fn.call(sub);
      state.filters.push({ apply: r => clauses.some(cl => cl.apply(r)) });
      return builder;
    },
    join(te, c1, c2) { state.joinDefs.push({ table: te, leftCol: c1, rightCol: c2, type: 'inner' }); return builder; },
    leftJoin(te, c1, c2) { state.joinDefs.push({ table: te, leftCol: c1, rightCol: c2, type: 'left' }); return builder; },
    select(...cols) { state.selectCols = cols.flat(); return builder; },
    orderBy(col, dir) { state.orderBys.push({ col, dir: dir || 'asc' }); return builder; },
    limit(n) { state.limitVal = n; return builder; },
    offset(n) { state.offsetVal = n; return builder; },
    count(expr) { state.countExpr = expr; return builder; },

    first() {
      let rows = applyFilters(getRows());
      if (state.countExpr) {
        const key = state.countExpr.includes(' as ') ? state.countExpr.split(' as ')[1].trim() : 'count';
        return Promise.resolve({ [key]: rows.length });
      }
      return Promise.resolve(rows[0] || null);
    },
    insert(data) {
      // handle array (bulk) or single object
      state._insertData = data;
      state._pendingInsert = true;
      return builder;
    },
    update(data) { const rows = applyFilters(getRows()); for (const r of rows) Object.assign(r, data); return Promise.resolve(rows.length); },
    del() { const rows = applyFilters(getRows()); const ids = new Set(rows.map(r => r.id)); tables[baseTable] = tables[baseTable].filter(r => !ids.has(r.id)); return Promise.resolve(rows.length); },

    returning(cols) {
      state._pendingInsert = false;
      const dataArr = Array.isArray(state._insertData) ? state._insertData : [state._insertData];
      const results = dataArr.map(data => {
        const id = ++counters[baseTable];
        const row = { id, ...data, created_at: new Date().toISOString() };
        tables[baseTable].push(row);
        const p = {}; for (const c of cols) p[c] = row[c];
        return p;
      });
      return Promise.resolve(results);
    },

    then(resolve, reject) {
      try {
        if (state._pendingInsert) {
          const dataArr = Array.isArray(state._insertData) ? state._insertData : [state._insertData];
          const ids = dataArr.map(data => {
            const id = ++counters[baseTable];
            tables[baseTable].push({ id, ...data, created_at: new Date().toISOString() });
            return id;
          });
          state._pendingInsert = false;
          return resolve(ids);
        }

        let rows = applyFilters(getRows());

        // Apply joins
        for (const jd of state.joinDefs) {
          const jt = jd.table.includes(' as ') ? jd.table.split(' as ')[0] : jd.table;
          const lc = stripAlias(jd.leftCol); const rc = stripAlias(jd.rightCol);
          if (jd.type === 'left') {
            rows = rows.map(row => {
              const match = (tables[jt] || []).find(jr => String(jr[rc]) === String(row[lc]) || String(jr[lc]) === String(row[rc]));
              const merged = { ...row };
              if (match) { for (const [k, v] of Object.entries(match)) { if (k === 'name') merged['_joined_name_' + jt] = v; else if (!(k in merged)) merged[k] = v; } }
              return merged;
            });
          } else {
            rows = rows.flatMap(row => {
              const matches = (tables[jt] || []).filter(jr => String(jr[rc]) === String(row[lc]) || String(jr[lc]) === String(row[rc]));
              return matches.length ? matches.map(m => { const merged = { ...row }; for (const [k, v] of Object.entries(m)) { if (!(k in merged)) merged[k] = v; } return merged; }) : [row];
            });
          }
        }

        // Apply select with alias handling
        if (state.selectCols) {
          rows = rows.map(r => {
            const o = {};
            for (const col of state.selectCols) {
              if (col.includes(' as ')) {
                const parts = col.split(' as ').map(s => s.trim());
                const srcKey = stripAlias(parts[0]);
                const alias = parts[1];
                // Handle 'u.name as paid_by_name' — need to get the joined user's name
                if (parts[0].includes('u.name') || parts[0].includes('u.email')) {
                  // Look through joined name fields
                  const jt = parts[0].split('.')[0]; // table alias like 'u'
                  // Find which joined table alias 'u' refers to — it's 'users'
                  const joinedTable = state.joinDefs.find(jd => jd.table.split(' as ')[1] === jt)?.table.split(' as ')[0];
                  const key = joinedTable ? '_joined_name_' + joinedTable : srcKey;
                  o[alias] = r[key] ?? r[srcKey] ?? null;
                } else {
                  o[alias] = r[srcKey] ?? null;
                }
              } else {
                const key = stripAlias(col);
                o[key] = r[key];
              }
            }
            return o;
          });
        }

        // Apply orderBy (multiple)
        for (const ob of state.orderBys) {
          const c = stripAlias(ob.col);
          rows.sort((a, b) => { const av = a[c], bv = b[c]; const cmp = av < bv ? -1 : av > bv ? 1 : 0; return ob.dir === 'desc' ? -cmp : cmp; });
        }

        // Apply offset + limit
        if (state.offsetVal != null) rows = rows.slice(state.offsetVal);
        if (state.limitVal != null) rows = rows.slice(0, state.limitVal);

        resolve(rows);
      } catch (e) { (reject || (() => {}))(e); }
    }
  };
  return builder;
}

function mockDb(t) { return createQueryBuilder(t); }
mockDb.transaction = async fn => fn(t => createQueryBuilder(t));
mockDb.raw = async () => ({ rows: [] });

const dbModulePath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbModulePath)] = {
  id: dbModulePath, filename: dbModulePath, loaded: true,
  exports: { db: mockDb, query: async () => [] }
};

process.env.JWT_SECRET = 'test-expenses';
process.env.PORT = '0';
process.env.CLIENT_URL = 'http://localhost:5173';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const routes = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');

const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', routes);
app.use(errorHandler);

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port, path: urlPath, method, headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const req = http.request(opts, res => { let c = ''; res.on('data', d => c += d); res.on('end', () => { let j; try { j = JSON.parse(c); } catch { j = c; } resolve({ status: res.statusCode, body: j }); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`\n🧪 Expenses integration test on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) {
    if (cond) { console.log(`  ✅ ${label}`); passed++; }
    else { console.log(`  ❌ ${label} — ${detail}`); failed++; }
  }

  // ── Setup ──────────────────────────────────────────────────
  console.log('SETUP — Register users + create group + add members');
  const rA = await request(port, 'POST', '/api/auth/register', { name: 'Aisha', email: 'aisha@test.com', password: 'password123' });
  const rR = await request(port, 'POST', '/api/auth/register', { name: 'Rohan', email: 'rohan@test.com', password: 'password123' });
  const rP = await request(port, 'POST', '/api/auth/register', { name: 'Priya', email: 'priya@test.com', password: 'password123' });
  const rM = await request(port, 'POST', '/api/auth/register', { name: 'Meera', email: 'meera@test.com', password: 'password123' });

  const aishaToken = rA.body.token;
  const rohanToken = rR.body.token;
  const aishaId = rA.body.user.id;
  const rohanId = rR.body.user.id;
  const priyaId = rP.body.user.id;
  const meeraId = rM.body.user.id;

  const rG = await request(port, 'POST', '/api/groups', { name: 'Flat 4B' }, { Authorization: `Bearer ${aishaToken}` });
  const groupId = rG.body.group.id;
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'rohan@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'priya@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'meera@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  console.log(`  groupId=${groupId}, users: Aisha=${aishaId}, Rohan=${rohanId}, Priya=${priyaId}, Meera=${meeraId}\n`);

  // ── Test A: Equal split — February rent ────────────────────
  console.log('TEST A — POST /api/groups/:id/expenses (equal split ₹48,000)');
  const rExpA = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'February rent',
    amount: 48000,
    currency: 'INR',
    paid_by_user_id: aishaId,
    split_type: 'equal',
    date: '2026-02-01',
    participants: [
      { user_id: aishaId, participant_name: 'Aisha' },
      { user_id: rohanId, participant_name: 'Rohan' }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rExpA.body, null, 2));
  ok('Status 201', rExpA.status === 201, `got ${rExpA.status}`);
  ok('expense.description = February rent', rExpA.body.expense?.description === 'February rent', `got ${rExpA.body.expense?.description}`);
  ok('expense.amount_inr = 48000', rExpA.body.expense?.amount_inr === 48000, `got ${rExpA.body.expense?.amount_inr}`);
  ok('2 splits returned', rExpA.body.splits?.length === 2, `got ${rExpA.body.splits?.length}`);
  ok('Each split = 24000', rExpA.body.splits?.every(s => s.share_amount === 24000), `got ${rExpA.body.splits?.map(s=>s.share_amount)}`);
  ok('warnings empty', rExpA.body.warnings?.length === 0, `got ${rExpA.body.warnings}`);
  const expenseAId = rExpA.body.expense?.id;
  console.log('');

  // ── Test B: Percentage split summing to 110% (key test) ────
  console.log('TEST B — POST expenses (percentage 110% — warn, not reject)');
  const rExpB = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'Pizza Friday',
    amount: 1440,
    currency: 'INR',
    paid_by_user_id: aishaId,
    split_type: 'percentage',
    date: '2026-02-28',
    participants: [
      { user_id: aishaId, participant_name: 'Aisha', percentage: 30 },
      { user_id: rohanId, participant_name: 'Rohan', percentage: 30 },
      { user_id: priyaId, participant_name: 'Priya', percentage: 30 },
      { user_id: meeraId, participant_name: 'Meera', percentage: 20 }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rExpB.body, null, 2));
  ok('Status 201 (not rejected)', rExpB.status === 201, `got ${rExpB.status}`);
  ok('warnings.length > 0', rExpB.body.warnings?.length > 0, `got ${rExpB.body.warnings}`);
  ok('warning mentions 110%', rExpB.body.warnings?.[0]?.includes('110%'), `got ${rExpB.body.warnings?.[0]}`);
  ok('4 splits inserted', rExpB.body.splits?.length === 4, `got ${rExpB.body.splits?.length}`);
  console.log('');

  // ── Test C: Share split ────────────────────────────────────
  console.log('TEST C — POST expenses (share split ₹3,600)');
  const rExpC = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'Scooter rentals',
    amount: 3600,
    currency: 'INR',
    paid_by_user_id: rohanId,
    split_type: 'share',
    date: '2026-03-10',
    participants: [
      { user_id: aishaId, participant_name: 'Aisha', shares: 1 },
      { user_id: rohanId, participant_name: 'Rohan', shares: 2 },
      { user_id: priyaId, participant_name: 'Priya', shares: 1 }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 201', rExpC.status === 201, `got ${rExpC.status}`);
  const rohanSplit = rExpC.body.splits?.find(s => s.participant_name === 'Rohan');
  // participants: Aisha=1, Rohan=2, Priya=1 → total 4 shares
  // Rohan = 2/4 × 3600 = 1800 (not 1200; that was T3 which had 6 total)
  ok('Rohan gets double share (1800)', rohanSplit?.share_amount === 1800, `got ${rohanSplit?.share_amount}`);
  ok('Shares sum to 3600', rExpC.body.splits?.reduce((a, s) => a + s.share_amount, 0) === 3600, `got ${rExpC.body.splits?.reduce((a,s)=>a+s.share_amount,0)}`);
  console.log('');

  // ── Test D: USD expense with exchange rate ─────────────────
  console.log('TEST D — POST expenses (USD → INR via exchange_rate)');
  const rExpD = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'AirBnB (USD)',
    amount: 500,
    currency: 'USD',
    exchange_rate: 83.5,
    paid_by_user_id: aishaId,
    split_type: 'equal',
    date: '2026-03-15',
    participants: [
      { user_id: aishaId, participant_name: 'Aisha' },
      { user_id: rohanId, participant_name: 'Rohan' }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 201', rExpD.status === 201, `got ${rExpD.status}`);
  ok('amount_inr = 41750', rExpD.body.expense?.amount_inr === 41750, `got ${rExpD.body.expense?.amount_inr}`);
  ok('Each split = 20875', rExpD.body.splits?.every(s => s.share_amount === 20875), `got ${rExpD.body.splits?.map(s=>s.share_amount)}`);
  console.log('');

  // ── Test E: Unequal split with external participant ────────
  console.log('TEST E — POST expenses (unequal, null user_id for external)');
  const rExpE = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'Birthday cake',
    amount: 1500,
    currency: 'INR',
    paid_by_user_id: null,
    split_type: 'unequal',
    date: '2026-03-20',
    participants: [
      { user_id: rohanId, participant_name: 'Rohan', amount: 700 },
      { user_id: priyaId, participant_name: 'Priya', amount: 400 },
      { user_id: null, participant_name: "Dev's friend Kabir", amount: 400 }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 201', rExpE.status === 201, `got ${rExpE.status}`);
  ok('No warnings (sum = 1500)', rExpE.body.warnings?.length === 0, `got ${rExpE.body.warnings}`);
  const kabir = rExpE.body.splits?.find(s => s.participant_name === "Dev's friend Kabir");
  ok('External participant (null user_id)', kabir?.user_id == null, `got ${kabir?.user_id}`);
  console.log('');

  // ── Test F: Validation errors ──────────────────────────────
  console.log('TEST F — Validation errors');
  const rF1 = await request(port, 'POST', `/api/groups/${groupId}/expenses`, { amount: 1000 }, { Authorization: `Bearer ${aishaToken}` });
  ok('Missing fields → 400', rF1.status === 400, `got ${rF1.status}`);

  const rF2 = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'Test', amount: 1000, currency: 'INR',
    split_type: 'invalid_type', date: '2026-01-01',
    participants: [{ user_id: 1, participant_name: 'X' }]
  }, { Authorization: `Bearer ${aishaToken}` });
  ok('Invalid split_type → 400', rF2.status === 400, `got ${rF2.status}`);
  console.log('');

  // ── Test G: List expenses (paginated) ─────────────────────
  console.log('TEST G — GET /api/groups/:id/expenses');
  const rList = await request(port, 'GET', `/api/groups/${groupId}/expenses`, null, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 200', rList.status === 200, `got ${rList.status}`);
  ok('expenses is array', Array.isArray(rList.body.expenses), `got type ${typeof rList.body.expenses}`);
  ok('total >= 5', rList.body.total >= 5, `got ${rList.body.total}`);
  ok('page = 1', rList.body.page === 1, `got ${rList.body.page}`);
  ok('limit = 20', rList.body.limit === 20, `got ${rList.body.limit}`);
  console.log('');

  // ── Test H: Get single expense ─────────────────────────────
  console.log('TEST H — GET /api/groups/:id/expenses/:expenseId');
  const rGet = await request(port, 'GET', `/api/groups/${groupId}/expenses/${expenseAId}`, null, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 200', rGet.status === 200, `got ${rGet.status}`);
  ok('Has expense', rGet.body.expense?.id === expenseAId, `got ${rGet.body.expense?.id}`);
  ok('Has splits', Array.isArray(rGet.body.splits), `got ${typeof rGet.body.splits}`);
  console.log('');

  // ── Test I: Delete expense auth checks ────────────────────
  console.log('TEST I — DELETE /api/groups/:id/expenses/:expenseId');
  // Rohan (non-admin, not creator) can't delete
  const rDel1 = await request(port, 'DELETE', `/api/groups/${groupId}/expenses/${expenseAId}`, null, { Authorization: `Bearer ${rohanToken}` });
  ok('Non-admin non-creator → 403', rDel1.status === 403, `got ${rDel1.status}`);

  // Aisha (creator + admin) can delete
  const rDel2 = await request(port, 'DELETE', `/api/groups/${groupId}/expenses/${expenseAId}`, null, { Authorization: `Bearer ${aishaToken}` });
  ok('Creator/admin → 200', rDel2.status === 200, `got ${rDel2.status}`);
  ok('Message = Expense deleted', rDel2.body.message === 'Expense deleted', `got ${rDel2.body.message}`);
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: routing, JWT, validation, calculateSplits,');
  console.log('   bulk inserts, pagination, deleteExpense auth checks.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
