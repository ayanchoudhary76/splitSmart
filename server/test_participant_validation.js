/**
 * PARTICIPANT MEMBERSHIP VALIDATION TEST — MOCK DB
 *
 * Verifies createExpense now rejects participants who were not
 * active members of the group on the expense date.
 *
 * Scenario:
 *   Group: Flat 4B
 *   Members:
 *     Aisha — joined 2026-01-01, still active (admin)
 *     Rohan — joined 2026-02-01, still active
 *     Meera — joined 2026-02-01, left  2026-03-31
 *   Non-member:
 *     Priya — registered but NOT in the group
 *
 * Test A — BLOCKED: Priya (user_id) in Feb expense → 400
 * Test B — ALLOWED: Kabir (no user_id, external) → 201
 * Test C — BLOCKED: Meera in April expense (left Mar 31) → 400
 * Test D — ALLOWED: correct Pizza Friday (Aisha/Rohan/Meera, Feb 28)
 * Test E — Final balance check: Priya absent, numbers correct
 */

const http = require('http');
const path = require('path');

// ── In-memory stores ──────────────────────────────────────────
const tables = {
  users: [], groups: [], group_members: [],
  expenses: [], expense_splits: [], settlements: []
};
const counters = {
  users: 0, groups: 0, group_members: 0,
  expenses: 0, expense_splits: 0, settlements: 0
};

function stripAlias(c) { return c.includes('.') ? c.split('.').pop() : c; }

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
    whereRaw(sql, params) {
      if (sql.includes('LOWER')) { const e = params[0].toLowerCase(); state.filters.push({ apply: r => (r.email||'').toLowerCase()===e }); }
      return builder;
    },
    whereNull(col) { const c=stripAlias(col); state.filters.push({ apply: r=>r[c]===null||r[c]===undefined }); return builder; },
    whereNotNull(col) { const c=stripAlias(col); state.filters.push({ apply: r=>r[c]!==null&&r[c]!==undefined }); return builder; },
    whereNot(obj) { state.filters.push({ apply: r=>Object.entries(obj).some(([k,v])=>String(r[k])!==String(v)) }); return builder; },
    andWhere(fn) {
      const cls = [];
      const sub = {
        whereNull(c) { cls.push({ apply: r=>r[stripAlias(c)]==null }); return sub; },
        orWhere(...a) {
          if (a.length===2) { const c=stripAlias(a[0]); cls.push({ apply: r=>r[c]>a[1] }); }
          else if (a.length===3) { const c=stripAlias(a[0]),op=a[1],val=a[2]; cls.push({ apply: r=>{ const rv=r[c]; if(rv==null)return false; if(op==='>')return rv>val; if(op==='<')return rv<val; return false; } }); }
          return sub;
        }
      };
      fn.call(sub);
      state.filters.push({ apply: r=>cls.some(cl=>cl.apply(r)) });
      return builder;
    },
    join(te,c1,c2) { state.joinDefs.push({ table:te, leftCol:c1, rightCol:c2, type:'inner' }); return builder; },
    leftJoin(te,c1,c2) { state.joinDefs.push({ table:te, leftCol:c1, rightCol:c2, type:'left' }); return builder; },
    select(...cols) { state.selectCols=cols.flat(); return builder; },
    orderBy(col,dir) { state.orderBys.push({ col, dir:dir||'asc' }); return builder; },
    limit(n) { state.limitVal=n; return builder; },
    offset(n) { state.offsetVal=n; return builder; },
    count(expr) { state.countExpr=expr; return builder; },
    first() {
      const rows=applyFilters(getRows());
      if(state.countExpr){const k=state.countExpr.includes(' as ')?state.countExpr.split(' as ')[1].trim():'count';return Promise.resolve({[k]:rows.length});}
      return Promise.resolve(rows[0]||null);
    },
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
        for(const jd of state.joinDefs){
          const jt=jd.table.includes(' as ')?jd.table.split(' as ')[0]:jd.table;
          const jalias=jd.table.includes(' as ')?jd.table.split(' as ')[1]:jt;
          const lc=stripAlias(jd.leftCol); const rc=stripAlias(jd.rightCol);
          if(jd.type==='left'){rows=rows.map(row=>{
            const m=(tables[jt]||[]).find(jr=>String(jr[rc])===String(row[lc])||String(jr[lc])===String(row[rc]));
            const merged={...row};
            if(m){for(const[k,v]of Object.entries(m)){
              merged[jalias+'.'+k]=v;
              if(k==='name')merged['_joined_name_'+jt]=v;
              if(!(k in merged))merged[k]=v;
            }}
            return merged;
          });}
          else{rows=rows.flatMap(row=>{
            const ms=(tables[jt]||[]).filter(jr=>String(jr[rc])===String(row[lc])||String(jr[lc])===String(row[rc]));
            return ms.length?ms.map(m=>{const merged={...row};for(const[k,v]of Object.entries(m)){merged[jalias+'.'+k]=v;if(!(k in merged))merged[k]=v;}return merged;}):[row];
          });}
        }
        if(state.selectCols){rows=rows.map(r=>{const o={};for(const col of state.selectCols){if(col.includes(' as ')){const[src,alias]=col.split(' as ').map(s=>s.trim());// Try full qualified key first (e.g. 'u.name'), then stripped
o[alias]=r[src]??r[stripAlias(src)]??null;}else{// Non-aliased: 'u.id' → try r['u.id'] first, then r['id']
o[stripAlias(col)]=r[col]??r[stripAlias(col)]??null;}}return o;});}
        for(const ob of state.orderBys){const c=stripAlias(ob.col);rows.sort((a,b)=>{const av=a[c],bv=b[c];const cmp=av<bv?-1:av>bv?1:0;return ob.dir==='desc'?-cmp:cmp;});}
        if(state.offsetVal!=null)rows=rows.slice(state.offsetVal);
        if(state.limitVal!=null)rows=rows.slice(0,state.limitVal);
        resolve(rows);
      } catch(e){(reject||(() =>{}))(e);}
    }
  };
  return builder;
}

