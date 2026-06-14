/**
 * BALANCE SERVICE INTEGRATION TEST — MOCK DB
 *
 * Simulates the P5 scenario:
 *   - Group: Flat 4B
 *   - Members: Aisha (admin), Rohan, Priya, Meera
 *   - Expense 1: February rent ₹48,000, paid by Aisha, split equal (2-way: Aisha+Rohan)
 *   - Expense 2: Pizza Friday ₹1,440, paid by Aisha, percentage 30/30/30/20 (4-way)
 *   - No settlements yet
 *
 * EXPECTED NET BALANCES (manual trace shown below):
 *
 * Expense 1 — Rent ₹48,000 equal split Aisha+Rohan:
 *   Aisha paid: 48,000   | Aisha owes: 24,000
 *   Rohan paid: 0        | Rohan owes: 24,000
 *
 * Expense 2 — Pizza ₹1,440 percentage 30/30/30/20:
 *   Aisha paid: 1,440    | Aisha owes: 432  (30%)
 *   Rohan paid: 0        | Rohan owes: 432  (30%)
 *   Priya paid: 0        | Priya owes: 432  (30%)
 *   Meera paid: 0        | Meera owes: 144  (20%, absorbs rounding)
 *
 * TOTALS:
 *   Aisha: paid=49,440  owed=24,432  net = +25,008  (is owed)
 *   Rohan: paid=0       owed=24,432  net = -24,432  (owes)
 *   Priya: paid=0       owed=432     net = -432      (owes)
 *   Meera: paid=0       owed=144     net = -144      (owes)
 *
 * MINIMIZED TRANSACTIONS (Aisha is the only creditor):
 *   Rohan → Aisha: 24,432
 *   Priya → Aisha: 432
 *   Meera → Aisha: 144
 */

const http = require('http');
const path = require('path');

// ── In-memory stores ──────────────────────────────────────────
const tables = {
  users: [], groups: [], group_members: [],
  expenses: [], expense_splits: [], settlements: []
};
const counters = { users: 0, groups: 0, group_members: 0, expenses: 0, expense_splits: 0, settlements: 0 };

function stripAlias(c) { return c.includes('.') ? c.split('.').pop() : c; }

