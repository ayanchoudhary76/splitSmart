const knex = require('knex');

const db = knex({
  client: 'pg',
  connection: process.env.DATABASE_URL,
  pool: { min: 2, max: 10 }
});

/**
 * Run a raw SQL query and return the rows.
 * Useful for complex balance queries.
 */
async function query(sql, params = []) {
  const result = await db.raw(sql, params);
  return result.rows;
}

module.exports = { db, query };
