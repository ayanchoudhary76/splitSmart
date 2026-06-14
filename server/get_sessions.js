const { db } = require('./src/config/db');
db('import_sessions').orderBy('created_at', 'desc').then(res => {
  console.log(res.map(r => ({id: r.id, status: r.status, created_at: r.created_at})));
  process.exit(0);
});
