/**
 * GROUPS INTEGRATION TEST — MOCK DB (v3)
 *
 * ⚠️  All tests run against an in-memory mock of Knex.
 *     Real code exercised: Express routing, JWT auth, controller logic,
 *     date validation, membership lifecycle (join/leave/rejoin).
 *
 * MOCKED: Knex DB calls
 */

const http = require('http');
const path = require('path');

// ── In-memory stores ──────────────────────────────────────────
const tables = {
  users: [],
  groups: [],
  group_members: []
};
const counters = { users: 0, groups: 0, group_members: 0 };

function stripAlias(col) {
  return col.includes('.') ? col.split('.').pop() : col;
}

// ── Chainable query builder ───────────────────────────────────
function createQueryBuilder(tableName) {
  const baseTable = tableName.includes(' as ') ? tableName.split(' as ')[0] : tableName;

  const state = {
    filters: [],
    joinDefs: [],
    selectCols: null,
    orderCol: null,
    orderDir: 'asc',
    countExpr: null,
    _insertData: null,
    _pendingInsert: false
  };

  function getRows() { return tables[baseTable] || []; }

  function applyFilters(rows) {
    return rows.filter(row => state.filters.every(f => f.apply(row)));
  }

  const builder = {
    where(...args) {
      if (args.length === 1 && typeof args[0] === 'object') {
        // .where({ group_id: 1, user_id: 2 })
        const obj = args[0];
        state.filters.push({
          apply: (row) => Object.entries(obj).every(([k, v]) => String(row[k]) === String(v))
        });
      } else if (args.length === 2) {
        // .where('col', val)
        const col = stripAlias(args[0]);
        const val = args[1];
        state.filters.push({ apply: (row) => String(row[col]) === String(val) });
      } else if (args.length === 3) {
        // .where('col', '<=', val)
        const col = stripAlias(args[0]);
        const op = args[1];
        const val = args[2];
        state.filters.push({
          apply: (row) => {
            const rv = row[col];
            if (rv === null || rv === undefined) return false;
            if (op === '<=') return rv <= val;
            if (op === '>=') return rv >= val;
            if (op === '<') return rv < val;
            if (op === '>') return rv > val;
            if (op === '=') return String(rv) === String(val);
            return String(rv) === String(val);
          }
        });
      }
      return builder;
    },
    whereRaw(sql, params) {
      if (sql.includes('LOWER')) {
        const email = params[0].toLowerCase();
        state.filters.push({ apply: (row) => (row.email || '').toLowerCase() === email });
      }
      return builder;
    },
    whereNull(col) {
      const c = stripAlias(col);
      state.filters.push({ apply: (row) => row[c] === null || row[c] === undefined });
      return builder;
    },
    whereNotNull(col) {
      const c = stripAlias(col);
      state.filters.push({ apply: (row) => row[c] !== null && row[c] !== undefined });
      return builder;
    },
    andWhere(fn) {
      const clauses = [];
      const sub = {
        whereNull(col) {
          const c = stripAlias(col);
          clauses.push({ apply: (row) => row[c] === null || row[c] === undefined });
          return sub;
        },
        orWhere(...args) {
          if (args.length === 2) {
            const c = stripAlias(args[0]);
            const val = args[1];
            clauses.push({ apply: (row) => row[c] > val });
          } else if (args.length === 3) {
            const c = stripAlias(args[0]);
            const op = args[1];
            const val = args[2];
            clauses.push({
              apply: (row) => {
                const rv = row[c];
                if (rv === null || rv === undefined) return false;
                if (op === '>') return rv > val;
                if (op === '<') return rv < val;
                if (op === '>=') return rv >= val;
                if (op === '<=') return rv <= val;
                return false;
              }
            });
          }
          return sub;
        }
      };
      fn.call(sub);
      state.filters.push({ apply: (row) => clauses.some(cl => cl.apply(row)) });
      return builder;
    },
    join(tableExpr, col1, col2) {
      state.joinDefs.push({ table: tableExpr, leftCol: col1, rightCol: col2 });
      return builder;
    },
    select(...cols) {
      state.selectCols = cols.flat();
      return builder;
    },
    orderBy(col, dir) {
      state.orderCol = col;
      state.orderDir = dir || 'asc';
      return builder;
    },
    count(expr) {
      state.countExpr = expr;
      return builder;
    },
    first() {
      const rows = applyFilters(getRows());
      if (state.countExpr) {
        const key = state.countExpr.includes(' as ') ? state.countExpr.split(' as ')[1].trim() : 'count';
        return Promise.resolve({ [key]: rows.length });
      }
      return Promise.resolve(rows[0] || null);
    },
    insert(data) {
      state._insertData = data;
      state._pendingInsert = true;
      return builder;
    },
    update(data) {
      const rows = applyFilters(getRows());
      for (const row of rows) Object.assign(row, data);
      return Promise.resolve(rows.length);
    },
    returning(cols) {
      state._pendingInsert = false;
      const id = ++counters[baseTable];
      const row = { id, ...state._insertData, created_at: new Date().toISOString() };
      tables[baseTable].push(row);
      const projected = {};
      for (const c of cols) projected[c] = row[c];
      return Promise.resolve([projected]);
    },
    then(resolve, reject) {
      try {
        // If there's a pending insert without returning, execute it now
        if (state._pendingInsert) {
          const id = ++counters[baseTable];
          const row = { id, ...state._insertData, created_at: new Date().toISOString() };
          tables[baseTable].push(row);
          state._pendingInsert = false;
          return resolve([id]);
        }

        let rows = applyFilters(getRows());

        // Apply joins
        if (state.joinDefs.length > 0) {
          rows = rows.map(row => {
            let merged = { ...row };
            for (const jd of state.joinDefs) {
              const jTable = jd.table.includes(' as ') ? jd.table.split(' as ')[0] : jd.table;
              const lCol = stripAlias(jd.leftCol);
              const rCol = stripAlias(jd.rightCol);
              const match = (tables[jTable] || []).find(jr =>
                String(jr[rCol]) === String(merged[lCol]) ||
                String(jr[lCol]) === String(merged[rCol])
              );
              if (match) {
                for (const [k, v] of Object.entries(match)) {
                  // Prefer joined table's name/email over group_members' fields
                  if (k === 'name' || k === 'email') merged[k] = v;
                  else if (!(k in merged)) merged[k] = v;
                }
              }
            }
            return merged;
          });
        }

        // Apply select
        if (state.selectCols) {
          rows = rows.map(r => {
            const out = {};
            for (const col of state.selectCols) {
              if (col.includes(' as ')) {
                const parts = col.split(' as ').map(s => s.trim());
                out[parts[1]] = r[stripAlias(parts[0])];
              } else {
                const key = stripAlias(col);
                out[key] = r[key];
              }
            }
            return out;
          });
        }

        // Apply order
        if (state.orderCol) {
          const c = stripAlias(state.orderCol);
          rows.sort((a, b) => {
            const av = a[c], bv = b[c];
            const cmp = av < bv ? -1 : av > bv ? 1 : 0;
            return state.orderDir === 'desc' ? -cmp : cmp;
          });
        }

        resolve(rows);
      } catch (e) {
        (reject || (() => {}))(e);
      }
    }
  };

  return builder;
}

