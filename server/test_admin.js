/**
 * ADMIN FEATURES TEST — MOCK DB
 *
 * Tests: admin_user_id on createGroup, removeMember admin rules,
 *        transferAdmin, deleteGroup, and the admin lifecycle flow.
 */

const http = require('http');
const path = require('path');

// ── In-memory stores ──────────────────────────────────────────
const tables = { users: [], groups: [], group_members: [] };
const counters = { users: 0, groups: 0, group_members: 0 };

function stripAlias(c) { return c.includes('.') ? c.split('.').pop() : c; }

function createQueryBuilder(tableName) {
  const baseTable = tableName.includes(' as ') ? tableName.split(' as ')[0] : tableName;
  const state = { filters: [], joinDefs: [], selectCols: null, orderCol: null, orderDir: 'asc', countExpr: null, _insertData: null, _pendingInsert: false };

  function getRows() { return tables[baseTable] || []; }
  function applyFilters(rows) { return rows.filter(row => state.filters.every(f => f.apply(row))); }

  const builder = {
    where(...args) {
      if (args.length === 1 && typeof args[0] === 'object') {
        const obj = args[0];
        state.filters.push({ apply: r => Object.entries(obj).every(([k, v]) => String(r[k]) === String(v)) });
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
    whereNot(obj) {
      state.filters.push({ apply: r => Object.entries(obj).some(([k, v]) => String(r[k]) !== String(v)) });
      return builder;
    },
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
    join(te, c1, c2) { state.joinDefs.push({ table: te, leftCol: c1, rightCol: c2 }); return builder; },
    select(...cols) { state.selectCols = cols.flat(); return builder; },
    orderBy(col, dir) { state.orderCol = col; state.orderDir = dir || 'asc'; return builder; },
    count(expr) { state.countExpr = expr; return builder; },
    first() {
      const rows = applyFilters(getRows());
      if (state.countExpr) { const key = state.countExpr.includes(' as ') ? state.countExpr.split(' as ')[1].trim() : 'count'; return Promise.resolve({ [key]: rows.length }); }
      return Promise.resolve(rows[0] || null);
    },
    insert(data) { state._insertData = data; state._pendingInsert = true; return builder; },
    update(data) { const rows = applyFilters(getRows()); for (const r of rows) Object.assign(r, data); return Promise.resolve(rows.length); },
    del() { const rows = applyFilters(getRows()); const ids = new Set(rows.map(r => r.id)); tables[baseTable] = tables[baseTable].filter(r => !ids.has(r.id)); return Promise.resolve(rows.length); },
    returning(cols) {
      state._pendingInsert = false;
      const id = ++counters[baseTable];
      const row = { id, ...state._insertData, created_at: new Date().toISOString() };
      tables[baseTable].push(row);
      const p = {}; for (const c of cols) p[c] = row[c];
      return Promise.resolve([p]);
    },
    then(resolve, reject) {
      try {
        if (state._pendingInsert) {
          const id = ++counters[baseTable];
          tables[baseTable].push({ id, ...state._insertData, created_at: new Date().toISOString() });
          state._pendingInsert = false;
          return resolve([id]);
        }
        let rows = applyFilters(getRows());
        if (state.joinDefs.length > 0) {
          rows = rows.map(row => {
            let m = { ...row };
            for (const jd of state.joinDefs) {
              const jt = jd.table.includes(' as ') ? jd.table.split(' as ')[0] : jd.table;
              const lc = stripAlias(jd.leftCol); const rc = stripAlias(jd.rightCol);
              const match = (tables[jt] || []).find(jr => String(jr[rc]) === String(m[lc]) || String(jr[lc]) === String(m[rc]));
              if (match) { for (const [k, v] of Object.entries(match)) { if (k === 'name' || k === 'email') m[k] = v; else if (!(k in m)) m[k] = v; } }
            }
            return m;
          });
        }
        if (state.selectCols) {
          rows = rows.map(r => { const o = {}; for (const col of state.selectCols) { if (col.includes(' as ')) { const p = col.split(' as ').map(s => s.trim()); o[p[1]] = r[stripAlias(p[0])]; } else { const k = stripAlias(col); o[k] = r[k]; } } return o; });
        }
        if (state.orderCol) { const c = stripAlias(state.orderCol); rows.sort((a, b) => { const av = a[c], bv = b[c]; const cmp = av < bv ? -1 : av > bv ? 1 : 0; return state.orderDir === 'desc' ? -cmp : cmp; }); }
        resolve(rows);
      } catch (e) { (reject || (() => {}))(e); }
    }
  };
  return builder;
}

function mockDb(t) { return createQueryBuilder(t); }
mockDb.transaction = async fn => fn(t => createQueryBuilder(t));
mockDb.raw = async (sql, params) => {
  if (sql.includes('FROM groups g')) {
    const uid = params[0]; const results = [];
    for (const g of tables.groups) {
      const mm = tables.group_members.find(gm => String(gm.group_id) === String(g.id) && String(gm.user_id) === String(uid) && gm.left_at == null);
      if (mm) {
        const ac = tables.group_members.filter(gm => String(gm.group_id) === String(g.id) && gm.left_at == null).length;
        results.push({ id: g.id, name: g.name, description: g.description, created_at: g.created_at, admin_user_id: g.admin_user_id, my_joined_at: mm.joined_at, member_count: ac });
      }
    }
    return { rows: results };
  }
  return { rows: [] };
};

const dbModulePath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbModulePath)] = { id: dbModulePath, filename: dbModulePath, loaded: true, exports: { db: mockDb, query: async () => [] } };