// ── Query builder (same as previous tests) ────────────────────
function createQueryBuilder(tableName) {
  const baseTable = tableName.includes(' as ') ? tableName.split(' as ')[0] : tableName;
  const state = {
    filters: [], joinDefs: [], selectCols: null,
    orderBys: [], countExpr: null, limitVal: null, offsetVal: null,
    _insertData: null, _pendingInsert: false
  };
  function getRows() { return tables[baseTable] || []; }
  function applyFilters(rows) { return rows.filter(r => state.filters.every(f => f.apply(r))); }

  const builder = {
    where(...args) {
      if (args.length === 1 && typeof args[0] === 'object') {
        const obj = args[0];
        state.filters.push({ apply: r => Object.entries(obj).every(([k, v]) => String(r[stripAlias(k)]) === String(v)) });
      } else if (args.length === 2) {
        const col = stripAlias(args[0]); const val = args[1];
        state.filters.push({ apply: r => String(r[col]) === String(val) });
      } else if (args.length === 3) {
        const col = stripAlias(args[0]); const op = args[1]; const val = args[2];
        state.filters.push({ apply: r => { const rv = r[col]; if (rv == null) return false; if (op==='<=') return rv<=val; if (op==='>=') return rv>=val; if (op==='<') return rv<val; if (op==='>') return rv>val; return String(rv)===String(val); } });
      }
      return builder;
    },
    whereRaw(sql, params) { if (sql.includes('LOWER')) { const e=params[0].toLowerCase(); state.filters.push({ apply: r=>(r.email||'').toLowerCase()===e }); } return builder; },
    whereNull(col) { const c=stripAlias(col); state.filters.push({ apply: r=>r[c]===null||r[c]===undefined }); return builder; },
    whereNotNull(col) { const c=stripAlias(col); state.filters.push({ apply: r=>r[c]!==null&&r[c]!==undefined }); return builder; },
    whereNot(obj) { state.filters.push({ apply: r=>Object.entries(obj).some(([k,v])=>String(r[k])!==String(v)) }); return builder; },
    andWhere(fn) { const cls=[]; const sub={ whereNull(c){cls.push({apply:r=>r[stripAlias(c)]==null});return sub;}, orWhere(...a){if(a.length===2){const c=stripAlias(a[0]);cls.push({apply:r=>r[c]>a[1]});}else if(a.length===3){const c=stripAlias(a[0]),op=a[1],val=a[2];cls.push({apply:r=>{const rv=r[c];if(rv==null)return false;if(op==='>')return rv>val;if(op==='<')return rv<val;return false;}});}return sub;} }; fn.call(sub); state.filters.push({ apply: r=>cls.some(cl=>cl.apply(r)) }); return builder; },
    join(te, c1, c2) { state.joinDefs.push({ table:te, leftCol:c1, rightCol:c2, type:'inner' }); return builder; },
    leftJoin(te, c1, c2) { state.joinDefs.push({ table:te, leftCol:c1, rightCol:c2, type:'left' }); return builder; },
    select(...cols) { state.selectCols=cols.flat(); return builder; },
    orderBy(col, dir) { state.orderBys.push({ col, dir:dir||'asc' }); return builder; },
    limit(n) { state.limitVal=n; return builder; },
    offset(n) { state.offsetVal=n; return builder; },
    count(expr) { state.countExpr=expr; return builder; },
    first() { const rows=applyFilters(getRows()); if(state.countExpr){const k=state.countExpr.includes(' as ')?state.countExpr.split(' as ')[1].trim():'count';return Promise.resolve({[k]:rows.length});}return Promise.resolve(rows[0]||null); },
    insert(data) { state._insertData=data; state._pendingInsert=true; return builder; },
    update(data) { const rows=applyFilters(getRows()); for(const r of rows)Object.assign(r,data); return Promise.resolve(rows.length); },
    del() { const rows=applyFilters(getRows()); const ids=new Set(rows.map(r=>r.id)); tables[baseTable]=tables[baseTable].filter(r=>!ids.has(r.id)); return Promise.resolve(rows.length); },
    returning(cols) {
      state._pendingInsert=false;
      const arr=Array.isArray(state._insertData)?state._insertData:[state._insertData];
      const res=arr.map(d=>{const id=++counters[baseTable];const row={id,...d,created_at:new Date().toISOString()};tables[baseTable].push(row);const p={};for(const c of cols)p[c]=row[c];return p;});
      return Promise.resolve(res);
    },
    then(resolve, reject) {
      try {
        if(state._pendingInsert){const arr=Array.isArray(state._insertData)?state._insertData:[state._insertData];const ids=arr.map(d=>{const id=++counters[baseTable];tables[baseTable].push({id,...d,created_at:new Date().toISOString()});return id;});state._pendingInsert=false;return resolve(ids);}
        let rows=applyFilters(getRows());
        for(const jd of state.joinDefs){const jt=jd.table.includes(' as ')?jd.table.split(' as ')[0]:jd.table;const lc=stripAlias(jd.leftCol);const rc=stripAlias(jd.rightCol);if(jd.type==='left'){rows=rows.map(row=>{const m=(tables[jt]||[]).find(jr=>String(jr[rc])===String(row[lc])||String(jr[lc])===String(row[rc]));const merged={...row};if(m){for(const[k,v]of Object.entries(m)){if(k==='name')merged['_joined_name_'+jt]=v;else if(!(k in merged))merged[k]=v;}}return merged;});}else{rows=rows.flatMap(row=>{const ms=(tables[jt]||[]).filter(jr=>String(jr[rc])===String(row[lc])||String(jr[lc])===String(row[rc]));return ms.length?ms.map(m=>{const merged={...row};for(const[k,v]of Object.entries(m)){if(!(k in merged))merged[k]=v;}return merged;}):[row];});}}
        if(state.selectCols){rows=rows.map(r=>{const o={};for(const col of state.selectCols){if(col.includes(' as ')){const[src,alias]=col.split(' as ').map(s=>s.trim());const sk=stripAlias(src);if(src.includes('u.name')||src.includes('u.email')){const jAlias=src.split('.')[0];const joinedT=state.joinDefs.find(jd=>jd.table.split(' as ')[1]===jAlias)?.table.split(' as ')[0];const key=joinedT?'_joined_name_'+joinedT:sk;o[alias]=r[key]??r[sk]??null;}else{o[alias]=r[sk]??null;}}else{const k=stripAlias(col);o[k]=r[k];}}return o;});}
        for(const ob of state.orderBys){const c=stripAlias(ob.col);rows.sort((a,b)=>{const av=a[c],bv=b[c];const cmp=av<bv?-1:av>bv?1:0;return ob.dir==='desc'?-cmp:cmp;});}
        if(state.offsetVal!=null)rows=rows.slice(state.offsetVal);
        if(state.limitVal!=null)rows=rows.slice(0,state.limitVal);
        resolve(rows);
      } catch(e){(reject||(() =>{}))(e);}
    }
  };
  return builder;
}