// ── Mock db ───────────────────────────────────────────────────
function mockDb(tableName) {
  return createQueryBuilder(tableName);
}

mockDb.transaction = async function (fn) {
  const trx = function (tableName) { return createQueryBuilder(tableName); };
  return fn(trx);
};

mockDb.raw = async function (sql, params) {
  if (sql.includes('FROM groups g')) {
    const userId = params[0];
    const results = [];
    for (const g of tables.groups) {
      const myMembership = tables.group_members.find(
        gm => String(gm.group_id) === String(g.id)
           && String(gm.user_id) === String(userId)
           && (gm.left_at === null || gm.left_at === undefined)
      );
      if (myMembership) {
        const activeCount = tables.group_members.filter(
          gm => String(gm.group_id) === String(g.id) && (gm.left_at === null || gm.left_at === undefined)
        ).length;
        results.push({
          id: g.id, name: g.name, description: g.description,
          created_at: g.created_at, my_joined_at: myMembership.joined_at,
          member_count: activeCount
        });
      }
    }
    return { rows: results };
  }
  return { rows: [] };
};

// ── Inject mock ───────────────────────────────────────────────
const dbModulePath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbModulePath)] = {
  id: dbModulePath, filename: dbModulePath, loaded: true,
  exports: { db: mockDb, query: async () => [] }
};

// ── Env ───────────────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-for-groups';
process.env.PORT = '0';
process.env.CLIENT_URL = 'http://localhost:5173';

// ── Build app ─────────────────────────────────────────────────
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
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api', routes);
app.use(errorHandler);