process.env.JWT_SECRET = 'test-admin-features';
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
  console.log(`\n🧪 Admin features test on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.log(`  ❌ ${label} — ${detail}`); failed++; } }

  // ── Setup: register Aisha + Rohan ──────────────────────────
  console.log('SETUP — Register Aisha (admin), Rohan (member)');
  const rA = await request(port, 'POST', '/api/auth/register', { name: 'Aisha', email: 'aisha@test.com', password: 'password123' });
  const rR = await request(port, 'POST', '/api/auth/register', { name: 'Rohan', email: 'rohan@test.com', password: 'password123' });
  const aishaToken = rA.body.token;
  const rohanToken = rR.body.token;
  const aishaId = rA.body.user.id;
  const rohanId = rR.body.user.id;
  console.log(`  Aisha id=${aishaId}, Rohan id=${rohanId}\n`);

  // ── Create group (Aisha = admin) ────────────────────────────
  console.log('SETUP — Create group "Flat 4B"');
  const rG = await request(port, 'POST', '/api/groups', { name: 'Flat 4B', description: 'Test' }, { Authorization: `Bearer ${aishaToken}` });
  const groupId = rG.body.group.id;
  ok('Group created with admin_user_id', rG.body.group.admin_user_id === aishaId, `got ${rG.body.group.admin_user_id}`);
  console.log('');

  // ── Add Rohan ───────────────────────────────────────────────
  console.log('SETUP — Add Rohan to group');
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'rohan@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Done\n');

  // ── Test A: getGroup includes admin_user_id ─────────────────
  console.log('TEST A — GET /api/groups/:id returns admin_user_id');
  const rA2 = await request(port, 'GET', `/api/groups/${groupId}`, null, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Group:', JSON.stringify(rA2.body.group));
  ok('admin_user_id present', rA2.body.group.admin_user_id === aishaId, `got ${rA2.body.group.admin_user_id}`);
  console.log('');

  // ── Test B: Admin blocks own removal (other members exist) ──
  console.log('TEST B — Admin tries to remove self (Rohan still active)');
  const rB = await request(port, 'DELETE', `/api/groups/${groupId}/members/${aishaId}`, { left_at: '2026-06-14' }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rB.body));
  ok('Status 400', rB.status === 400, `got ${rB.status}`);
  ok('Error mentions transfer', rB.body.error?.includes('Transfer admin'), `got ${rB.body.error}`);
  ok('action_required = transfer_or_delete', rB.body.action_required === 'transfer_or_delete', `got ${rB.body.action_required}`);
  console.log('');

  // ── Test C: Non-admin cannot remove others ──────────────────
  console.log('TEST C — Rohan (non-admin) tries to remove Aisha');
  const rC = await request(port, 'DELETE', `/api/groups/${groupId}/members/${aishaId}`, { left_at: '2026-06-14' }, { Authorization: `Bearer ${rohanToken}` });
  console.log('  Response:', JSON.stringify(rC.body));
  ok('Status 403', rC.status === 403, `got ${rC.status}`);
  ok('Error = Only admin can remove', rC.body.error?.includes('Only the group admin'), `got ${rC.body.error}`);
  console.log('');

  // ── Test C2: Non-admin CAN remove themselves ────────────────
  console.log('TEST C2 — Rohan (non-admin) removes himself');
  const rC2 = await request(port, 'DELETE', `/api/groups/${groupId}/members/${rohanId}`, { left_at: '2026-06-14' }, { Authorization: `Bearer ${rohanToken}` });
  console.log('  Response:', JSON.stringify(rC2.body));
  ok('Status 200', rC2.status === 200, `got ${rC2.status}`);
  // Re-add Rohan for remaining tests
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'rohan@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  (Re-added Rohan)\n');

  // ── Test D: Transfer admin to Rohan ─────────────────────────
  console.log('TEST D — PATCH /api/groups/:id/admin (transfer to Rohan)');
  const rD = await request(port, 'PATCH', `/api/groups/${groupId}/admin`, { new_admin_user_id: rohanId }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rD.body));
  ok('Status 200', rD.status === 200, `got ${rD.status}`);
  ok('Message = Admin transferred', rD.body.message === 'Admin transferred', `got ${rD.body.message}`);
  ok('new_admin.user_id = rohanId', rD.body.new_admin?.user_id === rohanId, `got ${rD.body.new_admin?.user_id}`);
  console.log('');

  // ── Test D2: Aisha (no longer admin) can't transfer ─────────
  console.log('TEST D2 — Former admin Aisha tries to transfer again');
  const rD2 = await request(port, 'PATCH', `/api/groups/${groupId}/admin`, { new_admin_user_id: aishaId }, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 403', rD2.status === 403, `got ${rD2.status}`);
  console.log('');

  // ── Test E: Former admin can now leave ──────────────────────
  console.log('TEST E — Aisha (former admin) removes herself');
  const rE = await request(port, 'DELETE', `/api/groups/${groupId}/members/${aishaId}`, { left_at: '2026-06-14' }, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rE.body));
  ok('Status 200', rE.status === 200, `got ${rE.status}`);
  ok('left_at = 2026-06-14', rE.body.left_at === '2026-06-14', `got ${rE.body.left_at}`);
  console.log('');

  // ── Test F: Delete group ────────────────────────────────────
  console.log('TEST F — DELETE /api/groups/:id');

  // F1: Non-admin can't delete
  const rF1 = await request(port, 'DELETE', `/api/groups/${groupId}`, { confirm: true }, { Authorization: `Bearer ${aishaToken}` });
  ok('Non-admin → 403', rF1.status === 403, `got ${rF1.status}`);

  // F2: Admin without confirm → 400
  const rF2 = await request(port, 'DELETE', `/api/groups/${groupId}`, {}, { Authorization: `Bearer ${rohanToken}` });
  ok('No confirm → 400', rF2.status === 400, `got ${rF2.status}`);

  // F3: Admin with confirm → 200
  const rF3 = await request(port, 'DELETE', `/api/groups/${groupId}`, { confirm: true }, { Authorization: `Bearer ${rohanToken}` });
  console.log('  Response:', JSON.stringify(rF3.body));
  ok('Admin + confirm → 200', rF3.status === 200, `got ${rF3.status}`);
  ok('Message = Group deleted', rF3.body.message === 'Group deleted', `got ${rF3.body.message}`);

  // F4: Group is actually gone
  const rF4 = await request(port, 'GET', `/api/groups/${groupId}`, null, { Authorization: `Bearer ${rohanToken}` });
  ok('Group gone → 404', rF4.status === 404, `got ${rF4.status}`);
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
