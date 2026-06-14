const knex = require('knex');
// Tell the pg driver to return DATE columns as plain strings, not Date objects
// Without this, "2026-02-01" (IST) becomes "2026-01-31T18:30:00.000Z" after UTC conversion
const { types } = require('pg');
types.setTypeParser(1082, val => val); // 1082 = DATE type OID in PostgreSQL
const isProduction = process.env.NODE_ENV === 'production';

const db = knex({
  client: 'pg',
  connection: isProduction
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : process.env.DATABASE_URL,
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