function mockDb(t) { return createQueryBuilder(t); }
mockDb.transaction = async fn => fn(t => createQueryBuilder(t));
mockDb.raw = async (sql, params) => {
  const groupId = params?.groupId ?? params?.[0];
  if (sql.includes('total_paid') && sql.includes('paid_by_user_id')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    const result = gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const paid = tables.expenses.filter(e => String(e.group_id)===String(groupId) && e.paid_by_user_id===gm.user_id && !e.is_settlement && e.date>=gm.joined_at && (gm.left_at==null||e.date<gm.left_at)).reduce((s,e)=>s+(e.amount_inr||0),0);
      return { user_id:gm.user_id, user_name:user?.name??'?', total_paid:paid };
    });
    return { rows: result };
  }
  if (sql.includes('total_owed') && sql.includes('expense_splits')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    const result = gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const owed = tables.expense_splits.filter(es => { if(es.user_id!==gm.user_id)return false; const exp=tables.expenses.find(e=>e.id===es.expense_id); if(!exp)return false; return String(exp.group_id)===String(groupId)&&!exp.is_settlement&&exp.date>=gm.joined_at&&(gm.left_at==null||exp.date<gm.left_at); }).reduce((s,es)=>s+(es.share_amount||0),0);
      return { user_id:gm.user_id, user_name:user?.name??'?', total_owed:owed };
    });
    return { rows: result };
  }
  if (sql.includes('settlements_paid') && sql.includes('from_user_id')) { const rows=tables.settlements.filter(s=>String(s.group_id)===String(groupId)); const map={}; for(const s of rows){map[s.from_user_id]=(map[s.from_user_id]||0)+s.amount;} return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),settlements_paid:amt})) }; }
  if (sql.includes('settlements_received') && sql.includes('to_user_id')) { const rows=tables.settlements.filter(s=>String(s.group_id)===String(groupId)); const map={}; for(const s of rows){map[s.to_user_id]=(map[s.to_user_id]||0)+s.amount;} return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),settlements_received:amt})) }; }
  if (sql.includes('FROM groups g')) { const uid=params?.[0]; const results=[]; for(const g of tables.groups){const mm=tables.group_members.find(gm=>String(gm.group_id)===String(g.id)&&String(gm.user_id)===String(uid)&&gm.left_at==null);if(mm){const ac=tables.group_members.filter(gm=>String(gm.group_id)===String(g.id)&&gm.left_at==null).length;results.push({id:g.id,name:g.name,description:g.description,created_at:g.created_at,admin_user_id:g.admin_user_id,my_joined_at:mm.joined_at,member_count:ac});}} return { rows:results }; }
  return { rows: [] };
};

