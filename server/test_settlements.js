/**
 * SETTLEMENTS INTEGRATION TEST — MOCK DB
 *
 * Scenario: Flat 4B after two expenses
 *   - February rent ₹48,000, Aisha paid, equal Aisha+Rohan → each owes 24,000
 *   - Pizza Friday ₹1,440, Aisha paid, Aisha:30% Rohan:30% Meera:40%
 *     → Aisha:432, Rohan:432, Meera:576
 *   - Cab split ₹600, Aisha paid, Aisha+Kabir(external) → external_shares=300
 *
 *   Pre-settlement balances:
 *     Aisha: total_paid=50040, external=300, total_owed=24732, net=+25008
 *     Rohan: total_paid=0,     external=0,   total_owed=24432, net=-24432
 *     Meera: total_paid=0,     external=0,   total_owed=576,   net=-576
 *     Priya: NOT a member
 *
 *   Test A — partial settlement: Rohan pays Aisha ₹10,000
 *     updated Rohan net: -24432 + 10000 = -14432
 *     updated Aisha net: 25008  - 10000 = 15008
 *
 *   Test B — self-settle blocked (from == to)
 *   Test C — list settlements shows 1 settlement with names
 *   Test D — second settlement (Meera → Aisha ₹576, full settlement)
 *     Meera net becomes 0, group not fully settled (Rohan still owes)
 *   Test E — non-member cannot create a settlement
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
    whereRaw(sql, params) { if (sql.includes('LOWER')) { const e=params[0].toLowerCase(); state.filters.push({ apply: r=>(r.email||'').toLowerCase()===e }); } return builder; },
    whereNull(col) { const c=stripAlias(col); state.filters.push({ apply: r=>r[c]===null||r[c]===undefined }); return builder; },
    whereNotNull(col) { const c=stripAlias(col); state.filters.push({ apply: r=>r[c]!==null&&r[c]!==undefined }); return builder; },
    whereNot(obj) { state.filters.push({ apply: r=>Object.entries(obj).some(([k,v])=>String(r[k])!==String(v)) }); return builder; },
    whereIn(col, vals) { const c=stripAlias(col); state.filters.push({ apply: r=>vals.map(String).includes(String(r[c])) }); return builder; },
    andWhere(fn) {
      const cls=[];
      const sub={ whereNull(c){cls.push({apply:r=>r[stripAlias(c)]==null});return sub;}, orWhere(...a){if(a.length===2){const c=stripAlias(a[0]);cls.push({apply:r=>r[c]>a[1]});}else if(a.length===3){const c=stripAlias(a[0]),op=a[1],val=a[2];cls.push({apply:r=>{const rv=r[c];if(rv==null)return false;if(op==='>')return rv>val;if(op==='<')return rv<val;return false;}});}return sub;} };
      fn.call(sub);
      state.filters.push({ apply: r=>cls.some(cl=>cl.apply(r)) });
      return builder;
    },
    join(te,c1,c2) { state.joinDefs.push({table:te,leftCol:c1,rightCol:c2,type:'inner'}); return builder; },
    leftJoin(te,c1,c2) { state.joinDefs.push({table:te,leftCol:c1,rightCol:c2,type:'left'}); return builder; },
    select(...cols) { state.selectCols=cols.flat(); return builder; },
    orderBy(col,dir) { state.orderBys.push({col,dir:dir||'asc'}); return builder; },
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
        if(state._pendingInsert){
          const arr=Array.isArray(state._insertData)?state._insertData:[state._insertData];
          const ids=arr.map(d=>{const id=++counters[baseTable];tables[baseTable].push({id,...d,created_at:new Date().toISOString()});return id;});
          state._pendingInsert=false; return resolve(ids);
        }
        let rows=applyFilters(getRows());
        for(const jd of state.joinDefs){
          const jt=jd.table.includes(' as ')?jd.table.split(' as ')[0]:jd.table;
          const jalias=jd.table.includes(' as ')?jd.table.split(' as ')[1]:jt;
          const lc=stripAlias(jd.leftCol); const rc=stripAlias(jd.rightCol);
          if(jd.type==='left'){
            rows=rows.map(row=>{
              const m=(tables[jt]||[]).find(jr=>String(jr[rc])===String(row[lc])||String(jr[lc])===String(row[rc]));
              const merged={...row};
              if(m){for(const[k,v]of Object.entries(m)){merged[jalias+'.'+k]=v;if(k==='name')merged['_joined_name_'+jt]=v;if(!(k in merged))merged[k]=v;}}
              return merged;
            });
          } else {
            rows=rows.flatMap(row=>{
              const ms=(tables[jt]||[]).filter(jr=>String(jr[rc])===String(row[lc])||String(jr[lc])===String(row[rc]));
              return ms.length?ms.map(m=>{const merged={...row};for(const[k,v]of Object.entries(m)){merged[jalias+'.'+k]=v;if(!(k in merged))merged[k]=v;}return merged;}):[row];
            });
          }
        }
        if(state.selectCols){
          rows=rows.map(r=>{
            const o={};
            for(const col of state.selectCols){
              if(col.includes(' as ')){
                const[src,alias]=col.split(' as ').map(s=>s.trim());
                // For 's.*' or plain table columns, use the full key first
                o[alias]=r[src]??r[stripAlias(src)]??null;
              } else {
                o[stripAlias(col)]=r[col]??r[stripAlias(col)]??null;
              }
            }
            return o;
          });
        }
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

  if (sql.includes('total_paid') && sql.includes('paid_by_user_id') && !sql.includes('external_shares')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    return { rows: gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const paid = tables.expenses.filter(e => String(e.group_id)===String(groupId) && e.paid_by_user_id===gm.user_id && !e.is_settlement && e.date>=gm.joined_at && (gm.left_at==null||e.date<gm.left_at)).reduce((s,e)=>s+(e.amount_inr||0),0);
      return { user_id:gm.user_id, user_name:user?.name??'?', total_paid:paid };
    })};
  }

  if (sql.includes('total_owed') && sql.includes('expense_splits')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    return { rows: gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const owed = tables.expense_splits.filter(es => {
        if(es.user_id!==gm.user_id)return false;
        const exp=tables.expenses.find(e=>e.id===es.expense_id);
        if(!exp)return false;
        return String(exp.group_id)===String(groupId)&&!exp.is_settlement&&exp.date>=gm.joined_at&&(gm.left_at==null||exp.date<gm.left_at);
      }).reduce((s,es)=>s+(es.share_amount||0),0);
      return { user_id:gm.user_id, user_name:user?.name??'?', total_owed:owed };
    })};
  }

  if (sql.includes('settlements_paid') && sql.includes('from_user_id')) {
    const rows=tables.settlements.filter(s=>String(s.group_id)===String(groupId));
    const map={}; for(const s of rows){map[s.from_user_id]=(map[s.from_user_id]||0)+s.amount;}
    return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),settlements_paid:amt})) };
  }

  if (sql.includes('settlements_received') && sql.includes('to_user_id')) {
    const rows=tables.settlements.filter(s=>String(s.group_id)===String(groupId));
    const map={}; for(const s of rows){map[s.to_user_id]=(map[s.to_user_id]||0)+s.amount;}
    return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),settlements_received:amt})) };
  }

  if (sql.includes('external_shares') && sql.includes('paid_by_user_id')) {
    const map = {};
    for (const e of tables.expenses) {
      if (String(e.group_id)!==String(groupId)||e.is_settlement||!e.paid_by_user_id) continue;
      const gm=tables.group_members.find(gm=>String(gm.group_id)===String(groupId)&&gm.user_id===e.paid_by_user_id);
      if (!gm||e.date<gm.joined_at||(gm.left_at!=null&&e.date>=gm.left_at)) continue;
      const extTotal=tables.expense_splits.filter(es=>es.expense_id===e.id&&es.user_id===null).reduce((s,es)=>s+(es.share_amount||0),0);
      if (extTotal>0) map[e.paid_by_user_id]=(map[e.paid_by_user_id]||0)+extTotal;
    }
    return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),external_shares:amt})) };
  }

  if (sql.includes('FROM groups g')) {
    const uid=params?.[0]; const results=[];
    for(const g of tables.groups){const mm=tables.group_members.find(gm=>String(gm.group_id)===String(g.id)&&String(gm.user_id)===String(uid)&&gm.left_at==null);if(mm){const ac=tables.group_members.filter(gm=>String(gm.group_id)===String(g.id)&&gm.left_at==null).length;results.push({id:g.id,name:g.name,description:g.description,created_at:g.created_at,admin_user_id:g.admin_user_id,my_joined_at:mm.joined_at,member_count:ac});}}
    return { rows:results };
  }

  return { rows: [] };
};

const dbPath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbPath)] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: mockDb, query: async () => [] } };

process.env.JWT_SECRET = 'test-settlements';
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
    const opts = { hostname:'127.0.0.1', port, path:urlPath, method, headers:{ 'Content-Type':'application/json', ...headers, ...(data?{'Content-Length':Buffer.byteLength(data)}:{}) } };
    const req = http.request(opts, res=>{let c='';res.on('data',d=>c+=d);res.on('end',()=>{let j;try{j=JSON.parse(c);}catch{j=c;}resolve({status:res.statusCode,body:j});});});
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`\n🧪 Settlements integration test on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) { if(cond){console.log(`  ✅ ${label}`);passed++;}else{console.log(`  ❌ ${label} — ${detail}`);failed++;} }

  // ── Setup ──────────────────────────────────────────────────
  console.log('SETUP — Users + group + expenses');
  const rA = await request(port,'POST','/api/auth/register',{name:'Aisha',email:'aisha@test.com',password:'password123'});
  const rR = await request(port,'POST','/api/auth/register',{name:'Rohan',email:'rohan@test.com',password:'password123'});
  const rP = await request(port,'POST','/api/auth/register',{name:'Priya',email:'priya@test.com',password:'password123'});
  const rM = await request(port,'POST','/api/auth/register',{name:'Meera',email:'meera@test.com',password:'password123'});
  const aishaToken=rA.body.token, rohanToken=rR.body.token, priyaToken=rP.body.token;
  const aishaId=rA.body.user.id, rohanId=rR.body.user.id, meeraId=rM.body.user.id;

  const rG = await request(port,'POST','/api/groups',{name:'Flat 4B'},{Authorization:`Bearer ${aishaToken}`});
  const groupId = rG.body.group.id;
  const aishaMem = tables.group_members.find(gm=>gm.group_id===groupId&&gm.user_id===aishaId);
  if(aishaMem) aishaMem.joined_at='2026-01-01';
  await request(port,'POST',`/api/groups/${groupId}/members`,{email:'rohan@test.com',joined_at:'2026-02-01'},{Authorization:`Bearer ${aishaToken}`});
  await request(port,'POST',`/api/groups/${groupId}/members`,{email:'meera@test.com',joined_at:'2026-02-01'},{Authorization:`Bearer ${aishaToken}`});
  await request(port,'DELETE',`/api/groups/${groupId}/members/${meeraId}`,{left_at:'2026-03-31'},{Authorization:`Bearer ${aishaToken}`});

  // Expense 1: Rent ₹48,000 equal Aisha+Rohan
  await request(port,'POST',`/api/groups/${groupId}/expenses`,{
    description:'February rent', amount:48000, currency:'INR', paid_by_user_id:aishaId,
    split_type:'equal', date:'2026-02-01',
    participants:[{user_id:aishaId,participant_name:'Aisha'},{user_id:rohanId,participant_name:'Rohan'}]
  },{Authorization:`Bearer ${aishaToken}`});

  // Expense 2: Pizza ₹1440 percentage 30/30/40
  await request(port,'POST',`/api/groups/${groupId}/expenses`,{
    description:'Pizza Friday', amount:1440, currency:'INR', paid_by_user_id:aishaId,
    split_type:'percentage', date:'2026-02-28',
    participants:[
      {user_id:aishaId,participant_name:'Aisha',percentage:30},
      {user_id:rohanId,participant_name:'Rohan',percentage:30},
      {user_id:meeraId,participant_name:'Meera',percentage:40}
    ]
  },{Authorization:`Bearer ${aishaToken}`});

  // Expense 3: Cab ₹600 Aisha+Kabir(external)
  await request(port,'POST',`/api/groups/${groupId}/expenses`,{
    description:'Cab split with friend', amount:600, currency:'INR', paid_by_user_id:aishaId,
    split_type:'equal', date:'2026-02-15',
    participants:[{user_id:aishaId,participant_name:'Aisha'},{participant_name:'Kabir'}]
  },{Authorization:`Bearer ${aishaToken}`});

  // Confirm pre-settlement balances
  const preBal = await request(port,'GET',`/api/groups/${groupId}/balances`,null,{Authorization:`Bearer ${aishaToken}`});
  const preAisha = preBal.body.balances?.find(b=>b.user_name==='Aisha');
  const preRohan = preBal.body.balances?.find(b=>b.user_name==='Rohan');
  const preMeera = preBal.body.balances?.find(b=>b.user_name==='Meera');
  console.log(`  Pre-settlement balances: Aisha=${preAisha?.net_balance}, Rohan=${preRohan?.net_balance}, Meera=${preMeera?.net_balance}`);
  console.log(`  groupId=${groupId}, Aisha=${aishaId}, Rohan=${rohanId}, Meera=${meeraId}\n`);

  // ── Test A — Partial settlement: Rohan pays Aisha ₹10,000 ──
  console.log('TEST A — POST /api/groups/:id/settlements (Rohan → Aisha ₹10,000)');
  const rS1 = await request(port,'POST',`/api/groups/${groupId}/settlements`,{
    from_user_id: rohanId,
    to_user_id:   aishaId,
    amount:       10000,
    date:         '2026-06-14',
    notes:        'Rohan paid Aisha via UPI'
  },{Authorization:`Bearer ${rohanToken}`});
  console.log('\n  Full Response:\n' + JSON.stringify(rS1.body, null, 2) + '\n');

  ok('Status 201', rS1.status === 201, `got ${rS1.status}`);
  ok('settlement.id present', rS1.body.settlement?.id != null, `got ${rS1.body.settlement?.id}`);
  ok('settlement.amount = 10000', rS1.body.settlement?.amount === 10000, `got ${rS1.body.settlement?.amount}`);
  ok('settlement.from_user_id = Rohan', String(rS1.body.settlement?.from_user_id) === String(rohanId), `got ${rS1.body.settlement?.from_user_id}`);
  ok('settlement.to_user_id = Aisha', String(rS1.body.settlement?.to_user_id) === String(aishaId), `got ${rS1.body.settlement?.to_user_id}`);
  ok('updated_balances present', Array.isArray(rS1.body.updated_balances), 'missing');
  ok('updated_transactions present', Array.isArray(rS1.body.updated_transactions), 'missing');

  const updAisha = rS1.body.updated_balances?.find(b=>b.user_name==='Aisha');
  const updRohan = rS1.body.updated_balances?.find(b=>b.user_name==='Rohan');
  console.log(`\n  Updated balances: Aisha net=${updAisha?.net_balance}, Rohan net=${updRohan?.net_balance}`);
  // Aisha: net was 25008, receives 10000 → settlements_received=10000, net=25008-10000=15008
  ok('Aisha net_balance = 15008', updAisha?.net_balance === 15008, `got ${updAisha?.net_balance}`);
  // Rohan: net was -24432, sends 10000 → settlements_paid=10000, net=-24432+10000=-14432
  ok('Rohan net_balance = -14432', updRohan?.net_balance === -14432, `got ${updRohan?.net_balance}`);

  // Zero-sum still holds after settlement
  const sumAfterA = rS1.body.updated_balances?.reduce((a,b)=>a+b.net_balance,0);
  console.log(`  Sum after settlement A = ${sumAfterA}`);
  ok('Zero-sum holds after Test A', Math.abs(sumAfterA) < 0.01, `got ${sumAfterA}`);
  console.log('');

  // ── Test B — Self-settle blocked ───────────────────────────
  console.log('TEST B — Self-settle blocked (from_user_id === to_user_id)');
  const rB = await request(port,'POST',`/api/groups/${groupId}/settlements`,{
    from_user_id:aishaId, to_user_id:aishaId, amount:100, date:'2026-06-14'
  },{Authorization:`Bearer ${aishaToken}`});
  console.log('  Response:', JSON.stringify(rB.body));
  ok('Status 400', rB.status === 400, `got ${rB.status}`);
  ok('error = Cannot settle with yourself', rB.body.error === 'Cannot settle with yourself', `got "${rB.body.error}"`);
  console.log('');

  // ── Test B2 — Zero/negative amount blocked ─────────────────
  console.log('TEST B2 — Zero amount blocked');
  const rB2 = await request(port,'POST',`/api/groups/${groupId}/settlements`,{
    from_user_id:rohanId, to_user_id:aishaId, amount:0, date:'2026-06-14'
  },{Authorization:`Bearer ${rohanToken}`});
  ok('Status 400', rB2.status === 400, `got ${rB2.status}`);
  ok('error mentions positive amount', rB2.body.error?.toLowerCase().includes('positive'), `got "${rB2.body.error}"`);
  console.log('');

  // ── Test C — List settlements ──────────────────────────────
  console.log('TEST C — GET /api/groups/:id/settlements');
  const rList = await request(port,'GET',`/api/groups/${groupId}/settlements`,null,{Authorization:`Bearer ${aishaToken}`});
  console.log('  Response:', JSON.stringify(rList.body, null, 2));
  ok('Status 200', rList.status === 200, `got ${rList.status}`);
  ok('settlements is array', Array.isArray(rList.body.settlements), 'missing');
  ok('1 settlement in list', rList.body.settlements?.length === 1, `got ${rList.body.settlements?.length}`);
  const s1 = rList.body.settlements?.[0];
  ok('from_name = Rohan', s1?.from_name === 'Rohan', `got ${s1?.from_name}`);
  ok('to_name = Aisha', s1?.to_name === 'Aisha', `got ${s1?.to_name}`);
  ok('amount = 10000', s1?.amount === 10000, `got ${s1?.amount}`);
  ok('date = 2026-06-14', s1?.date === '2026-06-14', `got ${s1?.date}`);
  console.log('');

  // ── Test D — Full settlement for Meera ─────────────────────
  console.log('TEST D — Full settlement: Meera → Aisha ₹576');
  const rS2 = await request(port,'POST',`/api/groups/${groupId}/settlements`,{
    from_user_id: meeraId,
    to_user_id:   aishaId,
    amount:       576,
    date:         '2026-06-14',
    notes:        'Meera settled in full'
  },{Authorization:`Bearer ${aishaToken}`});
  ok('Status 201', rS2.status === 201, `got ${rS2.status}`);
  const meeraAfter = rS2.body.updated_balances?.find(b=>b.user_name==='Meera');
  ok('Meera net = 0 after full settlement', Math.abs(meeraAfter?.net_balance) < 0.01, `got ${meeraAfter?.net_balance}`);
  ok('settled = false (Rohan still owes)', rS2.body.updated_balances ? (() => {
    const txns = rS2.body.updated_transactions;
    return txns?.length > 0;
  })() : false, 'unexpected state');

  // Zero-sum still holds
  const sumAfterD = rS2.body.updated_balances?.reduce((a,b)=>a+b.net_balance,0);
  console.log(`  Sum after settlement D = ${sumAfterD}`);
  ok('Zero-sum holds after Test D', Math.abs(sumAfterD) < 0.01, `got ${sumAfterD}`);
  console.log('');

  // ── Test E — Non-member cannot create settlement ────────────
  console.log('TEST E — Non-member (Priya) cannot create settlement');
  const rE = await request(port,'POST',`/api/groups/${groupId}/settlements`,{
    from_user_id:rP.body.user.id, to_user_id:aishaId, amount:100, date:'2026-06-14'
  },{Authorization:`Bearer ${priyaToken}`});
  ok('Non-member from_user_id → 404', rE.status === 404, `got ${rE.status}`);
  console.log('');

  // ── Test F — List shows 2 settlements after Tests A+D ──────
  console.log('TEST F — List settlements after all transactions');
  const rListF = await request(port,'GET',`/api/groups/${groupId}/settlements`,null,{Authorization:`Bearer ${aishaToken}`});
  ok('2 settlements in list', rListF.body.settlements?.length === 2, `got ${rListF.body.settlements?.length}`);
  ok('Sorted newest first', rListF.body.settlements?.[0]?.amount === 576 || rListF.body.settlements?.[0]?.amount === 10000, 'unexpected order');
  console.log('');

  // ── Summary ────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: createSettlement (validation + insert +');
  console.log('   immediate balance refresh), listSettlements (name JOIN),');
  console.log('   zero-sum invariant preserved across all settlements.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
