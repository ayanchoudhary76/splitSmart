/**
 * AUTH INTEGRATION TEST — MOCK DB
 * 
 * ⚠️  This test uses an in-memory mock of the Knex DB module.
 *     It does NOT connect to a real PostgreSQL database.
 *     All 4 tests run against mock data. Once you have a real
 *     DATABASE_URL (Neon), run migrations and re-test against real DB.
 *
 * What IS tested (real code):
 *   - Express routing & middleware chain
 *   - express-validator validation rules
 *   - bcryptjs hashing & comparison
 *   - jsonwebtoken sign & verify
 *   - requireAuth middleware (token parsing, error handling)
 *   - authController logic (register, login, me)
 *
 * What is MOCKED:
 *   - Knex DB calls (db('users').where/insert/first/returning)
 */

const http = require('http');

// ── In-memory user store ──────────────────────────────────────
const users = [];
let nextId = 1;

// ── Mock the knex db module BEFORE requiring the app ──────────
// We override require's cache so that when authController does
// require('../config/db'), it gets our mock.
const path = require('path');
const dbModulePath = path.resolve(__dirname, 'src/config/db.js');

// Build a chainable query builder mock
function createQueryBuilder(tableName) {
  const state = { table: tableName, wheres: [], inserts: null, returning: null };

  const builder = {
    whereRaw(sql, params) {
      state.wheres.push({ type: 'raw', sql, params });
      return builder;
    },
    where(col, val) {
      state.wheres.push({ type: 'eq', col, val });
      return builder;
    },
    first() {
      // Execute the "query" against our in-memory store
      let results = [...users];
      for (const w of state.wheres) {
        if (w.type === 'raw' && w.sql.includes('LOWER')) {
          const email = w.params[0].toLowerCase();
          results = results.filter(u => u.email.toLowerCase() === email);
        }
      }
      return Promise.resolve(results[0] || null);
    },
    insert(data) {
      state.inserts = data;
      return builder;
    },
    returning(cols) {
      // Execute the insert
      const row = { id: nextId++, ...state.inserts };
      users.push(row);
      const projected = {};
      for (const c of cols) projected[c] = row[c];
      return Promise.resolve([projected]);
    }
  };

  return builder;
}

const mockDb = function (tableName) {
  return createQueryBuilder(tableName);
};

// Provide the same exports as config/db.js
require.cache[require.resolve(dbModulePath)] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { db: mockDb, query: async () => [] }
};

// ── Set env vars ──────────────────────────────────────────────
process.env.JWT_SECRET = 'test-secret-key-for-verification';
process.env.PORT = '0'; // Will let OS pick a port
process.env.CLIENT_URL = 'http://localhost:5173';

// ── Build the Express app (without calling .listen in index.js) ──
// We'll construct it manually to control the port.
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
app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.use('/api', routes);
app.use(errorHandler);