const dbPath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbPath)] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: mockDb, query: async () => [] } };

process.env.JWT_SECRET = 'test-participant-validation';
process.env.PORT = '0';
process.env.CLIENT_URL = 'http://localhost:5173';

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const routes = require('./src/routes');
const { errorHandler } = require('./src/middleware/errorHandler');
const app = express();
app.use(helmet()); app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json()); app.use(express.urlencoded({ extended: true }));
app.use('/api', routes); app.use(errorHandler);

function request(port, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { hostname: '127.0.0.1', port, path: urlPath, method, headers: { 'Content-Type': 'application/json', ...headers, ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) } };
    const req = http.request(opts, res => { let c=''; res.on('data',d=>c+=d); res.on('end',()=>{ let j; try{j=JSON.parse(c);}catch{j=c;} resolve({status:res.statusCode,body:j}); }); });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`\n🧪 Participant validation test on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) { if(cond){console.log(`  ✅ ${label}`);passed++;}else{console.log(`  ❌ ${label} — ${detail}`);failed++;} }

  // ── Setup ──────────────────────────────────────────────────
  console.log('SETUP — 4 users, group, Aisha+Rohan+Meera as members');
  const rA = await request(port, 'POST', '/api/auth/register', { name:'Aisha', email:'aisha@test.com', password:'password123' });
  const rR = await request(port, 'POST', '/api/auth/register', { name:'Rohan', email:'rohan@test.com', password:'password123' });
  const rP = await request(port, 'POST', '/api/auth/register', { name:'Priya', email:'priya@test.com', password:'password123' });
  const rM = await request(port, 'POST', '/api/auth/register', { name:'Meera', email:'meera@test.com', password:'password123' });
  const aishaToken = rA.body.token;
  const aishaId=rA.body.user.id, rohanId=rR.body.user.id, priyaId=rP.body.user.id, meeraId=rM.body.user.id;

  const rG = await request(port, 'POST', '/api/groups', { name:'Flat 4B' }, { Authorization:`Bearer ${aishaToken}` });
  const groupId = rG.body.group.id;

  // Aisha: admin (joined today via createGroup — patch to 2026-01-01)
  const aishaMem = tables.group_members.find(gm => gm.group_id===groupId && gm.user_id===aishaId);
  if (aishaMem) aishaMem.joined_at = '2026-01-01';

  await request(port, 'POST', `/api/groups/${groupId}/members`, { email:'rohan@test.com', joined_at:'2026-02-01' }, { Authorization:`Bearer ${aishaToken}` });
  await request(port, 'POST', `/api/groups/${groupId}/members`, { email:'meera@test.com', joined_at:'2026-02-01' }, { Authorization:`Bearer ${aishaToken}` });
  // Meera departs 2026-03-31
  await request(port, 'DELETE', `/api/groups/${groupId}/members/${meeraId}`, { left_at:'2026-03-31' }, { Authorization:`Bearer ${aishaToken}` });
  // Priya is NOT added to the group at all

  console.log(`  groupId=${groupId}`);
  console.log(`  Aisha=${aishaId}(active), Rohan=${rohanId}(active), Meera=${meeraId}(left Mar 31), Priya=${priyaId}(NOT a member)\n`);

  // ── Test A: BLOCKED — Priya (non-member) in Feb expense ────
  console.log('TEST A — BLOCKED: Priya (non-member) as participant');
  const rA2 = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description:'Pizza Friday', amount:1440, currency:'INR',
    paid_by_user_id:aishaId, split_type:'percentage', date:'2026-02-28',
    participants:[
      { user_id:aishaId, participant_name:'Aisha', percentage:30 },
      { user_id:rohanId, participant_name:'Rohan', percentage:30 },
      { user_id:priyaId, participant_name:'Priya', percentage:30 },
      { user_id:meeraId, participant_name:'Meera', percentage:10 }
    ]
  }, { Authorization:`Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rA2.body));
  ok('Status 400', rA2.status === 400, `got ${rA2.status}`);
  ok('Error mentions membership', rA2.body.error?.includes('not active group members'), `got "${rA2.body.error}"`);
  ok('invalid_participants = ["Priya"]', JSON.stringify(rA2.body.invalid_participants) === '["Priya"]', `got ${JSON.stringify(rA2.body.invalid_participants)}`);
  ok('expense_date present', rA2.body.expense_date === '2026-02-28', `got ${rA2.body.expense_date}`);
  ok('hint present', !!rA2.body.hint, 'missing');
  console.log('');

  // ── Test B: ALLOWED — Kabir (external, no user_id) ─────────
  console.log('TEST B — ALLOWED: Kabir (no user_id, external participant)');
  const rB = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description:'Cab split with friend', amount:600, currency:'INR',
    paid_by_user_id:aishaId, split_type:'equal', date:'2026-02-15',
    participants:[
      { user_id:aishaId, participant_name:'Aisha' },
      { participant_name:'Kabir' }   // ← no user_id
    ]
  }, { Authorization:`Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rB.body, null, 2));
  ok('Status 201', rB.status === 201, `got ${rB.status}`);
  ok('2 splits', rB.body.splits?.length === 2, `got ${rB.body.splits?.length}`);
  ok('Kabir split present', rB.body.splits?.some(s => s.participant_name === 'Kabir'), 'missing');
  const kabirSplit = rB.body.splits?.find(s => s.participant_name === 'Kabir');
  ok('Kabir user_id = null', kabirSplit?.user_id == null, `got ${kabirSplit?.user_id}`);
  ok('Each split = 300', rB.body.splits?.every(s => s.share_amount === 300), `got ${rB.body.splits?.map(s=>s.share_amount)}`);
  console.log('');

  // ── Test C: BLOCKED — Meera in April expense (left Mar 31) ─
  console.log('TEST C — BLOCKED: Meera (left Mar 31) in April expense');
  const rC = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description:'April groceries', amount:1200, currency:'INR',
    paid_by_user_id:aishaId, split_type:'equal', date:'2026-04-15',
    participants:[
      { user_id:aishaId, participant_name:'Aisha' },
      { user_id:rohanId, participant_name:'Rohan' },
      { user_id:meeraId, participant_name:'Meera' }  // ← left March 31
    ]
  }, { Authorization:`Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rC.body));
  ok('Status 400', rC.status === 400, `got ${rC.status}`);
  ok('invalid_participants includes Meera', rC.body.invalid_participants?.includes('Meera'), `got ${JSON.stringify(rC.body.invalid_participants)}`);
  ok('expense_date = 2026-04-15', rC.body.expense_date === '2026-04-15', `got ${rC.body.expense_date}`);
  console.log('');

  // ── Test D: ALLOWED — Correct Pizza Friday (Aisha/Rohan/Meera Feb 28) ─
  console.log('TEST D — ALLOWED: Correct Pizza Friday (members only, percentages sum to 100%)');
  const rD = await request(port, 'POST', `/api/groups/${groupId}/expenses`, {
    description:'Pizza Friday', amount:1440, currency:'INR',
    paid_by_user_id:aishaId, split_type:'percentage', date:'2026-02-28',
    participants:[
      { user_id:aishaId, participant_name:'Aisha', percentage:30 },
      { user_id:rohanId, participant_name:'Rohan', percentage:30 },
      { user_id:meeraId, participant_name:'Meera', percentage:40 }
    ]
  }, { Authorization:`Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rD.body, null, 2));
  ok('Status 201', rD.status === 201, `got ${rD.status}`);
  ok('No warnings (100% sums correctly)', rD.body.warnings?.length === 0, `got ${JSON.stringify(rD.body.warnings)}`);
  ok('3 splits', rD.body.splits?.length === 3, `got ${rD.body.splits?.length}`);
  ok('Priya NOT in splits', !rD.body.splits?.some(s => s.participant_name === 'Priya'), 'Priya present!');
  ok('Meera in splits (active on Feb 28)', rD.body.splits?.some(s => s.participant_name === 'Meera'), 'Meera missing');
  const splits_sum = rD.body.splits?.reduce((a,s) => a+s.share_amount, 0);
  ok('Splits sum = 1440', splits_sum === 1440, `got ${splits_sum}`);
  console.log('');

  // ── Test E: Final balances check ───────────────────────────
  // Expenses in DB at this point:
  //   Cab expense (Test B): ₹600, Aisha paid, Aisha+Kabir equal = 300 each
  //   Pizza Friday (Test D): ₹1440, Aisha paid, Aisha=432, Rohan=432, Meera=576
  // Note: Kabir's split (user_id=null) doesn't appear in member balances
  //
  // Aisha: paid=(600+1440)=2040, owes=300+432=732, net=+1308
  // Rohan: paid=0, owes=432, net=-432
  // Meera: paid=0, owes=576, net=-576
  console.log('TEST E — GET /api/groups/:id/balances (after cleanup)');
  const rBal = await request(port, 'GET', `/api/groups/${groupId}/balances`, null, { Authorization:`Bearer ${aishaToken}` });
  console.log('  Response:', JSON.stringify(rBal.body, null, 2));
  ok('Status 200', rBal.status === 200, `got ${rBal.status}`);

  const aisha = rBal.body.balances?.find(b => b.user_name === 'Aisha');
  const rohan = rBal.body.balances?.find(b => b.user_name === 'Rohan');
  const meera = rBal.body.balances?.find(b => b.user_name === 'Meera');
  const priya = rBal.body.balances?.find(b => b.user_name === 'Priya');

  ok('Priya absent from balances (not a member)', priya == null, 'Priya found!');

  // Aisha: total_paid=2040, owes Aisha-share of cab(300)+pizza(432)=732 → net=+1308
  ok('Aisha net > 0 (is owed)', aisha?.net_balance > 0, `got ${aisha?.net_balance}`);
  ok('Rohan net = -432', rohan?.net_balance === -432, `got ${rohan?.net_balance}`);
  // Meera left Mar 31 — pizza (Feb 28) IS within her membership, so she owes her 40% share
  ok('Meera net = -576', meera?.net_balance === -576, `got ${meera?.net_balance}`);

  // Transactions: both Rohan and Meera pay Aisha
  ok('settled = false', rBal.body.settled === false, `got ${rBal.body.settled}`);
  const rohanTxn = rBal.body.transactions?.find(t => t.from_name === 'Rohan');
  const meeraTxn = rBal.body.transactions?.find(t => t.from_name === 'Meera');
  ok('Rohan → Aisha: 432', rohanTxn?.amount === 432, `got ${rohanTxn?.amount}`);
  ok('Meera → Aisha: 576', meeraTxn?.amount === 576, `got ${meeraTxn?.amount}`);
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: getMembersOnDate integration in createExpense,');
  console.log('   external participant pass-through, membership-date filtering.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