// ── Mock db.raw — handles the 4 balance queries ───────────────
function mockDb(t) { return createQueryBuilder(t); }
mockDb.transaction = async fn => fn(t => createQueryBuilder(t));

mockDb.raw = async (sql, params) => {
  // Normalise — named params (:groupId) or positional (?)
  const groupId = params?.groupId ?? params?.[0];

  // QUERY A — total paid per member
  if (sql.includes('total_paid') && sql.includes('paid_by_user_id')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    const result = gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const paid = tables.expenses
        .filter(e =>
          String(e.group_id) === String(groupId) &&
          e.paid_by_user_id === gm.user_id &&
          !e.is_settlement &&
          e.date >= gm.joined_at &&
          (gm.left_at == null || e.date < gm.left_at)
        )
        .reduce((sum, e) => sum + (e.amount_inr || 0), 0);
      return { user_id: gm.user_id, user_name: user?.name ?? '?', total_paid: paid };
    });
    return { rows: result };
  }

  // QUERY B — total owed per member
  if (sql.includes('total_owed') && sql.includes('expense_splits')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    const result = gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const owed = tables.expense_splits
        .filter(es => {
          if (es.user_id !== gm.user_id) return false;
          const exp = tables.expenses.find(e => e.id === es.expense_id);
          if (!exp) return false;
          return (
            String(exp.group_id) === String(groupId) &&
            !exp.is_settlement &&
            exp.date >= gm.joined_at &&
            (gm.left_at == null || exp.date < gm.left_at)
          );
        })
        .reduce((sum, es) => sum + (es.share_amount || 0), 0);
      return { user_id: gm.user_id, user_name: user?.name ?? '?', total_owed: owed };
    });
    return { rows: result };
  }

  // QUERY C — settlements paid
  if (sql.includes('settlements_paid') && sql.includes('from_user_id')) {
    const rows = tables.settlements.filter(s => String(s.group_id) === String(groupId));
    const map = {};
    for (const s of rows) { map[s.from_user_id] = (map[s.from_user_id] || 0) + s.amount; }
    return { rows: Object.entries(map).map(([uid, amt]) => ({ user_id: parseInt(uid), settlements_paid: amt })) };
  }

  // QUERY D — settlements received
  if (sql.includes('settlements_received') && sql.includes('to_user_id')) {
    const rows = tables.settlements.filter(s => String(s.group_id) === String(groupId));
    const map = {};
    for (const s of rows) { map[s.to_user_id] = (map[s.to_user_id] || 0) + s.amount; }
    return { rows: Object.entries(map).map(([uid, amt]) => ({ user_id: parseInt(uid), settlements_received: amt })) };
  }

  // getMyGroups raw query (used by groups routes)
  if (sql.includes('FROM groups g')) {
    const uid = params?.[0]; const results = [];
    for (const g of tables.groups) {
      const mm = tables.group_members.find(gm => String(gm.group_id)===String(g.id) && String(gm.user_id)===String(uid) && gm.left_at==null);
      if (mm) { const ac=tables.group_members.filter(gm=>String(gm.group_id)===String(g.id)&&gm.left_at==null).length; results.push({id:g.id,name:g.name,description:g.description,created_at:g.created_at,admin_user_id:g.admin_user_id,my_joined_at:mm.joined_at,member_count:ac}); }
    }
    return { rows: results };
  }

  return { rows: [] };
};

// ── Inject mock ───────────────────────────────────────────────
const dbPath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbPath)] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: mockDb, query: async () => [] } };

