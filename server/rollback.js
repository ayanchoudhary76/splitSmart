const jwt = require('jsonwebtoken');

const token = jwt.sign({ id: 1, email: 'aisha@example.com' }, '__sahilberwal', { expiresIn: '1d' });
const headers = { 'Authorization': `Bearer ${token}` };

async function run() {
  try {
    const r1 = await fetch('http://localhost:5000/api/import/1/sessions/8', { method: 'DELETE', headers });
    const d1 = await r1.json();
    console.log('Rollback:', d1);

    const r2 = await fetch('http://localhost:5000/api/groups/1/expenses?limit=100', { headers });
    const d2 = await r2.json();
    console.log('Total Expenses:', d2.total);

    const r3 = await fetch('http://localhost:5000/api/groups/1/balances', { headers });
    const d3 = await r3.json();
    console.log('Balances:', JSON.stringify(d3.balances, null, 2));
    console.log('Sum Net Balances:', d3.balances.reduce((s,b) => s + b.net_balance, 0));
  } catch (err) {
    console.error(err);
  }
}
run();