// ── HTTP helper ───────────────────────────────────────────────
function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1', port, path: urlPath, method,
      headers: {
        'Content-Type': 'application/json', ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', c => chunks += c);
      res.on('end', () => {
        let json; try { json = JSON.parse(chunks); } catch { json = chunks; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Tests ─────────────────────────────────────────────────────
async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`\n🧪 Test server on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) {
    if (cond) { console.log(`  ✅ ${label}`); passed++; }
    else { console.log(`  ❌ ${label} — ${detail}`); failed++; }
  }

  // ── Setup ──────────────────────────────────────────────────
  console.log('SETUP — Register Aisha, Rohan, Meera');
  const rA = await request(port, 'POST', '/api/auth/register', { name: 'Aisha', email: 'aisha@test.com', password: 'password123' });
  const rR = await request(port, 'POST', '/api/auth/register', { name: 'Rohan', email: 'rohan@test.com', password: 'password123' });
  const rM = await request(port, 'POST', '/api/auth/register', { name: 'Meera', email: 'meera@test.com', password: 'password123' });
  const aishaToken = rA.body.token;
  const rohanToken = rR.body.token;
  const meeraId = rM.body.user.id;
  console.log(`  Aisha id=${rA.body.user.id}, Rohan id=${rR.body.user.id}, Meera id=${meeraId}\n`);

  // ── Step 1: Create group ────────────────────────────────────
  console.log('STEP 1 — POST /api/groups');
  const r1 = await request(port, 'POST', '/api/groups',
    { name: 'Flat 4B', description: 'Feb 2026 onwards' },
    { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r1.body, null, 2));
  ok('Status 201', r1.status === 201, `got ${r1.status}`);
  ok('Group name = Flat 4B', r1.body.group?.name === 'Flat 4B', `got ${r1.body.group?.name}`);
  ok('Has membership.joined_at', !!r1.body.membership?.joined_at, 'missing');
  const groupId = r1.body.group?.id;
  console.log('');

  // ── Step 1b: Validation ─────────────────────────────────────
  console.log('STEP 1b — POST /api/groups (empty name)');
  const r1b = await request(port, 'POST', '/api/groups', { name: '' }, { Authorization: `Bearer ${aishaToken}` });
  ok('Status 400', r1b.status === 400, `got ${r1b.status}`);
  console.log('');

  // ── Step 2: List my groups ──────────────────────────────────
  console.log('STEP 2 — GET /api/groups');
  const r2 = await request(port, 'GET', '/api/groups', null, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r2.body, null, 2));
  ok('Status 200', r2.status === 200, `got ${r2.status}`);
  ok('1 group', r2.body.groups?.length === 1, `got ${r2.body.groups?.length}`);
  ok('member_count = 1', r2.body.groups?.[0]?.member_count === 1, `got ${r2.body.groups?.[0]?.member_count}`);
  console.log('');

  // ── Step 3: Add Rohan ───────────────────────────────────────
  console.log('STEP 3 — POST /api/groups/:id/members (Rohan, 2026-02-01)');
  const r3 = await request(port, 'POST', `/api/groups/${groupId}/members`,
    { email: 'rohan@test.com', joined_at: '2026-02-01' },
    { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r3.body, null, 2));
  ok('Status 201', r3.status === 201, `got ${r3.status}`);
  ok('User = Rohan', r3.body.membership?.name === 'Rohan', `got ${r3.body.membership?.name}`);
  ok('joined_at = 2026-02-01', r3.body.membership?.joined_at === '2026-02-01', `got ${r3.body.membership?.joined_at}`);
  console.log('');

  // ── Step 3b: Duplicate → 409 ───────────────────────────────
  console.log('STEP 3b — Duplicate add (Rohan again)');
  const r3b = await request(port, 'POST', `/api/groups/${groupId}/members`,
    { email: 'rohan@test.com', joined_at: '2026-02-01' },
    { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r3b.body));
  ok('Status 409', r3b.status === 409, `got ${r3b.status}`);
  ok('Error = already active member', r3b.body.error === 'User is already an active member', `got ${r3b.body.error}`);
  console.log('');

  // ── Step 3c: Unknown email → 404 ───────────────────────────
  console.log('STEP 3c — Unknown email');
  const r3c = await request(port, 'POST', `/api/groups/${groupId}/members`,
    { email: 'nobody@test.com', joined_at: '2026-02-01' },
    { Authorization: `Bearer ${aishaToken}` });
  ok('Status 404', r3c.status === 404, `got ${r3c.status}`);
  console.log('');

  // ── Step 3d: Future date → 400 ─────────────────────────────
  console.log('STEP 3d — Future join date');
  const r3d = await request(port, 'POST', `/api/groups/${groupId}/members`,
    { email: 'meera@test.com', joined_at: '2099-01-01' },
    { Authorization: `Bearer ${aishaToken}` });
  ok('Status 400', r3d.status === 400, `got ${r3d.status}`);
  console.log('');

  // ── Step 4: Add Meera ───────────────────────────────────────
  console.log('STEP 4 — POST /api/groups/:id/members (Meera, 2026-02-01)');
  const r4 = await request(port, 'POST', `/api/groups/${groupId}/members`,
    { email: 'meera@test.com', joined_at: '2026-02-01' },
    { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r4.body, null, 2));
  ok('Status 201', r4.status === 201, `got ${r4.status}`);
  ok('User = Meera', r4.body.membership?.name === 'Meera', `got ${r4.body.membership?.name}`);
  console.log('');

  // ── Step 5: Remove Meera ────────────────────────────────────
  console.log('STEP 5 — DELETE /api/groups/:id/members/:meeraId');
  const r5 = await request(port, 'DELETE', `/api/groups/${groupId}/members/${meeraId}`,
    { left_at: '2026-03-31' },
    { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r5.body, null, 2));
  ok('Status 200', r5.status === 200, `got ${r5.status}`);
  ok('left_at = 2026-03-31', r5.body.left_at === '2026-03-31', `got ${r5.body.left_at}`);
  console.log('');

  // ── Step 5b: Rohan still has access ─────────────────────────
  console.log('STEP 5b — Rohan accesses group');
  const r5b = await request(port, 'GET', `/api/groups/${groupId}`, null, { Authorization: `Bearer ${rohanToken}` });
  ok('Rohan gets 200', r5b.status === 200, `got ${r5b.status}`);
  console.log('');

  // ── Step 6: GET group detail ────────────────────────────────
  console.log('STEP 6 — GET /api/groups/:id (full member list)');
  const r6 = await request(port, 'GET', `/api/groups/${groupId}`, null, { Authorization: `Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(r6.body, null, 2));
  ok('Status 200', r6.status === 200, `got ${r6.status}`);
  ok('3 members total', r6.body.members?.length === 3, `got ${r6.body.members?.length}`);

  const aisha = r6.body.members?.find(m => m.name === 'Aisha');
  const rohan = r6.body.members?.find(m => m.name === 'Rohan');
  const meera = r6.body.members?.find(m => m.name === 'Meera');

  ok('Aisha is_active = true', aisha?.is_active === true, `got ${aisha?.is_active}`);
  ok('Aisha left_at null', aisha?.left_at == null, `got ${aisha?.left_at}`);
  ok('Rohan is_active = true', rohan?.is_active === true, `got ${rohan?.is_active}`);
  ok('Rohan joined_at = 2026-02-01', rohan?.joined_at === '2026-02-01', `got ${rohan?.joined_at}`);
  ok('Meera is_active = false', meera?.is_active === false, `got ${meera?.is_active}`);
  ok('Meera left_at = 2026-03-31', meera?.left_at === '2026-03-31', `got ${meera?.left_at}`);
  console.log('');

  // ── Step 7: getMembersOnDate ────────────────────────────────
  // Note: Aisha's joined_at is today (2026-06-14) because she was added
  // via createGroup. Rohan and Meera were added with joined_at = 2026-02-01.
  // Meera's left_at = 2026-03-31.
  console.log('STEP 7 — getMembersOnDate helper');
  const { getMembersOnDate } = require('./src/controllers/groupController');

  const march = await getMembersOnDate(groupId, '2026-03-15');
  console.log(`  March 15 members: ${march.map(m => m.name).join(', ')}`);
  ok('March 15: 2 active (Rohan+Meera, Aisha joined later)', march.length === 2, `got ${march.length}: ${march.map(m=>m.name)}`);

  const april = await getMembersOnDate(groupId, '2026-04-15');
  console.log(`  April 15 members: ${april.map(m => m.name).join(', ')}`);
  ok('April 15: 1 active (Rohan only, Meera left, Aisha not yet)', april.length === 1, `got ${april.length}: ${april.map(m=>m.name)}`);
  ok('April 15: no Meera', !april.find(m => m.name === 'Meera'), 'Meera still present');

  const june = await getMembersOnDate(groupId, '2026-06-14');
  console.log(`  June 14 members: ${june.map(m => m.name).join(', ')}`);
  ok('June 14: 2 active (Aisha+Rohan)', june.length === 2, `got ${june.length}: ${june.map(m=>m.name)}`);
  ok('June 14: includes Aisha', !!june.find(m => m.name === 'Aisha'), 'Aisha missing');
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: routing, JWT, controller logic,');
  console.log('   date validation, membership lifecycle, getMembersOnDate.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error('Test runner error:', err); process.exit(1); });
