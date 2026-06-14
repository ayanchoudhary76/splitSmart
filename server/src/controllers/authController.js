const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');
const { db } = require('../config/db');

/**
 * Create a signed JWT containing the user's id, name, and email.
 */
function makeToken(user) {
  return jwt.sign(
    { id: user.id, name: user.name, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}

/**
 * POST /api/auth/register
 */
async function register(req, res, next) {
  try {
    // Validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    const { name, email, password } = req.body;

    // Check if email already exists (case-insensitive)
    const existing = await db('users')
      .whereRaw('LOWER(email) = LOWER(?)', [email])
      .first();

    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    // Hash password
    const password_hash = await bcrypt.hash(password, 10);

    // Insert user and return id, name, email
    const [user] = await db('users')
      .insert({ name, email, password_hash })
      .returning(['id', 'name', 'email']);

    return res.status(201).json({
      token: makeToken(user),
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/auth/login
 */
async function login(req, res, next) {
  try {
    // Validation
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user by email (case-insensitive)
    const user = await db('users')
      .whereRaw('LOWER(email) = LOWER(?)', [email])
      .first();

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    return res.status(200).json({
      token: makeToken(user),
      user: { id: user.id, name: user.name, email: user.email }
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /api/auth/me
 * Protected — requires requireAuth middleware.
 */
function me(req, res) {
  return res.status(200).json(req.user);
}

module.exports = { register, login, me };