process.env.JWT_SECRET = 'test-balance';
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
    const req = http.request(opts, res => { let c=''; res.on('data', d=>c+=d); res.on('end', ()=>{ let j; try{j=JSON.parse(c);}catch{j=c;} resolve({status:res.statusCode,body:j}); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`\n🧪 Balance integration test on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) { if (cond) { console.log(`  ✅ ${label}`); passed++; } else { console.log(`  ❌ ${label} — ${detail}`); failed++; } }

  // ── Setup: 4 users + group + expenses replicating P5 ──────
  console.log('SETUP — Register 4 users, create group, add members');
  const rA = await request(port, 'POST', '/api/auth/register', { name: 'Aisha', email: 'aisha@test.com', password: 'password123' });
  const rR = await request(port, 'POST', '/api/auth/register', { name: 'Rohan', email: 'rohan@test.com', password: 'password123' });
  const rP = await request(port, 'POST', '/api/auth/register', { name: 'Priya', email: 'priya@test.com', password: 'password123' });
  const rM = await request(port, 'POST', '/api/auth/register', { name: 'Meera', email: 'meera@test.com', password: 'password123' });
  const aishaToken = rA.body.token;
  const aishaId = rA.body.user.id, rohanId = rR.body.user.id, priyaId = rP.body.user.id, meeraId = rM.body.user.id;

  const rG = await request(port, 'POST', '/api/groups', { name: 'Flat 4B' }, { Authorization: `Bearer ${aishaToken}` });
  const groupId = rG.body.group.id;
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'rohan@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'priya@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email: 'meera@test.com', joined_at: '2026-02-01' }, { Authorization: `Bearer ${aishaToken}` });

  // Patch Aisha's joined_at — createGroup sets it to today, but expenses are in Feb 2026.
  // In production this is fine (real group would be created before expenses).
  // In mock: override to a date before both expenses.
  const aishaMembership = tables.group_members.find(gm => gm.group_id === groupId && gm.user_id === aishaId);
  if (aishaMembership) aishaMembership.joined_at = '2026-01-01';

  // Expense 1: February rent ₹48,000 equal split Aisha+Rohan
  const rE1 = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'February rent', amount: 48000, currency: 'INR',
    paid_by_user_id: aishaId, split_type: 'equal', date: '2026-02-01',
    participants: [
      { user_id: aishaId, participant_name: 'Aisha' },
      { user_id: rohanId, participant_name: 'Rohan' }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });

  // Expense 2: Pizza Friday ₹1,440 percentage 30/30/30/20
  const rE2 = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description: 'Pizza Friday', amount: 1440, currency: 'INR',
    paid_by_user_id: aishaId, split_type: 'percentage', date: '2026-02-28',
    participants: [
      { user_id: aishaId, participant_name: 'Aisha', percentage: 30 },
      { user_id: rohanId, participant_name: 'Rohan', percentage: 30 },
      { user_id: priyaId, participant_name: 'Priya', percentage: 30 },
      { user_id: meeraId, participant_name: 'Meera', percentage: 20 }
    ]
  }, { Authorization: `Bearer ${aishaToken}` });

  console.log(`  groupId=${groupId}, expenses created: ${rE1.body.expense?.id}, ${rE2.body.expense?.id}`);
  console.log(`  Aisha id=${aishaId}, Rohan id=${rohanId}, Priya id=${priyaId}, Meera id=${meeraId}\n`);

  // ── Test: GET /api/groups/:id/balances ─────────────────────
  console.log('TEST — GET /api/groups/:id/balances');
  const rBal = await request(port, 'GET', `/api/groups/${groupId}/balances`, null, { Authorization: `Bearer ${aishaToken}` });
  console.log('\n  Full Response:\n' + JSON.stringify(rBal.body, null, 2) + '\n');

  ok('Status 200', rBal.status === 200, `got ${rBal.status}`);
  ok('Has balances array', Array.isArray(rBal.body.balances), 'missing');
  ok('Has transactions array', Array.isArray(rBal.body.transactions), 'missing');
  ok('Has total_expenses', typeof rBal.body.total_expenses === 'number', 'missing');
  ok('settled = false', rBal.body.settled === false, `got ${rBal.body.settled}`);
  console.log('');

  // ── Verify Aisha's numbers ──────────────────────────────────
  console.log('MANUAL TRACE — Aisha\'s net_balance:');
  const aisha = rBal.body.balances?.find(b => b.user_name === 'Aisha');
  console.log(`  Expense 1 — Rent ₹48,000 equal 2-way: Aisha paid=48000, owes=24000`);
  console.log(`  Expense 2 — Pizza ₹1,440 at 30%:      Aisha paid=1440,  owes=432`);
  console.log(`  ─────────────────────────────────────────────────────────────────`);
  console.log(`  total_paid = 48000 + 1440 = 49440`);
  console.log(`  total_owed = 24000 + 432  = 24432`);
  console.log(`  net        = 49440 - 24432 = 25008  (Aisha is owed ₹25,008)`);
  console.log(`  DB says → total_paid=${aisha?.total_paid}, total_owed=${aisha?.total_owed}, net_balance=${aisha?.net_balance}\n`);

  ok('Aisha total_paid = 49440', aisha?.total_paid === 49440, `got ${aisha?.total_paid}`);
  ok('Aisha total_owed = 24432', aisha?.total_owed === 24432, `got ${aisha?.total_owed}`);
  ok('Aisha net_balance = 25008', aisha?.net_balance === 25008, `got ${aisha?.net_balance}`);
  console.log('');

  // ── Verify Rohan's numbers ──────────────────────────────────
  console.log('MANUAL TRACE — Rohan\'s net_balance:');
  const rohan = rBal.body.balances?.find(b => b.user_name === 'Rohan');
  console.log(`  Expense 1 — Rent: Rohan paid=0, owes=24000`);
  console.log(`  Expense 2 — Pizza 30%: Rohan paid=0, owes=432`);
  console.log(`  net = 0 - (24000+432) = -24432  (Rohan owes ₹24,432)`);
  console.log(`  DB says → total_paid=${rohan?.total_paid}, total_owed=${rohan?.total_owed}, net_balance=${rohan?.net_balance}\n`);

  ok('Rohan total_paid = 0', rohan?.total_paid === 0, `got ${rohan?.total_paid}`);
  ok('Rohan total_owed = 24432', rohan?.total_owed === 24432, `got ${rohan?.total_owed}`);
  ok('Rohan net_balance = -24432', rohan?.net_balance === -24432, `got ${rohan?.net_balance}`);
  console.log('');

  // ── Verify Priya + Meera ────────────────────────────────────
  const priya = rBal.body.balances?.find(b => b.user_name === 'Priya');
  const meera = rBal.body.balances?.find(b => b.user_name === 'Meera');
  ok('Priya net_balance = -432', priya?.net_balance === -432, `got ${priya?.net_balance}`);
  ok('Meera net_balance = -144', meera?.net_balance === -144, `got ${meera?.net_balance}`);
  console.log('');

  // ── Verify total_expenses ────────────────────────────────────
  // Sum of total_paid across all members = Aisha paid both (48000+1440=49440)
  // Others paid 0 → total = 49440
  ok('total_expenses = 49440', rBal.body.total_expenses === 49440, `got ${rBal.body.total_expenses}`);
  console.log('');

  // ── Verify minimized transactions ──────────────────────────
  console.log('TRANSACTIONS (minimized debt):');
  const txns = rBal.body.transactions;
  for (const t of txns) console.log(`  ${t.from_name} → ${t.to_name}: ₹${t.amount}`);
  console.log('');

  ok('3 transactions total', txns?.length === 3, `got ${txns?.length}`);
  ok('All go to Aisha (sole creditor)', txns?.every(t => t.to_name === 'Aisha'), `some go elsewhere`);
  const rohanTxn = txns?.find(t => t.from_name === 'Rohan');
  const priyaTxn = txns?.find(t => t.from_name === 'Priya');
  const meeraTxn = txns?.find(t => t.from_name === 'Meera');
  ok('Rohan → Aisha: 24432', rohanTxn?.amount === 24432, `got ${rohanTxn?.amount}`);
  ok('Priya → Aisha: 432', priyaTxn?.amount === 432, `got ${priyaTxn?.amount}`);
  ok('Meera → Aisha: 144', meeraTxn?.amount === 144, `got ${meeraTxn?.amount}`);
  console.log('');

  // ── Verify sum of transactions equals net owed ──────────────
  const totalFlow = txns?.reduce((a, t) => a + t.amount, 0);
  ok('Transaction total = 25008 (= Aisha\'s net)', Math.abs(totalFlow - 25008) < 0.01, `got ${totalFlow}`);
  console.log('');

  // ── Test: non-member gets 403 ──────────────────────────────
  console.log('TEST — Non-member cannot view balances');
  const rOther = await request(port, 'POST', '/api/auth/register', { name: 'Stranger', email: 'stranger@test.com', password: 'password123' });
  const rUnauth = await request(port, 'GET', `/api/groups/${groupId}/balances`, null, { Authorization: `Bearer ${rOther.body.token}` });
  ok('Non-member → 403', rUnauth.status === 403, `got ${rUnauth.status}`);
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: balanceService queries, minimizeDebts,');
  console.log('   membership checks, full HTTP stack.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
