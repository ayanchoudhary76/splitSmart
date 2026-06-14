/**
 * EXTERNAL SHARES BALANCE FIX TEST — MOCK DB
 *
 * Scenario (from P7 participant validation test):
 *   Group: Flat 4B
 *   Members: Aisha (admin, joined Jan 1), Rohan (joined Feb 1), Meera (joined Feb 1, left Mar 31)
 *
 *   Expenses:
 *     1. Cab split — ₹600, paid by Aisha, split: Aisha ₹300 + Kabir(external) ₹300
 *     2. Pizza Friday — ₹1440, paid by Aisha, Aisha:432(30%) Rohan:432(30%) Meera:576(40%)
 *
 *   OLD (buggy) formula:
 *     Aisha: total_paid=2040, total_owed=732, net=+1308
 *     Rohan: total_paid=0,    total_owed=432, net=-432
 *     Meera: total_paid=0,    total_owed=576, net=-576
 *     SUM = 1308 - 432 - 576 = 300 ≠ 0  ← BUG: Kabir's ₹300 is unaccounted
 *
 *   NEW (fixed) formula — external_shares subtracted from payer's credit:
 *     Aisha: total_paid=2040, external_shares=300, total_owed=732, net=+1008
 *     Rohan: total_paid=0,    external_shares=0,   total_owed=432, net=-432
 *     Meera: total_paid=0,    external_shares=0,   total_owed=576, net=-576
 *     SUM = 1008 - 432 - 576 = 0  ✅
 *
 *   external_receivables: [{ payer_name: 'Aisha', amount: 300, note: 'Collect directly...' }]
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

  // QUERY A — total paid
  if (sql.includes('total_paid') && sql.includes('paid_by_user_id') && !sql.includes('external_shares')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    const result = gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const paid = tables.expenses
        .filter(e => String(e.group_id)===String(groupId) && e.paid_by_user_id===gm.user_id && !e.is_settlement && e.date>=gm.joined_at && (gm.left_at==null||e.date<gm.left_at))
        .reduce((s,e)=>s+(e.amount_inr||0),0);
      return { user_id:gm.user_id, user_name:user?.name??'?', total_paid:paid };
    });
    return { rows: result };
  }

  // QUERY B — total owed
  if (sql.includes('total_owed') && sql.includes('expense_splits')) {
    const gm_rows = tables.group_members.filter(gm => String(gm.group_id) === String(groupId));
    const result = gm_rows.map(gm => {
      const user = tables.users.find(u => u.id === gm.user_id);
      const owed = tables.expense_splits
        .filter(es => {
          if(es.user_id!==gm.user_id)return false;
          const exp=tables.expenses.find(e=>e.id===es.expense_id);
          if(!exp)return false;
          return String(exp.group_id)===String(groupId)&&!exp.is_settlement&&exp.date>=gm.joined_at&&(gm.left_at==null||exp.date<gm.left_at);
        })
        .reduce((s,es)=>s+(es.share_amount||0),0);
      return { user_id:gm.user_id, user_name:user?.name??'?', total_owed:owed };
    });
    return { rows: result };
  }

  // QUERY C — settlements paid
  if (sql.includes('settlements_paid') && sql.includes('from_user_id')) {
    const rows=tables.settlements.filter(s=>String(s.group_id)===String(groupId));
    const map={};for(const s of rows){map[s.from_user_id]=(map[s.from_user_id]||0)+s.amount;}
    return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),settlements_paid:amt})) };
  }

  // QUERY D — settlements received
  if (sql.includes('settlements_received') && sql.includes('to_user_id')) {
    const rows=tables.settlements.filter(s=>String(s.group_id)===String(groupId));
    const map={};for(const s of rows){map[s.to_user_id]=(map[s.to_user_id]||0)+s.amount;}
    return { rows:Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),settlements_received:amt})) };
  }

  // QUERY E — external shares (es.user_id IS NULL)
  if (sql.includes('external_shares') && sql.includes('paid_by_user_id')) {
    const map = {};
    for (const e of tables.expenses) {
      if (String(e.group_id) !== String(groupId) || e.is_settlement || !e.paid_by_user_id) continue;
      // Date-range check against payer's membership
      const gm = tables.group_members.find(gm => String(gm.group_id)===String(groupId) && gm.user_id===e.paid_by_user_id);
      if (!gm) continue;
      if (e.date < gm.joined_at) continue;
      if (gm.left_at != null && e.date >= gm.left_at) continue;

      const extSplits = tables.expense_splits.filter(es => es.expense_id===e.id && es.user_id===null);
      const extTotal = extSplits.reduce((s,es)=>s+(es.share_amount||0),0);
      if (extTotal > 0) {
        map[e.paid_by_user_id] = (map[e.paid_by_user_id]||0) + extTotal;
      }
    }
    return { rows: Object.entries(map).map(([uid,amt])=>({user_id:parseInt(uid),external_shares:amt})) };
  }

  // getMyGroups raw query
  if (sql.includes('FROM groups g')) {
    const uid=params?.[0]; const results=[];
    for(const g of tables.groups){const mm=tables.group_members.find(gm=>String(gm.group_id)===String(g.id)&&String(gm.user_id)===String(uid)&&gm.left_at==null);if(mm){const ac=tables.group_members.filter(gm=>String(gm.group_id)===String(g.id)&&gm.left_at==null).length;results.push({id:g.id,name:g.name,description:g.description,created_at:g.created_at,admin_user_id:g.admin_user_id,my_joined_at:mm.joined_at,member_count:ac});}}
    return { rows: results };
  }

  return { rows: [] };
};

const dbPath = path.resolve(__dirname, 'src/config/db.js');
require.cache[require.resolve(dbPath)] = { id: dbPath, filename: dbPath, loaded: true, exports: { db: mockDb, query: async () => [] } };

process.env.JWT_SECRET = 'test-external-balance';
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
  console.log(`\n🧪 External shares balance fix test on port ${port} (MOCK DB)\n`);

  let passed = 0, failed = 0;
  function ok(label, cond, detail) { if(cond){console.log(`  ✅ ${label}`);passed++;}else{console.log(`  ❌ ${label} — ${detail}`);failed++;} }

  // ── Setup (identical to participant validation test) ───────
  console.log('SETUP — 4 users, group, Aisha+Rohan+Meera as members');
  const rA = await request(port,'POST','/api/auth/register',{name:'Aisha',email:'aisha@test.com',password:'password123'});
  const rR = await request(port,'POST','/api/auth/register',{name:'Rohan',email:'rohan@test.com',password:'password123'});
  await request(port,'POST','/api/auth/register',{name:'Priya',email:'priya@test.com',password:'password123'});
  const rM = await request(port,'POST','/api/auth/register',{name:'Meera',email:'meera@test.com',password:'password123'});
  const aishaToken=rA.body.token, aishaId=rA.body.user.id, rohanId=rR.body.user.id, meeraId=rM.body.user.id;

  const rG = await request(port,'POST','/api/groups',{name:'Flat 4B'},{Authorization:`Bearer ${aishaToken}`});
  const groupId = rG.body.group.id;
  const aishaMem = tables.group_members.find(gm=>gm.group_id===groupId&&gm.user_id===aishaId);
  if(aishaMem) aishaMem.joined_at='2026-01-01';

  await request(port,'POST',`/api/groups/${groupId}/members`,{email:'rohan@test.com',joined_at:'2026-02-01'},{Authorization:`Bearer ${aishaToken}`});
  await request(port,'POST',`/api/groups/${groupId}/members`,{email:'meera@test.com',joined_at:'2026-02-01'},{Authorization:`Bearer ${aishaToken}`});
  await request(port,'DELETE',`/api/groups/${groupId}/members/${meeraId}`,{left_at:'2026-03-31'},{Authorization:`Bearer ${aishaToken}`});

  // Expense 1: Cab split — Aisha+Kabir(external) equal ₹600
  await request(port,'POST',`/api/groups/${groupId}/expenses`,{
    description:'Cab split with friend', amount:600, currency:'INR',
    paid_by_user_id:aishaId, split_type:'equal', date:'2026-02-15',
    participants:[{user_id:aishaId,participant_name:'Aisha'},{participant_name:'Kabir'}]
  },{Authorization:`Bearer ${aishaToken}`});

  // Expense 2: Pizza Friday — Aisha/Rohan/Meera percentage 30/30/40
  await request(port,'POST',`/api/groups/${groupId}/expenses`,{
    description:'Pizza Friday', amount:1440, currency:'INR',
    paid_by_user_id:aishaId, split_type:'percentage', date:'2026-02-28',
    participants:[
      {user_id:aishaId,participant_name:'Aisha',percentage:30},
      {user_id:rohanId,participant_name:'Rohan',percentage:30},
      {user_id:meeraId,participant_name:'Meera',percentage:40}
    ]
  },{Authorization:`Bearer ${aishaToken}`});

  console.log(`  groupId=${groupId}, Aisha=${aishaId}, Rohan=${rohanId}, Meera=${meeraId}\n`);

  // ── GET /api/groups/:id/balances ────────────────────────────
  console.log('TEST — GET /api/groups/:id/balances');
  const rBal = await request(port,'GET',`/api/groups/${groupId}/balances`,null,{Authorization:`Bearer ${aishaToken}`});
  console.log('\n  Full Response:\n' + JSON.stringify(rBal.body, null, 2) + '\n');

  ok('Status 200', rBal.status === 200, `got ${rBal.status}`);
  ok('Has external_receivables', Array.isArray(rBal.body.external_receivables), 'missing');

  const aisha = rBal.body.balances?.find(b=>b.user_name==='Aisha');
  const rohan = rBal.body.balances?.find(b=>b.user_name==='Rohan');
  const meera = rBal.body.balances?.find(b=>b.user_name==='Meera');

  // ── Verify external_shares on Aisha ────────────────────────
  console.log('VERIFY — Aisha.external_shares = 300 (Kabir\'s cab share)');
  ok('Aisha external_shares = 300', aisha?.external_shares === 300, `got ${aisha?.external_shares}`);
  ok('Rohan external_shares = 0',   rohan?.external_shares === 0,   `got ${rohan?.external_shares}`);
  ok('Meera external_shares = 0',   meera?.external_shares === 0,   `got ${meera?.external_shares}`);
  console.log('');

  // ── Verify corrected net_balances ──────────────────────────
  // Aisha: total_paid=2040, external_shares=300, total_owed=732
  //   net = (2040-300) + 0 - 732 - 0 = 1740 - 732 = 1008
  // Rohan: total_paid=0, total_owed=432  → net = -432
  // Meera: total_paid=0, total_owed=576  → net = -576
  console.log('VERIFY — Corrected net_balances:');
  console.log(`  Aisha: total_paid=2040, external_shares=300, total_owed=732`);
  console.log(`  net = (2040 - 300) - 732 = 1008`);
  console.log(`  DB: net_balance=${aisha?.net_balance}, total_owed=${aisha?.total_owed}`);
  ok('Aisha total_paid = 2040', aisha?.total_paid === 2040, `got ${aisha?.total_paid}`);
  ok('Aisha total_owed = 732',  aisha?.total_owed === 732,  `got ${aisha?.total_owed}`);
  ok('Aisha net_balance = 1008', aisha?.net_balance === 1008, `got ${aisha?.net_balance}`);
  ok('Rohan net_balance = -432', rohan?.net_balance === -432, `got ${rohan?.net_balance}`);
  ok('Meera net_balance = -576', meera?.net_balance === -576, `got ${meera?.net_balance}`);
  console.log('');

  // ── THE KEY INVARIANT: sum = 0 ────────────────────────────
  console.log('VERIFY — Zero-sum invariant:');
  const sum = rBal.body.balances?.reduce((acc, b) => acc + b.net_balance, 0) ?? NaN;
  console.log(`  ${rBal.body.balances?.map(b=>`${b.user_name}: ${b.net_balance}`).join(' + ')} = ${sum}`);
  ok('Sum of all net_balances = 0', Math.abs(sum) < 0.01, `got ${sum}`);
  console.log('');

  // ── external_receivables ───────────────────────────────────
  console.log('VERIFY — external_receivables:');
  const extRecv = rBal.body.external_receivables;
  console.log('  ' + JSON.stringify(extRecv));
  ok('1 external receivable (Kabir)', extRecv?.length === 1, `got ${extRecv?.length}`);
  ok('payer_name = Aisha', extRecv?.[0]?.payer_name === 'Aisha', `got ${extRecv?.[0]?.payer_name}`);
  ok('amount = 300', extRecv?.[0]?.amount === 300, `got ${extRecv?.[0]?.amount}`);
  ok('note = Collect directly', extRecv?.[0]?.note?.includes('Collect directly'), `got ${extRecv?.[0]?.note}`);
  console.log('');

  // ── Transactions reflect corrected net ─────────────────────
  console.log('VERIFY — Minimized transactions:');
  const txns = rBal.body.transactions;
  for (const t of txns) console.log(`  ${t.from_name} → ${t.to_name}: ₹${t.amount}`);
  ok('Rohan → Aisha: 432', txns?.some(t=>t.from_name==='Rohan'&&t.to_name==='Aisha'&&t.amount===432), `got ${JSON.stringify(txns?.find(t=>t.from_name==='Rohan'))}`);
  ok('Meera → Aisha: 576', txns?.some(t=>t.from_name==='Meera'&&t.to_name==='Aisha'&&t.amount===576), `got ${JSON.stringify(txns?.find(t=>t.from_name==='Meera'))}`);
  // Total flow must equal Aisha's net (1008)
  const totalFlow = txns?.reduce((a,t)=>a+t.amount,0);
  ok('Transaction total = 1008 (= Aisha net)', Math.abs(totalFlow - 1008) < 0.01, `got ${totalFlow}`);
  ok('settled = false', rBal.body.settled === false, `got ${rBal.body.settled}`);
  console.log('');

  // ── Confirm no external participant in group balances ───────
  const priya = rBal.body.balances?.find(b=>b.user_name==='Priya');
  ok('Priya absent (not a member)', priya == null, 'Priya found!');
  const kabir = rBal.body.balances?.find(b=>b.user_name==='Kabir');
  ok('Kabir absent (external, not a member)', kabir == null, 'Kabir found!');
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: queryExternalShares (Query E),');
  console.log('   updated net_balance formula, external_receivables in summary.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => { console.error(err); process.exit(1); });