// ── HTTP helpers ──────────────────────────────────────────────
function request(port, method, path, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {})
      }
    };
    const req = http.request(opts, (res) => {
      let chunks = '';
      res.on('data', (c) => chunks += c);
      res.on('end', () => {
        let json;
        try { json = JSON.parse(chunks); } catch { json = chunks; }
        resolve({ status: res.statusCode, body: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// ── Run tests ─────────────────────────────────────────────────
async function runTests() {
  const server = app.listen(0);
  const port = server.address().port;
  console.log(`\\n🧪 Test server running on port ${port} (MOCK DB)\\n`);

  let savedToken = null;
  let passed = 0;
  let failed = 0;

  function assert(label, condition, detail) {
    if (condition) {
      console.log(`  ✅ ${label}`);
      passed++;
    } else {
      console.log(`  ❌ ${label} — ${detail}`);
      failed++;
    }
  }

  // ── Test 1: Register ────────────────────────────────────────
  console.log('TEST 1 — POST /api/auth/register');
  const r1 = await request(port, 'POST', '/api/auth/register', {
    name: 'Aisha',
    email: 'aisha@test.com',
    password: 'password123'
  });
  console.log('  Response:', JSON.stringify(r1.body));
  assert('Status 201', r1.status === 201, `got ${r1.status}`);
  assert('Has token', typeof r1.body.token === 'string', 'no token');
  assert('User has id', typeof r1.body.user?.id === 'number', 'no user.id');
  assert('User name = Aisha', r1.body.user?.name === 'Aisha', `got ${r1.body.user?.name}`);
  assert('User email = aisha@test.com', r1.body.user?.email === 'aisha@test.com', `got ${r1.body.user?.email}`);
  console.log('');

  // ── Test 1b: Duplicate registration ─────────────────────────
  console.log('TEST 1b — POST /api/auth/register (duplicate email)');
  const r1b = await request(port, 'POST', '/api/auth/register', {
    name: 'Aisha2',
    email: 'aisha@test.com',
    password: 'password123'
  });
  console.log('  Response:', JSON.stringify(r1b.body));
  assert('Status 409', r1b.status === 409, `got ${r1b.status}`);
  assert('Error message', r1b.body.error === 'Email already registered', `got ${r1b.body.error}`);
  console.log('');

  // ── Test 1c: Validation errors ──────────────────────────────
  console.log('TEST 1c — POST /api/auth/register (bad input)');
  const r1c = await request(port, 'POST', '/api/auth/register', {
    name: '',
    email: 'not-an-email',
    password: '123'
  });
  console.log('  Response:', JSON.stringify(r1c.body));
  assert('Status 422', r1c.status === 422, `got ${r1c.status}`);
  assert('Has errors array', Array.isArray(r1c.body.errors), 'no errors array');
  console.log('');

  // ── Test 2: Login ───────────────────────────────────────────
  console.log('TEST 2 — POST /api/auth/login');
  const r2 = await request(port, 'POST', '/api/auth/login', {
    email: 'aisha@test.com',
    password: 'password123'
  });
  console.log('  Response:', JSON.stringify(r2.body));
  assert('Status 200', r2.status === 200, `got ${r2.status}`);
  assert('Has token', typeof r2.body.token === 'string', 'no token');
  assert('User id matches', r2.body.user?.id === r1.body.user?.id, `id mismatch`);
  savedToken = r2.body.token;
  console.log('');

  // ── Test 2b: Login wrong password ───────────────────────────
  console.log('TEST 2b — POST /api/auth/login (wrong password)');
  const r2b = await request(port, 'POST', '/api/auth/login', {
    email: 'aisha@test.com',
    password: 'wrongpassword'
  });
  console.log('  Response:', JSON.stringify(r2b.body));
  assert('Status 401', r2b.status === 401, `got ${r2b.status}`);
  assert('Error = Invalid credentials', r2b.body.error === 'Invalid credentials', `got ${r2b.body.error}`);
  console.log('');

  // ── Test 3: GET /me with token ──────────────────────────────
  console.log('TEST 3 — GET /api/auth/me (with token)');
  const r3 = await request(port, 'GET', '/api/auth/me', null, {
    Authorization: `Bearer ${savedToken}`
  });
  console.log('  Response:', JSON.stringify(r3.body));
  assert('Status 200', r3.status === 200, `got ${r3.status}`);
  assert('Has id', typeof r3.body.id === 'number', 'no id');
  assert('Name = Aisha', r3.body.name === 'Aisha', `got ${r3.body.name}`);
  assert('Email = aisha@test.com', r3.body.email === 'aisha@test.com', `got ${r3.body.email}`);
  console.log('');

  // ── Test 4: GET /me without token ───────────────────────────
  console.log('TEST 4 — GET /api/auth/me (no token)');
  const r4 = await request(port, 'GET', '/api/auth/me', null);
  console.log('  Response:', JSON.stringify(r4.body));
  assert('Status 401', r4.status === 401, `got ${r4.status}`);
  assert('Error = No token provided', r4.body.error === 'No token provided', `got ${r4.body.error}`);
  console.log('');

  // ── Test 4b: GET /me with garbage token ─────────────────────
  console.log('TEST 4b — GET /api/auth/me (invalid token)');
  const r4b = await request(port, 'GET', '/api/auth/me', null, {
    Authorization: 'Bearer garbage.token.here'
  });
  console.log('  Response:', JSON.stringify(r4b.body));
  assert('Status 401', r4b.status === 401, `got ${r4b.status}`);
  assert('Error = Invalid or expired token', r4b.body.error === 'Invalid or expired token', `got ${r4b.body.error}`);
  console.log('');

  // ── Summary ─────────────────────────────────────────────────
  console.log('═'.repeat(50));
  console.log(`  ${passed} passed, ${failed} failed, ${passed + failed} total`);
  console.log('═'.repeat(50));
  console.log('');
  console.log('⚠️  All tests ran against MOCK DB (in-memory).');
  console.log('   Real code exercised: routing, validation, bcrypt, JWT.');
  console.log('   Once you set DATABASE_URL and run migrations, re-test');
  console.log('   against the real Neon PostgreSQL database.');

  server.close();
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
